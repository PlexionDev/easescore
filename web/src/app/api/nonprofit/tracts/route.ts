import { tractMap } from "@/lib/nonprofit/data";

// Every Allegheny County census tract (simplified) with ACS rent burden, median income and QCT/DDA flags,
// for the need map. Area context only: never used to score parcels.
export async function GET() {
  const fc = await tractMap();
  if (!fc) return Response.json({ error: "Tract map not available." }, { status: 502 });
  return Response.json(fc, { headers: { "Cache-Control": "public, max-age=3600" } });
}
