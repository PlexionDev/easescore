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

export type SearchHit = { parid: string; house_num: string | null; address: string | null; city: string | null; muni_desc: string | null; use_desc: string | null };

export async function searchParcels(q: string): Promise<SearchHit[]> {
  const cleaned = q.trim().toUpperCase();
  if (!cleaned) return [];
  const select = "select=parid,house_num,address,city,muni_desc,use_desc&limit=25&order=address,house_num";
  const id = cleaned.replace(/[^0-9A-Z]/g, "");
  if (/^\d{4}[A-Z]\d{5}\d{6}$/.test(id) || /^[0-9A-Z]{16}$/.test(id)) {
    const r = await fetch(`${URL}/rest/v1/assessments?${select}&parid=eq.${id}`, { headers, cache: "no-store" });
    return r.ok ? r.json() : [];
  }
  const m = cleaned.match(/^(\d+)\s+(.+)$/);
  const street = encodeURIComponent(`*${(m ? m[2] : cleaned).replace(/[*,()]/g, "")}*`);
  const house = m ? `&house_num=eq.${m[1]}` : "";
  const r = await fetch(`${URL}/rest/v1/assessments?${select}&address=ilike.${street}${house}`, { headers, cache: "no-store" });
  return r.ok ? r.json() : [];
}
