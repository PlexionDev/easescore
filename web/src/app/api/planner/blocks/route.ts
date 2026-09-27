import type { NextRequest } from "next/server";
import { plannerBlocks } from "@/lib/planner";

// Block faces for the planner map's block-conformity layer (migration 131): [lon, lat, share, buildings, top rule, street].
export async function GET(req: NextRequest) {
  try {
    return Response.json(await plannerBlocks(), { headers: { "Cache-Control": "public, max-age=1800" } });
  } catch (e) {
    console.error(`[planner] ${req.nextUrl.pathname} failed:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not load block faces." }, { status: 502 });
  }
}
