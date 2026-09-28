import { score } from "@easescore/engine";

// Existing building or not-housing parcels (Planner lists): no Feasibility study or PDF.
// Returns the pane's "Not modeled: ..." sentence, or null (also on any lookup error).
export async function notModeledNote(parid: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const get = (path: string) => fetch(`${url}/rest/v1/${path}&parid=eq.${encodeURIComponent(parid)}`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ reason: string }[]>) : [])).catch(() => [] as { reason: string }[]);
  const [other, unscored] = await Promise.all([get("planner_other_public_land?select=reason"), get("planner_building_unscored?select=reason")]);
  const tail = ". EaseScore screens vacant and underused lots for new homes.";
  if (other[0]?.reason) return `Not modeled: ${score.partialText("not_housing", { use: other[0].reason }).replace(/^./, (m) => m.toLowerCase())}${tail}`;
  const r = unscored[0]?.reason;
  if (r === "use" || r === "footprint" || r === "not_lot") return `Not modeled: an existing major building stands on this lot${tail}`;
  if (r === "no_outline" || r === "lot_mismatch" || r === "large_site") return `Not modeled: ${score.partialText(r).replace(/^./, (m) => m.toLowerCase())}${tail}`;
  return null;
}
