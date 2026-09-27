// GET /api/rents/<parid> — rents by bedroom count (RentCast ZIP market statistics, HUD SAFMR and ZORI cross-checks).
// This on-demand user route is the ONLY place allowed to make a live RentCast call (allowLive), and
// only when the parcel's ZIP is not cached; each call is reserved and counted in the database
// (50/day, 800/month ET). Otherwise the rent falls back to HUD Small Area FMR with an honest label.

import { forScreen, loadRents } from "@/lib/rents";

export async function GET(_request: Request, ctx: RouteContext<"/api/rents/[parid]">) {
  const { parid } = await ctx.params;
  if (!/^[0-9A-Z]{16}$/i.test(parid)) return Response.json({ error: "Parcel not found" }, { status: 404 });
  const asOf = new Date().toISOString().slice(0, 10);
  const r = await loadRents(parid, asOf, undefined, undefined, { allowLive: true, caller: "api/rents" });
  if (!r) return Response.json({ error: "Data temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(forScreen(r), { headers: { "Cache-Control": "private, max-age=600" } });
}
