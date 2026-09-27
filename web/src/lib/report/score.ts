// Ease Score adapter for the Feasibility Study.
//
// The report never reads the score engine's types directly. It reads EaseScoreView, and
// loadEaseScore() is the ONE place that runs the engine and maps its output. If the engine throws or
// has nothing for the studied strategy, the report renders an explicit "Ease Score pending" state.

import { score as ease, type ParcelFacts } from "@easescore/engine";

export type EaseBand = "Easy" | "Moderate" | "Hard" | "Very hard";
export type Evidence = "complete" | "partial" | "missing";

export interface EaseFactorView {
  id: string;
  label: string;
  weight: number;
  /** 0-100, null when the factor has no evidence. */
  subscore: number | null;
  evidence: Evidence;
  partialCoverage: boolean;
  /** Plain-language one-liner, e.g. "65% of the lot is steeper than 25%". */
  line: string;
  sources: string[];
  dates: Record<string, string | null>;
}

export interface EaseFlagView {
  title: string;
  reason: string;
  /** What to do next (red flag path or review checklist). */
  next: string[];
  costNotes: string[];
}

export interface PermitView {
  months: number;
  upperMonths: number | null;
  method: "empirical" | "heuristic";
  basis: string[];
  dateRangeLabel: string | null;
}

export interface UnlockView {
  label: string;
  evaluated: boolean;
  reason?: string;
  scoreDelta: number | null;
  unitsDelta: number | null;
}

export type EaseScoreView =
  | { status: "pending"; reason: string }
  | {
      status: "ready";
      /** Point score; null only when the engine gives a range and no point value. */
      score: number | null;
      /** Shown instead of a single number when evidence is insufficient. */
      range: { min: number; max: number } | null;
      band: EaseBand | null;
      labels: string[];
      preliminary: boolean;
      blocked: boolean;
      evidenceShare: number;
      redFlags: EaseFlagView[];
      reviewCallouts: EaseFlagView[];
      factors: EaseFactorView[];
      permit: PermitView | null;
      unlocks: UnlockView[];
      configVersion: string;
      strategyLabel: string;
      /** Other strategies' scores, for comparison. */
      others: { label: string; score: number | null; band: EaseBand | null; applicable: boolean }[];
      notes: string[];
    };

export interface EaseScoreInput {
  facts: ParcelFacts;
  /** Raw parcel_quickfit_input payload (the engine applies its own frontage fallback). */
  quickfitInput: unknown;
  /** zba_grant_rates(district) payload. */
  zbaRates: unknown;
  /** parcel_ease_inputs(parid) payload. */
  easeInputs: unknown;
  /** permit_time_estimate rows by work kind, when the RPC exists. */
  permitTimes?: unknown;
  /** QuickFit typology of the studied scheme ("single_family" | "duplex" | "townhouse_row"), or null. */
  typology: string | null;
  affordable: boolean;
  /** The parcel page's scored result for the same parcel (the pane row), used as is instead of scoring again. */
  result?: ease.EaseScoreResult | null;
}

export const SCORE_PENDING_REASON = "The Ease Score engine did not return a score for this parcel.";

const TYPOLOGY_TO_STRATEGY: Record<string, string> = {
  single_family: "new_sf",
  duplex: "duplex",
  townhouse_row: "townhouse_row",
};

type Extras = Parameters<typeof ease.scoreParcel>[1];

/** The single wiring point between the score engine and the report. */
export function loadEaseScore(input: EaseScoreInput): EaseScoreView {
  let res: ReturnType<typeof ease.scoreParcel>;
  try {
    res = input.result ?? ease.scoreParcel(input.facts, {
      quickfitInput: input.quickfitInput as NonNullable<Extras>["quickfitInput"],
      easeInputs: input.easeInputs as NonNullable<Extras>["easeInputs"],
      zba: input.zbaRates as NonNullable<Extras>["zba"],
      permitTimes: (input.permitTimes ?? undefined) as NonNullable<Extras>["permitTimes"],
      project: { affordableUnitsProposed: input.affordable },
    });
  } catch (e) {
    return { status: "pending", reason: `The Ease Score engine could not score this parcel (${e instanceof Error ? e.message : String(e)}).` };
  }
  const wanted = input.typology ? TYPOLOGY_TO_STRATEGY[input.typology] : undefined;
  const pick =
    res.strategies.find((s) => s.strategy === wanted && s.applicable && (s.score != null || s.range)) ??
    res.strategies.find((s) => s.strategy === res.best);
  if (!pick || (pick.score == null && !pick.range)) {
    return { status: "pending", reason: res.notes[0] ?? SCORE_PENDING_REASON };
  }
  const p = pick.predictedMonthsToPermit;
  return {
    status: "ready",
    score: pick.score,
    range: pick.range ? { min: pick.range[0], max: pick.range[1] } : null,
    band: pick.band,
    labels: pick.labels,
    preliminary: pick.labels.includes(ease.PRELIMINARY),
    blocked: pick.labels.includes(ease.BLOCKED),
    evidenceShare: pick.evidenceShare,
    redFlags: pick.redFlags.map((f) => ({ title: f.title, reason: f.reason, next: [f.path], costNotes: [] })),
    reviewCallouts: pick.reviewCallouts.map((c) => ({ title: c.title, reason: c.reason, next: c.checklist, costNotes: c.costNotes })),
    factors: pick.factors.map((f) => ({
      id: f.id,
      label: f.label,
      weight: f.weight,
      subscore: f.subscore,
      evidence: f.evidence,
      partialCoverage: f.partialCoverage,
      line: f.oneLiner,
      sources: f.sources,
      dates: f.dates,
    })),
    permit: p ? { months: p.months, upperMonths: p.upperMonths, method: p.method, basis: p.basis, dateRangeLabel: p.dateRangeLabel } : null,
    unlocks: res.unlocks.map((u) => ({ label: u.label, evaluated: u.evaluated, reason: u.reason, scoreDelta: u.bestScoreDelta, unitsDelta: u.unitsDelta })),
    configVersion: pick.configVersion,
    strategyLabel: pick.strategyLabel,
    others: res.strategies.map((s) => ({ label: s.strategyLabel, score: s.score, band: s.band, applicable: s.applicable })),
    notes: [...pick.notes, ...res.notes],
  };
}

export const configVersionOf = (s: EaseScoreView) => (s.status === "ready" ? `v${s.configVersion}` : "pending");
