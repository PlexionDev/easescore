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

export const incomeLimits = () =>
  cached("il", 3_600_000, async () => (await select<IncomeLimitsRowLite>("hud_income_limits?select=*&order=year.desc&limit=1"))?.[0] ?? null);

export function sites(hood: string, f: SiteFilters, limit = 60) {
  return cached(`sites:${hood.toLowerCase()}:${JSON.stringify(f)}:${limit}`, 120_000, () =>
    rpc<SitesResult>("nonprofit_sites", { p_hood: hood, p_public: f.public, p_vacant: f.vacant, p_clean: f.clean, p_min_units: f.minUnits, p_limit: limit }));
}

/** County + City + school district millage (City of Pittsburgh only for now). */
export const pittsburghMills = () =>
  cached("mills", 3_600_000, async () => {
    const rows = await select<{ code: string; name: string; mills: string; year: number }>("millage?select=code,name,mills,year&rate_type=eq.general&code=in.(42003,CITY_PGH,sd:pittsburgh)");
    if (!rows || rows.length !== 3) return null;
    return { total: rows.reduce((t, r) => t + Number(r.mills), 0), year: rows[0]!.year, text: rows.map((r) => `${r.name} ${Number(r.mills)}`).join(" + ") };
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
    select<{ parid: string; agency_name: string | null; owner_class: string | null }>(`parcel_owner_class?select=parid,agency_name,owner_class&parid=in.(${ids})`),
  ]);
  const poOf = new Map((po ?? []).map((r) => [r.parid.trim(), r]));
  const ocOf = new Map((oc ?? []).map((r) => [r.parid.trim(), r]));
  const byId = new Map((rows ?? []).map((r) => {
    const id = r.parid.trim();
    return [id, { ...r, parid: id, agency: ocOf.get(id)?.agency_name ?? poOf.get(id)?.owner_category ?? null, agency_status: poOf.get(id)?.status ?? null, agency_class: ocOf.get(id)?.owner_class ?? null, geoid: null, qct: false, dda: false }];
  }));
  return parids.map((p) => byId.get(p)).filter(Boolean) as import("./types").Site[];
}
