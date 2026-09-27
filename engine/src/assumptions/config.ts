// Cost assumptions config: every default lives in engine/config/cost-assumptions.v0.2.json with its
// range and source label. This file only types it and lists it for the assumptions table.

import raw from "../../config/cost-assumptions.v0.2.json";

export type CostConfig = typeof raw;
export const COST_CONFIG: CostConfig = raw;

/** One sourced value from the config: `{ value, range?, sourceLabel, sourceNote? }`. */
export interface Sourced {
  value: number | null;
  range?: number[];
  sourceLabel: string;
  sourceNote?: string;
}

export type TierId = CostConfig["construction"]["tiers"][number]["id"];

export function tierOf(cfg: CostConfig, id: string | undefined) {
  const tiers = cfg.construction.tiers;
  return tiers.find((t) => t.id === id) ?? tiers.find((t) => t.id === cfg.construction.defaultTier) ?? tiers[0]!;
}
