// GET /api/search?q=...&limit=8 — live results for the address/parcel-ID search dropdown.
// Thin wrapper around searchParcels(); never returns owner names (SearchHit carries none).

import { searchParcels, type SearchHit } from "@/lib/data";

export const runtime = "nodejs";

const MIN_LEN = 3;
const MAX_LEN = 120;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 8;

type SearchResponse = { hits: SearchHit[] };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_LEN);

  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT;

  if (q.length < MIN_LEN) {
    return Response.json({ hits: [] } satisfies SearchResponse, {
      headers: { "Cache-Control": "private, max-age=10" },
    });
  }

  const hits = await searchParcels(q, limit);
  return Response.json({ hits: hits.slice(0, limit) } satisfies SearchResponse, {
    headers: { "Cache-Control": "private, max-age=10" },
  });
}
