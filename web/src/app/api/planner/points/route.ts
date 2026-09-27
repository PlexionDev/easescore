import type { NextRequest } from "next/server";
import { MAP_LIMIT, parseFilters, plannerPoints } from "@/lib/planner";

// Map points for the filtered set, highest scores first: [parid, lon, lat, score, band].
export async function GET(req: NextRequest) {
  try {
    const pts = await plannerPoints(parseFilters(req.nextUrl.searchParams), MAP_LIMIT);
    return Response.json(pts, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`[planner] ${req.nextUrl.pathname} failed:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not load map points." }, { status: 502 });
  }
}
