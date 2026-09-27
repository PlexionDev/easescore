// "Does it plausibly pencil?" at policy scale: one quick test per parcel for the scheme the rules allow
// by right, in three scenarios. Deliberately simpler than the parcel pro forma (no financing detail, no
// site adders): the policy view needs an honest range across thousands of lots, not a single underwrite.
// Every input is a sourced default from engine/config/cost-assumptions.v0.1.json or a value from data.

import { COST_CONFIG, type CostConfig } from "../assumptions/config";

export type Scenario = "low" | "likely" | "high";
export const SCENARIOS: Scenario[] = ["low", "likely", "high"];
export type Triple = Record<Scenario, number>;

/** New-construction sale value per finished sq ft near a parcel (quartiles of nearby comps). */
export interface ValueBand {
  p25: number;
  p50: number;
  p75: number;
  n: number;
  /** Search radius that reached the comp count, miles (null = citywide fallback). */
  radiusMi: number | null;
}

export interface CostBasis {
  /** Construction $/finished sq ft: low / likely / high (the "good" tier range). */
  costPsf: Triple;
  /** Soft costs as a share of hard cost: low / likely / high. */
  softShare: Triple;
  contingencyShare: number;
  brokerShare: number;
  /** Profit margin on cost a for-sale project needs to be more than "thin". */
  minMargin: number;
}

/** The cost basis from the pro forma config, so the policy view and the parcel pro forma never disagree. */
export function costBasis(cfg: CostConfig = COST_CONFIG): CostBasis {
  const tier = cfg.construction.tiers.find((t) => t.id === cfg.construction.defaultTier) ?? cfg.construction.tiers[0]!;
  const [cLo, cHi] = tier.costPerSf.range as [number, number];
  const sc = cfg.softCosts;
  const soft = (i: 0 | 1) => sc.architectureEngineering.range[i]! + sc.permitsAndFees.range[i]! + sc.surveyTitleLegalInsurance.range[i]!;
  return {
    costPsf: { low: cHi, likely: tier.costPerSf.value, high: cLo }, // "low" = the conservative scenario: high cost
    softShare: {
      low: soft(1),
      likely: sc.architectureEngineering.value + sc.permitsAndFees.value + sc.surveyTitleLegalInsurance.value,
      high: soft(0),
    },
    contingencyShare: cfg.contingency.flat.value,
    brokerShare: cfg.sale.brokerShare.value,
    minMargin: cfg.pencils.thinMarginBelow.value,
  };
}

export interface PencilInput {
  units: number;
  /** Net (livable) floor area of the whole scheme, sq ft. */
  netSf: number;
  /** Gross floor area of the whole scheme, sq ft. */
  grossSf: number;
  /** What the lot costs to acquire (assessed value, land + any building), dollars. */
  acquisition: number;
  value: ValueBand;
}

export interface PencilResult {
  pencils: Record<Scenario, boolean>;
  /** Gross sale value of the scheme per scenario, dollars. */
  saleValue: Triple;
  totalCost: Triple;
  margin: Triple;
}

/**
 * Three scenarios: low = low-quartile prices with high costs, likely = medians, high = high-quartile
 * prices with low costs. Because each scenario is at least as favourable as the one before, a parcel
 * that pencils in "low" pencils in all three: counts are ordered low <= likely <= high by construction.
 */
export function pencilTest(p: PencilInput, b: CostBasis = costBasis()): PencilResult {
  const price: Triple = { low: p.value.p25, likely: p.value.p50, high: p.value.p75 };
  const out = { pencils: {} as Record<Scenario, boolean>, saleValue: {} as Triple, totalCost: {} as Triple, margin: {} as Triple };
  for (const s of SCENARIOS) {
    const sale = price[s] * p.netSf;
    const hard = b.costPsf[s] * p.grossSf;
    const cost = hard * (1 + b.softShare[s] + b.contingencyShare) + Math.max(0, p.acquisition);
    const margin = cost > 0 ? (sale * (1 - b.brokerShare) - cost) / cost : -1;
    out.saleValue[s] = Math.round(sale);
    out.totalCost[s] = Math.round(cost);
    out.margin[s] = Math.round(margin * 1000) / 1000;
    out.pencils[s] = p.units > 0 && p.netSf > 0 && sale > 0 && margin >= b.minMargin;
  }
  // Enforce the ordering even at exact ties from rounding.
  if (out.pencils.low) out.pencils.likely = true;
  if (out.pencils.likely) out.pencils.high = true;
  return out;
}
