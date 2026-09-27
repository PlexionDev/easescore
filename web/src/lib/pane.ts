import "server-only";

// The parcel pane's data: one precomputed row from public.parcel_pane when it exists for the current
// config version, otherwise computed live from the per-parcel database functions (same result).
// Every step is timed (lib/timing.ts).

import { assumptions, score } from "@easescore/engine";
import { easeInputs, parcelFactsChecked, permitTimes, rentComps, salesComps, zbaGrantRates } from "@/lib/data";
import { newConstructionSalesNear, primeRate, singleFamilyComps, tapFeesPerHome } from "@/lib/proforma";
import { buildPane, fetchZbaCitywide, fromStored, PANE_VERSION, type PanePayload, type StoredPane } from "@/lib/pane-core";
import type { Timing } from "@/lib/timing";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export type PaneSource = "row" | "live";
export type PaneLoad =
  | { ok: true; payload: PanePayload; source: PaneSource }
  | { ok: false; error: boolean };

/** The stored row for this parcel, or null (missing, other config version, or any error). */
async function readRow(parid: string): Promise<PanePayload | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/parcel_pane?select=payload&parid=eq.${encodeURIComponent(parid)}&config_version=eq.${encodeURIComponent(PANE_VERSION)}`, {
      headers: { apikey: KEY }, cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as { payload: StoredPane }[];
    return rows[0]?.payload ? fromStored(rows[0].payload) : null;
  } catch {
    return null;
  }
}

async function compDetails(sales: { comps?: { parid: string }[] | null } | null) {
  const ids = [...new Set((sales?.comps ?? []).map((c) => c.parid))];
  if (!ids.length) return {};
  try {
    const r = await fetch(`${URL}/rest/v1/assessments?select=parid,year_built,condition_desc&parid=in.(${ids.join(",")})`, { headers: { apikey: KEY }, cache: "no-store" });
    const rows = r.ok ? ((await r.json()) as { parid: string; year_built: number | null; condition_desc: string | null }[]) : [];
    return Object.fromEntries(rows.map((x) => [x.parid, { year_built: x.year_built, condition_desc: x.condition_desc }]));
  } catch {
    return {};
  }
}

/** Computes the pane live (no stored row): per-parcel database calls in parallel, then the engine. */
async function live(parid: string, asOf: string, quickfit: Promise<unknown>, T: Timing): Promise<PaneLoad> {
  const factsR = T.time("rpc_parcel_facts", parcelFactsChecked(parid));
  const factsP = factsR.then((x) => x.facts);
  const salesP = T.time("rpc_sales_comps", salesComps(parid));
  const [fr, sales, rent, qf, ease, zba, permits, sfComps, prime, tapFees, newSales, details, zbaCity] = await Promise.all([
    factsR, salesP, T.time("rpc_rent_comps", rentComps(parid)), T.time("rpc_quickfit_input", quickfit), T.time("rpc_ease_inputs", easeInputs(parid)),
    factsP.then((f) => T.time("rpc_zba", zbaGrantRates((f as { zoning?: { code?: string } } | null)?.zoning?.code))),
    T.time("rpc_permit_times", permitTimes()),
    salesP.then((x) => T.time("rpc_sf_comps", singleFamilyComps(parid, x as assumptions.SalesCompsLike | null))),
    T.time("rest_prime_rate", primeRate()),
    factsP.then((f) => T.time("rest_tap_fees", tapFeesPerHome((f as { assessment?: { is_pittsburgh?: boolean } } | null)?.assessment?.is_pittsburgh === true))),
    T.time("rpc_new_construction_comps", newConstructionSalesNear(parid, asOf)),
    salesP.then((x) => T.time("rest_comp_details", compDetails(x as { comps?: { parid: string }[] } | null))),
    T.time("rest_zba_citywide", fetchZbaCitywide(URL, KEY)),
  ]);
  if (!fr.facts) return { ok: false, error: fr.error };
  const payload = T.timeSync("score_and_comps", () => buildPane({
    parid, asOf, facts: fr.facts, quickfitInput: qf ?? null, easeInputs: (ease ?? null) as score.EaseInputsRpc | null,
    zba: zba as PanePayload["zba"], zbaCitywide: zbaCity, permitTimes: permits, sales, rent, sfComps, prime, tapFees, newSales, compDetails: details,
  }));
  return { ok: true, payload, source: "live" };
}

/**
 * The pane data for a parcel: the stored row when there is one for the current config version,
 * otherwise computed live. `quickfit` is the parcel_quickfit_input call (shared with the map).
 */
export async function loadPane(parid: string, asOf: string, quickfit: Promise<unknown>, T: Timing): Promise<PaneLoad> {
  const row = await T.time("pane_row", readRow(parid));
  if (row) return { ok: true, payload: row, source: "row" };
  return T.time("pane_live", live(parid, asOf, quickfit, T));
}
