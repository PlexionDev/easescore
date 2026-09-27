import "server-only";
import { createHash } from "node:crypto";
import { buildRow, dayET, dedupeMaterial, pickMedians, type MedianRow, type ScenarioInput } from "./core";

// Scenario collection is OFF unless SCENARIO_COLLECTION=1 (unset in production until the owner
// approves the notice text). Nothing in this file logs a request body, header or ID.
export const collectionEnabled = () => process.env.SCENARIO_COLLECTION === "1";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Insert one scenario with the service key; duplicates (same dedupe_key) are ignored. */
export async function insertScenario(s: ScenarioInput): Promise<boolean> {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!URL || !key) return false;
  const row = buildRow(s, dayET());
  const dedupe_key = createHash("sha256").update(dedupeMaterial(row)).digest("hex");
  try {
    const r = await fetch(`${URL}/rest/v1/scenario_submissions?on_conflict=dedupe_key`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ ...row, dedupe_key }), cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Community medians for a parcel's strategy + tier (n >= 5 only, enforced in SQL and again here). */
export async function communityMedians(parid: string, strategy: string, tier: string | null): Promise<Record<string, MedianRow>> {
  if (!URL || !PUB) return {};
  const h = { apikey: PUB, "Content-Type": "application/json" };
  try {
    const a = await fetch(`${URL}/rest/v1/assessments?select=municode&parid=eq.${encodeURIComponent(parid)}&limit=1`, { headers: h, cache: "no-store", signal: AbortSignal.timeout(2000) });
    const muni = a.ok ? (((await a.json()) as { municode: string | null }[])[0]?.municode ?? null) : null;
    const r = await fetch(`${URL}/rest/v1/rpc/scenario_community_medians`, {
      method: "POST", headers: h, body: JSON.stringify({ p_strategy: strategy, p_tier: tier, p_municode: muni }), cache: "no-store", signal: AbortSignal.timeout(2000),
    });
    return r.ok ? pickMedians((await r.json()) as MedianRow[]) : {};
  } catch {
    return {};
  }
}
