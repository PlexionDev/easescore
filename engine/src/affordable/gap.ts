// Funding gap and capital stack for an affordable project. Pure and deterministic:
//   gap before sources = total development cost − supportable permanent debt
//   remaining gap      = gap before sources − the sources you switch on
// All money as low / likely / high. Every source amount is "typical, not an award".

import { COST_CONFIG } from "../assumptions/config";
import { CAPITAL_CONFIG, rentLimit, type CapitalConfig, type IncomeLimits, type RentLimit } from "./limits";
import { homeownerAssumptions, homeownerPrice, type Assumption, type HomeownerInputs, type HomeownerPrice } from "./homeownership";

export interface MoneyRange {
  low: number;
  likely: number;
  high: number;
}

export const TYPICAL_LABEL = "Typical, not an award";

export interface UnitGroup {
  count: number;
  bedrooms: number;
  amiPct: number;
}

export interface ProjectContext {
  tenure: "rent" | "sale";
  /** Any site in a HUD Qualified Census Tract / Difficult Development Area. */
  qct: boolean;
  dda: boolean;
  /** Every lot is publicly owned (City, URA, Land Bank, County, Housing Authority). */
  allPublicLand: boolean;
  /** Every lot is in the City of Pittsburgh. */
  inCity: boolean;
  lots: number;
  /** Total property tax millage (County + municipality + school district), or null when not known. */
  millsTotal: number | null;
}

export interface ProjectInput {
  units: UnitGroup[];
  /** Total development cost from the pro forma, land included. */
  tdc: MoneyRange;
  /** The land line inside the total (for the write-down); null when not priced. */
  land: MoneyRange | null;
  context: ProjectContext;
  /** For-sale tenure: mortgage rate, millage and mine subsidence for the homebuyer's payment. */
  sale?: HomeownerInputs;
}

export type EligibilityStatus = "ok" | "caution" | "no";
export interface EligibilityCheck {
  status: EligibilityStatus;
  text: string;
}

export interface SourceResult {
  id: string;
  label: string;
  short: string;
  kind: string;
  what: string;
  timing: string;
  governing: string | null;
  /** Typical amount for this project (never an award). */
  amount: MoneyRange;
  amountBasis: string;
  amountSource: string;
  checks: EligibilityCheck[];
  /** Worst check: "no" means it cannot be switched on. */
  status: EligibilityStatus;
  label2: typeof TYPICAL_LABEL;
}

export interface DebtResult {
  /** Monthly collected rent (net of utility allowance), all units. */
  monthlyRent: number;
  noi: MoneyRange;
  loan: MoneyRange;
  basis: string;
  sources: string[];
}

export interface StackPiece {
  id: string;
  short: string;
  /** Likely amount applied (capped at what is left of the likely gap). */
  applied: number;
}

export interface ProjectResult {
  tenure: "rent" | "sale";
  units: number;
  rents: (RentLimit & { count: number })[];
  /** For-sale tenure: the price each household can afford (empty for rentals). */
  sales: (HomeownerPrice & { count: number })[];
  /** For-sale tenure: every assumption behind the prices, labeled. */
  saleAssumptions: Assumption[];
  tdc: MoneyRange;
  debt: DebtResult;
  gapBefore: MoneyRange;
  sources: SourceResult[];
  enabled: string[];
  remaining: MoneyRange;
  /** Enabled sources flagged "!" (a caution check): the gap may not close if they do not come through. */
  flagged: string[];
  /** Remaining gap counting only the enabled sources with no caution (✓ only). Equals `remaining` when nothing is flagged. */
  firm: MoneyRange;
  /**
   * Tax abatement (LERTA): lowers property taxes over years; not construction money, so it is never in the
   * capital stack or the remaining gap. Present value shown separately, labeled. Null when not modeled.
   */
  taxSavings: SourceResult | null;
  /** Likely-case stacked bar: debt, then each enabled source in order, then the remaining gap. */
  stack: StackPiece[];
  /** Money beyond the mortgage, per home (gap before sources ÷ homes). */
  subsidyPerUnit: MoneyRange;
  /** Remaining gap per home. */
  remainingPerUnit: MoneyRange;
  /** Like-for-like comparison: rental = development cost per home vs. recent local new affordable rentals; for-sale = subsidy per home vs. a local for-sale subsidy estimate. */
  benchmark: { label: string; low: number; high: number; source: string; note: string; compareLabel: string; compare: MoneyRange; verdict: "below" | "within" | "above" };
  receipts: { gap: string; remaining: string };
}

const round = (x: number, step: number) => Math.round(x / step) * step + 0;
const ordered = (a: number, b: number, c: number, step = 10_000): MoneyRange => {
  const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
  return { low: round(lo, step), likely: round(Math.min(hi, Math.max(lo, b)), step), high: round(hi, step) };
};
const clamp0 = (r: MoneyRange): MoneyRange => ({ low: Math.max(0, r.low), likely: Math.max(0, r.likely), high: Math.max(0, r.high) });

/** Monthly payment per dollar of loan. */
export function mortgageConstant(rate: number, years: number): number {
  const r = rate / 12, nper = years * 12;
  return r === 0 ? 1 / nper : r / (1 - Math.pow(1 + r, -nper));
}

/** Permanent loan the restricted rents can carry: NOI ÷ DSCR ÷ (monthly constant × 12). */
export function supportableDebt(rents: { netRent: number; count: number }[], cfg: CapitalConfig = CAPITAL_CONFIG): DebtResult {
  const d = cfg.debt;
  const units = rents.reduce((t, r) => t + r.count, 0);
  const monthly = rents.reduce((t, r) => t + r.netRent * r.count, 0);
  const egi = monthly * 12 * (1 - d.vacancyShare.value);
  const [opLo, opHi] = d.opexPerUnitYear.range as [number, number];
  const [rateLo, rateHi] = d.rate.range as [number, number];
  const [dscrLo, dscrHi] = d.dscr.range as [number, number];
  const noiAt = (opex: number) => egi - opex * units;
  const loanAt = (noi: number, rate: number, dscr: number) => Math.max(0, noi / dscr / (mortgageConstant(rate, d.amortYears.value) * 12));
  const noi = { low: noiAt(opHi), likely: noiAt(d.opexPerUnitYear.value), high: noiAt(opLo) };
  const loan = ordered(loanAt(noi.low, rateHi, dscrHi), loanAt(noi.likely, d.rate.value, d.dscr.value), loanAt(noi.high, rateLo, dscrLo));
  return {
    monthlyRent: monthly,
    noi: ordered(noi.low, noi.likely, noi.high, 1_000),
    loan,
    basis: `Rents collected $${monthly.toLocaleString("en-US")}/month × 12, less ${Math.round(d.vacancyShare.value * 100)}% vacancy, less $${opLo.toLocaleString("en-US")}–$${opHi.toLocaleString("en-US")} operating cost per home per year = net operating income; loan = NOI ÷ ${dscrLo}–${dscrHi} debt coverage ÷ annual payment per dollar at ${(rateLo * 100).toFixed(1)}–${(rateHi * 100).toFixed(1)}% over ${d.amortYears.value} years.`,
    sources: [d.rate.sourceLabel === d.opexPerUnitYear.sourceLabel ? d.rate.sourceLabel : `${d.rate.sourceLabel}; ${d.opexPerUnitYear.sourceLabel}`],
  };
}

type SourceCfg = CapitalConfig["sources"][number];

/** Eligibility checks for one source. Plain words; "no" blocks the toggle. */
export function eligibility(src: SourceCfg, p: Pick<ProjectInput, "units" | "context">): EligibilityCheck[] {
  const units = p.units.reduce((t, u) => t + u.count, 0);
  const maxAmi = Math.max(...p.units.map((u) => u.amiPct));
  const at50 = p.units.filter((u) => u.amiPct <= 50).reduce((t, u) => t + u.count, 0);
  const rules = src.rules as Record<string, number | boolean | undefined>;
  const c = p.context;
  const out: EligibilityCheck[] = [];
  const qctDda = c.qct || c.dda;
  switch (src.id) {
    case "lihtc4":
    case "lihtc9": {
      if (c.tenure !== "rent") { out.push({ status: "no", text: "Tax credits fund rental homes" }); break; }
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: `Units at or below ${rules.maxAmiPct}% AMI` } : { status: "no", text: `Units above ${rules.maxAmiPct}% AMI (income averaging not modeled)` });
      if (qctDda) out.push({ status: "ok", text: c.qct ? "Qualified census tract (130% basis boost)" : "Difficult development area (130% basis boost)" });
      if (src.id === "lihtc4" && units < (rules.practicalMinUnits as number)) out.push({ status: "caution", text: `Needs tax-exempt bond financing; projects under about ${rules.practicalMinUnits} homes rarely use it alone (Assumption)` });
      if (src.id === "lihtc9" && units < (rules.competitiveMinUnits as number)) out.push({ status: "caution", text: `Project likely too small to compete (under about ${rules.competitiveMinUnits} homes; Assumption)` });
      break;
    }
    case "home":
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: `Units at or below ${rules.maxAmiPct}% AMI` } : { status: "no", text: `HOME units must serve households at or below ${rules.maxAmiPct}% AMI` });
      if (c.tenure === "rent" && maxAmi > (rules.highHomeRentAmiPct as number)) out.push({ status: "caution", text: "Rents must stay at or below the High HOME rent" });
      break;
    case "cdbg":
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: "Serves low- and moderate-income households" } : { status: "no", text: "Must mainly serve households at or below 80% AMI" });
      out.push({ status: "caution", text: "New construction only through a Community-Based Development Organization; often used for acquisition or site work" });
      break;
    case "phare":
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: `Units at or below ${rules.maxAmiPct}% AMI` } : { status: "no", text: `Must serve households at or below ${rules.maxAmiPct}% AMI` });
      break;
    case "hof":
      out.push(c.inCity ? { status: "ok", text: "All lots in the City of Pittsburgh" } : { status: "no", text: "City of Pittsburgh projects only" });
      if (maxAmi > (rules.maxAmiPct as number)) out.push({ status: "no", text: `Must serve households at or below ${rules.maxAmiPct}% AMI` });
      break;
    case "ahp": {
      const share = units ? at50 / units : 0;
      if (c.tenure === "rent") out.push(share >= (rules.minShareAt50 as number) ? { status: "ok", text: `${at50} of ${units} homes at or below 50% AMI (needs 20%)` } : { status: "no", text: "Rental projects need at least 20% of homes at or below 50% AMI" });
      else out.push(maxAmi <= 80 ? { status: "ok", text: "Homebuyers at or below 80% AMI" } : { status: "no", text: "Homebuyers must be at or below 80% AMI" });
      break;
    }
    case "lerta":
      out.push(c.millsTotal != null ? { status: "caution", text: "Only where the taxing bodies adopted it for this area" } : { status: "no", text: "Tax rate for this area not loaded" });
      break;
    case "land":
      out.push(c.allPublicLand ? { status: "ok", text: "All lots publicly owned" } : { status: "no", text: "Only for publicly owned lots" });
      break;
    case "philanthropy":
      out.push({ status: "caution", text: "Depends on funder relationships" });
      break;
    case "hba":
      if (c.tenure !== "sale") { out.push({ status: "no", text: "Helps homebuyers; for-sale homes only" }); break; }
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: `Buyers at or below ${rules.maxAmiPct}% AMI` } : { status: "no", text: `Buyers above ${rules.maxAmiPct}% AMI rarely qualify` });
      if (maxAmi > (rules.programLimitNoteAbovePct as number) && maxAmi <= (rules.maxAmiPct as number)) out.push({ status: "caution", text: `Each program sets its own income limit; above ${rules.programLimitNoteAbovePct}% AMI check the program (Assumption)` });
      break;
    case "clt":
      if (c.tenure !== "sale") { out.push({ status: "no", text: "Modeled for for-sale homes only" }); break; }
      out.push(maxAmi <= (rules.maxAmiPct as number) ? { status: "ok", text: "Buyer pays for the house; the trust keeps the land and the price stays affordable on resale" } : { status: "no", text: `Buyers above ${rules.maxAmiPct}% AMI` });
      out.push({ status: "caution", text: "Counts the land, like the public-land write-down: only one of the two is counted" });
      break;
  }
  return out;
}

const worst = (checks: EligibilityCheck[]): EligibilityStatus => (checks.some((c) => c.status === "no") ? "no" : checks.some((c) => c.status === "caution") ? "caution" : "ok");

/** Typical amount for one source on this project. */
export function sourceAmount(src: SourceCfg, p: ProjectInput): { amount: MoneyRange; basis: string } {
  const a = src.amount as Record<string, unknown>;
  const units = p.units.reduce((t, u) => t + u.count, 0);
  const tri = (k: string) => a[k] as [number, number, number];
  switch (a.method) {
    case "credit": {
      const [bLo, bMid, bHi] = tri("eligibleBasisShareOfCostExLand");
      const [pLo, pMid, pHi] = tri("pricePerCredit");
      const boost = p.context.qct || p.context.dda ? (a.basisBoostQctDda as number) : 1;
      const land = p.land ?? { low: 0, likely: 0, high: 0 };
      const rate = a.creditRate as number;
      const eq = (tdc: number, ld: number, b: number, pr: number) => Math.max(0, (tdc - ld) * b * boost * rate * 10 * pr);
      return {
        amount: ordered(eq(p.tdc.low, land.low, bLo, pLo), eq(p.tdc.likely, land.likely, bMid, pMid), eq(p.tdc.high, land.high, bHi, pHi)),
        basis: `(cost − land) × ${Math.round(bLo * 100)}–${Math.round(bHi * 100)}% eligible basis${boost > 1 ? ` × ${boost} basis boost` : ""} × ${rate * 100}% × 10 years × $${pLo.toFixed(2)}–$${pHi.toFixed(2)} per credit`,
      };
    }
    case "perUnit": {
      const [lo, mid, hi] = tri("perUnit");
      return { amount: ordered(lo * units, mid * units, hi * units), basis: `$${lo.toLocaleString("en-US")}–$${hi.toLocaleString("en-US")} per home × ${units} homes` };
    }
    case "perProject": {
      const [lo, mid, hi] = tri("perProject");
      return { amount: ordered(lo, mid, hi), basis: `$${lo.toLocaleString("en-US")}–$${hi.toLocaleString("en-US")} per project` };
    }
    case "abatement": {
      if (p.context.millsTotal == null) return { amount: { low: 0, likely: 0, high: 0 }, basis: "Tax rate not loaded" };
      const years = a.years as number, share = a.abatedShare as number, disc = a.discountRate as number;
      const land = p.land ?? { low: 0, likely: 0, high: 0 };
      const pvFactor = (1 - Math.pow(1 + disc, -years)) / disc;
      // New assessed value of the improvements ≈ cost less land (assessed value can differ; labeled).
      const pv = (tdc: number, ld: number) => Math.max(0, tdc - ld) * (p.context.millsTotal! / 1000) * share * pvFactor;
      return {
        amount: ordered(pv(p.tdc.low, land.low), pv(p.tdc.likely, land.likely), pv(p.tdc.high, land.high)),
        basis: `(cost − land, as a stand-in for new assessed value) × ${p.context.millsTotal.toFixed(2)} mills × ${Math.round(share * 100)}% for ${years} years, present value at ${disc * 100}%`,
      };
    }
    case "landTrust": {
      if (!p.land) return { amount: { low: 0, likely: 0, high: 0 }, basis: "Land not priced in the pro forma" };
      return { amount: ordered(p.land.low, p.land.likely, p.land.high, 1_000), basis: "Land value in the pro forma, carried by the trust instead of the buyer" };
    }
    case "land": {
      if (!p.land) return { amount: { low: 0, likely: 0, high: 0 }, basis: "Land not priced in the pro forma" };
      const nominal = (a.nominalPerLot as number) * p.context.lots;
      return {
        amount: ordered(p.land.low - nominal, p.land.likely - nominal, p.land.high - nominal, 1_000),
        basis: `Land value in the pro forma less a nominal $${(a.nominalPerLot as number).toLocaleString("en-US")} per lot × ${p.context.lots} lots`,
      };
    }
  }
  return { amount: { low: 0, likely: 0, high: 0 }, basis: "Not modeled" };
}

/** For-sale tenure: the homebuyers' prices stand where the permanent loan stands for a rental. */
export function saleProceeds(sales: (HomeownerPrice & { count: number })[], a: ReturnType<typeof homeownerAssumptions>): DebtResult {
  const sum = (k: keyof MoneyRange) => sales.reduce((t, x) => t + x.price[k] * x.count, 0);
  const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;
  return {
    monthlyRent: 0,
    noi: { low: 0, likely: 0, high: 0 },
    loan: ordered(sum("low"), sum("likely"), sum("high"), 1_000),
    basis: `Each home sells at the most its buyer can afford: 30% of the HUD income limit (household size = bedrooms + 1) pays principal and interest at ${pct(a.rate - a.spread)}–${pct(a.rate + a.spread)} over ${a.years} years with ${+(a.down * 100).toFixed(1)}% down, property tax at ${+a.mills.toFixed(2)} mills, insurance${a.pmi ? ", mortgage insurance" : ""}${a.msi ? " and mine subsidence insurance" : ""}. Sum of the prices × homes.`,
    sources: a.list.map((x) => `${x.label}: ${x.source}`),
  };
}

/** The whole project: rents (or sale prices), debt (or sales), gap, every source with its checks, and the remaining gap for the enabled set. */
export function evaluateProject(p: ProjectInput, il: IncomeLimits, enabled: string[], cfg: CapitalConfig = CAPITAL_CONFIG): ProjectResult {
  const units = p.units.reduce((t, u) => t + u.count, 0);
  const sale = p.context.tenure === "sale";
  const saleIn: HomeownerInputs = p.sale ?? { rate: null, mills: p.context.millsTotal, mineSubsidence: false };
  const ha = sale ? homeownerAssumptions(saleIn, cfg) : null;
  const rents = sale ? [] : p.units.map((u) => ({ ...rentLimit(il, u.amiPct, u.bedrooms, cfg), count: u.count }));
  const sales = sale ? p.units.map((u) => ({ ...homeownerPrice(il, u.amiPct, u.bedrooms, saleIn, cfg), count: u.count })) : [];
  const debt = sale ? saleProceeds(sales, ha!) : supportableDebt(rents, cfg);
  const tdc = ordered(p.tdc.low, p.tdc.likely, p.tdc.high);
  const gapBefore = clamp0(ordered(tdc.low - debt.loan.high, tdc.likely - debt.loan.likely, tdc.high - debt.loan.low));

  const fits = (s: SourceCfg) => {
    const t = (s as { tenures?: string[] }).tenures;
    return !t || t.includes(p.context.tenure);
  };
  const all: SourceResult[] = cfg.sources.filter(fits).map((s) => {
    const checks = eligibility(s, p);
    const { amount, basis } = sourceAmount(s, p);
    return {
      id: s.id, label: s.label, short: s.short, kind: s.kind, what: s.what, timing: s.timing, governing: s.governing ?? null,
      amount, amountBasis: basis, amountSource: (s.amount as { sourceLabel: string }).sourceLabel, checks, status: worst(checks), label2: TYPICAL_LABEL,
    };
  });
  // A tax abatement is not capital: it is shown on its own (taxSavings), never stacked against the construction gap.
  const sources = all.filter((s) => s.kind !== "abatement");
  const taxSavings = all.find((s) => s.kind === "abatement") ?? null;
  // Sources that count the same money (land trust vs. land write-down): the first one switched on in config order wins.
  const exclusive = (id: string) => ((cfg.sources.find((x) => x.id === id)?.rules as { exclusiveWith?: string[] } | undefined)?.exclusiveWith ?? []);
  const on: SourceResult[] = [];
  for (const s of sources) {
    if (!enabled.includes(s.id) || s.status === "no") continue;
    if (on.some((o) => exclusive(s.id).includes(o.id) || exclusive(o.id).includes(s.id))) continue;
    on.push(s);
  }
  const sum = (k: keyof MoneyRange, xs = on) => xs.reduce((t, s) => t + s.amount[k], 0);
  const remaining = clamp0(ordered(gapBefore.low - sum("high"), gapBefore.likely - sum("likely"), gapBefore.high - sum("low")));
  const sure = on.filter((s) => s.status === "ok");
  const firm = clamp0(ordered(gapBefore.low - sum("high", sure), gapBefore.likely - sum("likely", sure), gapBefore.high - sum("low", sure)));

  const stack: StackPiece[] = [{ id: "debt", short: sale ? "Home sales" : "Loan", applied: debt.loan.likely }];
  let left = gapBefore.likely;
  for (const s of on) {
    const x = Math.max(0, Math.min(left, s.amount.likely));
    stack.push({ id: s.id, short: s.short, applied: x });
    left -= x;
  }
  stack.push({ id: "gap", short: "Gap", applied: Math.max(0, left) });

  const per = (r: MoneyRange): MoneyRange => (units ? ordered(r.low / units, r.likely / units, r.high / units, 1_000) : { low: 0, likely: 0, high: 0 });
  const subsidyPerUnit = per(gapBefore);
  const verdict = (x: MoneyRange, lo: number, hi: number) => (x.high < lo ? "below" as const : x.low > hi ? "above" as const : "within" as const);
  let benchmark: ProjectResult["benchmark"];
  if (sale) {
    const hbc = COST_CONFIG.benchmarks.homeownershipSubsidy;
    const lo = hbc.range[0]!, hi = hbc.range[1]!;
    benchmark = {
      label: "Subsidy per affordable for-sale home in Pittsburgh", low: lo, high: hi, source: hbc.sourceLabel,
      note: "Subsidy against subsidy: the same kind of home. The subsidy here moves one for one with the development cost per home.",
      compareLabel: "Subsidy gap per home (cost − affordable price)", compare: subsidyPerUnit, verdict: verdict(subsidyPerUnit, lo, hi),
    };
  } else {
    // Development cost per home of recent new affordable rental buildings in Allegheny County (config benchmarks; rehab and conversions left out).
    const pj = COST_CONFIG.benchmarks.projects.filter((x) => /^New\b/.test(x.type));
    const lo = Math.min(...pj.map((x) => x.perUnit)), hi = Math.max(...pj.map((x) => x.perUnit));
    const tdcPer = per(tdc);
    benchmark = {
      label: "Development cost per home, recent new affordable rentals in Allegheny County", low: lo, high: hi,
      source: pj.map((x) => `${x.name}, ${x.units} homes (${x.sourceLabel})`).join("; "),
      note: `Cost against cost, but a rough match: those are ${Math.min(...pj.map((x) => x.units))}–${Math.max(...pj.map((x) => x.units))}-home multifamily buildings, a different building type from homes on scattered lots. No published per-home rental subsidy benchmark is loaded, so the subsidy is not compared.`,
      compareLabel: "Development cost per home", compare: tdcPer, verdict: verdict(tdcPer, lo, hi),
    };
  }
  return {
    tenure: sale ? "sale" : "rent",
    units, rents, sales, saleAssumptions: ha?.list ?? [], tdc, debt, gapBefore, sources, enabled: on.map((s) => s.id), remaining,
    flagged: on.filter((s) => s.status === "caution").map((s) => s.id), firm, taxSavings, stack,
    subsidyPerUnit, remainingPerUnit: per(remaining),
    benchmark,
    receipts: {
      gap: sale
        ? `Total development cost (pro forma) − what the buyers can pay (sum of the affordable prices) = subsidy needed. Low = low cost − high prices; high = high cost − low prices.`
        : `Total development cost (pro forma) − permanent loan the restricted rents support = money needed from other sources. Low = low cost − high loan; high = high cost − low loan.`,
      remaining: `Gap before sources − the typical amounts of the sources switched on (${on.map((s) => s.short).join(", ") || "none"}). Low uses each source's high end; high uses each source's low end.`,
    },
  };
}
