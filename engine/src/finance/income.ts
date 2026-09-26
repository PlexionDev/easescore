// Pillar 1B: income and value (rental) and sales (for-sale).

import { compute, divide, type Arg, type Num, type Receipt } from "./receipt";
import type { UnitRow } from "./types";

/** Σ over unit rows of count × field, with every row's count and field required. */
function unitSum(label: string, formula: string, mix: UnitRow[] | undefined, field: "monthlyRent" | "salePrice", times: number): Receipt {
  if (mix === undefined || mix.length === 0) {
    return compute(label, formula, { unitMix: undefined as Num }, () => 0);
  }
  const args: Record<string, Num> = {};
  mix.forEach((row, n) => {
    args[`unitMix[${n}].count`] = row.count;
    args[`unitMix[${n}].${field}`] = row[field];
  });
  return compute(label, formula, args, (v) =>
    mix.reduce((s, _row, n) => s + (v[`unitMix[${n}].count`] ?? 0) * (v[`unitMix[${n}].${field}`] ?? 0) * times, 0),
  );
}

/** Number of units in the unit mix. */
export function unitCount(mix: UnitRow[] | undefined): Receipt {
  if (mix === undefined || mix.length === 0) {
    return compute("Homes in the unit mix", "Σ unit counts", { unitMix: undefined as Num }, () => 0);
  }
  const args: Record<string, Num> = {};
  mix.forEach((row, n) => {
    args[`unitMix[${n}].count`] = row.count;
  });
  return compute("Homes in the unit mix", "Σ unit counts", args, (v) => Object.values(v).reduce((s, x) => s + x, 0));
}

export const grossPotentialRent = (mix: UnitRow[] | undefined) =>
  unitSum("Rent if every unit is leased, yearly (GPR)", "Σ units × monthly rent × 12", mix, "monthlyRent", 12);

export const grossSales = (mix: UnitRow[] | undefined) =>
  unitSum("Gross sales revenue", "Σ units × sale price", mix, "salePrice", 1);

export interface RentalIncome {
  gpr: Receipt;
  vacancyLoss: Receipt;
  egi: Receipt;
}

export function rentalIncome(mix: UnitRow[] | undefined, vacancyShare: Num, otherIncomeAnnual: Num): RentalIncome {
  const gpr = grossPotentialRent(mix);
  const vacancyLoss = compute(
    "Rent you won't collect (vacancy and credit loss)",
    "GPR × vacancy share",
    { gpr, vacancyShare },
    (v) => v.gpr * v.vacancyShare,
  );
  const egi = compute(
    "Realistic yearly income (EGI)",
    "GPR − vacancy and credit loss + other income",
    { gpr, vacancyLoss, otherIncomeAnnual },
    (v) => v.gpr - v.vacancyLoss + v.otherIncomeAnnual,
  );
  return { gpr, vacancyLoss, egi };
}

export const netOperatingIncome = (egi: Receipt, opex: Receipt) =>
  compute("Income after running costs (NOI)", "EGI − OPEX", { egi, opex }, (v) => v.egi - v.opex);

/** Cap rate implied by a known property value. */
export const capRate = (noi: Arg, propertyValue: Arg) =>
  compute("Market yield (cap rate)", "NOI ÷ property value", { noi, propertyValue }, (v) =>
    divide(v.noi, v.propertyValue, "Property value"),
  );

export const stabilizedValue = (noi: Arg, marketCapRate: Arg) =>
  compute("Value once leased (stabilized value)", "NOI ÷ market cap rate", { noi, marketCapRate }, (v) =>
    divide(v.noi, v.marketCapRate, "Market cap rate"),
  );

export const yieldOnCost = (noi: Arg, tdc: Arg) =>
  compute("Return on what you spent (yield on cost, YOC)", "NOI ÷ TDC", { noi, tdc }, (v) =>
    divide(v.noi, v.tdc, "Total development cost"),
  );

export const developmentSpread = (yoc: Arg, marketCapRate: Arg) =>
  compute(
    "Profit margin in yield terms (development spread)",
    "yield on cost − market cap rate",
    { yoc, marketCapRate },
    (v) => v.yoc - v.marketCapRate,
  );

export interface SaleResult {
  grossSales: Receipt;
  sellingCosts: Receipt;
  netSales: Receipt;
  profit: Receipt;
  profitMargin: Receipt;
}

export function saleResult(mix: UnitRow[] | undefined, sellingCostShare: Num, tdc: Receipt): SaleResult {
  const gs = grossSales(mix);
  const sellingCosts = compute("Selling costs", "gross sales × selling-cost share", { grossSales: gs, sellingCostShare }, (v) =>
    v.grossSales * v.sellingCostShare,
  );
  const netSales = compute("Sales after selling costs", "gross sales − selling costs", { grossSales: gs, sellingCosts }, (v) =>
    v.grossSales - v.sellingCosts,
  );
  const profit = compute("Profit", "gross sales − selling costs − TDC", { grossSales: gs, sellingCosts, tdc }, (v) =>
    v.grossSales - v.sellingCosts - v.tdc,
  );
  const profitMargin = compute("Profit as a share of cost (profit margin)", "profit ÷ TDC", { profit, tdc }, (v) =>
    divide(v.profit, v.tdc, "Total development cost"),
  );
  return { grossSales: gs, sellingCosts, netSales, profit, profitMargin };
}
