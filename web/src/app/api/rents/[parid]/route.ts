// GET /api/rents/<parid> — rents by bedroom count (RentCast listings, HUD SAFMR and ZORI cross-checks).
// Screen copy only: comp addresses are block-level. RentCast is called server-side (3 s timeout,
// quota-guarded); without it the result falls back to the labeled HUD/ZORI benchmark.

import { forScreen, loadRents } from "@/lib/rents";

export async function GET(_request: Request, ctx: RouteContext<"/api/rents/[parid]">) {
  const { parid } = await ctx.params;
  if (!/^[0-9A-Z]{16}$/i.test(parid)) return Response.json({ error: "Parcel not found" }, { status: 404 });
  const asOf = new Date().toISOString().slice(0, 10);
  const r = await loadRents(parid, asOf);
  if (!r) return Response.json({ error: "Data temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(forScreen(r), { headers: { "Cache-Control": "private, max-age=600" } });
}
