// Rehab (renovation) cost per finished sq ft by condition tier, from the County assessment's condition,
// year built and finished area. Ranges are editable assumptions (cost-assumptions.construction.rehab).

import { COST_CONFIG, type CostConfig } from "./config";

export interface RehabEstimate {
  tier: { id: string; label: string };
  /** $/finished SF after the older-house factor: [low, likely, high]. */
  perSf: [number, number, number];
  /** Dollars for the whole building (finished area × $/SF), unrounded: [low, likely, high]. */
  total: [number, number, number] | null;
  finishedSf: number | null;
  /** Plain reason: condition, year built, the factor applied. */
  basis: string;
  sourceLabel: string;
}

export function rehabEstimate(a: { condition: string | null | undefined; yearBuilt: number | null | undefined; finishedSf: number | null | undefined }, cfg: CostConfig = COST_CONFIG): RehabEstimate {
  const r = cfg.construction.rehab;
  const cond = a.condition?.trim().toUpperCase() || null;
  const tier = (cond ? r.tiers.find((t) => (t.conditions as string[]).includes(cond)) : undefined) ?? r.tiers.find((t) => t.id === r.unknownConditionTier)!;
  const old = a.yearBuilt != null && a.yearBuilt < r.oldHouse.builtBefore;
  const f = old ? r.oldHouse.factor : 1;
  const [lo, hi] = tier.costPerSf.range as [number, number];
  const perSf: [number, number, number] = [Math.round(lo * f), Math.round(tier.costPerSf.value * f), Math.round(hi * f)];
  const sf = a.finishedSf != null && a.finishedSf > 0 ? a.finishedSf : null;
  const basis = `${cond ? `County condition "${cond.charAt(0)}${cond.slice(1).toLowerCase()}"` : "Condition not recorded (middle tier used)"} → ${tier.label}, $${lo}–$${hi}/SF (likely $${tier.costPerSf.value})${old ? `; built ${a.yearBuilt}, before ${r.oldHouse.builtBefore}: × ${r.oldHouse.factor} for lead paint, old wiring and plaster` : ""}`;
  return {
    tier: { id: tier.id, label: tier.label }, perSf,
    total: sf ? [perSf[0] * sf, perSf[1] * sf, perSf[2] * sf] : null,
    finishedSf: sf, basis, sourceLabel: tier.costPerSf.sourceLabel,
  };
}
