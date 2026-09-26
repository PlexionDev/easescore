import "server-only";
import { score } from "@easescore/engine";

// Server-side reads through the Supabase Data API with the publishable key.
// Row Level Security keeps this read-only; secret keys are never used here.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const headers = { apikey: KEY, "Content-Type": "application/json" };

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

export const parcelFacts = (parid: string) => rpc<Record<string, unknown>>("parcel_facts", { p_parid: parid });
export const salesComps = (parid: string) => rpc<Record<string, unknown>>("parcel_sales_comps", { p_parid: parid });
export const rentComps = (parid: string) => rpc<Record<string, unknown>>("parcel_rent_comps", { p_parid: parid });
export const parcelMap = (parid: string) => rpc<any>("parcel_map", { p_parid: parid });
export const quickfitInput = (parid: string) => rpc<any>("parcel_quickfit_input", { p_parid: parid });

// Ease Score inputs. Each returns null on any failure (HTTP error, network error, bad JSON), so the
// affected factor shows "evidence missing" instead of breaking the page.
const soft = <T,>(p: Promise<T | null>) => p.catch(() => null);
export const easeInputs = (parid: string) => soft(rpc<score.EaseInputsRpc>("parcel_ease_inputs", { p_parid: parid }));
export const zbaGrantRates = (district: string | null | undefined) =>
  district ? soft(rpc<{ by_relief?: Record<string, score.ZbaReliefCounts> }>("zba_grant_rates", { p_district: district })) : Promise.resolve(null);

/**
 * Building-permit times for the score, keyed "new_build" / "rehab" (queries from the score config).
 * Measured medians are empty today, so the engine falls back to the City's review target
 * (target_calendar_days), which it labels "City target, not measured".
 */
export async function permitTimes(): Promise<Partial<Record<"new_build" | "rehab", score.PermitTimeStats>> | undefined> {
  const q = score.DEFAULT_CONFIG.f5.permitTimeQueries;
  const [nb, rh] = await Promise.all([
    soft(rpc<score.PermitTimeStats>("permit_time_estimate", { p_permit_type: q.new_build.permit_type, p_work_type: q.new_build.work_type })),
    soft(rpc<score.PermitTimeStats>("permit_time_estimate", { p_permit_type: q.rehab.permit_type, p_work_type: q.rehab.work_type })),
  ]);
  const out: Partial<Record<"new_build" | "rehab", score.PermitTimeStats>> = {};
  if (nb) out.new_build = nb;
  if (rh) out.rehab = rh;
  return Object.keys(out).length ? out : undefined;
}

export type SearchHit = { parid: string; house_num: string | null; address: string | null; city: string | null; zip: string | null;
  muni_desc: string | null; use_desc: string | null; match: string; score: number };

// Forgiving search in the database: parcel IDs with/without dashes, map-block-lot, and addresses with
// extra city/state/ZIP words, spelled-out suffixes, directionals, and small typos.
export async function searchParcels(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  return (await rpc<SearchHit[]>("search_parcels", { q, max_results: 25 })) ?? [];
}
