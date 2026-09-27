import type { NextRequest } from "next/server";
import { parseKey, stateKey } from "@/lib/policy/model";
import { policyState, policyStates, requestState } from "@/lib/policy/data";

// GET /api/policy/state?s=<lever state key>  -> the state's status, progress and summary.
// A state nobody has computed yet is queued for the background job (scripts/policy_batch.ts --queue),
// and the page shows its progress. GET /api/policy/state?all=1 lists every computed state (goal seek).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("all")) return Response.json(await policyStates(), { headers: { "Cache-Control": "no-store" } });
  const levers = parseKey(q.get("s") ?? "base");
  const key = stateKey(levers);
  let st = await policyState(key);
  if (st.status === "missing" && key !== "base") {
    await requestState(key, levers);
    st = await policyState(key);
  }
  return Response.json(st, { headers: { "Cache-Control": "no-store" } });
}
