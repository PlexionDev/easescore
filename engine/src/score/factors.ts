// Ease Score factors F1-F7. Each is a pure function of the score input, the strategy, its
// dimensional fit and the config. A factor that lacks its inputs returns evidence "missing" and a
// null sub-score; it is then left out of the average (never guessed).

import type { QuickFitRules } from "../quickfit/types";
import { clamp, pctText, piecewise, r1 } from "./curves";
import { CITE, SITE_PLAN_REVIEW, VERIFIED_USE_DISTRICTS } from "./code-refs";
import { STRATEGY_LABEL, existingUseColumn, permRank, useColumnsFor } from "./strategies";
import type {
  EaseScoreConfig, EaseScoreInput, Evidence, FactorId, FactorResult, PermitTimeEstimate, StrategyFit, StrategyId,
} from "./types";

export type ApprovalKind =
  | "use_variance" | "special_exception" | "conditional_use" | "administrator_exception"
  | "dimensional_variance" | "historic_certificate" | "subdivision" | "site_plan_review";

const APPROVAL_LABEL: Record<ApprovalKind, string> = {
  use_variance: "use variance",
  special_exception: "special exception",
  conditional_use: "conditional use",
  administrator_exception: "administrator exception",
  dimensional_variance: "dimensional variance",
  historic_certificate: "historic review certificate",
  subdivision: "subdivision",
  site_plan_review: "site plan review",
};

const CODE_APPROVAL: Record<string, ApprovalKind> = {
  N: "use_variance", S: "special_exception", C: "conditional_use", A: "administrator_exception",
};

const CODE_TEXT: Record<string, string> = {
  P: "allowed by right",
  A: "allowed with an administrator exception",
  S: "allowed only by special exception (Zoning Board hearing)",
  C: "allowed only as a conditional use (Planning Commission and City Council)",
  N: "not allowed (it would need a rezoning, or a use variance)",
};

const USE_TEXT: Record<string, string> = {
  single_unit_detached: "a single-unit detached house",
  single_unit_attached: "a single-unit attached home (rowhouse)",
  two_unit: "a two-unit building",
  three_unit: "a three-unit building",
  multi_unit: "a four-plus-unit building",
};

export const SRC = {
  zoning: "City of Pittsburgh Zoning Districts",
  zoningCode: "Pittsburgh Zoning Code (zoning rules table)",
  quickfit: "QuickFit lot-fit test (county parcel outline, street centerlines)",
  zba: "Pittsburgh zoning decisions (ZBA / City Council)",
  lidar1m: "USGS 3DEP 1 m lidar",
  slope10m: "USGS 3DEP elevation (10 m)",
  landslide: "City of Pittsburgh Landslide Prone Areas",
  undermined: "City of Pittsburgh Undermined Areas",
  minedOut: "PA DEP mined-out areas",
  slides: "Allegheny County slope-movement inventory (Pomeroy, 1982)",
  flood: "FEMA National Flood Hazard Layer",
  env: "PA DEP Land Recycling; EPA ACRES",
  sewer: "PWSA/3RWW combined sewersheds",
  streets: "County and City street centerlines",
  utilities: "Water / sewer service areas",
  transit: "Pittsburgh Regional Transit GTFS",
  catalog: "EaseScore requirements catalog",
  historic: "City of Pittsburgh Historic Districts",
  permits: "City of Pittsburgh PLI permits",
  assessment: "Allegheny County Property Assessments",
  cityOwned: "City of Pittsburgh city-owned properties",
  liens: "Allegheny County tax liens",
  sales: "Allegheny County Property Sale Transactions",
} as const;

interface Base {
  id: FactorId;
  label: string;
}

function factor(
  cfg: EaseScoreConfig, b: Base, subscore: number | null, evidence: Evidence, inputs: Record<string, unknown>,
  sources: string[], oneLiner: string, dates: Record<string, string | null>,
): FactorResult {
  const cov = cfg.evidence.sourceCoverage as Record<string, number | null | string>;
  const partialCoverage = sources.some((s) => typeof cov[s] === "number" && (cov[s] as number) < cfg.evidence.coverageThreshold);
  const ds: Record<string, string | null> = {};
  for (const s of sources) ds[s] = dates[s] ?? null;
  return {
    id: b.id,
    label: b.label,
    weight: (cfg.weights as Record<FactorId, number>)[b.id],
    subscore: subscore == null ? null : r1(clamp(subscore)),
    evidence: subscore == null ? "missing" : evidence,
    partialCoverage,
    inputs,
    sources,
    dates: ds,
    oneLiner,
  };
}

// ---------------------------------------------------------------- F1 zoning permission

export interface F1Out {
  factor: FactorResult;
  /** Discretionary approvals the zoning path needs; null when unknown. */
  approvals: ApprovalKind[] | null;
  permissionCode: string | null;
  fitStatus: StrategyFit["status"] | null;
}

const yearSpan = (c: { from?: string | null; to?: string | null }) => {
  const a = c.from?.slice(0, 4);
  const b = c.to?.slice(0, 4);
  return a && b ? (a === b ? a : `${a}–${b}`) : a ?? b ?? null;
};

export interface GrantOdds {
  rate: number;
  /** Plain label, always with the case count; says "default" when no case record is used. */
  basis: string;
  /** Decided cases behind the rate (0 for the default). */
  n: number;
  isDefault: boolean;
  scope: "district" | "citywide" | "default";
}

/**
 * Grant odds for a relief type: this district's decided cases when there are at least minCases;
 * otherwise the citywide record for the same relief type; otherwise the config default, labeled as one.
 */
export function grantRate(inp: EaseScoreInput, cfg: EaseScoreConfig, reliefType: string): GrantOdds {
  const z = cfg.f1.zba;
  const district = inp.zoning?.code ?? "this district";
  const c = inp.zba?.[reliefType];
  const decided = (c?.granted ?? 0) + (c?.denied ?? 0);
  if (c && decided >= z.minCases) {
    const yrs = yearSpan(c);
    return { rate: c.granted / decided, basis: `${c.granted} of ${decided} decided requests granted in ${district}${yrs ? ` (${yrs})` : ""}`, n: decided, isDefault: false, scope: "district" };
  }
  const cw = z.citywideFallback ? inp.zbaCitywide?.[reliefType] : undefined;
  const cwN = (cw?.granted ?? 0) + (cw?.denied ?? 0);
  const kind = reliefType === "dimensional_variance" ? "dimensional variances" : reliefType.replace(/_/g, " ") + "s";
  if (cw && cwN >= z.minCases) {
    const yrs = yearSpan(cw);
    return {
      rate: cw.granted / cwN,
      basis: `citywide ${kind} (${cwN} cases${yrs ? `, ${yrs}` : ""}): ${cw.granted} granted; ${district} has only ${decided} decided`,
      n: cwN, isDefault: false, scope: "citywide",
    };
  }
  return {
    rate: z.defaultGrantRate,
    basis: `default ${Math.round(z.defaultGrantRate * 100)}%, not from case records (${decided} decided cases in ${district}; citywide record not available)`,
    n: decided, isDefault: true, scope: "default",
  };
}

export function f1Zoning(
  inp: EaseScoreInput, s: StrategyId, fit: StrategyFit | null, rules: QuickFitRules | null, cfg: EaseScoreConfig,
): F1Out {
  const b: Base = { id: "F1", label: "Zoning permission" };
  const muni = inp.municipality ?? "the municipality";
  const miss = (oneLiner: string, inputs: Record<string, unknown> = {}): F1Out => ({
    factor: factor(cfg, b, null, "missing", inputs, [SRC.zoning], oneLiner, inp.dates),
    approvals: null, permissionCode: null, fitStatus: fit?.status ?? null,
  });
  if (!inp.isPittsburgh || !inp.zoning)
    return miss(`Zoning for ${muni} is not in our data. Confirm zoning with ${muni}.`, { municipality: muni });
  if (!rules)
    return miss(`District ${inp.zoning.code} has no transcribed rules yet. Confirm with City zoning staff.`, { district: inp.zoning.code });
  if (s === "adu")
    return miss("Accessory dwelling units are not in our zoning rules table. Confirm with City zoning staff.", { district: inp.zoning.code });

  const district = inp.zoning.code;
  const cols = useColumnsFor(s, inp.structure.use);
  if (!cols.length)
    return miss(`The building's current use (${inp.structure.use ?? "unknown"}) is not a housing use in the rules table.`, { district, existingUse: inp.structure.use });
  const table = rules as unknown as Record<string, string | null | undefined>;
  let col = cols[0]!;
  let code: string | null = table[col] ?? null;
  for (const c of cols.slice(1)) if (permRank(table[c] ?? null) > permRank(code)) { col = c; code = table[c] ?? null; }
  // Row schemes: permission depends on the width of the new lots, so the solver's answer wins.
  if (fit?.permissionCode && s !== "rehab_existing") code = fit.permissionCode;
  if (!code || !(code in cfg.f1.permission))
    return miss(`Permission for ${USE_TEXT[col] ?? col} in ${district} is not in our rules table; check the §911.02 Use Table.`, { district, useColumn: col });

  const citations = (rules.citation ?? "").split(";").map((x) => x.trim()).filter(Boolean);
  const sources = [SRC.zoning, SRC.zoningCode, ...citations.map((c) => `Pittsburgh Zoning Code ${c}`)];
  if (VERIFIED_USE_DISTRICTS.has(district)) sources.push(CITE.useTable);
  if (district === "P") sources.push(CITE.pStandards, CITE.pContextual);
  const inputs: Record<string, unknown> = { district, useColumn: col, permissionCode: code, ruleConfidence: rules.confidence };
  const approvals: ApprovalKind[] = [];
  const perm = cfg.f1.permission as Record<string, number>;
  let permScore = perm[code]!;
  let permText = `${cap(USE_TEXT[col] ?? col)} is ${CODE_TEXT[code] ?? `code ${code}`} in ${district} (§911.02 Use Table)`;

  if (s === "rehab_existing" && code === "N") {
    // The existing use predates the current rule: it continues as a legal nonconforming use.
    permScore = perm.nonconformingContinuation!;
    permText = `The existing ${(inp.structure.use ?? "residential").toLowerCase()} use is not a permitted use in ${district} (§911.02); it can continue as a legal nonconforming use, with limits on expansion and on rebuilding after major damage (Pittsburgh Code Chapter 921; the use-continuation sections are not yet checked)`;
    inputs.nonconforming = true;
    sources.push("Pittsburgh Zoning Code Chapter 921 (nonconformities)", CITE.ncMaintenance);
  } else if (CODE_APPROVAL[code]) {
    approvals.push(CODE_APPROVAL[code]!);
    // Not allowed: 0 permission points (config f1.permission.N) and a "not allowed" status the options list shows.
    if (code === "N") inputs.status = "not_allowed";
  }
  inputs.permissionScore = permScore;

  // Dimensional fit.
  let dim = 1;
  let evidence: Evidence = rules.confidence === "confirmed" ? "complete" : "partial";
  let dimText = "";
  if (s === "rehab_existing") {
    inputs.fitStatus = "existing";
    const lot = inp.lotAreaSf;
    const small = lot != null && rules.min_lot_area_sqft != null && lot < rules.min_lot_area_sqft;
    inputs.lotBelowMinimum = small;
    inputs.nonconformityRules = [CITE.ncMaintenance, CITE.ncEnlarge, CITE.ncReconstruct];
    sources.push(CITE.ncMaintenance, CITE.ncEnlarge);
    dimText = small
      ? `; the building already stands on a lot (${Math.round(lot!).toLocaleString()} sf) below the ${rules.min_lot_area_sqft!.toLocaleString()} sf minimum. Repair and remodeling need no relief if the nonconformity doesn't grow (§921.03.A.1); additions that comply are allowed, but ones that encroach further need a variance (§921.03.D.1); rebuilding after a fire or disaster is a special exception (§921.03.C.2)`
      : "; the building already stands, so repair and remodeling need no dimensional relief (§921.03.A.1)";
  } else if (!fit) {
    evidence = "partial";
    inputs.fitStatus = null;
    dimText = "; whether a building fits the setbacks was not checked";
  } else {
    inputs.fitStatus = fit.status;
    inputs.units = fit.units;
    sources.push(SRC.quickfit);
    const d = cfg.f1.dimensional;
    if (fit.status === "by_right") { dim = d.byRight; dimText = "; it fits the setbacks and lot rules as drawn"; }
    else if (fit.status === "contextual") { dim = d.contextualSetback; dimText = "; it fits once the contextual front setback applies (no hearing)"; inputs.contextualFrontSetbackFt = cfg.f1.contextualFrontSetbackFt; }
    else if (fit.status === "variance") {
      const g = grantRate(inp, cfg, cfg.f1.zba.dimensionalReliefType);
      // v0.2: a variance path never scores like a sure thing; F1 tops out at caps.varianceF1Max.
      dim = (d.varianceBase + d.varianceRateWeight * g.rate) * (cfg.caps.varianceF1Max / 100);
      inputs.varianceF1Max = cfg.caps.varianceF1Max;
      inputs.grantRateScope = g.scope;
      inputs.grantRateCases = g.n;
      approvals.push("dimensional_variance");
      sources.push(SRC.zba);
      inputs.varianceRules = fit.varianceRules;
      inputs.grantRate = r1(g.rate * 100) / 100;
      inputs.grantRateBasis = g.basis;
      const vr = fit.varianceRules.map((r) => r.replace(/_/g, " ")).join(", ");
      dimText = g.isDefault
        ? `; it needs a dimensional variance (${vr}); past decisions are too few to judge, so a ${g.basis} is assumed`
        : `; it needs a dimensional variance (${vr}), granted ${Math.round(g.rate * 100)}% of the time (${g.basis})`;
    } else if (fit.status === "no_fit") { dim = d.noFit; dimText = "; no building of this type fits the lot, even with reduced setbacks"; }
    if (fit.status === "variance" && rules.contextual_front_setback) dimText += " (the contextual front setback was also tried and is not enough)";

    // Lot of record (§921.04.A): an undersized lot that was vacant and separately owned when the
    // Code took effect gets a single-unit house as an Administrator Exception, not a variance.
    // Our data can't confirm vacancy on that date or separate ownership, so evidence is partial.
    const lot = inp.lotAreaSf;
    if (s === "new_sf" && !inp.structure.present && code === "P" && fit.status === "variance" && lot != null
        && rules.min_lot_area_sqft != null && lot < rules.min_lot_area_sqft) {
      const i = approvals.indexOf("dimensional_variance");
      if (i >= 0) approvals.splice(i, 1);
      approvals.push("administrator_exception");
      permScore = perm.A!;
      dim = 1;
      evidence = "partial";
      inputs.lotOfRecordPath = true;
      inputs.permissionScore = permScore;
      sources.push(CITE.lotOfRecord);
      dimText = `; the lot (${Math.round(lot).toLocaleString()} sf) is below the ${rules.min_lot_area_sqft.toLocaleString()} sf minimum, so the likely path is an Administrator Exception for a lot of record (§921.04.A), if it was vacant and separately owned when the Code took effect (not confirmable from our data)`;
    }
  }
  inputs.dimensionalFactor = r1(dim * 1000) / 1000;
  const sub = permScore * dim;
  return {
    factor: factor(cfg, b, sub, evidence, inputs, sources, `${permText}${dimText}.`, inp.dates),
    approvals,
    permissionCode: code,
    fitStatus: s === "rehab_existing" ? "existing" : fit?.status ?? null,
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- F2 terrain

export function f2Terrain(inp: EaseScoreInput, s: StrategyId, fit: StrategyFit | null, cfg: EaseScoreConfig): FactorResult {
  const b: Base = { id: "F2", label: "Terrain / buildable ground" };
  if (!inp.slope) return factor(cfg, b, null, "missing", {}, [SRC.lidar1m], "No slope data for this parcel.", inp.dates);
  const share = inp.slope.shareOver25;
  const slopeScore = piecewise(cfg.f2.steepSlopeCurve, share * 100);
  let evidence: Evidence = inp.slope.resolutionM <= 1 ? "complete" : "partial";
  const sources: string[] = [inp.slope.resolutionM <= 1 ? SRC.lidar1m : SRC.slope10m];
  const smallest = (cfg.f2.smallestFootprintSf as Record<StrategyId, number>)[s];
  const inputs: Record<string, unknown> = { shareOver25: share, slopeResolutionM: inp.slope.resolutionM, slopeSubscore: r1(slopeScore) };
  let env = 1;
  let text = `${pctText(share)} of the lot is steeper than 25%`;
  if (s === "rehab_existing") {
    inputs.envelope = "existing building";
  } else if (s === "adu" || !fit || fit.envelopeAreaSf == null) {
    evidence = "partial";
    inputs.envelope = "not checked";
    text += "; buildable area not checked";
  } else {
    sources.push(SRC.quickfit);
    const ok = fit.envelopeAreaSf >= smallest;
    env = ok ? cfg.f2.envelopeFactor.fits : cfg.f2.envelopeFactor.tooSmall;
    Object.assign(inputs, { envelopeAreaSf: fit.envelopeAreaSf, smallestFootprintSf: smallest, envelopeFactor: env });
    if (!ok) text += `; the buildable area inside the setbacks (${Math.round(fit.envelopeAreaSf).toLocaleString()} sf) is smaller than the smallest ${STRATEGY_LABEL[s].toLowerCase()} footprint (${smallest.toLocaleString()} sf)`;
  }
  return factor(cfg, b, slopeScore * env, evidence, inputs, sources, `${text}.`, inp.dates);
}

// ---------------------------------------------------------------- F3 geohazards

export function f3Hazards(inp: EaseScoreInput, cfg: EaseScoreConfig): FactorResult {
  const b: Base = { id: "F3", label: "Geohazards" };
  const h = inp.hazards;
  const m = cfg.f3.multipliers;
  const checks: { key: string; known: boolean; hit: boolean; mult: number; text: string; source: string }[] = [
    { key: "landslideProne", known: h.landslideProneShare != null, hit: (h.landslideProneShare ?? 0) > 0, mult: m.landslideProne,
      text: `${pctText(h.landslideProneShare ?? 0)} of the lot is in the landslide-prone overlay`, source: SRC.landslide },
    { key: "undermined", known: h.undermined != null, hit: h.undermined === true, mult: m.undermined,
      text: "the lot is over mapped mine workings", source: h.underminedSource ?? SRC.undermined },
    { key: "slopeMovementOnLot", known: h.slopeMovementOnLotShare != null, hit: (h.slopeMovementOnLotShare ?? 0) > 0, mult: m.slopeMovementOnLot,
      text: `${pctText(h.slopeMovementOnLotShare ?? 0)} of the lot is inside a mapped slope-movement area (1982 inventory)`, source: SRC.slides },
    { key: "floodplain100yr", known: h.floodplainShare != null, hit: (h.floodplainShare ?? 0) > 0, mult: m.floodplain100yr, // gitleaks:allow (factor id, not a secret)
      text: `${pctText(h.floodplainShare ?? 0)} of the lot is in the 100-year floodplain`, source: SRC.flood },
    { key: "contaminationOnOrAdjacent", known: h.contamination != null, hit: (h.contamination?.activeOnOrAdjacent ?? 0) > 0, mult: m.contaminationOnOrAdjacent,
      text: "a listed cleanup site is on or next to the lot", source: SRC.env },
    { key: "combinedSewer", known: h.combinedSewer != null, hit: h.combinedSewer === true, mult: m.combinedSewer,
      text: "combined-sewer area (basement backup risk)", source: SRC.sewer },
  ];
  const known = checks.filter((c) => c.known);
  if (!known.length) return factor(cfg, b, null, "missing", {}, [SRC.landslide], "No hazard data for this parcel.", inp.dates);
  let sub = 100;
  const inputs: Record<string, unknown> = {};
  for (const c of checks) {
    inputs[c.key] = c.known ? c.hit : null;
    if (c.hit) sub *= c.mult;
  }
  const unknown = checks.filter((c) => !c.known).map((c) => c.key);
  // The slope-movement inventory maps old slides, creep and fill from 1982, not recent landslides.
  const weakData = checks.some((c) => c.key === "slopeMovementOnLot" && c.known);
  if (unknown.length) inputs.notCovered = unknown;
  const hits = checks.filter((c) => c.hit);
  const text = hits.length ? cap(hits.map((c) => c.text).join("; ")) : "No mapped geohazards on or near the lot";
  const tail = unknown.length ? ` (not covered here: ${unknown.map(humanKey).join(", ")})` : "";
  return factor(cfg, b, sub, unknown.length || weakData ? "partial" : "complete", inputs, [...new Set(known.map((c) => c.source))], `${text}${tail}.`, inp.dates);
}

const humanKey = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/(\d+)/g, " $1").toLowerCase().trim();

// ---------------------------------------------------------------- F4 access & infrastructure

export function f4Access(inp: EaseScoreInput, cfg: EaseScoreConfig): FactorResult {
  const b: Base = { id: "F4", label: "Access & infrastructure" };
  const a = inp.access;
  if (!a.frontage) return factor(cfg, b, null, "missing", {}, [SRC.streets], "Street frontage is unknown for this parcel.", inp.dates);
  const front = (cfg.f4.frontage as Record<string, number>)[a.frontage] ?? 0;
  const u = cfg.f4.utilities;
  const outside = a.waterServed === false || a.sewerServed === false;
  const inside = a.waterServed === true && a.sewerServed === true;
  const util = outside ? u.outside : inside ? u.inside : u.unknown;
  const bonus = a.nearestFrequentStopM != null && a.nearestFrequentStopM <= cfg.f4.transitBonusMaxDistanceM ? cfg.f4.transitBonus : 0;
  const sub = Math.min(100, front * util + bonus);
  const frontText: Record<string, string> = {
    street: "Fronts an opened street",
    paper: "Only an unopened (paper) street or alley reaches the lot",
    steps: "Only city steps reach the lot",
    none: "No street reaches the lot",
  };
  const utilText = outside ? "outside a water or sewer service area" : inside ? "inside water and sewer service" : "water/sewer service not confirmed (scored as unknown)";
  const transitText = a.nearestFrequentStopM == null ? "" : bonus ? `; frequent transit ${Math.round(a.nearestFrequentStopM)} m away` : "";
  return factor(cfg, b, sub, inside || outside ? "complete" : "partial",
    { frontage: a.frontage, waterServed: a.waterServed, sewerServed: a.sewerServed, utilitiesFactor: util,
      nearestFrequentStopM: a.nearestFrequentStopM, transitBonus: bonus },
    [SRC.streets, SRC.utilities, SRC.transit], `${frontText[a.frontage] ?? a.frontage}; ${utilText}${transitText}.`, inp.dates);
}

// ---------------------------------------------------------------- F5 approval burden & time

export function f5Approvals(
  inp: EaseScoreInput, s: StrategyId, f1: F1Out, cfg: EaseScoreConfig,
): { factor: FactorResult; months: PermitTimeEstimate } {
  const b: Base = { id: "F5", label: "Approval burden & time" };
  const c = cfg.f5;
  let evidence: Evidence = "complete";
  const approvals: ApprovalKind[] = [...(f1.approvals ?? [])];
  const unknownParts: string[] = [];
  if (f1.approvals == null) { evidence = "partial"; unknownParts.push("zoning approvals"); }
  const historic = inp.historicDistrict;
  if (historic == null) { evidence = "partial"; unknownParts.push("historic district"); }
  else if (historic) approvals.push("historic_certificate");
  if (s === "townhouse_row") approvals.push("subdivision");
  if (sitePlanReviewApplies(inp, s)) approvals.push("site_plan_review");
  const geotech = inp.geotechRequired[s] === true;
  const newBuild = s !== "rehab_existing" && s !== "adu";
  const demolition = newBuild && inp.structure.present;

  let sub = c.start - c.perDiscretionaryApproval * approvals.length;
  if (geotech) sub -= c.geotechRequired;
  if (historic) sub -= c.historicDistrict;
  if (demolition) sub -= c.demolition;

  const listed = approvals.map((a) => APPROVAL_LABEL[a]);
  const parts = [
    listed.length ? `${listed.length} approval step${listed.length === 1 ? "" : "s"} beyond a building permit (${listed.join(", ")})` : "no approvals beyond a building permit",
    geotech ? "geotechnical report required" : "",
    historic ? `in the ${historic} historic district` : "",
    demolition ? "existing building must be demolished" : "",
  ].filter(Boolean);
  const unknownText = unknownParts.length ? ` Not known here: ${unknownParts.join(", ")}.` : "";
  const months = permitMonths(inp, s, approvals, geotech, cfg);
  const factorOut = factor(cfg, b, sub, evidence,
    { approvals, geotechRequired: geotech, historicDistrict: historic, demolition, predictedMonths: months.months },
    [SRC.catalog, SRC.zoningCode, SRC.historic, ...(months.method === "empirical" ? [SRC.permits] : [])],
    `${cap(parts.join("; "))}.${unknownText}`, inp.dates);
  return { factor: factorOut, months };
}

/** Verified Site Plan Review trigger for new construction / additions in this district. */
export function sitePlanReviewApplies(inp: EaseScoreInput, s: StrategyId): boolean {
  const t = inp.zoning ? SITE_PLAN_REVIEW[inp.zoning.code] : undefined;
  return !!t && s !== "rehab_existing" && inp.lotAreaSf != null && inp.lotAreaSf >= t.minLotSf;
}

const DAYS_PER_MONTH = 30.44;
const HEARING = new Set<ApprovalKind>(["use_variance", "dimensional_variance", "special_exception"]);

export function permitMonths(
  inp: EaseScoreInput, s: StrategyId, approvals: ApprovalKind[], geotech: boolean, cfg: EaseScoreConfig,
): PermitTimeEstimate {
  const m = cfg.f5.months as unknown as Record<string, number>;
  let disc = 0;
  const basis: string[] = [];
  for (const a of approvals) {
    const x = m[a] ?? 0;
    disc += x;
    basis.push(`${APPROVAL_LABEL[a]}: ~${x} mo (heuristic)`);
  }
  if (approvals.some((a) => HEARING.has(a))) {
    disc += m.afterHearingToPermit ?? 0;
    basis.push(`decision to permit after a hearing: ~${m.afterHearingToPermit} mo (ZBA record median)`);
  }
  if (geotech) { disc += m.geotech ?? 0; basis.push(`geotechnical report: ~${m.geotech} mo (heuristic)`); }
  const key = s === "rehab_existing" || s === "adu" ? "rehab" : "new_build";
  const t = inp.permitTimes?.[key];
  if (t?.median_days != null && (t.n ?? 0) > 0) {
    const med = t.median_days / DAYS_PER_MONTH;
    const p80 = t.p80_days != null ? t.p80_days / DAYS_PER_MONTH : null;
    basis.push(`building permit: median ${Math.round(t.median_days)} days${t.p80_days != null ? `, 80th percentile ${Math.round(t.p80_days)} days` : ""} (${t.n} City permits)`);
    return {
      months: r1(disc + med),
      upperMonths: p80 != null ? r1(disc + p80) : null,
      estimate: disc > 0,
      method: "empirical",
      basis,
      dateRangeLabel: t.date_from && t.date_to ? `based on City permits issued ${t.date_from} to ${t.date_to}` : null,
      officialTargetDays: t.target_days ?? null,
      actualMedianDays: t.median_days,
      queuePending: t.queue_pending ?? null,
      queueAsOf: t.queue_as_of ?? null,
    };
  }
  if (t?.target_calendar_days != null && t.target_calendar_days > 0) {
    // No measured permit times: use the City's published review target for one review round.
    const tgt = t.target_calendar_days / DAYS_PER_MONTH;
    basis.unshift(`building permit: City target ${t.target_calendar_days} calendar days per review round (City target, not measured)`);
    return {
      months: r1(disc + tgt), upperMonths: null, estimate: true, method: "heuristic", basis,
      dateRangeLabel: null, officialTargetDays: t.target_days ?? null, actualMedianDays: null,
      queuePending: t.queue_pending ?? null, queueAsOf: t.queue_as_of ?? null,
      targetOnly: true, label: "City target, not measured",
    };
  }
  basis.unshift(`building permit: ~${m.base} mo (heuristic; no permit-time records supplied)`);
  return {
    months: r1(disc + (m.base ?? 0)), upperMonths: null, estimate: true, method: "heuristic", basis,
    dateRangeLabel: null, officialTargetDays: null, actualMedianDays: null, queuePending: null, queueAsOf: null,
  };
}

// ---------------------------------------------------------------- F6 lot & acquisition readiness

export function f6Readiness(inp: EaseScoreInput, s: StrategyId, cfg: EaseScoreConfig): FactorResult {
  const b: Base = { id: "F6", label: "Lot & acquisition readiness" };
  const c = cfg.f6;
  const st = inp.structure;
  const cond = st.condition?.toUpperCase() ?? null;
  let evidence: Evidence = "complete";
  let base: number;
  let text: string;
  if (s === "rehab_existing") {
    const v = cond ? (c.rehabCondition as Record<string, number>)[cond] : undefined;
    if (v != null) { base = v; text = `Existing building in ${cond!.toLowerCase()} condition`; }
    else { base = c.existingStructure; evidence = "partial"; text = "Existing building, condition not recorded"; }
  } else if (s === "adu") {
    base = c.vacantOrTeardown;
    text = "The ADU goes beside the existing house";
  } else if (!st.present) {
    base = c.vacantOrTeardown; text = "Vacant lot";
  } else if (st.condemned || (cond && c.teardownConditions.includes(cond))) {
    base = c.vacantOrTeardown; text = st.condemned ? "Condemned building (teardown-ready)" : `Building in ${cond!.toLowerCase()} condition (teardown-ready)`;
  } else {
    base = c.existingStructure; text = "An existing building stands on the lot";
  }
  const t = c.titlePath;
  let title = t.clear;
  let titleText = "no public owner or tax lien found";
  if (inp.ownership.taxDelinquent == null) { evidence = "partial"; titleText = "tax-lien status unknown"; }
  if (inp.ownership.taxDelinquent) { title = Math.min(title, t.taxDelinquent); titleText = "tax-delinquent (treasurer / sheriff sale path)"; }
  if (inp.ownership.publicOwner) { title = Math.min(title, t.publicOwner); titleText = `publicly owned (${inp.ownership.publicOwner}; city / land bank path)`; }
  if (!inp.ownership.publicOwnerKnown) evidence = "partial";
  return factor(cfg, b, base * title, evidence,
    { structurePresent: st.present, condition: st.condition, condemned: st.condemned, taxDelinquent: inp.ownership.taxDelinquent,
      publicOwner: inp.ownership.publicOwner, titleFactor: title },
    [SRC.assessment, SRC.cityOwned, SRC.liens], `${text}; ${titleText}.`, inp.dates);
}

// ---------------------------------------------------------------- F7 market activity

export function f7Market(inp: EaseScoreInput, cfg: EaseScoreConfig): FactorResult {
  const b: Base = { id: "F7", label: "Market activity" };
  const m = inp.market;
  if (!m || m.percentile == null) return factor(cfg, b, null, "missing", {}, [SRC.sales], "Nearby sales activity is not available.", inp.dates);
  const city = m.scope === "city";
  const text = `${m.sales3y} valid sales${m.permits3y != null ? ` and ${m.permits3y} completed building permits` : ""} within 1/2 mile in 3 years: busier than ${Math.round(m.percentile)}% of ${city ? "City" : "county"} parcels`;
  return factor(cfg, b, m.percentile, m.permits3y != null ? "complete" : "partial",
    { sales3y: m.sales3y, permits3y: m.permits3y, percentile: m.percentile, rankedAgainst: city ? "City sample (sales + permits)" : "county sample (sales only)" },
    city ? [SRC.sales, SRC.permits] : [SRC.sales], `${text}${city ? "" : " (permit data covers the City only)"}.`, inp.dates);
}

export { existingUseColumn };
