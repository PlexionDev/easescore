// Facts adapter and the one-call entry point for the web app:
//   scoreParcel(parcel_facts, { quickfitInput, easeInputs, zba, permitTimes, project })
// Maps the RPC payloads to the score input, runs the QuickFit fit test per strategy, scores every
// strategy, and computes the policy "unlocks". No I/O: the caller fetches the RPCs.

import defaultConfig from "../../config/ease-score.v0.2.json";
import { evaluateRequirements } from "../evaluate";
import type { ParcelFacts, ProjectAnswers } from "../types";
import type { QuickFitRules } from "../quickfit/types";
import { SRC } from "./factors";
import { contextualInputFt, type StreetPrecedent } from "./precedent";
import { computeEaseScore, type ScoreContext } from "./score";
import { NEW_BUILD, existingUseColumn, runStrategyFits, solverRules, type FitRunOptions, type QuickFitParcelInput } from "./strategies";
import type {
  EaseScoreConfig, EaseScoreInput, EaseScoreResult, PermitTimeStats, StrategyFit, StrategyId, StrategyUnlock, UnlockId,
  UnlockResult, ZbaReliefCounts,
} from "./types";

export const DEFAULT_CONFIG: EaseScoreConfig = defaultConfig;

/** Shape of public.parcel_ease_inputs(parid). */
export interface EaseInputsRpc {
  env_sites?: { on_parcel: number; active_on_parcel?: number; adjacent_50ft: number; active_on_or_adjacent: number } | null;
  market?: {
    sales_3y_half_mile: number; completed_permits_3y_half_mile: number | null; percentile: number | null;
    scope: "city" | "county"; as_of?: string | null;
  } | null;
}

export interface ScoreExtras {
  /** public.parcel_quickfit_input(parid) */
  quickfitInput?: QuickFitParcelInput | null;
  /** public.parcel_ease_inputs(parid) */
  easeInputs?: EaseInputsRpc | null;
  /** public.zba_grant_rates(district) */
  zba?: { by_relief?: Record<string, ZbaReliefCounts> } | null;
  /** Citywide decided cases by relief type (fallback when the district has too few). */
  zbaCitywide?: Record<string, ZbaReliefCounts> | null;
  /** permit_time_estimate(...) rows for the queries named in config f5.permitTimeQueries. */
  permitTimes?: Partial<Record<"new_build" | "rehab", PermitTimeStats>>;
  project?: { affordableUnitsProposed?: boolean | null };
  /** Measured contextual front setback (neighbors), when known; else the config assumption is used. */
  contextualFrontSetbackFt?: number;
  /**
   * Street precedent for the lot's block face (precedent.ts). When given, its §925.06.B setback replaces
   * the config assumption (or the district setback when the rule does not reach), and it feeds the
   * planning badge's "matches block pattern" input.
   */
  precedent?: StreetPrecedent | null;
  /** Precomputed fits; when given, QuickFit is not run for the base scenario. */
  fits?: Partial<Record<StrategyId, StrategyFit>>;
  /** Compute policy unlocks (reruns QuickFit per policy). Default true. */
  unlocks?: boolean;
  /**
   * Site-fit runner. When given, it replaces the built-in QuickFit (v1) fit for the base scenario and
   * every policy rerun; the app passes QuickFit v2 here (engine/src/quickfit2/app.ts scoreFits).
   */
  fitRunner?: (rules: QuickFitRules, opts: FitRunOptions) => ReturnType<typeof runStrategyFits>;
}

type AnyFacts = ParcelFacts & Record<string, any>;

const CITY_MUNICODE = /^1(0[1-9]|[12][0-9]|3[0-2])$/;

/** City of Pittsburgh = county municipal codes 101-132 (East Pittsburgh, 822, is a separate borough). */
export function isCityParcel(f: AnyFacts): boolean {
  const code = f.assessment?.municode;
  if (typeof code === "string" && code) return CITY_MUNICODE.test(code);
  return f.assessment?.is_pittsburgh === true;
}

const shareOf = (f: AnyFacts, layer: string, pred: (o: any) => boolean = () => true) =>
  Math.min(1, (f.overlays ?? []).filter((o: any) => o.layer === layer && o.share > 0 && pred(o)).reduce((s: number, o: any) => s + o.share, 0));

const PROJECT: Record<StrategyId, ProjectAnswers> = {
  new_sf: { type: "new_build", units: 1 },
  duplex: { type: "new_build", units: 2 },
  three_four_unit: { type: "new_build", units: 3 },
  townhouse_row: { type: "new_build", units: 2, party_wall: true, lot_split_or_merge: true },
  adu: { type: "new_build", units: 1 },
  rehab_existing: { type: "rehab" },
};

/** Map parcel_facts (+ extras) to the score input. */
export function toEaseInput(facts: ParcelFacts, extras: ScoreExtras = {}): EaseScoreInput {
  const f = facts as AnyFacts;
  const a = f.assessment;
  const pgh = isCityParcel(f);
  const muni = f.context?.municipality ?? a?.municipality ?? null;
  const rulesRow = f.zoning?.rules ?? null;
  const zoning = pgh && f.zoning ? { code: f.zoning.code, rules: rulesRow ? solverRules(f.zoning.code, rulesRow as QuickFitRules) : null } : null;

  const present = (a?.fmv_building ?? 0) > 0 || !!a?.year_built || (f.building_footprint_sqft ?? 0) > 0;
  const mines = f.mines ?? null;
  const cityUndermined = pgh ? (mines?.in_city_undermined === true || shareOf(f, "undermined_pgh") > 0) : false;
  const minedOut = mines ? mines.in_mined_out === true : null;
  const undermined = pgh ? cityUndermined || minedOut === true : minedOut;
  const fe = f.flood_evidence ?? null;
  const env = extras.easeInputs?.env_sites ?? null;
  const util = f.utilities ?? null;
  // parcel_facts.utilities is nested ({water:{served}, sewer:{status}}); flat keys kept for older fixtures.
  const sewerStatus = util?.sewer?.status ?? util?.sewer_status ?? null;
  const sewer = util == null ? null : sewerStatus === "served" ? true : sewerStatus === "not_served" ? false : util.sewer?.served ?? util.sewer_served ?? null;
  const waterServed: boolean | null = util ? util.water?.served ?? util.water_served ?? null : null;
  const m = extras.easeInputs?.market ?? null;

  const geotechRequired: Partial<Record<StrategyId, boolean>> = {};
  for (const s of Object.keys(PROJECT) as StrategyId[]) {
    const units = s === "rehab_existing" ? unitsFromUse(a?.use) : PROJECT[s].units;
    const r = evaluateRequirements(facts, { ...PROJECT[s], ...(units ? { units } : {}) }).find((x) => x.id === "geotech");
    geotechRequired[s] = r?.status === "REQUIRED";
  }

  const zbaTo = Object.values(extras.zba?.by_relief ?? {}).map((x) => x.to).filter(Boolean).sort().pop() ?? null;
  return {
    parid: f.parid,
    municipality: muni,
    isPittsburgh: pgh,
    lotAreaSf: f.lot_area_sqft_gis ?? a?.lot_area_sqft ?? null,
    zoning,
    structure: {
      present,
      use: a?.use ?? null,
      condition: a?.condition ?? null,
      yearBuilt: a?.year_built ?? null,
      condemned: typeof f.condemned === "boolean" ? f.condemned : null,
    },
    slope: f.slope_1m
      ? { shareOver25: f.slope_1m.share_over_25, resolutionM: 1, source: SRC.lidar1m }
      : f.slope ? { shareOver25: f.slope.steep_share, resolutionM: f.slope.resolution_m ?? 10, source: SRC.slope10m } : null,
    hazards: {
      landslideProneShare: pgh ? shareOf(f, "landslide_prone_pgh") : null,
      undermined,
      underminedSource: cityUndermined ? SRC.undermined : minedOut != null ? SRC.minedOut : null,
      slopeMovementOnLotShare: Array.isArray(f.overlays) ? shareOf(f, "landslide_recorded") : null,
      floodplainShare: fe?.sfha_share ?? f.flood_1pct_share ?? null,
      floodwayShare: fe?.floodway_share ?? shareOf(f, "flood_fema_nfhl", (o) => String(o.attrs?.subtype ?? "").toUpperCase() === "FLOODWAY"),
      contamination: env ? { onParcel: env.on_parcel, activeOnParcel: env.active_on_parcel ?? 0, adjacent: env.adjacent_50ft, activeOnOrAdjacent: env.active_on_or_adjacent } : null,
      combinedSewer: pgh ? fe?.in_combined_sewer ?? null : null,
    },
    access: {
      frontage: (f.street_frontage as EaseScoreInput["access"]["frontage"]) ?? null,
      waterServed,
      sewerServed: sewer,
      nearestFrequentStopM: f.transit?.nearest_frequent_stop_m ?? null,
    },
    historicDistrict: pgh ? ((f.overlays ?? []).find((o: any) => o.layer === "historic_district_pgh" && o.share > 0)?.label ?? "") : null,
    ownership: {
      publicOwner: f.context?.public_owner ?? null,
      publicOwnerKnown: pgh,
      taxDelinquent: f.context?.tax_delinquent ?? f.tax_delinquent ?? null,
    },
    market: m ? { sales3y: m.sales_3y_half_mile, permits3y: m.completed_permits_3y_half_mile ?? null, percentile: m.percentile, scope: m.scope, asOf: m.as_of ?? null } : null,
    zba: extras.zba?.by_relief ?? null,
    zbaCitywide: extras.zbaCitywide ?? null,
    qct: f.tract_designations ? f.tract_designations.qct ?? null : null,
    geotechRequired,
    ...(extras.precedent !== undefined ? { blockPattern: extras.precedent } : {}),
    ...(extras.project ? { project: extras.project } : {}),
    // City permit targets and queue describe City of Pittsburgh review only; other towns fall back to the estimate.
    ...(extras.permitTimes && pgh ? { permitTimes: extras.permitTimes } : {}),
    dates: {
      [SRC.assessment]: a?.as_of ?? null,
      [SRC.lidar1m]: f.slope_1m ? "flown 2019" : null,
      [SRC.sales]: m?.as_of ?? null,
      [SRC.permits]: m?.scope === "city" ? m?.as_of ?? null : null,
      [SRC.zba]: zbaTo,
    },
  };
}

function unitsFromUse(use: string | null | undefined): number | undefined {
  const col = existingUseColumn(use);
  return col === "two_unit" ? 2 : col === "three_unit" ? 3 : col === "multi_unit" ? 4 : col ? 1 : undefined;
}

// ---------------------------------------------------------------- scoring entry points

function fitsFor(inp: EaseScoreInput, rules: QuickFitRules | null, extras: ScoreExtras, cfg: EaseScoreConfig): ReturnType<typeof runStrategyFits> {
  if (!rules || !extras.quickfitInput) return { fits: {}, schemes: {}, notes: extras.quickfitInput ? [] : ["Lot outline not supplied; the fit test did not run."] };
  const c = contextualFor(extras, cfg);
  const opts: FitRunOptions = { contextualFrontFt: c.ft, contextualBasis: c.basis, probeSetbacksFt: cfg.f1.varianceProbeSetbacksFt };
  return extras.fitRunner ? extras.fitRunner(rules, opts) : runStrategyFits(extras.quickfitInput, rules, opts);
}

/** Contextual front setback for the fit test: explicit extra, else measured precedent, else the config assumption. */
export function contextualFor(extras: ScoreExtras, cfg: EaseScoreConfig): { ft: number; basis: "measured" | "assumed" } {
  if (extras.contextualFrontSetbackFt != null) return { ft: extras.contextualFrontSetbackFt, basis: "measured" };
  const m = contextualInputFt(extras.precedent);
  return m != null ? { ft: m, basis: "measured" } : { ft: cfg.f1.contextualFrontSetbackFt, basis: "assumed" };
}

const UNLOCK_LABEL: Record<UnlockId, string> = {
  parking_minimum_removed: "Parking minimum removed",
  min_lot_size_removed: "Minimum lot size removed",
  attached_by_right: "Attached housing by right",
  contextual_setback_applied: "Contextual front setback applied",
};

function policyRules(id: UnlockId, r: QuickFitRules, contextualFt: number): QuickFitRules {
  switch (id) {
    case "parking_minimum_removed": return { ...r, parking_per_unit: 0, attached_parking_per_unit: 0 };
    case "min_lot_size_removed": return { ...r, min_lot_area_sqft: null, min_lot_area_per_unit_sqft: null };
    case "attached_by_right": return { ...r, single_unit_attached: "P", attached_by_right_max_lot_width_ft: null, attached_wider_lot_permission: null };
    case "contextual_setback_applied": return { ...r, min_front_setback_ft: Math.min(r.min_front_setback_ft ?? contextualFt, contextualFt) };
  }
}

/** Most units any new-build strategy fits by right (or with the contextual setback). */
function byRightUnits(fits: Partial<Record<StrategyId, StrategyFit>>): number {
  let best = 0;
  for (const s of NEW_BUILD) {
    const f = fits[s];
    if (f && (f.status === "by_right" || f.status === "contextual")) best = Math.max(best, f.units ?? 0);
  }
  return best;
}

/** Score a parcel from its facts and optional RPC extras. Deterministic. */
export function scoreParcel(facts: ParcelFacts, extras: ScoreExtras = {}, cfg: EaseScoreConfig = DEFAULT_CONFIG): EaseScoreResult {
  const inp = toEaseInput(facts, extras);
  const rules = inp.zoning?.rules ?? null;
  const base: { fits: Partial<Record<StrategyId, StrategyFit>>; notes: string[]; schemes?: EaseScoreResult["schemes"] } =
    extras.fits ? { fits: extras.fits, notes: [] } : fitsFor(inp, rules, extras, cfg);
  const ctx: ScoreContext = { rules, fits: base.fits, fitNotes: base.notes };
  const result: EaseScoreResult = { ...computeEaseScore(inp, ctx, cfg), schemes: base.schemes ?? {} };
  // Record which contextual setback the fit used (F1 inputs; the option text reads the basis).
  const cf = contextualFor(extras, cfg);
  for (const s of result.strategies) {
    const f1 = s.factors.find((f) => f.id === "F1");
    if (f1?.inputs && (f1.inputs as { fitStatus?: string }).fitStatus === "contextual")
      Object.assign(f1.inputs, { contextualFrontSetbackFt: cf.ft, contextualBasis: cf.basis });
  }
  if (extras.unlocks === false) return result;

  const bestScore = result.strategies.find((s) => s.strategy === result.best)?.score ?? null;
  const baseUnits = byRightUnits(base.fits);
  const ctxFt = cf.ft;
  const why = !inp.isPittsburgh || !inp.zoning ? "Zoning is not loaded for this parcel."
    : !rules ? "This district has no transcribed rules."
      : !extras.quickfitInput ? "Lot outline not supplied, so the fit test cannot be rerun." : null;

  const unlocks: UnlockResult[] = [];
  const perStrategy = new Map<StrategyId, StrategyUnlock[]>();
  for (const id of cfg.unlocks as UnlockId[]) {
    if (why) {
      unlocks.push({ id, label: UNLOCK_LABEL[id], evaluated: false, reason: why, bestScoreDelta: null, unitsDelta: null, bestStrategyAfter: null });
      for (const s of result.strategies) push(perStrategy, s.strategy, { id, label: UNLOCK_LABEL[id], evaluated: false, reason: why, scoreDelta: null, unitsDelta: null });
      continue;
    }
    const r2 = policyRules(id, rules!, ctxFt);
    const inp2: EaseScoreInput = { ...inp, zoning: { code: inp.zoning!.code, rules: r2 } };
    const run = fitsFor(inp2, r2, extras, cfg);
    const res2 = computeEaseScore(inp2, { rules: r2, fits: run.fits, fitNotes: run.notes }, cfg);
    const after = res2.strategies.find((s) => s.strategy === res2.best)?.score ?? null;
    unlocks.push({
      id, label: UNLOCK_LABEL[id], evaluated: true,
      bestScoreDelta: after != null && bestScore != null ? after - bestScore : null,
      unitsDelta: byRightUnits(run.fits) - baseUnits,
      bestStrategyAfter: res2.best,
    });
    for (const s of result.strategies) {
      const s2 = res2.strategies.find((x) => x.strategy === s.strategy)!;
      const u1 = base.fits[s.strategy];
      const u2 = run.fits[s.strategy];
      const by = (f?: StrategyFit) => (f && (f.status === "by_right" || f.status === "contextual") ? f.units ?? 0 : 0);
      push(perStrategy, s.strategy, {
        id, label: UNLOCK_LABEL[id], evaluated: s.applicable,
        ...(s.applicable ? {} : { reason: "Strategy not applicable." }),
        scoreDelta: s.score != null && s2.score != null ? s2.score - s.score : null,
        unitsDelta: NEW_BUILD.includes(s.strategy) ? by(u2) - by(u1) : null,
      });
    }
  }
  unlocks.sort((x, y) => Number(y.evaluated) - Number(x.evaluated) || (y.bestScoreDelta ?? 0) - (x.bestScoreDelta ?? 0) || (y.unitsDelta ?? 0) - (x.unitsDelta ?? 0));
  for (const s of result.strategies)
    s.unlocks = (perStrategy.get(s.strategy) ?? []).sort((x, y) => (y.scoreDelta ?? 0) - (x.scoreDelta ?? 0) || (y.unitsDelta ?? 0) - (x.unitsDelta ?? 0));
  return { ...result, unlocks };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
