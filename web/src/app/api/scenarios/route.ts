// POST /api/scenarios — store one anonymous pro forma scenario (TODO item 6).
// Off unless SCENARIO_COLLECTION=1. Reads only the JSON body (never headers, cookies, IP, user agent or
// referrer), rebuilds it from an allowlist, and never logs it. Always answers 204 with no body, so the
// response carries no ID that could tie the scenario to a log line.

import { sanitizeScenario } from "@/lib/scenarios/core";
import { collectionEnabled, insertScenario } from "@/lib/scenarios/server";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BYTES = 8_000;

export async function POST(request: Request) {
  if (!collectionEnabled()) return new Response(null, { status: 204, headers: NO_STORE });
  let body: unknown = null;
  try {
    const text = await request.text();
    if (text.length <= MAX_BYTES) body = JSON.parse(text);
  } catch { /* malformed: ignored */ }
  const s = sanitizeScenario(body);
  if (s) await insertScenario(s);
  return new Response(null, { status: 204, headers: NO_STORE });
}
