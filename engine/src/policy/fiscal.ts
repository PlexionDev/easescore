// Fiscal ledger for the Policy Analyst seat: new assessed value x millage, per taxing body.
// Pure arithmetic so it can be checked by hand (see engine/test/policy.test.ts).
//
// Allegheny County assesses property at a base-year value level, so a new home's assessed value is its
// market value times an assessment ratio (the median assessed value / sale price of recent
// new-construction sales, computed from county data and shown with its source).

import { SCENARIOS, type Scenario, type Triple } from "./pencil";

export interface TaxBody {
  id: "county" | "municipality" | "school";
  name: string;
  /** Mills: dollars of tax per $1,000 of assessed value. */
  mills: number;
  year: number;
  sourceUrl: string;
}

/** Annual property tax, dollars. */
export const annualTax = (assessedValue: number, mills: number) => (assessedValue * mills) / 1000;

/** Assessed value a new home adds: market value x assessment ratio, less the assessed building it replaces. */
export function assessedValueDelta(saleValue: number, ratio: number, existingBuildingAv: number): number {
  return Math.max(0, saleValue * ratio - Math.max(0, existingBuildingAv));
}

export interface Abatement {
  /** Share of the tax on the added value that is abated (0-1). */
  share: number;
  years: number;
}

export interface LedgerRow {
  body: TaxBody;
  /** New annual revenue at full build-out, by scenario, dollars. */
  revenue: Triple;
  /** Revenue forgone per year while an abatement runs (0 when none). */
  abatementPerYear: Triple;
  /** Year (1-based) when cumulative net revenue first covers the abatement cost; null = no cost to recover. */
  breakEvenYear: number | null;
}

/**
 * Ledger rows for each body. With an abatement the added value pays (1 - share) of its tax for `years`
 * years; the abatement cost is the forgone tax. Break-even is when the build-out's cumulative collected
 * tax exceeds the cumulative forgone tax, which, since the lots would pay ~nothing on the added value
 * without the homes, is year 1 whenever any tax is collected.
 */
export function ledger(avDelta: Triple, bodies: TaxBody[], abatement: Abatement | null = null): LedgerRow[] {
  return bodies.map((body) => {
    const revenue = {} as Triple;
    const abatementPerYear = {} as Triple;
    for (const s of SCENARIOS) {
      const full = annualTax(avDelta[s], body.mills);
      abatementPerYear[s] = abatement ? full * Math.min(1, Math.max(0, abatement.share)) : 0;
      revenue[s] = full;
    }
    let breakEvenYear: number | null = null;
    if (abatement && abatement.share > 0 && abatement.years > 0) {
      const collected = revenue.likely - abatementPerYear.likely;
      // Collected during the abatement, full tax afterwards; cost = forgone tax during the abatement.
      const cost = abatementPerYear.likely * abatement.years;
      let cum = 0;
      for (let y = 1; y <= 60; y++) {
        cum += y <= abatement.years ? collected : revenue.likely;
        if (cum >= cost && cum > 0) { breakEvenYear = y; break; }
      }
    }
    return { body, revenue, abatementPerYear, breakEvenYear };
  });
}

export const totalRevenue = (rows: LedgerRow[], s: Scenario) => rows.reduce((t, r) => t + r.revenue[s], 0);
