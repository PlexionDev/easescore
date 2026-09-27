// Ease Score (config v0.2): combine factors into a per-strategy score, band, range and labels.
// Pure and deterministic. Takes precomputed dimensional fits (see strategies.ts) so it never runs
// the QuickFit solver itself.

import { matchesBlockPattern } from "./precedent";
import type { QuickFitRules } from "../quickfit/types";
import { bandFor, pctText, r1 } from "./curves";
import { f1Zoning, f2Terrain, f3Hazards, f4Access, f5Approvals, f6Readiness, f7Market, type F1Out } from "./factors";
import { redFlags, reviewCallouts } from "./flags";
import { STRATEGY_LABEL } from "./strategies";
import type {
  Band, BadgeCriterion, EaseScoreConfig, EaseScoreInput, EaseScoreResult, FactorResult, PlanningBadge, StrategyFit, StrategyId,
  StrategyResult,
} from "./types";

export const BLOCKED = "Blocked unless resolved";
export const PRELIMINARY = "Preliminary — insufficient evidence";

export interface ScoreContext {
  /** Solver-ready zoning rules (zoning table row + attached-housing facts). */
  rules: QuickFitRules | null;
  fits: Partial<Record<StrategyId, StrategyFit>>;
  /** Notes from the fit run (e.g. an inferred front edge). */
  fitNotes: string[];
}

/** Weighted average over factors with evidence, plus the [min, max] range when any factor is missing. */
export function combine(factors: FactorResult[], cfg: EaseScoreConfig) {
  const total = factors.reduce((s, f) => s + f.weight, 0);
  const credit = cfg.evidence.credit as Record<string, number>;
  let wsum = 0;
  let wav = 0;
  let missingW = 0;
  let evidenceW = 0;
  for (const f of factors) {
    evidenceW += f.weight * (credit[f.evidence] ?? 0);
    if (f.subscore == null) { missingW += f.weight; continue; }
    wsum += f.weight * f.subscore;
    wav += f.weight;
  }
  const score = wav > 0 ? Math.round(wsum / wav) : null;
  const range: [number, number] | undefined = missingW > 0 && total > 0
    ? [Math.round(wsum / total), Math.round((wsum + 100 * missingW) / total)]
    : undefined;
  return { score, range, evidenceShare: total > 0 ? r1((evidenceW / total) * 1000) / 1000 : 0 };
}

interface Internal {
  result: StrategyResult;
  f1: F1Out | null;
}

function scoreOne(inp: EaseScoreInput, s: StrategyId, ctx: ScoreContext, cfg: EaseScoreConfig): Internal {
  const base = {
    strategy: s,
    strategyLabel: STRATEGY_LABEL[s],
    configVersion: cfg.version,
  };
  const needsBuilding = s === "rehab_existing" || s === "adu";
  if (needsBuilding && !inp.structure.present) {
    return {
      f1: null,
      result: {
        ...base, applicable: false, notApplicableReason: "No existing building on the lot.", score: null, band: null, labels: [],
        evidenceShare: 0, redFlags: [], reviewCallouts: [], factors: [], predictedMonthsToPermit: null,
        planningBadge: emptyBadge(cfg), unlocks: [], units: null, notes: [],
      },
    };
  }
  const fit = ctx.fits[s] ?? null;
  const f1 = f1Zoning(inp, s, fit, ctx.rules, cfg);
  const f5 = f5Approvals(inp, s, f1, cfg);
  const factors = [f1.factor, f2Terrain(inp, s, fit, cfg), f3Hazards(inp, cfg), f4Access(inp, cfg), f5.factor, f6Readiness(inp, s, cfg), f7Market(inp, cfg)];
  const combined = combine(factors, cfg);
  const cap = hazardCap(inp, combined.score, cfg);
  const score = cap ? Math.min(combined.score!, cap.ceiling) : combined.score;
  const range = combined.range && cap
    ? ([Math.min(combined.range[0], cap.ceiling), Math.min(combined.range[1], cap.ceiling)] as [number, number])
    : combined.range;
  const evidenceShare = combined.evidenceShare;
  const flags = redFlags(inp, cfg);
  const labels: string[] = [];
  if (flags.length) labels.push(BLOCKED);
  if (evidenceShare < cfg.evidence.minEvidenceShare) labels.push(PRELIMINARY);
  if (cap) labels.push(cap.label);
  const notes: string[] = [...(fit?.notes ?? [])];
  if (!inp.isPittsburgh) notes.push(`Zoning for ${inp.municipality ?? "this municipality"} is not loaded: confirm zoning with ${inp.municipality ?? "the municipality"}.`);
  return {
    f1,
    result: {
      ...base,
      applicable: true,
      score,
      ...(range ? { range } : {}),
      band: score == null ? null : bandFor(score, cfg),
      labels,
      evidenceShare,
      redFlags: flags,
      reviewCallouts: reviewCallouts(inp, s, fit, ctx.fitNotes, cfg, f1.factor.inputs.lotOfRecordPath === true),
      factors,
      predictedMonthsToPermit: f5.months,
      planningBadge: emptyBadge(cfg),
      unlocks: [],
      units: s === "rehab_existing" ? null : fit?.units ?? null,
      schemeId: s === "rehab_existing" ? null : fit?.schemeId ?? null,
      cap: cap ? { band: cap.band, reason: cap.reason, uncappedScore: combined.score!, label: cap.label } : null,
      notes,
    },
  };
}

/**
 * v0.2 hazard cap: a lot that is mostly landslide-prone, or largely steeper than 25%, cannot score
 * above caps.hazardBand.maxBand. Returns the ceiling score and the label, or null when no cap applies
 * (or the score already sits at or below the ceiling).
 */
export function hazardCap(inp: EaseScoreInput, score: number | null, cfg: EaseScoreConfig) {
  if (score == null) return null;
  const h = cfg.caps.hazardBand;
  const reasons: string[] = [];
  const ls = inp.hazards.landslideProneShare;
  if (ls != null && ls >= h.landslideProneShareMin) reasons.push(`${pctText(ls)} of the lot is landslide-prone`);
  const st = inp.slope?.shareOver25;
  if (st != null && st >= h.steepShareOver25Min) reasons.push(`${pctText(st)} of the lot is steeper than 25%`);
  if (!reasons.length) return null;
  const i = cfg.bands.findIndex((b) => b.band === h.maxBand);
  if (i <= 0) return null;
  const ceiling = cfg.bands[i - 1]!.min - 1;
  if (score <= ceiling) return null;
  const reason = reasons.join("; ");
  return { ceiling, band: h.maxBand as Band, reason, label: `Capped at ${h.maxBand}: ${reason}` };
}

function emptyBadge(cfg: EaseScoreConfig): PlanningBadge {
  return { status: cfg.planningBadge.status, points: 0, evaluatedWeight: 0, tier: null, criteria: [] };
}

const MISSING_MIDDLE: StrategyId[] = ["duplex", "three_four_unit", "townhouse_row"];

export function planningBadge(inp: EaseScoreInput, all: Internal[], strategy: StrategyResult, cfg: EaseScoreConfig): PlanningBadge {
  const criteria: BadgeCriterion[] = cfg.planningBadge.criteria.map((c) => {
    const base = { id: c.id, label: c.label, weight: c.weight };
    switch (c.id) {
      case "public_owner":
        if (inp.ownership.publicOwner) return { ...base, matched: true, note: `Owned by ${inp.ownership.publicOwner}.` };
        return inp.ownership.publicOwnerKnown
          ? { ...base, matched: false, note: "Not on the City-owned list (URA and Land Bank lists not loaded)." }
          : { ...base, matched: null, note: "Public-ownership list covers the City only." };
      case "frequent_transit": {
        const d = inp.access.nearestFrequentStopM;
        const max = (c as { maxDistanceM?: number }).maxDistanceM ?? 400;
        return d == null ? { ...base, matched: null, note: "Transit distance unknown." } : { ...base, matched: d <= max, note: `Nearest frequent stop ${Math.round(d)} m.` };
      }
      case "target_area":
        return { ...base, matched: null, note: "Awaiting planning input: no target-area layer yet." };
      case "missing_middle_by_right": {
        if (!inp.isPittsburgh || !inp.zoning) return { ...base, matched: null, note: "Zoning not loaded here." };
        // Missing middle is 2+ homes: a one-home "townhouse row" is an attached single-family home, not missing middle.
        const hits = all.filter((x) => MISSING_MIDDLE.includes(x.result.strategy) && (x.result.units ?? 0) >= 2 && x.f1?.permissionCode === "P"
          && (x.f1.fitStatus === "by_right" || x.f1.fitStatus === "contextual"));
        return { ...base, matched: hits.length > 0, note: hits.length ? `By right: ${hits.map((x) => x.result.strategyLabel.toLowerCase()).join(", ")}.` : "No 2-4 unit or townhouse option fits by right." };
      }
      case "affordable_units": {
        const a = inp.project?.affordableUnitsProposed;
        return a == null ? { ...base, matched: null, note: "Project input: not entered." } : { ...base, matched: a, note: a ? "Affordable units proposed." : "No affordable units proposed." };
      }
      case "qct":
        return inp.qct == null ? { ...base, matched: null, note: "Census tract unknown." } : { ...base, matched: inp.qct, note: inp.qct ? "In a HUD Qualified Census Tract." : "Not in a Qualified Census Tract." };
      case "vacant_tax_delinquent": {
        if (inp.ownership.taxDelinquent == null) return { ...base, matched: null, note: "Tax-lien status unknown." };
        const vacant = !inp.structure.present || inp.structure.condemned === true;
        const m = vacant && inp.ownership.taxDelinquent;
        return { ...base, matched: m, note: m ? "Vacant or condemned and tax-delinquent." : "Not both vacant/blighted and tax-delinquent." };
      }
      case "matches_block_pattern":
        return { ...base, ...matchesBlockPattern(inp.blockPattern, strategy.units) };
      default:
        return { ...base, matched: null, note: "Not evaluated." };
    }
  });
  // Points are on a 0–100 scale regardless of how many criteria are configured (weights are relative).
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const points = Math.round((criteria.reduce((s, c) => s + (c.matched ? c.weight : 0), 0) * 100) / totalWeight);
  const evaluatedWeight = criteria.reduce((s, c) => s + (c.matched == null ? 0 : c.weight), 0);
  let tier: PlanningBadge["tier"] = null;
  for (const t of cfg.planningBadge.tiers)
    if (points >= t.min && (!t.requiresNoRedFlags || strategy.redFlags.length === 0)) { tier = t.tier as PlanningBadge["tier"]; break; }
  return { status: cfg.planningBadge.status, points, evaluatedWeight, tier, criteria };
}

/** Best strategy: no red flags first, then highest score, then more evidence, then strategy order. */
export function pickBest(results: StrategyResult[], order: readonly string[]): StrategyId | null {
  // Renovation is never estimated automatically (condition inside unknown), so it is never the best option.
  const ok0 = results.filter((r) => r.applicable && r.score != null && r.strategy !== "rehab_existing");
  // Options whose zoning could not be checked (e.g. backyard units, whose rules are not transcribed) are never
  // the best when another option has a zoning answer (same rule as the planner batch and rankOptions).
  const zoned = ok0.filter((r) => r.factors.some((f) => f.id === "F1" && f.subscore != null));
  const ok = zoned.length ? zoned : ok0;
  if (!ok.length) return null;
  return [...ok].sort(
    (a, b) => a.redFlags.length - b.redFlags.length || b.score! - a.score! || b.evidenceShare - a.evidenceShare || order.indexOf(a.strategy) - order.indexOf(b.strategy),
  )[0]!.strategy;
}

/** Score every strategy from a prepared input and precomputed fits. No solver, no I/O. */
export function computeEaseScore(inp: EaseScoreInput, ctx: ScoreContext, cfg: EaseScoreConfig): EaseScoreResult {
  const order = cfg.strategies as StrategyId[];
  const all = order.map((s) => scoreOne(inp, s, ctx, cfg));
  for (const x of all) if (x.result.applicable) x.result.planningBadge = planningBadge(inp, all, x.result, cfg);
  const strategies = all.map((x) => x.result);
  const notes = [...ctx.fitNotes];
  if (!inp.isPittsburgh) notes.push(`Outside the City of Pittsburgh: zoning is not loaded. Confirm zoning with ${inp.municipality ?? "the municipality"}.`);
  return { parid: inp.parid, configVersion: cfg.version, best: pickBest(strategies, order), strategies, unlocks: [], notes };
}
