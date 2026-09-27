import type { Metadata } from "next";
import { hasRows, policyMeta, policyState, policyStates } from "@/lib/policy/data";
import { scenarioFromQuery, stateKey } from "@/lib/policy/model";
import PolicyApp from "./PolicyApp";

export const metadata: Metadata = {
  title: "Test a rule change · EaseScore.AI",
  description: "For policy analysts: change a zoning rule and see how many homes it allows by right, where, whether they pencil, and what each taxing body collects.",
};

// Policy Analyst seat. Lever states are precomputed by scripts/policy_batch.ts into policy_states /
// policy_results; the page reads one state's summary and its map points.
export default async function PolicyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const initial = scenarioFromQuery(sp);
  const key = stateKey(initial.levers);
  const [meta, state, states, acs, geo] = await Promise.all([
    policyMeta(), policyState(key), policyStates(),
    hasRows("acs_tract"), hasRows("parcel_geo"),
  ]);
  return <PolicyApp initial={initial} initialState={state} meta={meta} states={states} flags={{ acs, geo }} />;
}
