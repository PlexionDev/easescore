// The best option with its own home count, from a stored parcel_scores row. Stored by_right_units is the
// most homes by right across ALL building types, so it is never shown beside the best option's name as
// if it were that option's yield; it is labeled MOST_BY_RIGHT instead.

import { STRATEGY_TEXT } from "./planner-query";

export const MOST_BY_RIGHT = "Most homes by right, any type";

/** The best option's own home count: 1 for single-family or a backyard unit, 2 for a duplex, 3 or 4 for a 3–4 unit building; null when the stored row cannot tell (townhouse row). */
export function bestOwnUnits(r: { best_strategy: string | null; by_right_units: number | null }): number | null {
  switch (r.best_strategy) {
    case "new_sf":
    case "adu":
      return 1;
    case "duplex":
      return 2;
    case "three_four_unit":
      return r.by_right_units === 3 || r.by_right_units === 4 ? r.by_right_units : null;
    default:
      return null;
  }
}

/** "Duplex · 2 homes" (the type alone when its own count is unknown); null when there is no best option. */
export function bestWithHomes(r: { best_strategy: string | null; by_right_units: number | null }): string | null {
  if (!r.best_strategy) return null;
  const type = STRATEGY_TEXT[r.best_strategy] ?? r.best_strategy;
  const n = bestOwnUnits(r);
  return n != null ? `${type} · ${n} home${n === 1 ? "" : "s"}` : type;
}
