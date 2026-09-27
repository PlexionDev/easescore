// Funding gap and capital stack for an affordable project. Pure and deterministic:
//   gap before sources = total development cost − supportable permanent debt
//   remaining gap      = gap before sources − the sources you switch on
// All money as low / likely / high. Every source amount is "typical, not an award".

import { COST_CONFIG } from "../assumptions/config";
import { CAPITAL_CONFIG, rentLimit, type CapitalConfig, type IncomeLimits, type RentLimit } from "./limits";

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
  units: number;
  rents: (RentLimit & { count: number })[];
  tdc: MoneyRange;
  debt: DebtResult;
  gapBefore: MoneyRange;
  sources: SourceResult[];
  enabled: string[];
  remaining: MoneyRange;
  /** Likely-case stacked bar: debt, then each enabled source in order, then the remaining gap. */
  stack: StackPiece[];
  /** Money beyond the mortgage, per home (gap before sources ÷ homes). */
  subsidyPerUnit: MoneyRange;
  /** Remaining gap per home. */
  remainingPerUnit: MoneyRange;
  benchmark: { label: string; low: number; high: number; source: string; note: string };
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
      if (src.id === "lihtc4" && units < (rules.practicalMinUnits as number)) out.push({ status: "caution", text: `Needs tax-exempt bond financing; projects under about ${rules.practicalMinUnits} homes rarely use it alone (Assumption, edit me)` });
      if (src.id === "lihtc9" && units < (rules.competitiveMinUnits as number)) out.push({ status: "caution", text: `Project likely too small to compete (under about ${rules.competitiveMinUnits} homes; Assumption, edit me)` });
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
      else out.push({ status: "ok", text: "Homebuyers at or below 80% AMI" });
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

/** The whole project: rents, debt, gap, every source with its checks, and the remaining gap for the enabled set. */
export function evaluateProject(p: ProjectInput, il: IncomeLimits, enabled: string[], cfg: CapitalConfig = CAPITAL_CONFIG): ProjectResult {
  const units = p.units.reduce((t, u) => t + u.count, 0);
  const rents = p.units.map((u) => ({ ...rentLimit(il, u.amiPct, u.bedrooms, cfg), count: u.count }));
  const debt = supportableDebt(rents, cfg);
  const tdc = ordered(p.tdc.low, p.tdc.likely, p.tdc.high);
  const gapBefore = clamp0(ordered(tdc.low - debt.loan.high, tdc.likely - debt.loan.likely, tdc.high - debt.loan.low));

  const sources: SourceResult[] = cfg.sources.map((s) => {
    const checks = eligibility(s, p);
    const { amount, basis } = sourceAmount(s, p);
    return {
      id: s.id, label: s.label, short: s.short, kind: s.kind, what: s.what, timing: s.timing, governing: s.governing ?? null,
      amount, amountBasis: basis, amountSource: (s.amount as { sourceLabel: string }).sourceLabel, checks, status: worst(checks), label2: TYPICAL_LABEL,
    };
  });
  const on = sources.filter((s) => enabled.includes(s.id) && s.status !== "no");
  const sum = (k: keyof MoneyRange) => on.reduce((t, s) => t + s.amount[k], 0);
  const remaining = clamp0(ordered(gapBefore.low - sum("high"), gapBefore.likely - sum("likely"), gapBefore.high - sum("low")));

  const stack: StackPiece[] = [{ id: "debt", short: "Loan", applied: debt.loan.likely }];
  let left = gapBefore.likely;
  for (const s of on) {
    const x = Math.max(0, Math.min(left, s.amount.likely));
    stack.push({ id: s.id, short: s.short, applied: x });
    left -= x;
  }
  stack.push({ id: "gap", short: "Gap", applied: Math.max(0, left) });

  const per = (r: MoneyRange): MoneyRange => (units ? ordered(r.low / units, r.likely / units, r.high / units, 1_000) : { low: 0, likely: 0, high: 0 });
  const hbc = COST_CONFIG.benchmarks.homeownershipSubsidy;
  const hb = { low: hbc.range[0]!, high: hbc.range[1]! };
  return {
    units, rents, tdc, debt, gapBefore, sources, enabled: on.map((s) => s.id), remaining, stack,
    subsidyPerUnit: per(gapBefore), remainingPerUnit: per(remaining),
    benchmark: {
      label: "Subsidy per affordable for-sale home in Pittsburgh", ...hb, source: hbc.sourceLabel,
      note: "A for-sale benchmark; rental subsidy needs differ.",
    },
    receipts: {
      gap: `Total development cost (pro forma) − permanent loan the restricted rents support = money needed from other sources. Low = low cost − high loan; high = high cost − low loan.`,
      remaining: `Gap before sources − the typical amounts of the sources switched on (${on.map((s) => s.short).join(", ") || "none"}). Low uses each source's high end; high uses each source's low end.`,
    },
  };
}
