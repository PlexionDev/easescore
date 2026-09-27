// Planner seat: Data API reads for the precomputed parcel_scores table, plus everything in
// ./planner-query (filters, query builder, CSV). Reads use the publishable key; RLS keeps the table
// read-only.

import { filtersToDb, MAP_LIMIT, PAGE_SIZE, type Dir, type Filters, type PlannerOptions, type PlannerPoint, type PlannerResult, type Sort } from "./planner-query";

export * from "./planner-query";

// ------------------------------------------------------------------------------ reads (server)

/** One Data API call, retried once (a cold database or a busy batch can time a statement out). Errors are logged. */
async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
      });
      if (r.ok) return (await r.json()) as T;
      last = `${r.status} ${(await r.text()).slice(0, 200)}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    console.error(`[planner] ${fn} attempt ${attempt + 1} failed: ${last}`);
    if (attempt === 0) await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error(`${fn} failed: ${last}`);
}

// Short in-memory cache: scores change only when the batch reruns, and the broadest queries take ~1 s.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

export const plannerQuery = (f: Filters, sort: Sort, dir: Dir, limit = PAGE_SIZE, offset = 0) => {
  const body = { p_filters: filtersToDb(f), p_limit: limit, p_offset: offset, p_sort: sort, p_dir: dir };
  return cached(`q:${JSON.stringify(body)}`, () => rpc<PlannerResult>("planner_query", body));
};
export const plannerPoints = (f: Filters, limit = MAP_LIMIT) => {
  const body = { p_filters: filtersToDb(f), p_limit: limit };
  return cached(`p:${JSON.stringify(body)}`, () => rpc<PlannerPoint[]>("planner_points", body));
};
/** Block faces for the map's block-conformity layer: [lon, lat, share nonconforming, buildings, top rule, street]. */
export type BlockPoint = [number, number, number, number, string | null, string | null];
export const plannerBlocks = () => cached("blocks", () => rpc<BlockPoint[]>("block_conformity_points", {}), 30 * 60_000);
// Options change when a batch adds a municipality or district; keep them fresher.
export const plannerOptions = () => cached("options", () => rpc<PlannerOptions>("planner_options", {}), 60_000);

