import type { NextRequest } from "next/server";
import { sites } from "@/lib/nonprofit/data";
import { parseState } from "@/lib/nonprofit/types";

// Candidate lots in a neighborhood from the precomputed scores (public / vacant / no red flags by default).
export async function GET(req: NextRequest) {
  const s = parseState(req.nextUrl.searchParams);
  const res = await sites(s.hood, s.filters, 60);
  if (!res) return Response.json({ error: "Could not load sites." }, { status: 502 });
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
