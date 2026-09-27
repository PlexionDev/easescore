// Assessed value after completion, estimated from completed projects: the County assessed value of new
// homes built in the last years ÷ their first sale price (engine/config/tax-assessment-ratio.v0.1.json),
// by City / rest of County and detached / attached. Building-permit values are reported beside it as a
// diagnostic only and never used.

import ratios from "../../config/tax-assessment-ratio.v0.1.json";

type Group = { sales: number; soldFrom: string; soldTo: string; builtFrom: number; builtTo: number; ratio: number[]; permitDiagnostic: { permits: number; medianPermitValueToPrice: number } | null };
export interface TaxRatioTable { asOf: string; builtFrom: number; minSales: number; groups: Record<string, Group> }
export const TAX_RATIOS: TaxRatioTable = ratios as unknown as TaxRatioTable;

export interface AssessedEstimate {
  /** Median ratio of assessed value to sale price for the group used. */
  ratio: number;
  ratioRange: [number, number];
  /** Estimated assessed value = ratio × value. */
  assessed: number;
  group: string;
  sales: number;
  /** Receipt text: method, sample count, dates, and the permit diagnostic. */
  receipt: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function assessedAfterCompletion(a: { value: number; isCity: boolean; attached: boolean; valueBasis: string }, t: TaxRatioTable = TAX_RATIOS): AssessedEstimate | null {
  if (!(a.value > 0)) return null;
  const key = `${a.isCity ? "city" : "county"}_${a.attached ? "attached" : "detached"}`;
  const own = t.groups[key];
  const g = own && own.sales >= t.minSales ? { k: key, g: own } : t.groups.all ? { k: "all", g: t.groups.all } : null;
  if (!g) return null;
  const [q1, med, q3] = g.g.ratio as [number, number, number];
  const where = g.k === "all" ? "across Allegheny County" : `${a.isCity ? "in the City of Pittsburgh" : "in Allegheny County outside the City"}, ${a.attached ? "attached (townhouse, rowhouse)" : "detached"}`;
  const permit = g.g.permitDiagnostic
    ? ` Check only (not used): City building-permit values for ${g.g.permitDiagnostic.permits} of these homes were a median ${pct(g.g.permitDiagnostic.medianPermitValueToPrice)} of the sale price.`
    : "";
  return {
    ratio: med, ratioRange: [q1, q3], assessed: med * a.value, group: g.k, sales: g.g.sales,
    receipt: `Assessed value after completion is estimated from completed projects: ${g.g.sales} new homes ${where}, built ${g.g.builtFrom}–${g.g.builtTo} and sold ${g.g.soldFrom.slice(0, 7)} to ${g.g.soldTo.slice(0, 7)}, were assessed at a median ${pct(med)} of their sale price (middle half ${pct(q1)}–${pct(q3)}; County assessed value ÷ first sale price). ${pct(med)} × ${usd(a.value)} ${a.valueBasis} = ${usd(med * a.value)}.${permit} The County sets the real figure.`,
  };
}
