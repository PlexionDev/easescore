// Pillar 1D: cash-flow based returns. Timelines are monthly so approval and construction delays
// shift cash by the exact number of months; rates are reported per year.

import { compute, type Arg, type Receipt } from "./receipt";
import { annualFromMonthly, equityMultiple, irr, monthlyFromAnnual, npv, paybackPeriod } from "./tvm";

/** A monthly cash-flow series plus a Receipt that carries its inputs (value = net cash over the project). */
export interface CashFlows {
  basis: Receipt;
  /** flows[0] is month 0 (purchase / equity in). null when inputs are missing. */
  monthly: number[] | null;
}

export function cashFlows<K extends string>(
  label: string,
  formula: string,
  deps: Record<K, Arg>,
  build: (v: Record<K, number>) => number[] | string,
): CashFlows {
  let monthly: number[] | null = null;
  const basis = compute(label, formula, deps, (v) => {
    const f = build(v);
    if (typeof f === "string") return f;
    monthly = f;
    return f.reduce((s, x) => s + x, 0);
  });
  return { basis, monthly: basis.status === "ok" ? monthly : null };
}

export const npvOf = (cf: CashFlows, discountRate: Arg, label: string) =>
  compute(
    label,
    "Σ monthly cash flow ÷ (1 + monthly rate)^month, monthly rate = (1 + annual discount rate)^(1/12) − 1",
    { netCash: cf.basis, discountRate },
    (v) => npv(monthlyFromAnnual(v.discountRate), cf.monthly ?? []),
  );

export const irrOf = (cf: CashFlows, label: string) =>
  compute(
    label,
    "monthly rate where NPV = 0 (Newton, bisection fallback), annualized: (1 + monthly)^12 − 1",
    { netCash: cf.basis },
    () => {
      const m = irr(cf.monthly ?? []);
      return m === null ? "the cash flows never change sign, so there is no return rate" : annualFromMonthly(m);
    },
  );

export const paybackOf = (cf: CashFlows) =>
  compute(
    "Years until your cash comes back (payback period)",
    "first month cumulative cash flow ≥ 0, ÷ 12",
    { netCash: cf.basis },
    () => {
      const m = paybackPeriod(cf.monthly ?? []);
      return m === null ? "the cash put in does not come back within the modeled period" : m / 12;
    },
  );

export const equityMultipleOf = (cf: CashFlows) =>
  compute(
    "Total cash back ÷ cash in (equity multiple)",
    "sum of positive cash flows ÷ sum of negative cash flows",
    { netCash: cf.basis },
    () => equityMultiple(cf.monthly ?? []) ?? "no cash goes in, so the multiple is undefined",
  );

export const cashOnCash = (noi: Arg, debtService: Arg, equity: Arg) =>
  compute(
    "Yearly cash profit ÷ cash invested (cash-on-cash return)",
    "(NOI − annual debt service) ÷ equity",
    { noi, debtService, equity },
    (v) => (v.equity <= 0 ? "equity is zero or negative, so the return is undefined" : (v.noi - v.debtService) / v.equity),
  );

/**
 * Development-period flows shared by rental and for-sale models (unlevered):
 * month 0 land; holding cost spread evenly over months 1..D; hard + soft + contingency spread evenly
 * over the construction months (A+1..A+C), where A = approval period and C = construction period.
 */
export function developmentFlows(
  totalMonths: number,
  v: { land: number; buildCost: number; holdingCosts: number; approvalPeriod: number; constructionPeriod: number },
): number[] {
  const flows = new Array<number>(totalMonths + 1).fill(0);
  const A = v.approvalPeriod;
  const C = v.constructionPeriod;
  const D = A + C;
  flows[0] = -v.land;
  if (D === 0) flows[0] -= v.holdingCosts;
  else for (let m = 1; m <= D; m++) flows[m] = (flows[m] ?? 0) - v.holdingCosts / D;
  if (C === 0) flows[A] = (flows[A] ?? 0) - v.buildCost;
  else for (let m = A + 1; m <= D; m++) flows[m] = (flows[m] ?? 0) - v.buildCost / C;
  return flows;
}

export const positiveWholeYears = (years: number) =>
  Number.isInteger(years) && years > 0 ? null : "the hold period must be a whole number of years, one or more";

export const positiveWholeMonths = (months: number, what: string) =>
  Number.isInteger(months) && months > 0 ? null : `${what} must be a whole number of months, one or more`;
