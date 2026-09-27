// Affordable homeownership: the most a household at a given % of the area median can pay for a home.
// Documented PITI method (all assumptions in engine/config/capital-sources.v0.1.json → forSale):
//   monthly budget  = 30% of the HUD income limit ÷ 12
//   monthly cost(P) = loan × mortgage constant            (principal + interest; loan = P × (1 − down))
//                   + P × assessed share × mills ÷ 1000 ÷ 12   (property tax at the lot's millage)
//                   + insurance ÷ 12                        (homeowner's insurance)
//                   + loan × PMI rate ÷ 12                  (mortgage insurance while under 20% down)
//                   + ($3.75 + $0.25 × P ÷ 1000) ÷ 12       (PA DEP mine subsidence insurance, undermined lots only)
// cost(P) is linear in P, so the price is solved exactly: P = (budget − fixed) ÷ per-dollar, rounded
// down to $1,000. Pure and deterministic.

import { MSI_CHART } from "../finance/msi";
import { mortgageConstant, type MoneyRange } from "./gap";
import { CAPITAL_CONFIG, affordableMonthly, incomeLimit, type CapitalConfig, type IncomeLimits } from "./limits";

export interface HomeownerInputs {
  /** 30-year mortgage rate as a decimal (0.0703), or null to use the labeled fallback. */
  rate: number | null;
  /** Where the rate came from, e.g. "FRED MORTGAGE30US, 2026-09-24". */
  rateSource?: string | null;
  /** County + municipal + school millage for the lots, or null to use the labeled fallback. */
  mills: number | null;
  millsSource?: string | null;
  /** Any lot over undermined ground: include mine subsidence insurance. */
  mineSubsidence: boolean;
  /** Overrides (edit me). */
  downPaymentShare?: number;
  insurancePerYear?: number;
}

export interface MonthlyLines {
  principalInterest: number;
  tax: number;
  insurance: number;
  pmi: number;
  msi: number;
  total: number;
}

export interface Assumption {
  id: string;
  label: string;
  value: string;
  source: string;
  /** True when the value is an editable assumption (not published data). */
  assumption: boolean;
}

export interface HomeownerPrice {
  amiPct: number;
  bedrooms: number;
  persons: number;
  income: number;
  incomeBasis: string;
  /** Monthly budget: 30% of income ÷ 12. */
  budget: number;
  /** Most the household can pay: low at the higher rate, high at the lower rate. */
  price: MoneyRange;
  loan: number;
  downPayment: number;
  /** Likely-case monthly payment lines at the likely price. */
  monthly: MonthlyLines;
  formula: string;
  text: string;
}

const floorTo = (x: number, step: number) => Math.max(0, Math.floor(x / step) * step);

/** Resolved assumptions (with labels) for one project. */
export function homeownerAssumptions(inp: HomeownerInputs, cfg: CapitalConfig = CAPITAL_CONFIG) {
  const f = cfg.forSale;
  const rate = inp.rate ?? f.rateFallback.value;
  const mills = inp.mills ?? f.millsFallback.value;
  const down = inp.downPaymentShare ?? f.downPaymentShare.value;
  const ins = inp.insurancePerYear ?? f.insurancePerYear.value;
  const pmi = down < f.pmiAnnualShare.belowDownShare ? f.pmiAnnualShare.value : 0;
  const pct = (x: number, d = 2) => `${+(x * 100).toFixed(d)}%`;
  const list: Assumption[] = [
    { id: "share", label: "Share of income for housing", value: pct(f.housingShare.value, 0), source: f.housingShare.sourceLabel, assumption: false },
    { id: "rate", label: "Mortgage rate (30-year fixed)", value: `${pct(rate)} (range ${pct(rate - f.rateSpread.value)}–${pct(rate + f.rateSpread.value)})`, source: inp.rate != null ? inp.rateSource ?? "FRED 30-year fixed mortgage average" : f.rateFallback.sourceLabel, assumption: inp.rate == null },
    { id: "term", label: "Loan term", value: `${f.termYears.value} years`, source: f.termYears.sourceLabel, assumption: false },
    { id: "down", label: "Down payment", value: pct(down, 1), source: inp.downPaymentShare != null ? "Your input" : f.downPaymentShare.sourceLabel, assumption: true },
    { id: "tax", label: "Property tax", value: `${+mills.toFixed(2)} mills on ${pct(f.assessedShareOfPrice.value, 0)} of the price`, source: inp.mills != null ? `${inp.millsSource ?? "Allegheny County millage"}; ${f.assessedShareOfPrice.sourceLabel}` : f.millsFallback.sourceLabel, assumption: inp.mills == null },
    { id: "ins", label: "Homeowner's insurance", value: `$${ins.toLocaleString("en-US")} a year`, source: inp.insurancePerYear != null ? "Your input" : f.insurancePerYear.sourceLabel, assumption: true },
    { id: "pmi", label: "Mortgage insurance (PMI)", value: pmi ? `${pct(pmi, 2)} of the loan a year` : "none (20% or more down)", source: f.pmiAnnualShare.sourceLabel, assumption: true },
    { id: "msi", label: "Mine subsidence insurance", value: inp.mineSubsidence ? `$${MSI_CHART.baseFee} + $${MSI_CHART.perThousand} per $1,000 of coverage a year (coverage = price)` : "not needed (no lot over undermined ground)", source: MSI_CHART.source, assumption: false },
    { id: "size", label: "Household size", value: "bedrooms + 1", source: f.householdSize.sourceLabel, assumption: true },
  ];
  return { rate, mills, down, ins, pmi, spread: f.rateSpread.value, years: f.termYears.value, share: f.housingShare.value, assessed: f.assessedShareOfPrice.value, msi: inp.mineSubsidence, list };
}

type Resolved = ReturnType<typeof homeownerAssumptions>;

/** Monthly payment lines for a price. */
export function monthlyCost(price: number, a: Resolved, rate = a.rate): MonthlyLines {
  const loan = price * (1 - a.down);
  const principalInterest = loan * mortgageConstant(rate, a.years);
  const tax = (price * a.assessed * a.mills) / 1000 / 12;
  const insurance = a.ins / 12;
  const pmi = (loan * a.pmi) / 12;
  const msi = a.msi ? (MSI_CHART.baseFee + (MSI_CHART.perThousand * Math.min(MSI_CHART.maxCoverage, Math.max(MSI_CHART.minCoverage, price))) / 1000) / 12 : 0;
  return { principalInterest, tax, insurance, pmi, msi, total: principalInterest + tax + insurance + pmi + msi };
}

/** Exact solve of monthlyCost(P) = budget (linear in P), rounded down to $1,000. */
export function maxPrice(budget: number, a: Resolved, rate = a.rate): number {
  const perDollar = (1 - a.down) * mortgageConstant(rate, a.years) + (a.assessed * a.mills) / 12000 + ((1 - a.down) * a.pmi) / 12 + (a.msi ? MSI_CHART.perThousand / 12000 : 0);
  const fixed = a.ins / 12 + (a.msi ? MSI_CHART.baseFee / 12 : 0);
  return floorTo((budget - fixed) / perDollar, 1000);
}

/** "A family of 3 at 80% of the area median can afford a home priced at about $X." */
export function homeownerPrice(il: IncomeLimits, amiPct: number, bedrooms: number, inp: HomeownerInputs, cfg: CapitalConfig = CAPITAL_CONFIG): HomeownerPrice {
  const a = homeownerAssumptions(inp, cfg);
  const br = Math.max(0, Math.round(bedrooms));
  const persons = Math.min(8, br + cfg.forSale.householdSize.extraPersons);
  const lim = incomeLimit(il, amiPct, persons, cfg);
  const budget = affordableMonthly(lim.value, cfg);
  const likely = maxPrice(budget, a);
  const price: MoneyRange = { low: maxPrice(budget, a, a.rate + a.spread), likely, high: maxPrice(budget, a, Math.max(0.0001, a.rate - a.spread)) };
  const monthly = monthlyCost(likely, a);
  const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
  const who = persons === 1 ? "A single adult" : `A family of ${persons}`;
  return {
    amiPct, bedrooms: br, persons, income: lim.value, incomeBasis: lim.basis, budget, price,
    loan: Math.round(likely * (1 - a.down)), downPayment: Math.round(likely * a.down), monthly,
    formula: `${amiPct}% AMI income, ${persons}-person household = ${usd(lim.value)} × 30% ÷ 12 = ${usd(budget)} a month for the whole payment. At ${+(a.rate * 100).toFixed(2)}% over ${a.years} years with ${+(a.down * 100).toFixed(1)}% down, a ${usd(likely)} home costs ${usd(monthly.principalInterest)} principal and interest + ${usd(monthly.tax)} property tax (${+a.mills.toFixed(2)} mills) + ${usd(monthly.insurance)} insurance${monthly.pmi ? ` + ${usd(monthly.pmi)} mortgage insurance` : ""}${monthly.msi ? ` + ${usd(monthly.msi)} mine subsidence insurance` : ""} = ${usd(monthly.total)} a month. Range: ${usd(price.low)} at ${+((a.rate + a.spread) * 100).toFixed(2)}% to ${usd(price.high)} at ${+((a.rate - a.spread) * 100).toFixed(2)}%.`,
    text: `${who} at ${amiPct}% of the area median earns up to about ${usd(lim.value)} a year and can afford a home priced at about ${usd(likely)} (about ${usd(monthly.total)} a month with taxes and insurance).`,
  };
}
