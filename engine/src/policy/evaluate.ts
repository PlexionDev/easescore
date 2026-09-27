// One parcel under one lever state: rescore with the rewritten zoning row (levers.ts), compare with the
// baseline, and run the quick pencil test on the homes the change adds. Pure and deterministic; the
// batch (scripts/policy_batch.ts) supplies the inputs exactly as scripts/score_all.ts assembles them.
// Nothing demographic is read here: capacity and scoring use zoning, lot geometry, hazards and access only.

import { scoreParcel, type EaseInputsRpc, type ScoreExtras } from "../score/adapter";
import { NEW_BUILD, type QuickFitParcelInput } from "../score/strategies";
import type { EaseScoreResult, StrategyId } from "../score/types";
import type { ParcelFacts } from "../types";
import type { QuickFitRules } from "../quickfit/types";
import { applyLevers, type LeverId, type LeverState } from "./levers";
import { assessedValueDelta } from "./fiscal";
import { costBasis, pencilTest, SCENARIOS, type CostBasis, type Triple, type ValueBand } from "./pencil";

export interface PolicyParcel {
  facts: ParcelFacts & Record<string, any>;
  quickfitInput: QuickFitParcelInput | null;
  easeInputs: EaseInputsRpc | null;
  zba: ScoreExtras["zba"];
  permitTimes: ScoreExtras["permitTimes"];
  /** Street-front length from the lot outline, ft. */
  frontageFt: number | null;
  /** County assessed values today (base-year level), dollars. */
  assessed: { land: number | null; building: number | null; total: number | null };
  /** New-construction $/sq ft near the parcel; null when too few sales. */
  value: ValueBand | null;
  /** Median assessed value / sale price for recent new construction. */
  assessmentRatio: number | null;
}

export interface Capacity {
  /** Most homes any new-build option fits by right (same rule as parcel_scores.by_right_units). */
  units: number | null;
  strategy: StrategyId | null;
  score: number | null;
  band: string | null;
}

/** Same rule as scripts/score_all.ts unitsSummary().byRight: zoning evaluated, use permitted, fits. */
export function byRightCapacity(res: EaseScoreResult): Capacity {
  let units: number | null = null;
  let strategy: StrategyId | null = null;
  for (const s of res.strategies) {
    if (!NEW_BUILD.includes(s.strategy) || !s.applicable) continue;
    const i = (s.factors.find((f) => f.id === "F1")?.inputs ?? {}) as Record<string, any>;
    const code = i.permissionCode as string | undefined;
    const fit = i.fitStatus as string | undefined;
    if (!code || !fit) continue;
    const u = code === "P" && (fit === "by_right" || fit === "contextual") ? s.units ?? 0 : 0;
    if (units == null || u > units) { units = u; strategy = u > 0 ? s.strategy : strategy; }
  }
  const best = res.strategies.find((s) => s.strategy === (strategy ?? res.best)) ?? null;
  return { units, strategy, score: best?.score ?? null, band: best?.band ?? null };
}

/** Score a parcel with a given zoning-rules row (null = the row it carries). */
export function scoreWith(p: PolicyParcel, rules?: QuickFitRules | null): EaseScoreResult {
  const facts = rules === undefined || !p.facts.zoning ? p.facts : { ...p.facts, zoning: { ...p.facts.zoning, rules: rules as any } };
  return scoreParcel(facts, {
    quickfitInput: p.quickfitInput, easeInputs: p.easeInputs, zba: p.zba, permitTimes: p.permitTimes, unlocks: false,
  });
}

export interface ParcelOutcome {
  touched: LeverId[];
  before: Capacity;
  after: Capacity;
  unitsDelta: number;
  pencils: Record<"low" | "likely" | "high", boolean> | null;
  saleValue: Triple | null;
  /**
   * Assessed value the change adds at build-out when the scheme pencils in that scenario, dollars: the
   * scheme's value times (homes added / homes in the scheme) times the assessment ratio, less the
   * existing building's assessed value when the lot had no by-right home before.
   */
  avDelta: Triple;
}

const ZERO: Triple = { low: 0, likely: 0, high: 0 };

/** Evaluate one parcel under a lever state, given its baseline (result or capacity, computed once per parcel). */
export function evaluateParcel(p: PolicyParcel, state: LeverState, baseline: EaseScoreResult | Capacity, basis: CostBasis = costBasis()): ParcelOutcome {
  const before = "strategies" in baseline ? byRightCapacity(baseline) : baseline;
  const z = p.facts.zoning ?? null;
  const pgh = p.facts.assessment?.is_pittsburgh === true || /^1(0[1-9]|[12][0-9]|3[0-2])$/.test(String(p.facts.assessment?.municode ?? ""));
  const app = applyLevers({
    pgh, zoneCode: z?.code ?? null, rules: (z?.rules as QuickFitRules | null | undefined) ?? null, frontageFt: p.frontageFt,
    transitM: p.facts.transit?.nearest_frequent_stop_m ?? null,
  }, state);
  if (!app.touched.length) return { touched: [], before, after: before, unitsDelta: 0, pencils: null, saleValue: null, avDelta: ZERO };
  const res = scoreWith(p, app.rules);
  const after = byRightCapacity(res);
  const unitsDelta = (after.units ?? 0) - (before.units ?? 0);
  if (unitsDelta <= 0 || !after.strategy) return { touched: app.touched, before, after, unitsDelta, pencils: null, saleValue: null, avDelta: ZERO };
  const scheme = res.schemes?.[after.strategy] ?? null;
  if (!scheme || !p.value) return { touched: app.touched, before, after, unitsDelta, pencils: null, saleValue: null, avDelta: ZERO };
  const t = pencilTest({
    units: scheme.units, netSf: scheme.netFloorAreaSf, grossSf: scheme.grossFloorAreaSf,
    acquisition: p.assessed.total ?? 0, value: p.value,
  }, basis);
  // Only the homes the change adds are credited to it: the scheme's value pro rata to the added homes.
  // A lot that could not take a home by right before also loses its existing building's assessed value.
  const share = scheme.units > 0 ? Math.min(1, unitsDelta / scheme.units) : 0;
  const replaced = (before.units ?? 0) === 0 ? p.assessed.building ?? 0 : 0;
  const avDelta = {} as Triple;
  for (const s of SCENARIOS)
    avDelta[s] = t.pencils[s] && p.assessmentRatio != null ? Math.round(assessedValueDelta(t.saleValue[s] * share, p.assessmentRatio, replaced)) : 0;
  return { touched: app.touched, before, after, unitsDelta, pencils: t.pencils, saleValue: t.saleValue, avDelta };
}
