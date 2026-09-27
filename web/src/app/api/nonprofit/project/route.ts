import type { NextRequest } from "next/server";
import { projectCost } from "@/lib/nonprofit/project";
import { parseState } from "@/lib/nonprofit/types";

export const maxDuration = 30;

// Development cost of the chosen lots (same pro forma as the parcel page, rental tenure, homes per lot),
// plus the context the capital-source eligibility rules read. Rents, debt and the gap are computed in the
// browser from this (engine/src/affordable), so switching sources on and off needs no round trip.
export async function GET(req: NextRequest) {
  const s = parseState(req.nextUrl.searchParams);
  if (!s.lots.length) return Response.json({ error: "Pick at least one lot." }, { status: 400 });
  const res = await projectCost(s.lots, s.perLot, s.bedrooms);
  return Response.json(res, { headers: { "Cache-Control": "private, max-age=300" } });
}
