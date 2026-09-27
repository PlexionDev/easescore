// Planner seat: Data API reads for the precomputed parcel_scores table, plus everything in
// ./planner-query (filters, query builder, CSV). Reads use the publishable key; RLS keeps the table
// read-only.

import { filtersToDb, MAP_LIMIT, PAGE_SIZE, type Dir, type Filters, type PlannerOptions, type PlannerPoint, type PlannerResult, type Sort } from "./planner-query";

export * from "./planner-query";

// ------------------------------------------------------------------------------ reads (server)

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  if (!r.ok) throw new Error(`${fn} failed (${r.status})`);
  return (await r.json()) as T;
}

// Short in-memory cache: scores change only when the batch reruns, and the broadest queries take ~1 s.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
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
export const plannerOptions = () => cached("options", () => rpc<PlannerOptions>("planner_options", {}));

