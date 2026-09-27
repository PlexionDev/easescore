// Ease Score. Config: engine/config/ease-score.v0.2.json (v0.1 kept for history) (passed in; the default is imported).
export { scoreParcel, toEaseInput, isCityParcel, contextualFor, DEFAULT_CONFIG, type ScoreExtras, type EaseInputsRpc } from "./adapter";
export { computeEaseScore, combine, hazardCap, pickBest, planningBadge, BLOCKED, PRELIMINARY, type ScoreContext } from "./score";
export { f1Zoning, f2Terrain, f3Hazards, f4Access, f5Approvals, f6Readiness, f7Market, permitMonths, grantRate, SRC, type GrantOdds } from "./factors";
export { redFlags, reviewCallouts } from "./flags";
export {
  STRATEGY_LABEL, NEW_BUILD, SCORE_TYPOLOGIES, STACKED_TRIPLEX, STACKED_FOURPLEX, fitFromQuickFit, schemeFromQuickFit, pickStrategyScheme, runStrategyFits,
  frontEdgesFor, solverRules, useColumnsFor, type QuickFitParcelInput, type FitRunOptions,
} from "./strategies";
export { piecewise, bandFor } from "./curves";
export { BAND_LABEL, BAND_CODES, PARTIAL, SCORE_CAPTION, bandLabel, relabelBands, zoningLoaded, partialHeadline, buildingUnscored, buildingHeadline, partialText, BUILDING_USE_RE, BUILDING_USE_EXCLUDE_RE, type PartialReason } from "./bands";
export type * from "./types";
export { selectScheme, type SelectedScheme, type SelectSchemeArgs, type ProgramOverrides, type UnitProgram, type SchemeLike } from "./selected";
export { rankOptions, optionZoningPath, isEvaluable, OPTION_NAME, LEAD_PENCILS, LEAD_SUBSIDY, type OptionRow, type PencilState, type ZoningPathKind } from "./options";
export {
  streetPrecedent, contextualFront, contextualInputFt, matchesBlockPattern, buildToLine, quantile, median, spread,
  CONTEXTUAL_CITATION, MIN_BUILDINGS, TOLERANCE_FT,
  type StreetPrecedent, type PrecedentRpc, type PrecedentLot, type PrecedentRules, type BlockFaceRow, type NearbyZbaCase, type ContextualFront, type Spread,
} from "./precedent";
