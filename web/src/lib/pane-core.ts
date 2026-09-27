// The parcel pane's precomputed part: everything the pane shows by default that does not depend on
// the visitor's choices. Built the same way by the live page (lib/pane.ts) and the batch
// (scripts/pane_all.ts), and stored one row per parcel in public.parcel_pane. No server-only or
// Next.js imports here, so the batch can bundle it.

import { assumptions, score, type ParcelFacts } from "@easescore/engine";
import type { TerrainGrid } from "./terrain-grid";
import { fitRunnerFor, qf2Data, type AppControls } from "./qf2/core";
import { SOLVER_VERSION as QF2_VERSION } from "@easescore/engine/src/quickfit2/app";

/** FNV-1a hash of a JSON value (so any edit to a config, not only its version label, changes the key). */
function hash(v: unknown): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify(v);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Changes when the score config, the cost config or this payload's shape changes; other rows are ignored. Bump "pane.N" when engine code changes what buildPane returns. */
export const PANE_VERSION = `pane.13|${QF2_VERSION}|score.${score.DEFAULT_CONFIG.version}.${hash(score.DEFAULT_CONFIG)}|${assumptions.COST_CONFIG.version}.${hash(assumptions.COST_CONFIG)}`;

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
  /** Lidar elevation grid under the lot (lib/terrain-grid.ts), sampled by the caller; null when not covered. */
  terrain?: TerrainGrid | null;
  /** parcel_owner_class row (land pricing: public lots are priced by the agency). */
  owner?: { owner_class: string | null; agency_name: string | null } | null;
  /** parcel_street_precedent(parid): the lot's block face and nearby Zoning Board cases (City only). */
  precedent?: score.PrecedentRpc | null;
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
  /** Lidar ground grid under the lot, same local feet as `outline` (QuickFit 3D: plate heights, hillside stepping). */
  terrain: TerrainGrid | null;
  /** Ease Score for every strategy (policy unlocks on, as on the parcel page); null if scoring failed. */
  score: score.EaseScoreResult | null;
  newComps: Partial<Record<score.StrategyId, assumptions.CompSet | null>>;
  rehabComps: assumptions.CompSet | null;
  /** Owner class (private, city, ura, county, hacp, other_public, nonprofit) and agency name. */
  owner: { owner_class: string | null; agency_name: string | null } | null;
  /** Street precedent (block face pattern, §925.06.B contextual setback, nearby ZBA cases); null outside the City or with no street. */
  precedent: score.StreetPrecedent | null;
  /** Nearby decided Zoning Board cases (from the same call), also when the lot has no block face. */
  zbaNearby: score.NearbyZbaCase[] | null;
  /** QuickFit v2 controls that reproduce each new-build option's priced scheme (the score's fit). */
  qf2Defaults?: Partial<Record<score.StrategyId, AppControls>>;
}

/**
 * Stored form of the payload (parcel_pane.payload): new-construction comps kept once per kind (every new
 * build except a townhouse row uses the single-family set) and the single-family comps left out when
 * they are the parcel's own sales comps.
 */
export interface StoredPane extends Omit<PanePayload, "newComps" | "sfComps"> {
  newCompsSf: assumptions.CompSet | null;
  newCompsTownhouse: assumptions.CompSet | null;
  /** Per strategy (comps are size-banded to each option's home size), when it differs from newCompsSf. */
  newCompsBy?: Partial<Record<score.StrategyId, assumptions.CompSet | null>>;
  sfComps: assumptions.SalesCompsLike | null | "sales";
}

export function toStored(p: PanePayload): StoredPane {
  const { newComps, sfComps, ...rest } = p;
  const sfKey = (Object.keys(newComps) as score.StrategyId[]).find((k) => k !== "townhouse_row");
  const base = sfKey ? newComps[sfKey] ?? null : null;
  const by: StoredPane["newCompsBy"] = {};
  for (const [k, v] of Object.entries(newComps) as [score.StrategyId, assumptions.CompSet | null][])
    if (k !== "townhouse_row" && k !== sfKey && JSON.stringify(v) !== JSON.stringify(base)) by[k] = v;
  return {
    ...rest,
    newCompsSf: base,
    newCompsTownhouse: newComps.townhouse_row ?? null,
    ...(Object.keys(by).length ? { newCompsBy: by } : {}),
    sfComps: sfComps && sfComps === p.sales ? "sales" : sfComps,
  };
}

export function fromStored(s: StoredPane): PanePayload {
  const { newCompsSf, newCompsTownhouse, newCompsBy, sfComps, ...rest } = s;
  const newComps: PanePayload["newComps"] = {};
  for (const x of s.score?.strategies ?? []) {
    if (x.strategy === "rehab_existing") continue;
    const set = x.strategy === "townhouse_row" ? newCompsTownhouse : newCompsBy && x.strategy in newCompsBy ? newCompsBy[x.strategy] ?? null : newCompsSf;
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
  const zr = (f.zoning as { code?: string; rules?: { min_front_setback_ft?: number | null; contextual_front_setback?: boolean | null } | null } | undefined);
  let precedent: score.StreetPrecedent | null = null;
  try {
    precedent = score.isCityParcel(f) ? score.streetPrecedent(i.precedent ?? null, {
      zoneCode: zr?.code ?? null, min_front_setback_ft: zr?.rules?.min_front_setback_ft ?? null, contextual_front_setback: zr?.rules?.contextual_front_setback ?? null,
    }) : null;
  } catch {
    precedent = null;
  }
  // The site fit is QuickFit v2 (engine/src/quickfit2), run on the same data the browser worker gets.
  const qd = qf2Data({ parid: i.parid, qf: i.quickfitInput, facts: f, terrain: i.terrain ?? null, zba: i.zba, zbaCitywide: i.zbaCitywide ?? null });
  const runner = qd ? fitRunnerFor(qd) : null;
  try {
    // Permit times and review targets are City of Pittsburgh data: only used for City parcels.
    result = score.scoreParcel(f, {
      ...(runner ? { fitRunner: runner.run } : {}),
      quickfitInput: i.quickfitInput ?? null, easeInputs: i.easeInputs, zba: i.zba, zbaCitywide: i.zbaCitywide ?? null,
      permitTimes: score.isCityParcel(f) ? i.permitTimes : undefined, unlocks: true,
      // Measured neighbors replace the 5 ft contextual-setback assumption when the lot has a block face.
      ...(precedent ? { precedent } : {}),
    });
  } catch {
    result = null;
  }
  const c = f.centroid as { lat?: number; lon?: number } | undefined;
  const newComps: PanePayload["newComps"] = {};
  for (const s of result?.strategies ?? []) {
    if (s.strategy === "rehab_existing" || c?.lat == null || c?.lon == null || !i.newSales) continue;
    // Size band: the fit scheme's finished area per home.
    const sch = result?.schemes?.[s.strategy];
    const sizeSf = sch && sch.units > 0 ? sch.netFloorAreaSf / sch.units : null;
    newComps[s.strategy] = assumptions.newConstructionCompsFor(s.strategy, { lat: c.lat, lon: c.lon, parid: i.parid, area: compArea(f), sizeSf }, i.newSales, i.asOf);
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
    terrain: i.terrain ?? null,
    score: result,
    newComps,
    rehabComps,
    owner: i.owner ? { owner_class: i.owner.owner_class ?? null, agency_name: i.owner.agency_name ?? null } : null,
    precedent,
    zbaNearby: i.precedent?.zba ?? null,
    qf2Defaults: runner?.defaults() ?? {},
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
