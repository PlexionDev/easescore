// Ease Score v0.1. Config: engine/config/ease-score.v0.1.json (passed in; the default is imported).
export { scoreParcel, toEaseInput, isCityParcel, DEFAULT_CONFIG, type ScoreExtras, type EaseInputsRpc } from "./adapter";
export { computeEaseScore, combine, pickBest, planningBadge, BLOCKED, PRELIMINARY, type ScoreContext } from "./score";
export { f1Zoning, f2Terrain, f3Hazards, f4Access, f5Approvals, f6Readiness, f7Market, permitMonths, grantRate, SRC } from "./factors";
export { redFlags, reviewCallouts } from "./flags";
export {
  STRATEGY_LABEL, NEW_BUILD, SCORE_TYPOLOGIES, STACKED_TRIPLEX, STACKED_FOURPLEX, fitFromQuickFit, runStrategyFits,
  frontEdgesFor, solverRules, useColumnsFor, type QuickFitParcelInput, type FitRunOptions,
} from "./strategies";
export { piecewise, bandFor } from "./curves";
export type * from "./types";
