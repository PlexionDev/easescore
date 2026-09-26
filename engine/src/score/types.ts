// Ease Score v0.1 shapes. The score is computed per housing strategy from one input object;
// every factor reports its evidence level, inputs, sources and data dates.

import type { UsePermission } from "../types";
import type { QuickFitRules, Scheme } from "../quickfit/types";
import type config from "../../config/ease-score.v0.1.json";

export type EaseScoreConfig = typeof config;

export type StrategyId = "new_sf" | "duplex" | "three_four_unit" | "townhouse_row" | "adu" | "rehab_existing";

export type FactorId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7";

export type Evidence = "complete" | "partial" | "missing";

export type Band = "Easy" | "Moderate" | "Hard" | "Very hard";

export interface SourceRef {
  name: string;
  /** Data date or vintage, or null when the source does not record one. */
  asOf: string | null;
}

export interface FactorResult {
  id: FactorId;
  label: string;
  weight: number;
  /** 0-100, or null when evidence is missing (the factor is left out of the average). */
  subscore: number | null;
  evidence: Evidence;
  /** A source this factor relies on covers less than the configured share of target parcels. */
  partialCoverage: boolean;
  inputs: Record<string, unknown>;
  sources: string[];
  dates: Record<string, string | null>;
  /** Plain-language summary for the factor bar. */
  oneLiner: string;
}

export interface RedFlag {
  id: "floodway" | "no_access" | "contamination_on_site";
  title: string;
  reason: string;
  /** What would have to happen to unblock the parcel. */
  path: string;
  source: string;
}

export interface ReviewCallout {
  id: "landslide_prone" | "undermined" | "unbuildable_lot" | "limited_access" | "site_plan_review" | "lot_of_record";
  severity: "amber";
  title: string;
  reason: string;
  /** What to do / submit, in order. */
  checklist: string[];
  /** Plain-language cost notes; any number comes from the config and is an editable default. */
  costNotes: string[];
  citations: string[];
  source: string;
}

export interface PermitTimeEstimate {
  /** Typical months to a permit: discretionary approvals (heuristic) + building permit (median when known). */
  months: number;
  /** Upper end using the 80th-percentile building permit time, when known. */
  upperMonths: number | null;
  /** True whenever any part comes from the heuristic rather than permit records. */
  estimate: boolean;
  /** "empirical" when the building-permit part comes from City permit records, else "heuristic". */
  method: "empirical" | "heuristic";
  basis: string[];
  /** e.g. "based on City permits issued 2019-06-03 to 2026-09-21" */
  dateRangeLabel: string | null;
  officialTargetDays: number | null;
  actualMedianDays: number | null;
  queuePending: number | null;
  queueAsOf: string | null;
  /** True when the building-permit part is the City's published review target, not measured permit times. */
  targetOnly?: boolean;
  /** Short label for how the building-permit part was set, e.g. "City target, not measured". */
  label?: string;
}

/** One row of permit_time_estimate(permit_type, work_type). */
export interface PermitTimeStats {
  median_days: number | null;
  p80_days: number | null;
  n: number | null;
  date_from: string | null;
  date_to: string | null;
  target_days?: number | null;
  /** City review target per review round in calendar days; used when median_days is empty. */
  target_calendar_days?: number | null;
  queue_pending?: number | null;
  queue_as_of?: string | null;
}

export interface BadgeCriterion {
  id: string;
  label: string;
  weight: number;
  /** true / false, or null when the criterion could not be evaluated. */
  matched: boolean | null;
  note: string;
}

export interface PlanningBadge {
  status: string;
  points: number;
  evaluatedWeight: number;
  tier: "Expedite candidate" | "Priority watch" | null;
  criteria: BadgeCriterion[];
}

export type UnlockId = "parking_minimum_removed" | "min_lot_size_removed" | "attached_by_right" | "contextual_setback_applied";

export interface StrategyUnlock {
  id: UnlockId;
  label: string;
  evaluated: boolean;
  reason?: string;
  scoreDelta: number | null;
  unitsDelta: number | null;
}

export interface UnlockResult {
  id: UnlockId;
  label: string;
  evaluated: boolean;
  reason?: string;
  /** Change in the best strategy's score (best strategy may change under the policy). */
  bestScoreDelta: number | null;
  /** Change in the most units any strategy fits by right (or on its easiest path). */
  unitsDelta: number | null;
  bestStrategyAfter: StrategyId | null;
}

export interface StrategyResult {
  strategy: StrategyId;
  strategyLabel: string;
  applicable: boolean;
  notApplicableReason?: string;
  score: number | null;
  /** Present when any factor is missing: [missing factors at 0, missing factors at 100]. */
  range?: [number, number];
  band: Band | null;
  /** "Blocked unless resolved", "Preliminary — insufficient evidence". */
  labels: string[];
  evidenceShare: number;
  redFlags: RedFlag[];
  reviewCallouts: ReviewCallout[];
  factors: FactorResult[];
  predictedMonthsToPermit: PermitTimeEstimate | null;
  planningBadge: PlanningBadge;
  unlocks: StrategyUnlock[];
  /** Most units the strategy fits on its easiest zoning path, when QuickFit ran. */
  units: number | null;
  notes: string[];
  configVersion: string;
}

export interface EaseScoreResult {
  parid: string;
  configVersion: string;
  best: StrategyId | null;
  strategies: StrategyResult[];
  unlocks: UnlockResult[];
  notes: string[];
  /** The QuickFit scheme behind each new-build strategy's fit (sizes the pro forma). */
  schemes?: Partial<Record<StrategyId, Scheme>>;
}

// ---------------------------------------------------------------- inputs

/** How a strategy's building fits the lot's dimensional rules (from QuickFit). */
export interface StrategyFit {
  /**
   * by_right: fits every dimensional rule · contextual: fits once the contextual front setback applies ·
   * variance: fits only with dimensional relief · no_fit: nothing fits even with setback relief ·
   * existing: the building is already there (rehab)
   */
  status: "by_right" | "contextual" | "variance" | "no_fit" | "existing";
  /** Dimensional rules that need relief (variance path only). */
  varianceRules: string[];
  envelopeAreaSf: number | null;
  /** Most units on the path above. */
  units: number | null;
  /** Best use-permission code among the fitting schemes (row: depends on the new lots' width). */
  permissionCode?: UsePermission | null;
  needsSubdivision: boolean;
  notes: string[];
}

export interface ZbaReliefCounts {
  granted: number;
  denied: number;
  from?: string | null;
  to?: string | null;
}

export interface EaseScoreInput {
  parid: string;
  municipality: string | null;
  isPittsburgh: boolean;
  lotAreaSf: number | null;
  /** Null when no zoning district is loaded for the parcel. */
  zoning: { code: string; rules: QuickFitRules | null } | null;
  structure: {
    present: boolean;
    use: string | null;
    condition: string | null;
    yearBuilt: number | null;
    condemned: boolean | null;
  };
  slope: { shareOver25: number; resolutionM: number; source: string } | null;
  hazards: {
    /** null = layer does not cover this parcel (City-only layers outside Pittsburgh). */
    landslideProneShare: number | null;
    undermined: boolean | null;
    underminedSource: string | null;
    /** Share of the lot inside a mapped 1982 slope-movement area (county inventory); null = unknown. */
    slopeMovementOnLotShare: number | null;
    floodplainShare: number | null;
    floodwayShare: number | null;
    contamination: { onParcel: number; activeOnParcel: number; adjacent: number; activeOnOrAdjacent: number } | null;
    combinedSewer: boolean | null;
  };
  access: {
    frontage: "street" | "paper" | "steps" | "none" | null;
    /** Water / sewer service: true = served, false = not served, null = unknown. Never assumed served. */
    waterServed: boolean | null;
    sewerServed: boolean | null;
    nearestFrequentStopM: number | null;
  };
  /** Historic district name, "" when not in one, null when unknown (outside Pittsburgh). */
  historicDistrict: string | null;
  ownership: { publicOwner: string | null; publicOwnerKnown: boolean; taxDelinquent: boolean | null };
  market: { sales3y: number; permits3y: number | null; percentile: number | null; scope: "city" | "county"; asOf: string | null } | null;
  /** Relief counts for this zoning district, by relief type. */
  zba: Record<string, ZbaReliefCounts> | null;
  qct: boolean | null;
  /** Per strategy: does the requirements catalog mark a geotechnical report REQUIRED? */
  geotechRequired: Partial<Record<StrategyId, boolean>>;
  project?: { affordableUnitsProposed?: boolean | null };
  /** Building-permit times from City records, keyed "new_build" / "rehab". Optional. */
  permitTimes?: Partial<Record<"new_build" | "rehab", PermitTimeStats>>;
  /** Data dates by source name. */
  dates: Record<string, string | null>;
}
