// Adapters: engine outputs → NarrativeFacts.
// fromStrategyResult() maps the score engine's StrategyResult; toNarrativeFacts() takes the
// §7 shape loosely, for callers that assemble the pieces themselves.

import config from "../../config/ease-score.v0.1.json";
import type { StrategyFit, StrategyResult } from "../score/types";
import type { UsePermission } from "../types";
import type {
  CostRange, UsePath,
  Band, NarrativeCallout, NarrativeFacts, NarrativeFactor, NarrativeProForma, NarrativeRedFlag,
  NarrativeRequirement, NarrativeUnlock, NarrativeZoning,
} from "./types";

/** The §7 per-parcel, per-strategy score output, as far as the narrative needs it. */
export interface ScoreOutputLike {
  score: number | null;
  range?: { min: number; max: number } | null;
  band: Band | null;
  insufficientEvidence?: boolean;
  redFlags: Array<{ id: string; label: string; path?: string | null }>;
  reviewCallouts: Array<{ id: string; label: string; action?: string | null; cost?: { low: number; high: number; isDefault?: boolean } | null; months?: number | null; requirementId?: string | null }>;
  factors: Array<{ id: string; label?: string; weight: number; subscore: number | null; evidence: "complete" | "partial" | "missing"; oneLiner?: string | null }>;
  predictedMonthsToPermit: number | null;
  unlocks?: Array<{ label: string; scoreGain?: number | null; unitGain?: number | null }>;
  configVersion: string;
}

export interface NarrativeInputs {
  parid: string;
  strategy: { id: string; label: string };
  score: ScoreOutputLike;
  zoning: NarrativeZoning;
  proForma?: NarrativeProForma | null;
  /** Requirements engine results (RequirementResult) or anything with id/item/status/phase/issuer. */
  requirements: Array<{ id: string; item: string; status: NarrativeRequirement["status"]; phase?: string | null; issuer?: string | null; cost?: { low: number; high: number; isDefault?: boolean } | null; weeks?: number | null }>;
}

/** Assemble NarrativeFacts from the engine outputs. Drops NOT_NEEDED items to keep the JSON small. */
export function toNarrativeFacts(i: NarrativeInputs): NarrativeFacts {
  const redFlags: NarrativeRedFlag[] = i.score.redFlags.map((r) => ({ id: r.id, label: r.label, path: r.path ?? null }));
  const reviewCallouts: NarrativeCallout[] = i.score.reviewCallouts.map((c) => ({
    id: c.id, label: c.label, action: c.action ?? null, cost: c.cost ?? null, months: c.months ?? null, requirementId: c.requirementId ?? null,
  }));
  const factors: NarrativeFactor[] = i.score.factors.map((f) => ({
    id: f.id, label: f.label ?? f.id, weight: f.weight, subscore: f.subscore, evidence: f.evidence, oneLiner: f.oneLiner ?? null,
  }));
  const unlocks: NarrativeUnlock[] = (i.score.unlocks ?? []).map((u) => ({ label: u.label, scoreGain: u.scoreGain ?? null, unitGain: u.unitGain ?? null }));
  return {
    parid: i.parid,
    strategy: i.strategy,
    configVersion: i.score.configVersion,
    score: {
      score: i.score.score,
      band: i.score.band,
      range: i.score.range ?? null,
      insufficientEvidence: i.score.insufficientEvidence ?? false,
      redFlags,
      reviewCallouts,
      factors,
      predictedMonthsToPermit: i.score.predictedMonthsToPermit,
      unlocks,
      configVersion: i.score.configVersion,
    },
    zoning: i.zoning,
    proForma: i.proForma ?? null,
    requirements: i.requirements
      .filter((r) => r.status !== "NOT_NEEDED")
      .map((r) => ({ id: r.id, item: r.item, status: r.status, phase: r.phase ?? null, issuer: r.issuer ?? null, cost: r.cost ?? null, weeks: r.weeks ?? null })),
  };
}

// ---------------------------------------------------------------------------------------------
// Score engine → narrative.

/** Use-permission code (P/S/A/C/N) → the path the narrative describes. */
export function usePathFromPermission(code: UsePermission | null | undefined): UsePath {
  switch (code) {
    case "P": return "by_right";
    case "S": return "special_exception";
    case "A": return "administrator_exception";
    case "C": return "conditional_use";
    case "N": return "not_permitted";
    default: return "unknown";
  }
}

/** QuickFit's StrategyFit → the zoning part of the facts. */
export function zoningFromFit(
  fit: StrategyFit | null,
  opts: { useLabel: string; district?: string | null; municipality?: string | null; grantRate?: number | null; grantCases?: number | null },
): NarrativeZoning {
  const dimensional: NarrativeZoning["dimensional"] = !fit
    ? "unknown"
    : fit.status === "by_right" || fit.status === "existing"
      ? "fits"
      : fit.status === "contextual"
        ? "contextual"
        : "variance";
  return {
    district: opts.district ?? null,
    useLabel: opts.useLabel,
    use: usePathFromPermission(fit?.permissionCode),
    dimensional,
    varianceItems: fit?.varianceRules.map((r) => r.replace(/_/g, " ")) ?? [],
    grantRate: opts.grantRate ?? null,
    grantCases: opts.grantCases ?? null,
    units: fit?.units ?? null,
    municipality: opts.municipality ?? null,
  };
}

/** What each review callout asks for, in plain words, and its editable default cost from the config. */
const CALLOUT_ACTION: Partial<Record<string, string>> = {
  landslide_prone: "a geotechnical report",
  undermined: "grouting",
};

function calloutCost(id: string): CostRange | null {
  const rc = (config as { reviewCallouts?: { groutingCostUsd?: { low: number; high: number } | null; geotechReportCostUsd?: { low: number; high: number } | null } }).reviewCallouts;
  const c = id === "undermined" ? rc?.groutingCostUsd : id === "landslide_prone" ? rc?.geotechReportCostUsd : null;
  return c ? { low: c.low, high: c.high, isDefault: true } : null;
}

/** Map one StrategyResult from the score engine into NarrativeFacts. */
export function fromStrategyResult(i: {
  parid: string;
  result: StrategyResult;
  zoning: NarrativeZoning;
  proForma?: NarrativeProForma | null;
  requirements: NarrativeInputs["requirements"];
}): NarrativeFacts {
  const r = i.result;
  return toNarrativeFacts({
    parid: i.parid,
    strategy: { id: r.strategy, label: r.strategyLabel },
    score: {
      score: r.score,
      range: r.range ? { min: r.range[0], max: r.range[1] } : null,
      band: r.band,
      insufficientEvidence: r.labels.some((l) => l.startsWith("Preliminary")),
      redFlags: r.redFlags.map((f) => ({ id: f.id, label: f.title, path: f.path })),
      reviewCallouts: r.reviewCallouts.map((c) => ({
        id: c.id, label: c.title, action: CALLOUT_ACTION[c.id] ?? null, cost: calloutCost(c.id),
        requirementId: c.id === "landslide_prone" ? "geotech" : null,
      })),
      factors: r.factors.map((f) => ({ id: f.id, label: f.label, weight: f.weight, subscore: f.subscore, evidence: f.evidence, oneLiner: f.oneLiner })),
      predictedMonthsToPermit: r.predictedMonthsToPermit?.months ?? null,
      unlocks: r.unlocks.filter((u) => u.evaluated).map((u) => ({ label: u.label, scoreGain: u.scoreDelta, unitGain: u.unitsDelta })),
      configVersion: r.configVersion,
    },
    zoning: i.zoning,
    proForma: i.proForma,
    requirements: i.requirements,
  });
}
