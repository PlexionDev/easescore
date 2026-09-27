// The parcel pane's precomputed part: everything the pane shows by default that does not depend on
// the visitor's choices. Built the same way by the live page (lib/pane.ts) and the batch
// (scripts/pane_all.ts), and stored one row per parcel in public.parcel_pane. No server-only or
// Next.js imports here, so the batch can bundle it.

import { assumptions, score, type ParcelFacts } from "@easescore/engine";

/** FNV-1a hash of a JSON value (so any edit to a config, not only its version label, changes the key). */
function hash(v: unknown): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify(v);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Changes when the score config, the cost config or this payload's shape changes; other rows are ignored. Bump "pane.N" when engine code changes what buildPane returns. */
export const PANE_VERSION = `pane.6|score.${score.DEFAULT_CONFIG.version}.${hash(score.DEFAULT_CONFIG)}|${assumptions.COST_CONFIG.version}.${hash(assumptions.COST_CONFIG)}`;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PaneInputs {
  parid: string;
  asOf: string;
  /** parcel_facts with zoning.rules. */
  facts: Json;
  /** parcel_quickfit_input (with front / street-side edges). */
  quickfitInput: Json | null;
  easeInputs: score.EaseInputsRpc | null;
  zba: { by_relief?: Record<string, score.ZbaReliefCounts> } | null;
  /** Citywide decided cases by relief type: the grant-odds fallback when the district has too few. */
  zbaCitywide?: Record<string, score.ZbaReliefCounts> | null;
  permitTimes: Partial<Record<"new_build" | "rehab", score.PermitTimeStats>> | undefined;
  sales: Json | null;
  rent: Json | null;
  sfComps: assumptions.SalesCompsLike | null;
  prime: { rate: number; date: string } | null;
  tapFees: number | null;
  /** Recent new-construction sales near the parcel (new_construction_comps). */
  newSales: assumptions.SaleRecord[] | null;
  /** Year built and condition of the parcel's own sales comps (for the rehab's matched comps). */
  compDetails: Record<string, { year_built: number | null; condition_desc: string | null }> | null;
}

export interface PanePayload {
  version: string;
  parid: string;
  asOf: string;
  facts: Json;
  sales: Json | null;
  rent: Json | null;
  sfComps: assumptions.SalesCompsLike | null;
  zba: { by_relief?: Record<string, score.ZbaReliefCounts> } | null;
  prime: { rate: number; date: string } | null;
  tapFees: number | null;
  /** Lot outline in local feet (quickfit parcel ring), for the still placeholder before the map loads. */
  outline: [number, number][] | null;
  /** Ease Score for every strategy (policy unlocks on, as on the parcel page); null if scoring failed. */
  score: score.EaseScoreResult | null;
  newComps: Partial<Record<score.StrategyId, assumptions.CompSet | null>>;
  rehabComps: assumptions.CompSet | null;
}

/**
 * Stored form of the payload (parcel_pane.payload): new-construction comps kept once per kind (every new
 * build except a townhouse row uses the single-family set) and the single-family comps left out when
 * they are the parcel's own sales comps.
 */
export interface StoredPane extends Omit<PanePayload, "newComps" | "sfComps"> {
  newCompsSf: assumptions.CompSet | null;
  newCompsTownhouse: assumptions.CompSet | null;
  sfComps: assumptions.SalesCompsLike | null | "sales";
}

export function toStored(p: PanePayload): StoredPane {
  const { newComps, sfComps, ...rest } = p;
  const sfKey = (Object.keys(newComps) as score.StrategyId[]).find((k) => k !== "townhouse_row");
  return {
    ...rest,
    newCompsSf: sfKey ? newComps[sfKey] ?? null : null,
    newCompsTownhouse: newComps.townhouse_row ?? null,
    sfComps: sfComps && sfComps === p.sales ? "sales" : sfComps,
  };
}

export function fromStored(s: StoredPane): PanePayload {
  const { newCompsSf, newCompsTownhouse, sfComps, ...rest } = s;
  const newComps: PanePayload["newComps"] = {};
  for (const x of s.score?.strategies ?? []) {
    if (x.strategy === "rehab_existing") continue;
    const set = x.strategy === "townhouse_row" ? newCompsTownhouse : newCompsSf;
    if (set) newComps[x.strategy] = set;
  }
  return { ...rest, newComps, sfComps: sfComps === "sales" ? (s.sales as assumptions.SalesCompsLike | null) : sfComps };
}

/** Comp area for the subject: City neighborhood inside Pittsburgh, else the municipality (matches parcel_geo). */
export function compArea(f: Json): string | null {
  const pgh = f?.assessment?.is_pittsburgh === true;
  const hood = f?.context?.neighborhood as string | undefined;
  const muni = (f?.context?.municipality ?? f?.assessment?.municipality) as string | undefined;
  return (pgh ? hood : muni)?.trim() || null;
}

export function buildPane(i: PaneInputs): PanePayload {
  const f = i.facts as ParcelFacts & Record<string, Json>;
  let result: score.EaseScoreResult | null = null;
  try {
    // Permit times and review targets are City of Pittsburgh data: only used for City parcels.
    result = score.scoreParcel(f, {
      quickfitInput: i.quickfitInput ?? null, easeInputs: i.easeInputs, zba: i.zba, zbaCitywide: i.zbaCitywide ?? null,
      permitTimes: score.isCityParcel(f) ? i.permitTimes : undefined, unlocks: true,
    });
  } catch {
    result = null;
  }
  const c = f.centroid as { lat?: number; lon?: number } | undefined;
  const newComps: PanePayload["newComps"] = {};
  for (const s of result?.strategies ?? []) {
    if (s.strategy === "rehab_existing" || c?.lat == null || c?.lon == null || !i.newSales) continue;
    newComps[s.strategy] = assumptions.newConstructionCompsFor(s.strategy, { lat: c.lat, lon: c.lon, parid: i.parid, area: compArea(f) }, i.newSales, i.asOf);
  }
  let rehabComps: assumptions.CompSet | null = null;
  if (result?.strategies.some((s) => s.strategy === "rehab_existing" && s.applicable)) {
    const own = i.sales as { comparable_use?: string | null; radius_mi?: number | null; search_steps?: string[] | null; comps?: { parid: string; sale_date: string; price: number; distance_mi: number }[] | null } | null;
    const d = i.compDetails ?? {};
    rehabComps = assumptions.matchedExistingComps(
      { livingAreaSqft: (f.assessment as { living_area_sqft?: number | null } | undefined)?.living_area_sqft ?? null, yearBuilt: f.assessment?.year_built ?? null },
      { ...own, comps: (own?.comps ?? []).map((x) => ({ ...x, year_built: d[x.parid]?.year_built ?? null, condition_desc: d[x.parid]?.condition_desc ?? null })) },
    );
  }
  const ring = i.quickfitInput?.parcel;
  return {
    version: PANE_VERSION,
    parid: i.parid,
    asOf: i.asOf,
    facts: i.facts,
    sales: i.sales,
    rent: i.rent,
    sfComps: i.sfComps,
    zba: i.zba,
    prime: i.prime,
    tapFees: i.tapFees,
    outline: Array.isArray(ring) && ring.length >= 3 ? ring : null,
    score: result,
    newComps,
    rehabComps,
  };
}

// ------------------------------------------------------------------------------ citywide grant odds

type ReqRow = { outcome: string | null; zoning_cases: { decision_date: string | null } | null };
let citywideCache: { at: number; p: Promise<Record<string, score.ZbaReliefCounts> | null> } | null = null;

/**
 * Citywide decided dimensional-variance requests (granted / partially granted vs denied, with the
 * decision-date span), read through the Data API. Cached 12 hours per process. null on any error.
 */
export function fetchZbaCitywide(url: string, key: string): Promise<Record<string, score.ZbaReliefCounts> | null> {
  if (citywideCache && Date.now() - citywideCache.at < 12 * 3600 * 1000) return citywideCache.p;
  const relief = score.DEFAULT_CONFIG.f1.zba.dimensionalReliefType;
  const p = (async () => {
    try {
      const q = `zoning_requests?select=outcome,zoning_cases!inner(decision_date)&relief_type=eq.${relief}&or=(outcome.ilike.grant*,outcome.ilike.partial*,outcome.ilike.den*)&order=request_id`;
      const rows: ReqRow[] = [];
      for (let from = 0; ; from += 1000) {
        const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Range: `${from}-${from + 999}` }, cache: "no-store" });
        if (!r.ok) return null;
        const page = (await r.json()) as ReqRow[];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      const granted = rows.filter((x) => /^(grant|partial)/i.test(x.outcome ?? "")).length;
      const denied = rows.filter((x) => /^den/i.test(x.outcome ?? "")).length;
      const dates = rows.map((x) => x.zoning_cases?.decision_date).filter((d): d is string => !!d).sort();
      return { [relief]: { granted, denied, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null } };
    } catch {
      return null;
    }
  })();
  citywideCache = { at: Date.now(), p };
  p.then((v) => { if (v === null && citywideCache?.p === p) citywideCache = null; });
  return p;
}
