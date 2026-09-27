import type { NextRequest } from "next/server";
import { parseKey, stateKey } from "@/lib/policy/model";
import { policyPoints } from "@/lib/policy/data";

// GET /api/policy/points?s=<key> -> [parid, lon, lat, homes added, levers, newly buildable, pencils (likely)]
// for every parcel that gains homes under the lever state (the "policy wave" map).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = stateKey(parseKey(req.nextUrl.searchParams.get("s") ?? "base"));
  return Response.json(await policyPoints(key), { headers: { "Cache-Control": "public, max-age=60" } });
}
