// Which housing options the two-sentence summary talks about. Pure: classifies each scored strategy
// as by right or needing approval (from the same F1 fit the score used) and picks the best by-right
// option and the larger with-approval option. The web summary builds its pro formas around these.

import type { StrategyResult, ZbaReliefCounts } from "../score/types";
import type { ReliefType, SummaryPrecedent } from "./summary";

export interface PlanPath {
  path: "by_right" | "approval";
  /** Plain words with an article, e.g. "a special exception"; null when by right. */
  approval: string | null;
  reliefType: ReliefType | null;
  precedent: SummaryPrecedent | null;
  /** The QuickFit scheme the score's fit read (the pro forma must price this same scheme). */
  schemeId: string | null;
}

type F1In = { permissionCode?: string | null; fitStatus?: string | null; varianceRules?: string[]; lotOfRecordPath?: boolean; nonconforming?: boolean };

function precedentOf(zba: Record<string, ZbaReliefCounts> | null | undefined, relief: ReliefType | null): SummaryPrecedent | null {
  if (!relief || relief === "administrator_exception") return null;
  const c = zba?.[relief];
  if (!c) return { granted: 0, decided: 0, sinceYear: null };
  const year = c.from ? Number(c.from.slice(0, 4)) : null;
  return { granted: c.granted, decided: c.granted + c.denied, sinceYear: Number.isFinite(year) ? year : null };
}

/** How a strategy is allowed: by right, with a named approval, or null when our data can't say. */
export function classifyPlan(s: StrategyResult, zba: Record<string, ZbaReliefCounts> | null | undefined): PlanPath | null {
  if (!s.applicable || s.strategy === "adu") return null;
  const f1 = s.factors.find((f) => f.id === "F1");
  const i = (f1?.inputs ?? {}) as F1In;
  if (f1?.subscore == null || !i.permissionCode) return null;
  const code = i.permissionCode;
  const fit = i.fitStatus ?? null;
  if (fit === "no_fit" || fit == null) return null;
  const schemeId = s.schemeId ?? null;
  if (i.lotOfRecordPath)
    return { path: "approval", approval: "an administrator exception for a lot of record", reliefType: "administrator_exception", precedent: null, schemeId };
  const variance = fit === "variance";
  const names = (i.varianceRules ?? []).map((r) => r.replace(/_/g, " ").replace(/^min /, "minimum ").replace(/^max /, "maximum "));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const varianceText = names.length ? `a variance for the ${list}` : "a dimensional variance";
  if (code === "P" || (s.strategy === "rehab_existing" && i.nonconforming)) {
    if (!variance) return { path: "by_right", approval: null, reliefType: null, precedent: null, schemeId };
    return { path: "approval", approval: varianceText, reliefType: "dimensional_variance", precedent: precedentOf(zba, "dimensional_variance"), schemeId };
  }
  const relief: ReliefType = code === "S" ? "special_exception" : code === "C" ? "conditional_use" : code === "A" ? "administrator_exception" : "use_variance";
  const base = code === "S" ? "a special exception" : code === "C" ? "conditional use approval" : code === "A" ? "an administrator exception" : "a use variance";
  return { path: "approval", approval: variance ? `${base} and ${varianceText}` : base, reliefType: relief, precedent: precedentOf(zba, relief), schemeId };
}

/**
 * Best by-right option (highest value, then the higher Ease Score, then most units) and the
 * with-approval option that allows more homes than by right (most units, then the same order).
 * `value` is profit for a sale or yield for a rental; null sorts last.
 */
export function pickPlans<T extends { path: "by_right" | "approval"; units: number | null; value: number | null; score?: number | null }>(options: T[]): { byRight: T | null; withApproval: T | null } {
  const rank = (xs: T[]) => [...xs].sort((x, y) => (y.value ?? -Infinity) - (x.value ?? -Infinity) || (y.score ?? -Infinity) - (x.score ?? -Infinity) || (y.units ?? 0) - (x.units ?? 0));
  const byRight = rank(options.filter((o) => o.path === "by_right"))[0] ?? null;
  const approvals = options.filter((o) => o.path === "approval" && (byRight == null || (o.units ?? 0) > (byRight.units ?? 0)));
  const mostUnits = Math.max(0, ...approvals.map((o) => o.units ?? 0));
  const withApproval = rank(approvals.filter((o) => (o.units ?? 0) === mostUnits))[0] ?? null;
  return { byRight, withApproval };
}

/**
 * The page's default option: the summary's featured by-right option (the one that makes the most
 * financial sense), else the Ease Score's best strategy. The visitor's own choice always wins.
 */
export function defaultStrategy<S extends string>(chosen: S | null | undefined, featuredByRight: S | null | undefined, best: S | null | undefined): S | null {
  return chosen ?? featuredByRight ?? best ?? null;
}
