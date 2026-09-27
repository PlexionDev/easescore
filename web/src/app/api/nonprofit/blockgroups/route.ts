import { bgMap } from "@/lib/nonprofit/data";

// Every populated Allegheny County census block group (simplified) with ACS 5-year rent burden, median
// income, median rent and poverty, for the need map's block-group level. Area context only: never used
// to score parcels.
export async function GET() {
  const fc = await bgMap();
  if (!fc) return Response.json({ error: "Block-group map not available." }, { status: 502 });
  return Response.json(fc, { headers: { "Cache-Control": "public, max-age=3600" } });
}
