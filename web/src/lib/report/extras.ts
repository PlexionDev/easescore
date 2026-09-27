// Report additions computed from the report model (pure): sources and uses, the tax abatement
// scenario, the absorption support from comps, and public cost vs public benefit.

import { assumptions, finance } from "@easescore/engine";
import type { ReportModel } from "./load";

const ok = (r: finance.Receipt) => (r.status === "ok" ? r.value : null);

export interface SourcesUses {
  uses: { label: string; amount: number }[];
  sources: { label: string; amount: number; kind: "debt" | "equity" | "subsidy" }[];
  total: number;
  /** Sale shortfall after sales proceeds, the amount a subsidy or write-down would need to cover (for-sale only). */
  gap: number | null;
}

const GROUP_LABEL: Record<string, string> = {
  land: "Land (purchase)",
  hard: "Hard costs (construction and site work)",
  soft: "Soft costs (design, permits, legal, fees)",
  contingency: "Contingency",
  financing: "Financing and holding (interest, lender fees, taxes while building)",
};

export function sourcesUses(pf: assumptions.ProFormaResult): SourcesUses | null {
  if (pf.tdc == null) return null;
  const uses = (["land", "hard", "soft", "contingency", "financing"] as const)
    .map((g) => ({ label: GROUP_LABEL[g]!, amount: pf.budget.filter((b) => b.group === g && b.amount != null).reduce((t, b) => t + b.amount!, 0) }))
    .filter((u) => u.amount > 0);
  const total = pf.tdc;
  const c = pf.forSale.costs;
  const loan = Math.min(ok(c.constructionLoan) ?? 0, total);
  const grants = Math.min(ok(c.grants) ?? 0, total - loan);
  const sources: SourcesUses["sources"] = [];
  if (loan > 0) sources.push({ label: "Construction loan", amount: loan, kind: "debt" });
  if (grants > 0) sources.push({ label: "Grants and subsidies entered", amount: grants, kind: "subsidy" });
  sources.push({ label: "Developer equity (cash in)", amount: Math.max(0, total - loan - grants), kind: "equity" });
  const gap = pf.plan.tenure === "sale" && pf.sale.profit != null && pf.sale.profit < 0 ? -pf.sale.profit : null;
  return { uses, sources, total, gap };
}

export interface Abatement {
  share: number;
  years: number;
  edited: boolean;
  mills: number;
  /** Assessed value the new construction adds (the pro forma's assumption: construction cost). */
  addedValue: number;
  taxOnAdded: number;
  abatedPerYear: number;
  abatedTotal: number;
  perHomePerYear: number | null;
  units: number | null;
  rent: { noi: number; noiWith: number; yoc: number; yocWith: number } | null;
}

export function abatementScenario(m: ReportModel): Abatement | null {
  const r = m.proForma.plan.rental;
  const mills = typeof r.taxMills === "number" ? r.taxMills : null;
  const after = typeof r.assessedValue === "number" ? r.assessedValue : null;
  const land = typeof m.facts.assessment?.fmv_land === "number" ? (m.facts.assessment.fmv_land as number) : null;
  if (mills == null || after == null || land == null || after <= land) return null;
  const addedValue = after - land;
  const taxOnAdded = (addedValue * mills) / 1000;
  const abatedPerYear = taxOnAdded * m.abatement.share;
  const units = m.proForma.plan.units;
  const tdc = m.proForma.tdc;
  const noi = m.proForma.rent.noi;
  return {
    share: m.abatement.share,
    years: m.abatement.years,
    edited: m.abatement.edited,
    mills,
    addedValue,
    taxOnAdded,
    abatedPerYear,
    abatedTotal: abatedPerYear * m.abatement.years,
    perHomePerYear: units ? abatedPerYear / units : null,
    units,
    rent: noi != null && tdc ? { noi, noiWith: noi + abatedPerYear, yoc: noi / tdc, yocWith: (noi + abatedPerYear) / tdc } : null,
  };
}

export interface Absorption {
  /** New-construction sales used as comps, their radius and the span of years they cover. */
  ncCount: number | null;
  ncRadiusMi: number | null;
  ncYears: number | null;
  ncPerYear: number | null;
  /** All nearby valid sales (the comps RPC), per year. */
  salesCount: number | null;
  salesRadiusMi: number | null;
  salesYears: number | null;
  salesPerYear: number | null;
  salesMonths: number;
  leaseUpMonths: number;
}

const yearsBetween = (from?: string | null, to?: string | null) => {
  if (!from || !to) return null;
  const d = (Date.parse(to) - Date.parse(from)) / (365.25 * 24 * 3600 * 1000);
  return Number.isFinite(d) && d > 0 ? Math.max(1, Math.round(d * 10) / 10) : null;
};

export function absorption(m: ReportModel): Absorption {
  const vc = m.proForma.plan.valueComps as assumptions.CompSet | null;
  const nc = vc && "median_living_area_sqft" in vc ? vc : null;
  const cfgYears = assumptions.COST_CONFIG.comps.newConstruction.years;
  const ncYears = nc ? cfgYears : null;
  const s = m.sales;
  const sYears = s ? s.years ?? yearsBetween(s.date_range?.from, s.date_range?.to) : null;
  return {
    ncCount: nc?.count ?? null,
    ncRadiusMi: nc?.radius_mi ?? null,
    ncYears,
    ncPerYear: nc && ncYears ? nc.count / ncYears : null,
    salesCount: s?.count ?? null,
    salesRadiusMi: s?.radius_mi ?? null,
    salesYears: sYears,
    salesPerYear: s && sYears ? s.count / sYears : null,
    salesMonths: assumptions.COST_CONFIG.sale.salesMonths.value,
    leaseUpMonths: assumptions.COST_CONFIG.absorption.leaseUpMonths.value,
  };
}
