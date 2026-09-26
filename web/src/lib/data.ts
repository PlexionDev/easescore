import "server-only";

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

export type SearchHit = { parid: string; house_num: string | null; address: string | null; city: string | null; zip: string | null;
  muni_desc: string | null; use_desc: string | null; match: string; score: number };

// Forgiving search in the database: parcel IDs with/without dashes, map-block-lot, and addresses with
// extra city/state/ZIP words, spelled-out suffixes, directionals, and small typos.
export async function searchParcels(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  return (await rpc<SearchHit[]>("search_parcels", { q, max_results: 25 })) ?? [];
}
