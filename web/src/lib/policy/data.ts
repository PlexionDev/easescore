import "server-only";
import type { Places, PolicyMeta, PolicyState, Summary } from "./model";

// Server-side reads for the Policy Analyst seat through the Supabase Data API with the publishable key
// (RLS keeps it read-only). The only write is policy_request, which queues a lever state for the
// background job and cannot change any result.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const headers = { apikey: KEY, "Content-Type": "application/json" };

async function get<T>(path: string, extra: Record<string, string> = {}): Promise<T | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { ...headers, ...extra }, cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function policyMeta(): Promise<PolicyMeta | null> {
  const rows = await get<{ payload: PolicyMeta; computed_at: string }[]>("policy_meta?select=payload,computed_at&id=eq.inputs");
  return rows?.[0] ? { ...rows[0].payload, computed_at: rows[0].computed_at } : null;
}

const STATE_COLS = "key,status,done,total,summary,computed_at,config_version";

/** One lever state. While the job is still running, the summary is aggregated live from the rows so far. */
export async function policyState(key: string): Promise<PolicyState> {
  const rows = await get<PolicyState[]>(`policy_states?select=${STATE_COLS}&key=eq.${encodeURIComponent(key)}`);
  const st = rows?.[0];
  if (!st) return { key, status: "missing", done: 0, total: null, summary: null, computed_at: null, config_version: null };
  if (st.status === "queued") {
    // Queue position: states the background job will finish first.
    const q = await get<{ key: string; status: string }[]>("policy_states?select=key,status&status=in.(queued,running)&order=requested_at");
    const i = q ? q.findIndex((x) => x.key === key) : -1;
    if (i >= 0) st.ahead = i;
  }
  if (st.status !== "done" && st.status !== "queued") {
    const live = await rpc<Summary>("policy_summary", { p_key: key });
    if (live && live.eligible > 0) st.summary = { ...(st.summary ?? {}), ...live } as Summary;
  }
  return st;
}

export async function policyStates(): Promise<PolicyState[]> {
  return (await get<PolicyState[]>(`policy_states?select=${STATE_COLS}&order=key`)) ?? [];
}

export const requestState = (key: string, levers: unknown) => rpc<{ key: string; status: string }>("policy_request", { p_key: key, p_levers: levers });

export type PolicyPoint = [string, number, number, number, string, boolean, boolean | null, number];
/** policy_points returns at most this many rows (ordered by homes added, then parcel ID). */
const RPC_CAP = 60000;
type PointRow = { parid: string; lon: number; lat: number; units_delta: number; touched: string[] | null; units_before: number | null; pencils_likely: boolean | null };
/** The rows policy_points leaves out past its cap, in the same order, read page by page from policy_results. */
async function pointsAfter(key: string, last: PolicyPoint): Promise<PolicyPoint[]> {
  const [lastParid, , , lastDelta] = last;
  const path = `policy_results?select=parid,lon,lat,units_delta,touched,units_before,pencils_likely&key=eq.${encodeURIComponent(key)}`
    + `&units_delta=gt.0&lon=not.is.null&or=(units_delta.lt.${lastDelta},and(units_delta.eq.${lastDelta},parid.gt.${encodeURIComponent(lastParid)}))`
    + "&order=units_delta.desc,parid";
  const out: PolicyPoint[] = [];
  for (let from = 0, page = 0; page < 100; page++) {
    const rows = await get<PointRow[]>(path, { Range: `${from}-${from + 999}`, "Range-Unit": "items" });
    if (!rows?.length) break;
    for (const r of rows) out.push([r.parid, r.lon, r.lat, r.units_delta, (r.touched ?? []).join("+"), (r.units_before ?? 0) === 0, r.pencils_likely, r.units_before ?? 0]);
    from += rows.length;
    if (rows.length < 1000) break;
  }
  return out;
}

/** Most points a map carries (browser and packet). */
export const MAX_POINTS = 40000;
/**
 * Map points for every parcel that gains homes. When there are more than MAX_POINTS, keep an even sample
 * across the whole list (every k-th parcel), never the first N by parcel ID (that drops whole wards); the
 * map legend and packet caption say "showing N of M".
 */
export const policyPoints = async (key: string): Promise<PolicyPoint[]> => {
  const all = (await rpc<PolicyPoint[]>("policy_points", { p_key: key, p_limit: RPC_CAP })) ?? [];
  if (all.length === RPC_CAP) all.push(...(await pointsAfter(key, all[all.length - 1]!)));
  if (all.length <= MAX_POINTS) return all;
  const step = all.length / MAX_POINTS;
  return Array.from({ length: MAX_POINTS }, (_, i) => all[Math.floor(i * step)]!);
};

export interface ResultRow {
  parid: string; touched: string[]; units_before: number | null; units_after: number | null; units_delta: number;
  strategy_after: string | null; pencils_low: boolean | null; pencils_likely: boolean | null; pencils_high: boolean | null;
  av_delta_likely: number; neighborhood: string | null; zoning: string | null;
}

/** Every parcel a lever state touches, paged through the Data API. */
export async function policyRows(key: string, onlyGaining = false): Promise<ResultRow[]> {
  const cols = "parid,touched,units_before,units_after,units_delta,strategy_after,pencils_low,pencils_likely,pencils_high,av_delta_likely,neighborhood,zoning";
  const path = `policy_results?select=${cols}&key=eq.${encodeURIComponent(key)}${onlyGaining ? "&units_delta=gt.0" : ""}&order=units_delta.desc,parid`;
  // The API caps each response (1,000 rows), so a full City export is ~100 pages: fetch them in parallel
  // waves, retry a failed page once, and fail loudly rather than return a silently truncated list.
  const fetchPage = async (from: number, size: number) =>
    (await get<ResultRow[]>(path, { Range: `${from}-${from + size - 1}`, "Range-Unit": "items" })) ??
    (await get<ResultRow[]>(path, { Range: `${from}-${from + size - 1}`, "Range-Unit": "items" }));
  const first = await fetchPage(0, 10000);
  if (!first) throw new Error("policy_results could not be read");
  const out: ResultRow[] = [...first];
  const size = first.length;
  if (!size) return out;
  const WAVE = 8;
  for (let from = size, done = false; !done && from < 400000; from += size * WAVE) {
    const pages = await Promise.all(Array.from({ length: WAVE }, (_, i) => fetchPage(from + i * size, size)));
    for (const rows of pages) {
      if (!rows) throw new Error("policy_results page could not be read");
      out.push(...rows);
      if (rows.length < size) { done = true; break; }
    }
  }
  return out;
}

/** Whether a table exists and has rows (datasets another agent is still loading). */
export async function hasRows(table: string): Promise<boolean> {
  const rows = await get<unknown[]>(`${table}?select=*&limit=1`);
  return !!rows && rows.length > 0;
}

type Ring = [number, number][];
export interface Outline {
  type: "FeatureCollection";
  features: { properties: { name: string }; geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } }[];
}
export const hoodOutlines = () => rpc<Outline>("policy_hood_outlines", {});

export const policyPlaces = (key: string) => rpc<Places>("policy_places", { p_key: key });

export interface WhoTract {
  geoid: string; name: string | null; parcels: number; homes: number; acs_year: string | null;
  median_hh_income: number | null; median_hh_income_moe: number | null; renter_share_pct: number | null;
  rent_burden_30_pct: number | null; rent_burden_50_pct: number | null; median_gross_rent: number | null; poverty_pct: number | null;
  price_change_pct: number | null; displacement_flag: boolean | null;
}
export interface Who {
  acs_year: string | null; price_window: string | null; city_median_income: number | null; homes: number; homes_with_income: number;
  homes_below_city_median: number; homes_high_burden: number; homes_majority_renter: number; homes_displacement_flag: number; tracts: WhoTract[];
}
export const policyWho = (key: string) => rpc<Who>("policy_who", { p_key: key });

/** Stored context for a finished state (written by the batch), else null. */
export async function storedContext(key: string): Promise<{ places: Places | null; who: Who | null } | null> {
  const rows = await get<{ status: string; places: Places | null; who: Who | null }[]>(`policy_states?select=status,places,who&key=eq.${encodeURIComponent(key)}`);
  const r = rows?.[0];
  return r && r.status === "done" && r.places && r.who ? { places: r.places, who: r.who } : null;
}
