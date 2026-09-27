// Market strength: a signal shown beside the Ease Score, never blended into it. Read from the same
// new-construction comp set the pro forma prices a new home from (CompSet: count and median $/SF),
// against the default construction cost per finished sq ft in the cost config. Pure and deterministic.

import type { CompSet } from "./comps";
import { COST_CONFIG, type CostConfig } from "./config";

export type MarketLevel = "Strong" | "Moderate" | "Weak";

export interface MarketSignal {
  level: MarketLevel;
  /** New-construction sales in the set. */
  count: number;
  medianPerSf: number | null;
  radiusMi: number | null;
  /** Default construction cost per finished sq ft (cost config default tier). */
  costPerSf: number;
  /** The rule, in plain words. */
  rule: string;
  /** The rule applied to this parcel's numbers. */
  receipt: string;
}

/** Strong: new homes sell for at least this multiple of the default construction cost per sq ft. */
export const STRONG_MULTIPLE = 1.3;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function marketSignal(set: CompSet | null | undefined, config: CostConfig = COST_CONFIG): MarketSignal {
  const min = config.comps.newConstruction.minComps;
  const tier = config.construction.tiers.find((t) => t.id === config.construction.defaultTier) ?? config.construction.tiers[0]!;
  const cost = tier.costPerSf.value;
  const strongAt = Math.round(cost * STRONG_MULTIPLE);
  const count = set?.count ?? 0;
  const med = set?.median_price_per_sqft ?? null;
  const radius = set?.radius_mi ?? null;
  const rule = `Strong: ${min} or more recent new-construction sales nearby selling at a median of at least ${usd(strongAt)}/sq ft (${STRONG_MULTIPLE}× the default construction cost of ${usd(cost)}/sq ft, ${tier.label.toLowerCase()}). Moderate: ${min} or more sales at a median of at least ${usd(cost)}/sq ft. Weak: fewer than ${min} sales, or a median below ${usd(cost)}/sq ft. Sales: the same new-construction comparable set the pro forma uses (last ${config.comps.newConstruction.years} years).`;
  let level: MarketLevel;
  if (count < min || med == null) level = "Weak";
  else if (med >= strongAt) level = "Strong";
  else if (med >= cost) level = "Moderate";
  else level = "Weak";
  const where = radius != null ? ` within ${radius} mi` : "";
  const receipt = count === 0
    ? `No qualifying new-construction sales${where} in the last ${config.comps.newConstruction.years} years: ${level}.`
    : `${count} new-construction sale${count === 1 ? "" : "s"}${where}${med != null ? `, median ${usd(med)}/sq ft` : ""}${count < min ? ` (fewer than ${min})` : med != null ? (med >= strongAt ? ` (at least ${usd(strongAt)})` : med >= cost ? ` (at least ${usd(cost)}, below ${usd(strongAt)})` : ` (below ${usd(cost)})`) : ""}: ${level}.`;
  return { level, count, medianPerSf: med, radiusMi: radius, costPerSf: cost, rule, receipt };
}
