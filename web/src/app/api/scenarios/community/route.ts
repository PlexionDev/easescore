// GET /api/scenarios/community?parid=&strategy=&tier= — whether scenario collection is on and, if so,
// the community medians of user-entered budget lines ($/SF) with n >= 5. Suggestions only: no engine
// default changes from these numbers.

import { communityMedians, collectionEnabled } from "@/lib/scenarios/server";

export async function GET(request: Request) {
  if (!collectionEnabled()) return Response.json({ enabled: false, medians: {} }, { headers: { "Cache-Control": "public, max-age=300" } });
  const q = new URL(request.url).searchParams;
  const parid = (q.get("parid") ?? "").toUpperCase();
  const strategy = q.get("strategy") ?? "";
  const tier = q.get("tier");
  if (!/^[0-9A-Z]{16}$/.test(parid) || !/^[a-z0-9_]{1,40}$/.test(strategy) || (tier != null && !/^[A-Za-z0-9_.-]{1,40}$/.test(tier))) {
    return Response.json({ enabled: true, medians: {} }, { headers: { "Cache-Control": "no-store" } });
  }
  const medians = await communityMedians(parid, strategy, tier);
  return Response.json({ enabled: true, medians }, { headers: { "Cache-Control": "private, max-age=300" } });
}
