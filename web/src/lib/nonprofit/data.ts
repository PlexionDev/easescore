import "server-only";

// Nonprofit / CDC seat: database reads (publishable key; RLS keeps everything read-only).
// Functions from supabase/migrations/190_nonprofit_seat.sql; HUD limits from 061; tract designations
// from 063; ACS detail, CHAS, LIHTC and ownership classes from 100–104. Each of those is probed by
// table name (empty tables count as not loaded) and shown as "not loaded yet" until it has rows.

import type { Area, IncomeLimitsRowLite, NeedData, OptionalDataset, SiteFilters, SitesResult } from "./types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function rpc<T>(fn: string, body: Record<string, unknown>, timeoutMs = 8000): Promise<T | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function select<T>(pathAndQuery: string, timeoutMs = 6000): Promise<T[] | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: KEY }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? ((await r.json()) as T[]) : null;
  } catch {
    return null;
  }
}

/** Small in-process cache for slow-changing reads. */
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>;
  const v = f();
  memo.set(key, { at: Date.now(), v });
  // Failed reads are not kept.
  v.then((x) => { if (x == null) memo.delete(key); }, () => memo.delete(key));
  return v;
}

export const neighborhoods = () =>
  cached("hoods", 3_600_000, async () => (await select<{ name: string }>("neighborhoods?select=name&order=name"))?.map((r) => r.name) ?? null);

export const area = (hood: string) => cached(`area:${hood.toLowerCase()}`, 600_000, () => rpc<Area>("nonprofit_area", { p_hood: hood }));

export const tractMap = () => cached("tractmap", 3_600_000, () => rpc<GeoJSON.FeatureCollection>("nonprofit_tract_map", {}, 15000));

/** Block-group need map (migration 191): same properties as the tract map, plus the ACS vintage. */
export const bgMap = () => cached("bgmap", 3_600_000, () => rpc<GeoJSON.FeatureCollection & { vintage?: string; acs_year?: number }>("nonprofit_bg_map", {}, 15000));

export const incomeLimits = () =>
  cached("il", 3_600_000, async () => (await select<IncomeLimitsRowLite>("hud_income_limits?select=*&order=year.desc&limit=1"))?.[0] ?? null);

export function sites(hood: string, f: SiteFilters, limit = 60) {
  return cached(`sites:${hood.toLowerCase()}:${JSON.stringify(f)}:${limit}`, 120_000, () =>
    rpc<SitesResult>("nonprofit_sites", { p_hood: hood, p_public: f.public, p_vacant: f.vacant, p_clean: f.clean, p_min_units: f.minUnits, p_limit: limit }));
}

/** Same normalization as public.school_key() (migration 105), so parcel_geo school names match millage_rates. */
export function schoolKey(n: string): string {
  return n.toUpperCase().replace(/[^A-Z]/g, "").replace(/(CITY|BORO|TWP|TOWNSHIP|AREA)$/, "").replace("WESTJEFFERSONHILLS", "WESTJEFFERSON");
}

/**
 * Total general millage (County + municipality + school district) for the chosen lots, from the
 * millage_rates view: two small indexed reads. Averaged when lots differ; null when none resolves
 * (e.g. split-rate cities with no general rate).
 */
export function lotMills(parids: string[]) {
  return cached(`mills:${parids.join(",")}`, 3_600_000, async () => {
    if (!parids.length) return null;
    const geo = await select<{ parid: string; muni_code: string | null; school_district: string | null }>(`parcel_geo?select=parid,muni_code,school_district&parid=in.(${parids.join(",")})`);
    if (!geo?.length) return null;
    const munis = [...new Set(geo.map((g) => g.muni_code).filter(Boolean))] as string[];
    const schools = [...new Set(geo.map((g) => (g.school_district ? schoolKey(g.school_district) : null)).filter(Boolean))] as string[];
    const rows = await select<{ body_type: string; body_name: string; mills: string; year: number; muni_code: string | null; school_key: string | null }>(
      `millage_rates?select=body_type,body_name,mills,year,muni_code,school_key&rate_type=eq.general&or=(body_type.eq.county${munis.length ? `,muni_code.in.(${munis.join(",")})` : ""}${schools.length ? `,school_key.in.(${schools.join(",")})` : ""})`,
    );
    if (!rows?.length) return null;
    const county = rows.find((r) => r.body_type === "county");
    const per = geo.map((g) => {
      const m = rows.find((r) => r.body_type === "municipality" && r.muni_code === g.muni_code);
      const sd = g.school_district ? rows.find((r) => r.body_type === "school_district" && r.school_key === schoolKey(g.school_district!)) : undefined;
      return county && m && sd ? { total: Number(county.mills) + Number(m.mills) + Number(sd.mills), text: `${county.year} millage: ${[county, m, sd].map((r) => `${titleName(r.body_name)} ${Number(r.mills)}`).join(" + ")} (Allegheny County Treasurer millage tables)` } : null;
    }).filter(Boolean) as { total: number; text: string }[];
    if (!per.length) return null;
    const texts = [...new Set(per.map((p) => p.text))];
    return { total: Math.round((100 * per.reduce((t, p) => t + p.total, 0)) / per.length) / 100, text: texts.length === 1 ? texts[0]! : `Average of ${per.length} lots: ${texts.join("; ")}` };
  });
}
const titleName = (n: string) => n.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

/** Latest FRED 30-year fixed mortgage average (MORTGAGE30US), or null when not loaded. */
export const mortgageRate = () =>
  cached("mortgage30", 3_600_000, async () => {
    const r = (await select<{ value: string | number; date: string }>("market_series?select=value,date&series_id=eq.MORTGAGE30US&order=date.desc&limit=1"))?.[0];
    const v = r ? Number(r.value) : NaN;
    return r && Number.isFinite(v) ? { rate: v / 100, date: r.date, source: `FRED MORTGAGE30US (Freddie Mac 30-year fixed average), week of ${r.date}` } : null;
  });

// ------------------------------------------------------------------------------ datasets being loaded

const CANDIDATES: Record<OptionalDataset["id"], { name: string; tables: string[] }> = {
  chas: { name: "HUD CHAS (households by income and cost burden)", tables: ["chas_tract"] },
  lihtc: { name: "HUD LIHTC project database", tables: ["lihtc_projects"] },
  acs_detail: { name: "Census ACS detail (poverty, renter counts)", tables: ["acs_tract"] },
  owner_class: { name: "Ownership classes (agency names)", tables: ["parcel_owner_class"] },
};

async function exists(table: string): Promise<boolean> {
  try {
    const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: KEY }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    return r.ok && ((await r.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

/** Which of the datasets being loaded exist yet (checked every 5 minutes). */
export const datasets = () =>
  cached("datasets", 300_000, async () =>
    Promise.all((Object.keys(CANDIDATES) as OptionalDataset["id"][]).map(async (id): Promise<OptionalDataset> => {
      const c = CANDIDATES[id];
      for (const t of c.tables) if (await exists(t)) return { id, name: c.name, table: t, loaded: true };
      return { id, name: c.name, table: null, loaded: false };
    })),
  );

export async function need(hood: string): Promise<NeedData> {
  const [a, il, ds] = await Promise.all([area(hood), incomeLimits(), datasets()]);
  return { area: a, il, datasets: ds };
}

/** The chosen lots' precomputed rows with the owning agency (for the brief). Small indexed reads. */
export async function lotsDetail(parids: string[]): Promise<import("./types").Site[]> {
  if (!parids.length) return [];
  const ids = parids.join(",");
  const [rows, po, oc] = await Promise.all([
    select<import("./types").Site>(`parcel_scores?select=parid,address,score,band,best_strategy,by_right_units,units_with_relief,months_to_permit,red_flag_count,red_flags,top_blocker,zoning,lot_sqft,vacant,owner_class,tax_delinquent,municipality,lon,lat,preliminary&parid=in.(${ids})`),
    select<{ parid: string; owner_category: string | null; status: string | null }>(`public_owned?select=parid,owner_category,status&parid=in.(${ids})`),
    select<{ parid: string; agency_name: string | null; owner_class: string | null; city_program: string | null }>(`parcel_owner_class?select=parid,agency_name,owner_class,city_program&parid=in.(${ids})`),
  ]);
  const poOf = new Map((po ?? []).map((r) => [r.parid.trim(), r]));
  const ocOf = new Map((oc ?? []).map((r) => [r.parid.trim(), r]));
  const byId = new Map((rows ?? []).map((r) => {
    const id = r.parid.trim();
    return [id, { ...r, parid: id, agency: ocOf.get(id)?.agency_name ?? poOf.get(id)?.owner_category ?? null, agency_status: poOf.get(id)?.status ?? null, agency_class: ocOf.get(id)?.owner_class ?? null, city_program: ocOf.get(id)?.city_program ?? null, geoid: null, qct: false, dda: false }];
  }));
  return parids.map((p) => byId.get(p)).filter(Boolean) as import("./types").Site[];
}
