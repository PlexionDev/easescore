// "Best options for this lot": one row per housing option, ranked. Ease (the Ease Score) and money
// (does it pencil) stay two separate signals and are never blended into one number: the ranking only
// uses the pencil verdict to split the list, then orders by ease inside each group.
//
//   1. Options that are allowed and fit the lot, and pencil (yes or barely), easiest first.
//   2. Options that are allowed and fit the lot, whatever the pro forma says (no verdict, or no sale value yet), easiest first.
//   3. Options that cannot be evaluated (zoning not in our data; renovating an existing building, whose
//      condition inside is unknown), easiest first.
//   4. Options the zoning does not allow, or that do not fit the lot, easiest first.
//   5. Options that do not apply here (e.g. renovation on a vacant lot).
//
// The best option is the easiest option that is allowed and fits (groups 1-2, "evaluable"): zoning and fit
// decide it, never whether pricing exists. A missing sale value shows in the Pro forma, not here. When
// nothing pencils, the first row is the easiest evaluable option, labeled "Needs subsidy or lower costs".
// Renovation is never estimated automatically, so it is never the best option.
// Pure and deterministic.

import type { StrategyId, StrategyResult, EaseScoreResult, Band } from "./types";

export type ZoningPathKind =
  | "allowed" | "administrator_exception" | "special_exception" | "conditional_use" | "variance"
  | "existing" | "not_allowed" | "no_fit" | "unknown" | "not_applicable";

/** Money signal per option, from the pro forma (never from the score). */
export type PencilState = "yes" | "thin" | "no" | "pricing" | "unknown" | "none";

export interface OptionRow {
  strategy: StrategyId;
  /** Short option name, e.g. "Duplex". */
  name: string;
  applicable: boolean;
  score: number | null;
  range: [number, number] | null;
  band: Band | null;
  zoning: { kind: ZoningPathKind; text: string };
  pencils: PencilState;
  /** 1-based position in the list. */
  rank: number;
  /** Label on the first row: "Easiest option that pencils", "Needs subsidy or lower costs", or null. */
  leadLabel: string | null;
  /** Allowed and fits (zoning known, not blocked; not a renovation): only these can be the best option. */
  evaluable: boolean;
}

export const OPTION_NAME: Record<StrategyId, string> = {
  rehab_existing: "Renovate the existing building",
  new_sf: "New single-family",
  duplex: "Duplex",
  three_four_unit: "3–4 units",
  townhouse_row: "Townhouse row",
  adu: "ADU (backyard unit)",
};

export const LEAD_PENCILS = "Easiest option that pencils";
export const LEAD_SUBSIDY = "Needs subsidy or lower costs";

type F1In = {
  permissionCode?: string | null; fitStatus?: string | null; varianceRules?: string[]; lotOfRecordPath?: boolean;
  nonconforming?: boolean; status?: string; contextualBasis?: "measured" | "assumed"; contextualFrontSetbackFt?: number;
};

const ruleWords = (rs: string[] | undefined) =>
  (rs ?? []).map((r) => r.replace(/_/g, " ").replace(/^min /, "minimum ").replace(/^max /, "maximum ")).join(", ");

/** The zoning path in plain words, read from the option's F1 (zoning permission) factor. */
export function optionZoningPath(s: StrategyResult): { kind: ZoningPathKind; text: string } {
  if (!s.applicable) return { kind: "not_applicable", text: s.notApplicableReason ?? "Does not apply to this lot" };
  if (s.strategy === "rehab_existing")
    return { kind: "existing", text: "Not evaluated. Condition inside is unknown; needs an inspection." };
  const f1 = s.factors.find((f) => f.id === "F1");
  const i = (f1?.inputs ?? {}) as F1In;
  if (!f1 || f1.subscore == null || !i.permissionCode) {
    if (s.strategy === "adu") return { kind: "unknown", text: "Backyard units are not in our zoning rules: confirm with the City" };
    return { kind: "unknown", text: "Zoning not in our data: confirm with the municipality" };
  }
  const code = i.permissionCode;
  if (code === "N" || i.status === "not_allowed") return { kind: "not_allowed", text: "Not allowed here: would need a rezoning or a use variance (hard to get)" };
  if (i.fitStatus === "no_fit") return { kind: "no_fit", text: "Allowed use, but no building of this type fits the lot" };
  if (i.lotOfRecordPath) return { kind: "administrator_exception", text: "Needs an administrator exception (undersized lot of record)" };
  const variance = i.fitStatus === "variance";
  const vText = variance ? `a variance${i.varianceRules?.length ? ` (${ruleWords(i.varianceRules)})` : ""}` : "";
  if (code === "P") return variance ? { kind: "variance", text: `Allowed use; needs ${vText}` } : { kind: "allowed", text: i.fitStatus === "contextual"
    ? (i.contextualBasis === "measured" ? `Allowed by matching neighbors (§925.06 front setback ${i.contextualFrontSetbackFt} ft)` : "Allowed (with the contextual front setback)")
    : "Allowed" };
  const [kind, base]: [ZoningPathKind, string] =
    code === "A" ? ["administrator_exception", "Needs an administrator exception"]
    : code === "S" ? ["special_exception", "Needs a special exception"]
    : code === "C" ? ["conditional_use", "Needs conditional use approval"]
    : ["unknown", `Permission code ${code}: check the use table`];
  const ctx = i.fitStatus === "contextual" && i.contextualBasis === "measured" ? " (front line matches the neighbors, §925.06)" : "";
  return { kind, text: variance ? `${base} and ${vText}` : base + ctx };
}

const BLOCKED_KINDS: ZoningPathKind[] = ["not_allowed", "no_fit"];

/** Ease used for ordering: the score, else the middle of its range, else last. */
const easeOf = (s: StrategyResult) => (s.score != null ? s.score : s.range ? (s.range[0] + s.range[1]) / 2 : -1);

/** Allowed and fits: zoning known and not blocked, and not a renovation (never estimated automatically). Pricing plays no part. */
export function isEvaluable(s: StrategyResult, z: ZoningPathKind, _p?: PencilState): boolean {
  return s.applicable && s.strategy !== "rehab_existing" && z !== "unknown" && z !== "not_applicable" && z !== "existing" && !BLOCKED_KINDS.includes(z);
}

function group(s: StrategyResult, z: ZoningPathKind, p: PencilState): number {
  if (!s.applicable) return 4;
  if (BLOCKED_KINDS.includes(z)) return 3;
  if (!isEvaluable(s, z, p)) return 2;
  return p === "yes" || p === "thin" ? 0 : 1;
}

/**
 * Rank every option. `pencils` is the pro forma verdict per option (missing = "unknown").
 * Ties: higher Ease Score, then the config's strategy order.
 */
export function rankOptions(result: Pick<EaseScoreResult, "strategies">, pencils: Partial<Record<StrategyId, PencilState>>): OptionRow[] {
  const order = result.strategies.map((s) => s.strategy);
  const rows = result.strategies.map((s) => {
    const zoning = optionZoningPath(s);
    const p: PencilState = !s.applicable ? "none" : pencils[s.strategy] ?? "unknown";
    return { s, zoning, p, g: group(s, zoning.kind, p) };
  });
  rows.sort((a, b) => a.g - b.g || easeOf(b.s) - easeOf(a.s) || order.indexOf(a.s.strategy) - order.indexOf(b.s.strategy));
  return rows.map(({ s, zoning, p, g }, i) => ({
    strategy: s.strategy,
    name: OPTION_NAME[s.strategy],
    applicable: s.applicable,
    score: s.score,
    range: s.range ?? null,
    band: s.band,
    zoning,
    pencils: p,
    rank: i + 1,
    leadLabel: i > 0 ? null : g === 0 ? LEAD_PENCILS : g === 1 && p === "no" ? LEAD_SUBSIDY : null,
    evaluable: g <= 1,
  }));
}
