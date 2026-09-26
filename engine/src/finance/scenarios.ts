// Pillar 1F: scenarios, one-variable sensitivity, tornado data, and break-even solvers.
// Scenario sets are structure only: the numbers are supplied by the user or the database.

import { forSaleProForma, rentalProForma } from "./proforma";
import { compute, notComputable, type Receipt } from "./receipt";
import { bisect } from "./tvm";
import type { DevelopmentInputs, ForSaleInputs, RentalInputs, UnitRow } from "./types";

export type ScenarioId = "base" | "conservative" | "optimistic";

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  base: "Base",
  conservative: "Conservative",
  optimistic: "Optimistic",
};

/** A saved assumption set. Conservative and optimistic store only the assumptions that differ from base. */
export interface Scenario<I> {
  id: ScenarioId;
  name: string;
  assumptions: Partial<I>;
  /** Where the assumptions came from (user entry, database table and date, ...). */
  source?: string;
  notes?: string;
}

export interface ScenarioSet<I> {
  base: Scenario<I>;
  conservative?: Scenario<I>;
  optimistic?: Scenario<I>;
}

/** Inputs for one scenario: base assumptions with that scenario's overrides laid on top. */
export function resolveScenario<I extends object>(set: ScenarioSet<I>, id: ScenarioId): I | null {
  const s = set[id];
  if (!s) return null;
  return { ...set.base.assumptions, ...s.assumptions } as I;
}

/** A single assumption that can be moved: `apply` returns new inputs with the change `x` applied. */
export interface SensitivityVariable<I> {
  id: string;
  label: string;
  /** How x is read, e.g. "share change (+0.10 = +10%)" or "months added". */
  unit: string;
  apply: (inputs: I, x: number) => I;
}

const scaled = (v: number | null | undefined, x: number) => (typeof v === "number" ? v * (1 + x) : v);
const shifted = (v: number | null | undefined, x: number) => (typeof v === "number" ? v + x : v);

/** Scale a numeric field by (1 + x). Missing stays missing. */
export function scaleField<I extends object>(key: keyof I & string, label: string): SensitivityVariable<I> {
  return {
    id: `${key}:scale`,
    label,
    unit: "share change (+0.10 = +10%)",
    apply: (inputs, x) => ({ ...inputs, [key]: scaled(inputs[key] as number | null | undefined, x) }),
  };
}

/** Add x to a numeric field (rates in decimals, months in months). Missing stays missing. */
export function shiftField<I extends object>(key: keyof I & string, label: string, unit: string): SensitivityVariable<I> {
  return {
    id: `${key}:shift`,
    label,
    unit,
    apply: (inputs, x) => ({ ...inputs, [key]: shifted(inputs[key] as number | null | undefined, x) }),
  };
}

const mapMix = (mix: UnitRow[] | undefined, field: "monthlyRent" | "salePrice", x: number) =>
  mix?.map((r) => ({ ...r, [field]: scaled(r[field], x) }));

/** Scale every unit's rent by (1 + x). */
export const rentChange = <I extends { unitMix?: UnitRow[] }>(): SensitivityVariable<I> => ({
  id: "rent:scale",
  label: "Rent",
  unit: "share change (+0.10 = +10%)",
  apply: (inputs, x) => ({ ...inputs, unitMix: mapMix(inputs.unitMix, "monthlyRent", x) }),
});

/** Scale every unit's sale price by (1 + x). */
export const salePriceChange = <I extends { unitMix?: UnitRow[] }>(): SensitivityVariable<I> => ({
  id: "salePrice:scale",
  label: "Sale price",
  unit: "share change (+0.10 = +10%)",
  apply: (inputs, x) => ({ ...inputs, unitMix: mapMix(inputs.unitMix, "salePrice", x) }),
});

/** Scale hard costs (total or per sq ft, plus hard site lines) by (1 + x). Soft and contingency shares follow. */
export const hardCostChange = <I extends DevelopmentInputs>(): SensitivityVariable<I> => ({
  id: "hardCost:scale",
  label: "Construction cost (hard costs)",
  unit: "share change (+0.10 = +10%)",
  apply: (inputs, x) => ({
    ...inputs,
    hardCost: scaled(inputs.hardCost, x),
    hardCostPerSqFt: scaled(inputs.hardCostPerSqFt, x),
    hardSiteLines: inputs.hardSiteLines
      ? Object.fromEntries(Object.entries(inputs.hardSiteLines).map(([k, v]) => [k, scaled(v, x)]))
      : inputs.hardSiteLines,
  }),
});

/** A metric to watch: a function of the inputs returning a Receipt (e.g. levered IRR, profit). */
export type Metric<I> = (inputs: I) => Receipt;

export interface SweepPoint {
  x: number;
  value: number | null;
  status: Receipt["status"];
}

/** One-variable sensitivity: the metric at each x. */
export function sweep<I>(inputs: I, variable: SensitivityVariable<I>, xs: readonly number[], metric: Metric<I>): SweepPoint[] {
  return xs.map((x) => {
    const r = metric(variable.apply(inputs, x));
    return { x, value: r.value, status: r.status };
  });
}

export interface TornadoSpec<I> {
  variable: SensitivityVariable<I>;
  low: number;
  high: number;
}

export interface TornadoRow {
  id: string;
  label: string;
  low: number;
  high: number;
  valueAtLow: number | null;
  valueAtHigh: number | null;
  /** |valueAtHigh − valueAtLow|; null when either end cannot be computed. */
  swing: number | null;
}

/** Tornado data: each variable moved low and high; rows sorted by swing, largest first (uncomputable last). */
export function tornado<I>(inputs: I, specs: readonly TornadoSpec<I>[], metric: Metric<I>): { base: Receipt; rows: TornadoRow[] } {
  const base = metric(inputs);
  const rows = specs.map(({ variable, low, high }) => {
    const valueAtLow = metric(variable.apply(inputs, low)).value;
    const valueAtHigh = metric(variable.apply(inputs, high)).value;
    const swing = valueAtLow === null || valueAtHigh === null ? null : Math.abs(valueAtHigh - valueAtLow);
    return { id: variable.id, label: variable.label, low, high, valueAtLow, valueAtHigh, swing };
  });
  rows.sort((a, b) => {
    if (a.swing === null && b.swing === null) return a.id.localeCompare(b.id);
    if (a.swing === null) return 1;
    if (b.swing === null) return -1;
    return b.swing - a.swing || a.id.localeCompare(b.id);
  });
  return { base, rows };
}

const MAX_BRACKET_DOUBLINGS = 60;

/**
 * Solve for the x at which the metric equals zero, by bisection on [lo, hi].
 * If there is no sign change, hi is doubled (away from lo) until one appears or the cap is reached.
 */
export function breakEven<I>(
  inputs: I,
  variable: SensitivityVariable<I>,
  metric: Metric<I>,
  lo: number,
  hi: number,
  label: string,
): Receipt {
  const formula = `${variable.label} change (${variable.unit}) at which the metric = 0, by bisection`;
  const base = metric(inputs);
  if (base.status !== "ok") {
    return compute(label, formula, { metric: base }, (v) => v.metric);
  }
  const f = (x: number) => {
    const r = metric(variable.apply(inputs, x)).value;
    return r === null ? NaN : r;
  };
  let top = hi;
  let root = bisect(f, lo, top);
  for (let k = 0; root === null && k < MAX_BRACKET_DOUBLINGS; k++) {
    top = lo + (top - lo) * 2;
    root = bisect(f, lo, top);
  }
  const inputsUsed = { variable: variable.id, lo, hi: top, metricAtBase: base.value };
  if (root === null) return notComputable(label, formula, inputsUsed, "the metric does not cross zero in the searched range");
  return { status: "ok", value: root, label, formula, inputs: inputsUsed };
}

const averageRent = (mix: UnitRow[] | undefined) => {
  let units = 0;
  let rent = 0;
  for (const r of mix ?? []) {
    units += r.count ?? 0;
    rent += (r.count ?? 0) * (r.monthlyRent ?? 0);
  }
  return units > 0 ? rent / units : null;
};

/**
 * "Breaks even at $X/mo rent": the average monthly rent per unit at which NPV = 0
 * (all rents scaled by the same share). basis picks unlevered or levered NPV.
 */
export function breakEvenRent(inputs: RentalInputs, basis: "unlevered" | "levered"): Receipt {
  const metric: Metric<RentalInputs> = (i) =>
    basis === "unlevered" ? rentalProForma(i).returns.unleveredNpv : rentalProForma(i).returns.leveredNpv;
  const label = `Break-even rent, average per home per month (${basis} NPV = 0)`;
  const shift = breakEven(inputs, rentChange<RentalInputs>(), metric, -1, 1, label);
  if (shift.status !== "ok") return shift;
  const avg = averageRent(inputs.unitMix);
  return compute(
    label,
    "average current rent × (1 + rent change at which NPV = 0)",
    { averageRent: avg, rentChange: shift },
    (v) => v.averageRent * (1 + v.rentChange),
  );
}

/** "Breaks even if costs rise less than X%": hard-cost increase (share) at which for-sale profit = 0. */
export function breakEvenCostIncrease(inputs: ForSaleInputs): Receipt {
  return breakEven(
    inputs,
    hardCostChange<ForSaleInputs>(),
    (i) => forSaleProForma(i).sales.profit,
    -1,
    1,
    "Hard-cost increase at which profit = 0 (break-even cost increase)",
  );
}
