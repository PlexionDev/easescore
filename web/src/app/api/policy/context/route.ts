import type { NextRequest } from "next/server";
import { parseKey, stateKey } from "@/lib/policy/model";
import { policyPlaces, policyWho } from "@/lib/policy/data";

// GET /api/policy/context?s=<key> -> { places, who }: homes by council district, added value by school
// district (for the ledger), and census context for the tracts that gain capacity (context only).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = stateKey(parseKey(req.nextUrl.searchParams.get("s") ?? "base"));
  const [places, who] = await Promise.all([policyPlaces(key), policyWho(key)]);
  return Response.json({ places, who }, { headers: { "Cache-Control": "no-store" } });
}
