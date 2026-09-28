// GET /api/pane/<parid> — the parcel pane's data (the same loader the parcel page uses) with a
// Server-Timing header for every server step, so a browser's network panel shows where time goes.
// "source" says whether it came from the precomputed row or was computed live.

import { todayET } from "@/lib/date";
import { parcelMap, quickfitInput } from "@/lib/data";
import { loadPane } from "@/lib/pane";
import { Timing } from "@/lib/timing";

export async function GET(request: Request, ctx: RouteContext<"/api/pane/[parid]">) {
  const { parid } = await ctx.params;
  const T = new Timing("api/pane", parid);
  const asOf = todayET();
  const withMap = new URL(request.url).searchParams.get("map") === "1";
  const qf = quickfitInput(parid);
  const [loaded] = await Promise.all([loadPane(parid, asOf, qf, T), withMap ? T.time("rpc_parcel_map", parcelMap(parid)) : null]);
  const headers = { "Server-Timing": T.header(), "Cache-Control": "no-store" };
  if (!loaded.ok) return Response.json({ error: loaded.error ? "Data temporarily unavailable" : "Parcel not found" }, { status: loaded.error ? 503 : 404, headers });
  // Parcel data changes at most daily: browsers keep it 5 min, the CDN 1 h, and may serve a stale copy for a day while refreshing.
  return Response.json({ source: loaded.source, payload: loaded.payload }, { headers: { ...headers, "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } });
}
