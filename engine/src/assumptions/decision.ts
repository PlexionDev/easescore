// The decision box: "what can I pay for this land, and what must it sell for?" One function, used by the
// Pencil calculator, the report and its PDF, so the three show the same numbers. It reads the priced
// pro forma (evaluateDevelopment) and the investment criteria (engine/config/decision-criteria.v0.1.json,
// every value an editable assumption); it never re-prices the budget. Also here: taxes after
// construction (#4) and the unit-by-unit sellout with its closing schedule (#6).
//
// Money math (for-sale; the rounded pro forma figures the budget shows):
//   net proceeds = gross sellout − selling/closing (seller's half of the transfer tax; commissions excluded)
//   profit = net proceeds − total development cost (TDC)
//   price needed for the target = TDC × (1 + target) ÷ (1 − selling share)
//   most the project can cost = net proceeds ÷ (1 + target)
//   residual land value = the land price at which TDC(land) = net proceeds ÷ (1 + target). TDC moves by
//   more than $1 per $1 of land because the loan (and its interest and fee) is a share of cost, so the
//   finance module is run at two land prices to measure that slope.

import { developmentCosts, type ForSaleInputs, type Receipt } from "../finance";
import raw from "../../config/decision-criteria.v0.1.json";
import { COST_CONFIG } from "./config";
import type { DevelopmentPlan } from "./build";
import type { ProFormaResult } from "./evaluate";

export type DecisionConfig = typeof raw;
export const DECISION_CONFIG: DecisionConfig = raw;

export interface InvestmentCriteria {
  /** Target profit as a share of total development cost (0.15 = 15%). */
  targetMargin: number;
  /** Minimum contingency as a share of hard cost. */
  minContingency: number;
  /** Maximum construction loan as a share of cost. */
  maxLtc: number;
}

export const DEFAULT_CRITERIA: InvestmentCriteria = {
  targetMargin: raw.targetMarginOnCost.value,
  minContingency: raw.minContingency.value,
  maxLtc: raw.maxLtc.value,
};

/** URL keys for the criteria, in whole percent (dc_margin=15, dc_cont=10, dc_ltc=75). */
export const CRITERIA_KEYS = { targetMargin: "dc_margin", minContingency: "dc_cont", maxLtc: "dc_ltc" } as const;

type SP = Record<string, string | string[] | undefined>;

/** Criteria from the URL (whole percents), falling back to the defaults; out-of-range values are ignored. */
export function criteriaFromQuery(sp: SP): InvestmentCriteria {
  const pct = (k: string, lo: number, hi: number): number | null => {
    const s = sp[k];
    if (typeof s !== "string" || s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= lo && n <= hi ? n / 100 : null;
  };
  return {
    targetMargin: pct(CRITERIA_KEYS.targetMargin, 0, 100) ?? DEFAULT_CRITERIA.targetMargin,
    minContingency: pct(CRITERIA_KEYS.minContingency, 0, 50) ?? DEFAULT_CRITERIA.minContingency,
    maxLtc: pct(CRITERIA_KEYS.maxLtc, 0, 100) ?? DEFAULT_CRITERIA.maxLtc,
  };
}

export interface DecisionBox {
  criteria: InvestmentCriteria;
  /** True when a criterion differs from the default. */
  edited: boolean;
  /** Plain reason the box cannot be computed (then the money fields are null). */
  missing: string | null;
  /** The box is the build-and-sell test; for a rental plan it says so. */
  rentalPlan: boolean;
  units: number | null;
  finishedSf: number | null;
  grossSellout: number | null;
  /** Price per finished sq ft and per home implied by the sellout. */
  pricePerSf: number | null;
  pricePerUnit: number | null;
  sellingClosing: number | null;
  sellingShare: number | null;
  sellingBasis: string;
  netProceeds: number | null;
  tdc: number | null;
  profit: number | null;
  profitOnCost: number | null;
  profitOnRevenue: number | null;
  /** Loan interest between completion and the last closing: not in the budget, so not in `profit` (see unitSellout). */
  sellOutCarry: number | null;
  profitAfterCarry: number | null;
  /** Loan interest + lender fees in the budget; profit before them is the unlevered profit. */
  financingCost: number | null;
  unleveredProfit: number | null;
  unleveredOnCost: number | null;
  levered: boolean;
  financingBasis: string;
  breakEven: {
    /** Gross sellout needed for the target margin. */
    targetGross: number | null;
    perUnit: number | null;
    perSf: number | null;
    /** Zero profit. */
    zeroPerUnit: number | null;
    zeroPerSf: number | null;
  };
  /** Most the project can cost and still earn the target (= net proceeds ÷ (1 + target)). */
  maxCost: number | null;
  /** Cost cut needed to reach the target (negative = headroom above the target). */
  costReduction: number | null;
  residual: {
    /** Residual land value = maximum land price that still hits the target (negative = none). */
    value: number | null;
    landUsed: number | null;
    landSource: string;
    /** Cost other than land at the residual land price (hard + soft + contingency + financing and holding). */
    costExLand: number | null;
    targetProfit: number | null;
    /** TDC change per $1 of land (loan interest and fee ride on land). */
    tdcPerLandDollar: number | null;
    formula: string;
  };
  contingency: { share: number; meets: boolean; text: string };
  ltc: { planLtc: number; maxLtc: number; above: boolean; loanAtMax: number | null; equityAtMax: number | null; text: string };
  /** The one template sentence built from the numbers above. */
  sentence: string | null;
}

const has = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const v = (r: Receipt | undefined): number | null => (r && r.status === "ok" ? r.value : null);
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct1 = (s: number) => `${s < 0 ? "−" : ""}${(Math.round(Math.abs(s) * 1000) / 10).toFixed(1)}%`;
const pct0 = (s: number) => `${+(s * 100).toFixed(2)}%`;
const round = (x: number, step: number) => Math.round(x / step) * step + 0;

/** TDC of the for-sale inputs at a land price, with lender fees re-sized to the loan (as the plan builder does). */
function tdcAtLand(i: ForSaleInputs, feeShare: number, land: number): number | null {
  const x: ForSaleInputs = { ...i, land, loanFees: 0 };
  const first = developmentCosts(x);
  const loan = v(first.constructionLoan);
  if (loan == null) return null;
  return v(developmentCosts({ ...x, loanFees: loan * feeShare }).tdc);
}

export function decisionBox(r: ProFormaResult, criteria: Partial<InvestmentCriteria> = {}): DecisionBox {
  const c: InvestmentCriteria = { ...DEFAULT_CRITERIA, ...criteria };
  const p = r.plan;
  const m = c.targetMargin;
  const edited = c.targetMargin !== DEFAULT_CRITERIA.targetMargin || c.minContingency !== DEFAULT_CRITERIA.minContingency || c.maxLtc !== DEFAULT_CRITERIA.maxLtc;
  const units = p.units;
  const sf = p.finishedSf;
  const gross = r.sale.grossSales;
  const tdc = r.tdc;
  const s = p.forSale.sellingCostShare ?? null;
  const comm = p.salesCommission && gross ? p.salesCommission / gross : 0;
  const broker = COST_CONFIG.sale.brokerShare.value + comm;
  const sellingBasis = has(s)
    ? `Seller's half of the realty transfer tax, ${pct0(s - broker)} of the sale price${broker ? ` + sales commission ${usd(p.salesCommission)} (your number)` : ""}.${broker ? "" : " Sales commission: not included (often 5–6% if listed with an agent); add it in the budget if you sell through a broker."}`
    : "Transfer tax rate not loaded for this municipality.";

  // Financing: interest + lender fees in the budget (holding taxes stay in cost either way).
  const fin = (id: string) => r.budget.find((b) => b.id === id)?.amount ?? 0;
  const financingCost = tdc != null ? fin("interest") + fin("loan_fees") : null;
  const ltc0 = p.forSale.constructionLoanLtc ?? 0;
  const rate = p.forSale.constructionRate ?? 0;
  const levered = ltc0 > 0 && rate > 0;
  const financingBasis = levered
    ? `Includes a construction loan of ${pct0(ltc0)} of cost at ${pct0(rate)}, interest-only on the drawn balance (${p.assumptions.find((a) => a.key === "constructionRate")?.sourceLabel ?? "assumption"}). Unlevered profit leaves out loan interest and lender fees.`
    : "No construction loan entered: the results are unlevered (no loan interest or lender fees).";

  // Contingency and loan-to-cost checks against the criteria.
  const cs = p.shares.contingency;
  const meets = cs + 1e-9 >= c.minContingency;
  const contingency = {
    share: cs, meets,
    text: meets
      ? `Contingency in the budget: ${pct0(cs)} of hard cost, meets your ${pct0(c.minContingency)} minimum.`
      : `Contingency in the budget: ${pct0(cs)} of hard cost, below your ${pct0(c.minContingency)} minimum. Raise the contingency line in the budget to test it.`,
  };
  const cbf = v(r.forSale.costs.costBeforeFinancing);
  const loanAtMax = cbf != null ? round(c.maxLtc * cbf, 1000) : null;
  const equityAtMax = loanAtMax != null && tdc != null ? tdc - loanAtMax : null;
  const above = levered && ltc0 > c.maxLtc + 1e-9;
  const ltc = {
    planLtc: ltc0, maxLtc: c.maxLtc, above, loanAtMax, equityAtMax,
    text: `${loanAtMax != null ? `At your ${pct0(c.maxLtc)} maximum loan-to-cost the loan is about ${usd(loanAtMax)} and the equity needed about ${equityAtMax != null ? usd(equityAtMax) : "—"}.` : ""}${above ? ` The budget's loan assumption (${pct0(ltc0)} of cost) is above your maximum; lower "Loan-to-cost" under "Change the plan" on the parcel page to match.` : ""}`.trim(),
  };

  const empty = (why: string): DecisionBox => ({
    criteria: c, edited, missing: why, rentalPlan: p.tenure === "rent", units, finishedSf: sf,
    grossSellout: gross, pricePerSf: null, pricePerUnit: null, sellingClosing: null, sellingShare: s, sellingBasis,
    netProceeds: null, tdc, profit: null, profitOnCost: null, profitOnRevenue: null, sellOutCarry: null, profitAfterCarry: null,
    financingCost, unleveredProfit: null, unleveredOnCost: null, levered, financingBasis,
    breakEven: { targetGross: null, perUnit: null, perSf: null, zeroPerUnit: null, zeroPerSf: null },
    maxCost: null, costReduction: null,
    residual: { value: null, landUsed: p.land.value, landSource: p.sources.land.label, costExLand: null, targetProfit: null, tdcPerLandDollar: null, formula: "" },
    contingency, ltc, sentence: null,
  });
  if (p.missing.length) return empty(p.missing[0]!);
  if (gross == null) return empty("No sale value for the finished homes, so the build-and-sell test cannot be run. Enter a sale price to test it.");
  if (tdc == null || !units || !sf) return empty("The project cannot be sized or priced yet.");
  if (!has(s) || s >= 1) return empty("The selling cost rate is not loaded for this municipality.");

  const selling = r.sale.sellingCosts ?? round(gross * s, 1000);
  const net = gross - selling;
  const profit = net - tdc;
  const unlev = financingCost != null ? profit + financingCost : null;

  // Break-evens (TDC does not depend on the sale price).
  const targetGross = (tdc * (1 + m)) / (1 - s);
  const zeroGross = tdc / (1 - s);
  const maxCost = net / (1 + m);

  // Residual land value: solve TDC(land) = maxCost; TDC is linear in land.
  const L0 = p.land.value ?? 0;
  const feeShare = p.loanFeeShare;
  const step = 100000;
  const t0 = tdcAtLand(p.forSale, feeShare, L0);
  const t1 = tdcAtLand(p.forSale, feeShare, L0 + step);
  const slope = t0 != null && t1 != null ? (t1 - t0) / step : null;
  // Solve from the unrounded TDC at L0 (t0), not the budget's $1,000-rounded total, so the residual does not
  // drift when only the land price changes (TDC is linear in land, so the solution is independent of L0).
  const rlv = slope != null && slope > 0 && t0 != null ? L0 + (maxCost - t0) / slope : null;
  const costExLand = rlv != null ? maxCost - rlv : null;
  const targetProfit = maxCost * m;

  const perSf = gross / sf;
  const bePerSf = targetGross / sf;
  const cut = tdc - maxCost;
  const at = `At ${usd(round(perSf, 1))}/sf the project earns ${pct1(profit / tdc)} on cost${r.sellOutCarry ? ` (${pct1((profit - r.sellOutCarry) / tdc)} after about ${usd(r.sellOutCarry)} of loan interest between completion and the last sale, which the budget leaves out)` : ""}`;
  const tgt = `the ${pct0(m)} target`;
  let sentence: string;
  if (profit / tdc < m) {
    sentence = `${at} vs. ${tgt}. It reaches the target at about ${usd(round(bePerSf, 1))}/sf, ${usd(round(cut, 1000))} lower cost`;
    sentence += rlv != null && rlv > 0 ? `, or a land price of ${usd(round(rlv, 1000))}.` : rlv != null ? `; no land price gets there (residual land value ${usd(round(rlv, 1000))}).` : ".";
  } else {
    sentence = `${at}, at or above ${tgt}. It keeps the target down to about ${usd(round(bePerSf, 1))}/sf, with ${usd(round(-cut, 1000))} of cost headroom`;
    sentence += rlv != null ? `, or a land price up to ${usd(round(rlv, 1000))}.` : ".";
  }

  return {
    criteria: c, edited, missing: null, rentalPlan: p.tenure === "rent", units, finishedSf: sf,
    grossSellout: gross, pricePerSf: perSf, pricePerUnit: gross / units,
    sellingClosing: selling, sellingShare: s, sellingBasis,
    netProceeds: net, tdc, profit, profitOnCost: profit / tdc, profitOnRevenue: profit / gross,
    sellOutCarry: r.sellOutCarry ?? null, profitAfterCarry: r.sellOutCarry ? profit - r.sellOutCarry : null,
    financingCost, unleveredProfit: unlev, unleveredOnCost: unlev != null ? unlev / tdc : null, levered, financingBasis,
    breakEven: { targetGross, perUnit: targetGross / units, perSf: bePerSf, zeroPerUnit: zeroGross / units, zeroPerSf: zeroGross / sf },
    maxCost, costReduction: cut,
    residual: {
      value: rlv, landUsed: p.land.value, landSource: p.sources.land.label, costExLand, targetProfit, tdcPerLandDollar: slope,
      formula: rlv != null
        ? `${usd(gross)} sellout − ${usd(selling)} selling/closing − ${usd(round(costExLand!, 1))} hard, soft, contingency and financing − ${usd(round(targetProfit, 1))} target profit (${pct0(m)} of cost) = ${usd(round(rlv, 1))}`
        : "",
    },
    contingency, ltc, sentence,
  };
}

// ---------------------------------------------------------------------------------------------
// #4 Taxes after construction

export interface TaxesAfter {
  mills: number | null;
  millsLabel: string;
  assessedToday: number | null;
  taxToday: number | null;
  valueAfter: number | null;
  assessedAfter: number | null;
  ratio: number | null;
  ratioRange: [number, number] | null;
  /** "Completed projects" (County data) or an assumption label. */
  ratioSource: string;
  taxAfter: number | null;
  taxAfterPerUnit: number | null;
  receipt: string | null;
  abatement: string;
}

/** City of Pittsburgh: the cost model's 2026 millage; elsewhere the parcel's total millage from County data. */
export function millsFor(isCity: boolean, generalMills: number | null | undefined): { mills: number | null; label: string } {
  const cm = COST_CONFIG.propertyTax.cityMills;
  if (isCity) return { mills: cm.value, label: cm.sourceLabel };
  return has(generalMills) ? { mills: generalMills, label: "Total millage for this parcel (Allegheny County Treasurer)" } : { mills: null, label: "Millage not loaded for this municipality" };
}

export function taxesAfterCompletion(a: { plan: DevelopmentPlan; isCity: boolean; generalMills: number | null | undefined; assessedToday: number | null | undefined }): TaxesAfter {
  const { mills, label } = millsFor(a.isCity, a.generalMills);
  const today = has(a.assessedToday) ? a.assessedToday : null;
  const est = a.plan.assessedAfter;
  const taxToday = mills != null && today != null ? (today * mills) / 1000 : null;
  const taxAfter = mills != null && est ? (est.assessed * mills) / 1000 : null;
  const units = a.plan.units;
  return {
    mills, millsLabel: label, assessedToday: today, taxToday,
    valueAfter: est && est.ratio > 0 ? est.assessed / est.ratio : null,
    assessedAfter: est ? est.assessed : null,
    ratio: est ? est.ratio : null,
    ratioRange: est ? est.ratioRange : null,
    ratioSource: est ? `Completed projects: County assessed value ÷ first sale price, ${est.sales} new homes` : "Not estimated: no value for the finished homes",
    taxAfter,
    taxAfterPerUnit: taxAfter != null && units ? taxAfter / units : null,
    receipt: est ? est.receipt : null,
    abatement: "Tax abatements (for example LERTA) are not modeled; check eligibility with the City, County and school district.",
  };
}

// ---------------------------------------------------------------------------------------------
// #6 Unit-by-unit sellout, closing schedule and interest carry to the last closing

export interface SelloutRow {
  unit: number;
  finishedSf: number;
  bedrooms: number;
  parking: number | null;
  priceLow: number | null;
  price: number;
  priceHigh: number | null;
  /** Months after construction ends. */
  closingMonth: number;
}

export interface UnitSellout {
  rows: SelloutRow[];
  total: number;
  totalLow: number | null;
  totalHigh: number | null;
  /** The pro forma's gross sellout (average home × units); the table total can differ by rounding and size. */
  proFormaGross: number | null;
  sizeBasis: string;
  bandsText: string;
  bandsSource: string;
  priceBasis: string;
  scheduleText: string;
  lastClosingMonth: number;
  carry: { loan: number; rate: number; interest: number; text: string } | null;
  /** Profit and margin after the sell-out carry (not in the budget total). */
  profitAfterCarry: number | null;
  marginAfterCarry: number | null;
}

/** Shoelace area of a ring (any units squared). */
const ringArea = (ring: [number, number][] | { x: number; y: number }[]): number => {
  const pts = (ring as unknown[]).map((q) => (Array.isArray(q) ? { x: q[0] as number, y: q[1] as number } : (q as { x: number; y: number })));
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

export function bedroomsFor(sf: number): number {
  for (const b of raw.bedroomBands.bands) if (b.upToSf == null || sf < b.upToSf) return b.bedrooms;
  return raw.bedroomBands.bands[raw.bedroomBands.bands.length - 1]!.bedrooms;
}

export function bedroomBandsText(): string {
  const bands = raw.bedroomBands.bands;
  return bands
    .map((b, k) => {
      const lo = k === 0 ? null : bands[k - 1]!.upToSf;
      const n = `${b.bedrooms} bedroom${b.bedrooms === 1 ? "" : "s"}`;
      return b.upToSf == null ? `${lo!.toLocaleString("en-US")} sq ft and up: ${n}` : lo == null ? `under ${b.upToSf.toLocaleString("en-US")} sq ft: ${n}` : `${lo.toLocaleString("en-US")}–${(b.upToSf - 1).toLocaleString("en-US")} sq ft: ${n}`;
    })
    .join("; ");
}

/**
 * Construction-loan interest between completion and the last closing (not in the budget total): the loan is
 * fully drawn at completion and each closing repays an equal share. Σ (loan ÷ n) × rate × months to closing ÷ 12,
 * with the first closing salesMonths after completion and one every closingIntervalMonths after that.
 * Rounded to $1,000. Null when there is no loan, rate or unit count.
 */
export function sellOutCarry(loan: number | null | undefined, rate: number | null | undefined, units: number | null | undefined, intervalMonths?: number): number | null {
  if (loan == null || !(loan > 0) || rate == null || !(rate > 0) || !units || units < 1) return null;
  const first = COST_CONFIG.sale.salesMonths.value;
  const interval = intervalMonths ?? raw.closingIntervalMonths.value;
  let t = 0;
  for (let k = 0; k < units; k++) t += ((loan / units) * rate * (first + k * interval)) / 12;
  return Math.round(t / 1000) * 1000;
}

export function unitSellout(r: ProFormaResult, opts: { closingIntervalMonths?: number; localNewSalesPerYear?: number | null } = {}): UnitSellout | null {
  const p = r.plan;
  const n = p.units;
  const sf = p.finishedSf;
  const ppsf = p.revenue.sale.pricePerSf;
  if (!n || !sf || ppsf == null || p.strategy === "rehab_existing") return null;
  const step = COST_CONFIG.rounding.salePrice;
  const interval = opts.closingIntervalMonths ?? raw.closingIntervalMonths.value;
  const first = COST_CONFIG.sale.salesMonths.value;

  // Finished sq ft per home: the scheme's unit footprints share the plan's finished area.
  const fps = p.scheme.footprints ?? [];
  const areas = fps.length === n ? fps.map((f) => ringArea(f as unknown as [number, number][])) : [];
  const areaSum = areas.reduce((t, x) => t + x, 0);
  const shares = areas.length === n && areaSum > 0 ? areas.map((x) => x / areaSum) : Array.from({ length: n }, () => 1 / n);
  const byFootprint = areas.length === n && areaSum > 0 && new Set(areas.map((x) => Math.round(x))).size > 1;

  const spaces = p.scheme.parking?.spaces;
  const pr = r.ranges.sale.pricePerSf;
  const lowF = pr && pr.likely ? pr.low / pr.likely : null;
  const highF = pr && pr.likely ? pr.high / pr.likely : null;
  const same = !byFootprint;
  const avgPrice = p.revenue.sale.pricePerUnit;

  const rows: SelloutRow[] = shares.map((sh, k) => {
    const usf = sf * sh;
    const price = same && avgPrice != null ? avgPrice : round(ppsf * usf, step);
    return {
      unit: k + 1,
      finishedSf: Math.round(usf),
      bedrooms: bedroomsFor(usf),
      parking: has(spaces) ? Math.floor(spaces / n) + (k < spaces % n ? 1 : 0) : null,
      priceLow: lowF != null ? round(price * lowF, step) : null,
      price,
      priceHigh: highF != null ? round(price * highF, step) : null,
      closingMonth: first + k * interval,
    };
  });
  const total = rows.reduce((t, x) => t + x.price, 0);
  const lastClosingMonth = rows[rows.length - 1]!.closingMonth;

  // Interest carry after completion: the loan is fully drawn at completion; each closing repays an equal share.
  const loan = v(r.forSale.costs.constructionLoan);
  const rate = p.forSale.constructionRate ?? 0;
  let carry: UnitSellout["carry"] = null;
  if (loan != null && loan > 0 && rate > 0) {
    const interest = rows.reduce((t, x) => t + ((loan / n) * rate * x.closingMonth) / 12, 0);
    carry = {
      loan, rate, interest,
      text: `The construction loan (${usd(round(loan, 1000))}) is fully drawn at completion; each closing repays ${n === 1 ? "it" : `1/${n} of it`}. Interest at ${pct0(rate)} until each closing: Σ (loan ÷ ${n}) × ${pct0(rate)} × months to closing ÷ 12 = ${usd(round(interest, 1000))}. The budget's loan interest covers only the build; this carry is not in the budget total.`,
    };
  }
  const profit = r.sale.profit;
  const profitAfterCarry = profit != null && carry ? profit - round(carry.interest, 1000) : null;
  const pace = opts.localNewSalesPerYear;
  return {
    rows, total,
    totalLow: rows.every((x) => x.priceLow != null) ? rows.reduce((t, x) => t + x.priceLow!, 0) : null,
    totalHigh: rows.every((x) => x.priceHigh != null) ? rows.reduce((t, x) => t + x.priceHigh!, 0) : null,
    proFormaGross: r.sale.grossSales,
    sizeBasis: byFootprint
      ? `Finished area ${sf.toLocaleString("en-US")} sq ft shared by each home's footprint in the QuickFit layout (${p.sizeBasis}).`
      : `Finished area ${sf.toLocaleString("en-US")} sq ft ÷ ${n} home${n === 1 ? "" : "s"} (${p.sizeBasis}).`,
    bandsText: bedroomBandsText(),
    bandsSource: raw.bedroomBands.sourceLabel,
    priceBasis: `${usd(ppsf)}/sf × each home's finished sq ft, rounded to ${usd(step)}${pr ? `; low–high from the ${usd(pr.low)}–${usd(pr.high)}/sf range` : ""} (${p.revenue.sale.basis}).`,
    scheduleText: `Assumption, edit me: the first home closes ${first} months after construction ends (${COST_CONFIG.sale.salesMonths.sourceLabel}), then one closing every ${interval} months (${raw.closingIntervalMonths.sourceLabel}); the last closes in month ${lastClosingMonth}.${pace != null ? ` Support: about ${(Math.round(pace * 10) / 10).toFixed(1)} new-construction sales a year nearby${pace < n ? `, fewer than the ${n} homes here, so selling may take longer` : ""}.` : ""}`,
    lastClosingMonth,
    carry,
    profitAfterCarry,
    marginAfterCarry: profitAfterCarry != null && r.tdc ? profitAfterCarry / r.tdc : null,
  };
}
