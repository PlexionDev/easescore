// Run a DevelopmentPlan through the finance module and say what it means in plain words:
// the budget lines, the "does it pencil" verdict, "A − B = C" sentences, the NarrativeProForma for
// the four answers, and a sanity check against recent Allegheny County projects.

import {
  breakEven,
  breakEvenCostIncrease,
  forSaleProForma,
  hardCostChange,
  rentalProForma,
  rentChange,
  salePriceChange,
  scaleField,
  shiftField,
  tornado,
  type ForSaleInputs,
  type ForSaleProForma,
  type Receipt,
  type RentalInputs,
  type RentalProForma,
  type SensitivityVariable,
  type TornadoRow,
  type TornadoSpec,
} from "../finance";
import type { NarrativeProForma } from "../narrative/types";
import { COST_CONFIG, type CostConfig } from "./config";
import type { DevelopmentPlan, LineGroup } from "./build";
import { proFormaRanges, type ProFormaRanges } from "./ranges";

export interface BudgetLine {
  id: string;
  group: LineGroup | "total";
  label: string;
  short?: string;
  /** Routine transaction and carrying item (permits, title, lender fees, taxes while holding): grouped into one line in the UI. */
  minor?: boolean;
  amount: number | null;
  basis: string;
  sourceLabel: string;
}

export interface ProFormaResult {
  plan: DevelopmentPlan;
  forSale: ForSaleProForma;
  rental: RentalProForma;
  budget: BudgetLine[];
  tdc: number | null;
  costPerUnit: number | null;
  costPerSf: number | null;
  sale: { grossSales: number | null; sellingCosts: number | null; netSales: number | null; profit: number | null; margin: number | null };
  rent: { monthlyRent: number | null; annualRent: number | null; vacancy: number | null; opex: number | null; noi: number | null; yieldOnCost: number | null };
  verdict: "yes" | "thin" | "no" | null;
  /** One plain sentence answering "does it pencil?" (or why it can't be answered). */
  headline: string;
  /** The math as "A − B = C" sentences. */
  sentences: string[];
  narrative: NarrativeProForma | null;
  benchmark: { perUnit: number | null; line: string; projects: CostConfig["benchmarks"]["projects"] };
  /** Low / likely / high for every line and total, with source badges and triangulation. */
  ranges: ProFormaRanges;
}

const v = (r: Receipt): number | null => (r.status === "ok" ? r.value : null);
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct1 = (share: number) => `${(share * 100).toFixed(1)}%`;
const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function evaluateDevelopment(plan: DevelopmentPlan, config: CostConfig = COST_CONFIG): ProFormaResult {
  const forSale = forSaleProForma(plan.forSale);
  const rental = rentalProForma(plan.rental);
  const c = forSale.costs;
  const hard = v(c.hard);

  // ---- Budget lines (same numbers the finance module totals)
  const own = (l: { id: string; sourceLabel: string }) => plan.userLines.includes(l.id) || l.sourceLabel === "Your number" || l.sourceLabel === "Your input";
  const r1kLine = <T extends { id: string; sourceLabel: string; amount: number }>(l: T): T => (own(l) ? { ...l } : { ...l, amount: Math.round(l.amount / 1000) * 1000 + 0 });
  const budget: BudgetLine[] = plan.lines.filter((l) => l.group === "land" || l.group === "hard").map(r1kLine);
  const mine = (id: string) => plan.userLines.includes(id);
  const r1k = (x: number | null) => (x == null ? null : Math.round(x / 1000) * 1000 + 0);
  const share = (id: string, label: string, s: number, basis: string, sourceLabel: string): BudgetLine => ({
    id, group: "soft", label, amount: hard != null ? r1k(s * hard) : null, basis: mine(id) ? "Your number" : basis, sourceLabel: mine(id) ? "Your number" : sourceLabel,
  });
  budget.push(share("ae", "Architecture and engineering", plan.shares.ae, `${pct1(plan.shares.ae)} of hard cost`, sourceOf(plan, "ae")));
  budget.push(share("permits", "Building permit and fees", plan.shares.permits, plan.shares.permitsBasis, sourceOf(plan, "permits")));
  budget.push(share("other_soft", "Survey, title, legal and insurance", plan.shares.other, `${pct1(plan.shares.other)} of hard cost`, sourceOf(plan, "other")));
  for (const l of plan.lines.filter((x) => x.group === "soft")) budget.push(r1kLine(l));
  budget.push({
    id: "contingency", group: "contingency", label: `Contingency (${plan.shares.contingencyKind})`, amount: r1k(v(c.contingency)),
    basis: mine("contingency") ? "Your number" : `${pct1(plan.shares.contingency)} of hard cost`, sourceLabel: mine("contingency") ? "Your number" : sourceOf(plan, "contingency"),
  });
  budget.push({ id: "interest", group: "financing", label: "Construction loan interest", amount: r1k(v(c.constructionInterest)), basis: c.constructionInterest.formula, sourceLabel: sourceOf(plan, "constructionRate") });
  budget.push({ id: "loan_fees", group: "financing", label: "Lender fees", amount: v(c.constructionLoan) != null ? r1k(v(c.constructionLoan)! * plan.loanFeeShare) : null, basis: `${pct1(plan.loanFeeShare)} of the loan`, sourceLabel: sourceOf(plan, "loanFees") });
  budget.push({ id: "holding", group: "financing", label: "Property taxes while approving and building", amount: r1k(v(c.holdingCosts)), basis: c.holdingCosts.formula, sourceLabel: "County assessment × millage" });
  // Totals to $10,000; profit, margin and yield use the rounded figures shown.
  const tdcRaw = v(c.tdc);
  const tdc = tdcRaw != null ? Math.round(tdcRaw / 10000) * 10000 + 0 : null;
  budget.push({ id: "tdc", group: "total", label: "Total development cost (TDC)", amount: tdc, basis: "land + hard + soft + contingency + financing", sourceLabel: "Finance module" });

  // ---- Sale
  const s = forSale.sales;
  const gs = v(s.grossSales);
  const sellR = r1k(v(s.sellingCosts));
  const netR = gs != null && sellR != null ? gs - sellR : null;
  const profitR = netR != null && tdc != null ? netR - tdc : null;
  const sale = { grossSales: gs, sellingCosts: sellR, netSales: netR, profit: profitR, margin: profitR != null && tdc ? Math.round((profitR / tdc) * 1000) / 1000 : null };
  // ---- Rent
  const inc = rental.income;
  const gpr = v(inc.gpr);
  const vac = r1k(v(inc.vacancyLoss));
  const opx = r1k(v(rental.opex.total));
  const noiR = gpr != null && vac != null && opx != null ? gpr - vac - opx : r1k(v(rental.noi));
  const rent = {
    monthlyRent: gpr != null ? gpr / 12 : null,
    annualRent: gpr,
    vacancy: vac,
    opex: opx,
    noi: noiR,
    yieldOnCost: noiR != null && tdc ? Math.round((noiR / tdc) * 1000) / 1000 : v(rental.yieldOnCost),
  };

  const thin = config.pencils.thinMarginBelow.value;
  const thinYoc = config.pencils.thinYieldOnCostBelow.value as number | null;
  let verdict: ProFormaResult["verdict"] = null;
  if (plan.tenure === "sale" && sale.margin != null) verdict = sale.margin <= 0 ? "no" : sale.margin < thin ? "thin" : "yes";
  if (plan.tenure === "rent" && rent.noi != null) verdict = rent.noi <= 0 ? "no" : thinYoc != null && rent.yieldOnCost != null ? (rent.yieldOnCost < thinYoc ? "thin" : "yes") : null;

  // ---- Sentences
  const MINOR = new Set(["permits", "other_soft", "tap_fees", "loan_fees", "holding"]);
  for (const b of budget) if (MINOR.has(b.id)) b.minor = true;
  const sentences: string[] = [];
  const hardLines = budget.filter((b) => b.group === "hard" && b.amount != null);
  const softSum = budget.filter((b) => b.group === "soft" && b.amount != null).reduce((t, b) => t + b.amount!, 0);
  const finSum = v(c.financing);
  if (tdc != null) {
    const sumOf = (xs: BudgetLine[]) => xs.reduce((t, x) => t + (x.amount ?? 0), 0);
    const design = budget.filter((x) => x.group === "soft" && !x.minor);
    const minor = budget.filter((x) => x.minor);
    const parts = [
      plan.land.value != null ? `${plan.strategy === "rehab_existing" ? "purchase" : "land"} ${usd(plan.land.value)}` : null,
      ...hardLines.map((x) => `${x.short ?? x.label.toLowerCase()} ${usd(x.amount!)}`),
      design.length ? `design and engineering ${usd(sumOf(design))}` : null,
      budget.find((b) => b.id === "contingency")?.amount != null ? `contingency ${usd(budget.find((b) => b.id === "contingency")!.amount!)}` : null,
      budget.find((b) => b.id === "interest")?.amount != null ? `loan interest ${usd(budget.find((b) => b.id === "interest")!.amount!)}` : null,
      minor.length ? `closing, permit and carrying costs ${usd(sumOf(minor))}` : null,
    ].filter(Boolean);
    sentences.push(`Cost: ${parts.join(" + ")} = ${usd(tdc)} total.`);
  }
  if (plan.tenure === "sale") {
    const u = plan.units ?? 0;
    if (sale.grossSales != null) {
      if (plan.revenue.sale.basis === "Your sale price per home")
        sentences.push(`Value: ${usd(plan.revenue.sale.pricePerUnit!)} per home × ${u} home${u === 1 ? "" : "s"} = ${usd(sale.grossSales)} in sales.`);
      else if (plan.rounding.sale && plan.revenue.sale.pricePerUnit != null)
        sentences.push(`Value: ${plan.rounding.sale}; × ${u} home${u === 1 ? "" : "s"} = ${usd(sale.grossSales)} in sales.`);
      else if (plan.revenue.sale.pricePerSf != null && plan.finishedSf != null)
        sentences.push(`Value: ${usd(plan.revenue.sale.pricePerSf)} per sq ft × ${plan.finishedSf.toLocaleString("en-US")} finished sq ft = ${usd(sale.grossSales)} in sales.`);
    }
    if (sale.grossSales != null && sale.sellingCosts != null && tdc != null && sale.profit != null)
      sentences.push(
        `Profit: ${usd(sale.grossSales)} sales − ${usd(tdc)} total cost − ${usd(sale.sellingCosts)} selling costs = ${sale.profit >= 0 ? `${usd(sale.profit)} profit` : `${usd(-sale.profit)} short`}${sale.margin != null ? ` (${sale.margin >= 0 ? "" : "a loss of "}${pct1(Math.abs(sale.margin))} of cost)` : ""}.`,
      );
  } else {
    const units = plan.units ?? 0;
    if (plan.revenue.rent.perUnit != null && rent.annualRent != null && rent.vacancy != null)
      sentences.push(`Rent: ${usd(plan.revenue.rent.perUnit)} a month${plan.rounding.rent ? ` (${plan.rounding.rent})` : ""} × ${units} home${units === 1 ? "" : "s"} × 12 = ${usd(rent.annualRent)} a year; minus ${usd(rent.vacancy)} for vacancy = ${usd(rent.annualRent - rent.vacancy)} collected.`);
    if (rent.annualRent != null && rent.vacancy != null && rent.opex != null && rent.noi != null)
      sentences.push(`${usd(rent.annualRent - rent.vacancy)} collected − ${usd(rent.opex)} running costs (taxes, insurance, upkeep, management, reserves) = ${usd(rent.noi)} a year before loan payments (NOI).`);
    if (rent.noi != null && tdc != null && rent.yieldOnCost != null)
      sentences.push(`${usd(rent.noi)} ÷ ${usd(tdc)} total cost = ${pct1(rent.yieldOnCost)} a year on cost (yield on cost).`);
  }

  // ---- Headline (rounded: $10,000 for totals, no false precision; the exact math is in the sentences)
  const about = (n: number) => usd(Math.round(n / 10000) * 10000);
  let headline: string;
  if (plan.missing.length) headline = `Can't tell yet${tdc != null ? `: it costs about ${about(tdc)}, but` : "."} ${tdc != null ? lcFirst(plan.missing[0]!) : plan.missing[0]}`;
  else if (plan.tenure === "sale" && sale.profit != null && tdc != null && sale.netSales != null)
    headline =
      verdict === "no"
        ? `No: it costs about ${about(tdc)} and would net about ${about(sale.netSales)} after selling costs, ${about(-sale.profit)} short.`
        : `${verdict === "thin" ? "Barely" : "Yes"}: it costs about ${about(tdc)} and would net about ${about(sale.netSales)} after selling costs, a ${about(sale.profit)} profit (${pct1(sale.margin!)}).`;
  else if (plan.tenure === "rent" && rent.noi != null && tdc != null)
    headline =
      verdict === "no"
        ? `No: it costs about ${about(tdc)} and the rent would not cover running costs.`
        : `It depends on the loan: it costs about ${about(tdc)} and would bring in about ${usd(Math.round(rent.noi / 1000) * 1000)} a year after running costs, ${pct1(rent.yieldOnCost ?? 0)} on cost. A local cap rate is needed to call it.`;
  else headline = "Can't tell yet: an input is missing.";
  if (!plan.missing.length && plan.exclusions.length) headline += ` Partial estimate: ${plan.exclusions.length} cost item${plan.exclusions.length === 1 ? " is" : "s are"} not included yet.`;

  // ---- Narrative facts for "Does it pencil?"
  let narrative: NarrativeProForma | null = null;
  if (tdc != null) {
    if (plan.tenure === "sale")
      narrative =
        sale.netSales != null && sale.profit != null
          ? { tenure: "sale", totalCost: tdc, value: sale.netSales, margin: sale.profit, marginPct: sale.margin != null ? sale.margin * 100 : null, verdict }
          : { tenure: "sale", totalCost: tdc, value: null };
    else if (rent.monthlyRent == null || rent.noi == null || rent.vacancy == null || rent.opex == null) narrative = { tenure: "rent", totalCost: tdc };
    else
      narrative = {
        tenure: "rent", totalCost: tdc, monthlyRent: rent.monthlyRent, annualOpex: rent.vacancy + rent.opex, noi: rent.noi,
        yieldOnCostPct: rent.yieldOnCost != null ? rent.yieldOnCost * 100 : null, verdict,
      };
  }

  // Decisive money risks and steps for the four answers (plain words, no numbers).
  const risks: string[] = [];
  const steps: string[] = [];
  const newBuild = plan.strategy !== "rehab_existing";
  const vc = plan.valueComps;
  if (plan.tenure === "sale" && plan.revenue.sale.sourceLabel !== "Your input" && (!vc || vc.status !== "ok" || vc.sufficient === false)) {
    risks.push(newBuild ? "Too few recent new-home sales nearby to price a new house, so its value is not estimated." : "Too few similar home sales nearby to price the finished home.");
    steps.push(newBuild ? "Ask a local agent or appraiser what new homes like this sell for nearby." : "Ask a local agent or appraiser what a fixed-up home like this sells for nearby.");
  }
  if (plan.sizeWarning) risks.push("The layout is small next to new homes that sold nearby, so the sale value is uncertain.");
  if (verdict === "no" || verdict === "thin") steps.push("Get a builder's bid for this layout before buying; the cost lines show what drives the total.");
  if (plan.exclusions.length) steps.push("Get local quotes for the cost items the estimate leaves out.");
  if (narrative) narrative = { ...narrative, risks, steps };

  // ---- Benchmarks
  const projects = config.benchmarks.projects;
  const lo = Math.min(...projects.map((p) => p.perUnit));
  const hi = Math.max(...projects.map((p) => p.perUnit));
  const perUnit = v(c.costPerUnit);
  const line = `${perUnit != null && tdc != null ? `Your estimate: ${usd(perUnit)} per home. ` : ""}Recent Allegheny County projects: ${usd(lo)} to ${usd(hi)} per home (${projects.length} projects, mostly new multifamily and affordable; all-in cost).`;

  return {
    plan,
    forSale,
    rental,
    budget,
    tdc,
    costPerUnit: tdc != null ? perUnit : null,
    costPerSf: tdc != null ? v(c.costPerSqFt) : null,
    sale,
    rent,
    verdict,
    headline,
    sentences,
    narrative,
    benchmark: { perUnit: tdc != null ? perUnit : null, line, projects },
    ranges: alignRanges(proFormaRanges(plan, budget, config), sale, rent, tdc),
  };
}

/** The ranges' "likely" figures equal the rounded numbers the sentences use (low <= likely <= high). */
function alignRanges(r: ProFormaRanges, sale: ProFormaResult["sale"], rent: ProFormaResult["rent"], tdc: number | null): ProFormaRanges {
  const fit = <T extends { low: number; likely: number; high: number }>(x: T | null, likely: number | null): T | null =>
    x && likely != null ? { ...x, likely, low: Math.min(x.low, likely), high: Math.max(x.high, likely) } : x;
  return {
    ...r,
    tdc: fit(r.tdc, tdc),
    sale: { ...r.sale, profit: fit(r.sale.profit, sale.profit), marginPct: fit(r.sale.marginPct, sale.margin != null ? Math.round(sale.margin * 1000) / 10 : null) },
    rent: { ...r.rent, noi: fit(r.rent.noi, rent.noi), yieldOnCostPct: fit(r.rent.yieldOnCostPct, rent.yieldOnCost != null ? Math.round(rent.yieldOnCost * 1000) / 10 : null) },
    lines: r.lines.map((l) => (l.id === "tdc" ? { ...l, range: fit(l.range, tdc) } : l)),
  };
}

function sourceOf(plan: DevelopmentPlan, key: string): string {
  return plan.assumptions.find((r) => r.key === key)?.sourceLabel ?? "Assumption — editable";
}

// ---------------------------------------------------------------------------------------------
// Sensitivity: base / conservative / optimistic, the tornado, and break-evens.

export interface ScenarioRow {
  id: "conservative" | "base" | "optimistic";
  label: string;
  tdc: number | null;
  /** Sale: profit. Rent: NOI a year. */
  result: number | null;
  /** Sale: profit margin. Rent: yield on cost. */
  ratio: number | null;
}

export interface SensitivityResult {
  metricLabel: string;
  ratioLabel: string;
  scenarios: ScenarioRow[];
  tornado: TornadoRow[];
  base: number | null;
  /** Sale: hard-cost increase at which profit = 0. */
  breakEvenCostIncrease: Receipt | null;
  /** Sale: sale-price change at which profit = 0. */
  breakEvenPriceChange: Receipt | null;
  /** Assumption labels behind the moves. */
  moves: string[];
}

type Inputs = ForSaleInputs | RentalInputs;

export function sensitivity(plan: DevelopmentPlan, config: CostConfig = COST_CONFIG): SensitivityResult {
  const sv = config.sensitivity;
  const sale = plan.tenure === "sale";
  const inputs: Inputs = sale ? plan.forSale : plan.rental;
  const metric = (i: Inputs): Receipt => (sale ? forSaleProForma(i as ForSaleInputs).sales.profit : rentalProForma(i as RentalInputs).noi);
  const ratio = (i: Inputs): Receipt => (sale ? forSaleProForma(i as ForSaleInputs).sales.profitMargin : rentalProForma(i as RentalInputs).yieldOnCost);
  const tdcOf = (i: Inputs): Receipt => forSaleProForma(i as ForSaleInputs).costs.tdc;
  const cost = hardCostChange<Inputs>();
  const revenue = (sale ? salePriceChange<Inputs>() : rentChange<Inputs>()) as SensitivityVariable<Inputs>;
  const land = scaleField<Inputs>("land", "Land price");
  const rate = shiftField<Inputs>("constructionRate", "Interest rate", "percentage points");
  const delay = shiftField<Inputs>("approvalDelayMonths", "Approval delay", "months");

  const apply = (i: Inputs, moves: [SensitivityVariable<Inputs>, number][]) => moves.reduce((acc, [variable, x]) => variable.apply(acc, x), i);
  const cons = apply(inputs, [[cost, sv.costShare.value], [revenue, -sv.revenueShare.value], [rate, sv.rateShift.value]]);
  const opt = apply(inputs, [[cost, -sv.costShare.value], [revenue, sv.revenueShare.value], [rate, -sv.rateShift.value]]);
  const row = (id: ScenarioRow["id"], label: string, i: Inputs): ScenarioRow => ({ id, label, tdc: v(tdcOf(i)), result: v(metric(i)), ratio: v(ratio(i)) });

  const specs: TornadoSpec<Inputs>[] = [
    { variable: cost, low: -sv.costShare.value, high: sv.costShare.value },
    { variable: revenue, low: -sv.revenueShare.value, high: sv.revenueShare.value },
    { variable: land, low: -sv.landShare.value, high: sv.landShare.value },
    { variable: rate, low: -sv.rateShift.value, high: sv.rateShift.value },
    { variable: delay, low: 0, high: sv.delayMonths.value },
  ];
  const t = tornado(inputs, specs, metric);
  return {
    metricLabel: sale ? "Profit" : "Income after running costs (NOI), yearly",
    ratioLabel: sale ? "Profit margin" : "Yield on cost",
    scenarios: [row("conservative", "Conservative", cons), row("base", "Base", inputs), row("optimistic", "Optimistic", opt)],
    tornado: t.rows,
    base: v(t.base),
    breakEvenCostIncrease: sale ? breakEvenCostIncrease(plan.forSale) : null,
    breakEvenPriceChange: sale ? breakEven(plan.forSale, salePriceChange<ForSaleInputs>(), (i) => forSaleProForma(i).sales.profit, -1, 1, "Sale-price change at which profit = 0") : null,
    moves: [
      `Conservative: construction cost +${Math.round(sv.costShare.value * 100)}%, ${sale ? "sale price" : "rent"} −${Math.round(sv.revenueShare.value * 100)}%, interest rate +${sv.rateShift.value * 100} point (${sv.costShare.sourceLabel}).`,
      `Optimistic: the same moves the other way.`,
    ],
  };
}
