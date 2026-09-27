import type { NextRequest } from "next/server";
import { need } from "@/lib/nonprofit/data";

// Need for one City neighborhood: tract ACS figures, QCT/DDA, HUD income limits, and which of the
// datasets still being loaded (CHAS, LIHTC, ACS detail) exist yet.
export async function GET(req: NextRequest) {
  const hood = (req.nextUrl.searchParams.get("hood") ?? "").slice(0, 60);
  if (!hood) return Response.json({ error: "Pick a neighborhood." }, { status: 400 });
  const data = await need(hood);
  return Response.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
}
