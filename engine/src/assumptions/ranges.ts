// No false precision: every money output of the pro forma as {low, likely, high}, rounded ($1,000
// for line items, $10,000 for totals, percentages to one decimal), with a source badge per line and
// the source values that speak to it (triangulation). Low / high come only from each input's
// documented range: construction tier ranges, site-adder ranges, soft-cost share ranges, comps
// percentiles (25th / 75th) for the sale value, and the config's sensitivity moves where an input has
// no documented range (land, rent), which are then badged "Assumption, edit me".

import { forSaleProForma, rentalProForma, rentChange, salePriceChange, type ForSaleInputs, type Receipt, type RentalInputs } from "../finance";
import { COST_CONFIG, tierOf, type CostConfig } from "./config";
import type { DataSource, DevelopmentPlan, SalesCompsLike } from "./build";
import type { CompSet } from "./comps";

/** Fixed set of source badges. The UI shows "Assumption, edit me" in amber. */
export const SOURCE_BADGES = [
  "Pittsburgh builders (2026)",
  "Pittsburgh builders (2026), retail price including builder fee",
  // Listed for completeness; not cited by any line until the Feb 2026 ICC table is verified from a public page.
  "ICC BVD Feb 2026, national, permit-fee average",
  "NAHB 2024, national, excludes builder fee",
  "Local project benchmark",
  "Local project data (owner-provided)",
  "Assumption, edit me",
] as const;
export type SourceBadge = (typeof SOURCE_BADGES)[number];
export const ASSUMPTION_BADGE: SourceBadge = "Assumption, edit me";

/** Comps needed before the value range uses their 25th / 75th percentile. */
export const MIN_COMPS_FOR_PERCENTILES = 8;
/** Value range when there are fewer comps (an assumption, labeled as one). */
export const VALUE_FALLBACK_SHARE = 0.15;
/** Receipt line for every derived range (profit, gap, margin, yield). */
export const RANGE_METHOD =
  "The profit (or gap), margin and yield ranges combine the cost and value ranges as independent uncertainties: each side moves by the square root of (value change² + cost change²), so a low value is not paired with a high cost.";

export interface MoneyRange {
  low: number;
  likely: number;
  high: number;
}

/** Where a line's number comes from: a fixed badge, a public dataset (with its year), or your input. */
export interface LineSource {
  kind: "badge" | "data" | "user";
  /** Set for kind "badge". */
  badge: SourceBadge | null;
  /** Plain label; for data, includes the year or date. */
  label: string;
  asOf: string | null;
}

/** One source value that speaks to a cost line, for the small agreement strip. */
export interface TriangulationPoint {
  label: string;
  badge: SourceBadge | null;
  low: number;
  high: number;
  /** Point value when the source gives one. */
  value: number | null;
  note: string | null;
}

export interface Triangulation {
  /** Unit of every point, e.g. "$/finished SF" or "$ per home". */
  unit: string;
  /** The value this estimate uses, in the same unit. */
  used: MoneyRange;
  points: TriangulationPoint[];
}

export interface RangedLine {
  id: string;
  group: string;
  label: string;
  range: MoneyRange | null;
  /** How low / high were set, in plain words. */
  rangeBasis: string;
  source: LineSource;
  triangulation: Triangulation | null;
}

export interface PctRange {
  low: number;
  likely: number;
  high: number;
}

export interface ProFormaRanges {
  lines: RangedLine[];
  tdc: MoneyRange | null;
  sale: { grossSales: MoneyRange | null; netSales: MoneyRange | null; profit: MoneyRange | null; marginPct: PctRange | null; pricePerSf: MoneyRange | null; basis: string; method: string; source: DataSource };
  rent: { monthlyPerUnit: MoneyRange | null; noi: MoneyRange | null; yieldOnCostPct: PctRange | null; basis: string; method: string; source: DataSource };
  land: { range: MoneyRange | null; source: DataSource };
  /** "$620K–$690K, likely $650K" for the chip. */
  headline: string | null;
}

// ---------------------------------------------------------------------------------------------
// Rounding and text

export const roundTo = (x: number, step: number) => Math.round(x / step) * step + 0;
const r1 = (x: number) => Math.round(x * 10) / 10 + 0;

/** Round a range: line items to $1,000, totals to $10,000. low <= likely <= high always holds. */
export function roundRange(lo: number, likely: number, hi: number, step: number): MoneyRange {
  const a = Math.min(lo, likely, hi);
  const b = Math.max(lo, likely, hi);
  return { low: roundTo(a, step), likely: roundTo(likely, step), high: roundTo(b, step) };
}
const pctRange = (lo: number, likely: number, hi: number): PctRange => ({ low: r1(Math.min(lo, likely, hi) * 100), likely: r1(likely * 100), high: r1(Math.max(lo, likely, hi) * 100) });

/** "$650K" / "$1.2M" / "−$40K". */
export function shortMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${+(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** The chip: "From a $130K gap to a $150K profit, likely a $34K profit", "Gap …", "Profit …" or "Cost …". */
export function rangeHeadline(tenure: "sale" | "rent", p: MoneyRange | null, tdc: MoneyRange | null): string | null {
  return tenure === "sale" && p
    ? p.low < 0 && p.high > 0
      ? `From a ${shortMoney(-p.low)} gap to a ${shortMoney(p.high)} profit, likely ${p.likely < 0 ? `a ${shortMoney(-p.likely)} gap` : `a ${shortMoney(p.likely)} profit`}`
      : p.likely < 0
        ? `Gap ${rangeText({ low: -p.high, likely: -p.likely, high: -p.low })}`
        : `Profit ${rangeText(p)}`
    : tdc ? `Cost ${rangeText(tdc)}` : null;
}

/** "$620K–$690K, likely $650K" (or just "$650K" when low = high). */
export function rangeText(r: MoneyRange | null): string | null {
  if (!r) return null;
  if (r.low === r.high) return shortMoney(r.likely);
  return `${shortMoney(r.low)}–${shortMoney(r.high)}, likely ${shortMoney(r.likely)}`;
}

// ---------------------------------------------------------------------------------------------

const v = (r: Receipt): number | null => (r.status === "ok" ? r.value : null);
const has = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const i = Math.floor(pos);
  return s[i]! + (s[Math.min(i + 1, s.length - 1)]! - s[i]!) * (pos - i);
}

const isUser = (label: string) => label === "Your input" || label === "Your number";
const badge = (b: SourceBadge, label?: string): LineSource => ({ kind: "badge", badge: b, label: label ?? b, asOf: null });
const data = (label: string, asOf: string | null): LineSource => ({ kind: "data", badge: null, label, asOf });
const USER: LineSource = { kind: "user", badge: null, label: "Your input", asOf: null };

/**
 * Low / likely / high for every budget line and the totals. Pure; call after evaluateDevelopment
 * (it reads the plan and the budget) — evaluateDevelopment attaches it as `ranges`.
 */
export function proFormaRanges(
  plan: DevelopmentPlan,
  budget: { id: string; group: string; label: string; amount: number | null; sourceLabel: string }[],
  config: CostConfig = COST_CONFIG,
): ProFormaRanges {
  const tier = tierOf(config, plan.tier.id);
  const edited = (key: string) => plan.assumptions.find((r) => r.key === key)?.edited === true;
  const sv = config.sensitivity;
  const lines: RangedLine[] = [];
  const amt = (id: string) => budget.find((b) => b.id === id)?.amount ?? plan.lines.find((l) => l.id === id)?.amount ?? null;

  // ---- Hard-cost pieces: [low, high] multipliers on each line's likely amount
  const rh = plan.rehab;
  const tierLo = rh ? rh.perSf[0] / rh.perSf[1] : tier.costPerSf.range[0]! / tier.costPerSf.value;
  const tierHi = rh ? rh.perSf[2] / rh.perSf[1] : tier.costPerSf.range[1]! / tier.costPerSf.value;
  const mineLine = (id: string) => plan.userLines.includes(id);
  const hardBase = plan.lines.find((l) => l.id === "hard_base");
  const baseUser = hardBase ? isUser(hardBase.sourceLabel) : false;
  const mult: Record<string, [number, number]> = {};
  if (hardBase) mult.hard_base = baseUser || mineLine("hard_base") || edited("costPerSf") ? [1, 1] : [tierLo, tierHi];
  if (plan.lines.some((l) => l.id === "garage_level")) mult.garage_level = baseUser ? [1, 1] : [tierLo, tierHi];
  const slope = plan.adders.find((a) => a.id === "steep_slope" || a.id === "moderate_slope");
  if (slope && slope.perSf != null) {
    const def = slope.id === "steep_slope" ? config.siteAdders.steepSlope : config.siteAdders.moderateSlope;
    mult.slope_adder = edited("slopeAdder") || mineLine("slope_adder") ? [1, 1] : [def.range[0]! / slope.perSf, def.range[1]! / slope.perSf];
  }
  const rwAmt = amt("retaining_walls");
  const rwDef = config.siteAdders.retainingWalls;
  if (rwAmt) mult.retaining_walls = mineLine("retaining_walls") ? [1, 1] : [rwDef.range[0]! / rwDef.value, rwDef.range[1]! / rwDef.value];
  // Site work & earthwork takeoff: each quantity line's own low/high (unit cost range × quantity).
  const takeoff = plan.siteTakeoff;
  for (const q of takeoff?.lines ?? []) {
    if (q.id !== "foundation_walls" && q.id !== "excavation" && q.id !== "retaining_walls") continue;
    if (!q.amount.likely) continue;
    mult[q.id] = mineLine(q.id) ? [1, 1] : [q.amount.low / q.amount.likely, q.amount.high / q.amount.likely];
  }
  const grout = config.siteAdders.mineGrouting;
  const groutAmt = amt("grouting");
  if (groutAmt != null) mult.grouting = edited("grouting") ? [1, 1] : [grout.range[0]! / groutAmt, grout.range[1]! / groutAmt];

  const hardIds = plan.lines.filter((l) => l.group === "hard").map((l) => l.id);
  const hardAt = (k: 0 | 1) => hardIds.reduce((t, id) => t + (amt(id) ?? 0) * (mult[id]?.[k] ?? 1), 0);
  const hardLikely = hardIds.reduce((t, id) => t + (amt(id) ?? 0), 0);
  const hardLo = hardAt(0);
  const hardHi = hardAt(1);

  // ---- Soft shares [low, likely, high]
  const sc = config.softCosts;
  const shareRange = (key: string, likely: number, range: number[] | undefined): [number, number] =>
    edited(key) || !range ? [likely, likely] : [Math.min(range[0]!, likely), Math.max(range[1]!, likely)];
  const pgh = plan.shares.permitsBasis.includes("per $1,000");
  const shares: Record<string, [number, number, number]> = {
    ae: [...shareRange("ae", plan.shares.ae, plan.shares.aeRange ?? sc.architectureEngineering.range), plan.shares.ae] as unknown as [number, number, number],
    permits: [...(plan.shares.permitsRange && !edited("permits") ? plan.shares.permitsRange : pgh ? [plan.shares.permits, plan.shares.permits] : shareRange("permits", plan.shares.permits, sc.permitsAndFees.range)), plan.shares.permits] as unknown as [number, number, number],
    other_soft: [...(plan.shares.otherRange && !edited("other") ? plan.shares.otherRange : shareRange("other", plan.shares.other, sc.surveyTitleLegalInsurance.range)), plan.shares.other] as unknown as [number, number, number],
  };

  // ---- Low / high finance inputs (cost side only)
  const land = plan.land.value;
  const landUser = plan.sources.land.kind === "user";
  const le = plan.land.estimate;
  const rps = config.land.rehabPurchase.rangeShare;
  const landLo = land != null ? (landUser ? land : le ? le.low : land * (1 - rps)) : null;
  const landHi = land != null ? (landUser ? land : le ? le.high : land * (1 + rps)) : null;
  const costInputs = <I extends ForSaleInputs | RentalInputs>(i: I, k: 0 | 1): I => {
    const siteLines = { ...(i.hardSiteLines ?? {}) } as Record<string, number>;
    if ("grouting" in siteLines && mult.grouting) siteLines.grouting = siteLines.grouting! * mult.grouting[k];
    if ("siteWork" in siteLines)
      for (const id of ["slope_adder", "retaining_walls", "foundation_walls", "excavation"]) {
        const a = amt(id);
        if (a && mult[id]) siteLines.siteWork = siteLines.siteWork! + a * (mult[id]![k] - 1);
      }
    const baseAmt = (amt("hard_base") ?? 0) + (amt("garage_level") ?? 0);
    const baseMult = mult.hard_base?.[k] ?? 1;
    const softShare = shares.ae![k] + shares.permits![k] + shares.other_soft![k];
    return {
      ...i,
      land: (k === 0 ? landLo : landHi) ?? i.land,
      hardCost: i.hardCost != null ? baseAmt * baseMult : i.hardCost,
      hardSiteLines: siteLines,
      softCostShareOfHard: softShare,
    };
  };
  const fsLo = costInputs(plan.forSale, 0);
  const fsHi = costInputs(plan.forSale, 1);
  const cLo = forSaleProForma(fsLo).costs;
  const cMid = forSaleProForma(plan.forSale).costs;
  const cHi = forSaleProForma(fsHi).costs;

  // ---- Lines
  const benchmarks = config.benchmarks.projects;
  const perHomeSf = plan.finishedSf != null && plan.units ? plan.finishedSf / plan.units : null;
  for (const b of budget) {
    if (b.group === "total") continue;
    const likely = b.amount;
    let lo = likely, hi = likely;
    let basis = "No documented range: shown as one number";
    let source: LineSource = isUser(b.sourceLabel) ? USER : badge(ASSUMPTION_BADGE, b.sourceLabel);
    let tri: Triangulation | null = null;
    const m = mult[b.id];
    if (likely != null && m) { lo = likely * m[0]; hi = likely * m[1]; }
    switch (b.id) {
      case "land":
        lo = landLo; hi = landHi;
        source = landUser ? USER : plan.sources.land.kind === "data" ? data(plan.sources.land.label, plan.sources.land.asOf) : badge(ASSUMPTION_BADGE);
        basis = landUser ? "Your price" : le ? (le.public ? "Public land: price set by the agency. From agency sales of vacant lots up to the private market" : "Middle half of nearby vacant-land sales (per sq ft of lot)") : `±${Math.round(rps * 100)}% around nearby as-is home sales (Assumption, edit me)`;
        break;
      case "hard_base": {
        if (rh) {
          const you = baseUser || mineLine("hard_base") || edited("costPerSf");
          source = you ? USER : badge(ASSUMPTION_BADGE, rh.sourceLabel);
          basis = you ? "Your number" : `${rh.basis} (Assumption, edit me)`;
          break;
        }
        const tierBadge: SourceBadge = "Pittsburgh builders (2026)";
        source = baseUser || mineLine("hard_base") ? USER : badge(tierBadge, `${tier.costPerSf.sourceLabel} (${tier.label})`);
        basis = baseUser || mineLine("hard_base") ? "Your number" : `${tier.label} range $${tier.costPerSf.range[0]}–$${tier.costPerSf.range[1]}/SF (Pittsburgh builders' published ranges with the builder's fee removed)`;
        if (plan.finishedSf) {
          const used = roundRange((lo ?? 0) / plan.finishedSf, (likely ?? 0) / plan.finishedSf, (hi ?? 0) / plan.finishedSf, 1);
          const nr = config.construction.nationalReference;
          const points: TriangulationPoint[] = [
            { label: `${tier.label}, cost to build (builder fee removed)`, badge: "Pittsburgh builders (2026)", low: tier.costPerSf.range[0]!, high: tier.costPerSf.range[1]!, value: tier.costPerSf.value, note: "Published Pittsburgh builder ranges ÷ about 1.20 (builder overhead and profit removed)." },
            { label: `Pittsburgh builders' published retail, ${tier.label}`, badge: "Pittsburgh builders (2026), retail price including builder fee", low: tier.retail.range[0]!, high: tier.retail.range[1]!, value: null, note: "Price to an owner, including the builder's fee: the cross-check." },
            { label: "NAHB national average", badge: "NAHB 2024, national, excludes builder fee", low: nr.value, high: nr.value, value: nr.value, note: "National production builders, construction only; excludes builder overhead and profit." },
          ];
          if (perHomeSf) {
            const per = benchmarks.map((p) => p.perUnit / perHomeSf);
            points.push({ label: `Recent Allegheny County projects (${benchmarks.length}), all-in per home ÷ ${Math.round(perHomeSf).toLocaleString("en-US")} sq ft`, badge: "Local project benchmark",
              low: Math.round(Math.min(...per)), high: Math.round(Math.max(...per)), value: null,
              note: "All-in cost per home (land, soft costs, financing; mostly multifamily and affordable), so it sits above construction cost alone." });
          }
          if (baseUser) points.push({ label: "Your number", badge: null, low: used.likely, high: used.likely, value: used.likely, note: null });
          tri = { unit: "$/finished SF", used, points };
        }
        break;
      }
      case "garage_level":
        source = baseUser ? USER : badge(ASSUMPTION_BADGE, config.construction.garageLevelShareOfTier.sourceLabel);
        basis = baseUser ? "Your number" : `Tier range × ${Math.round(config.construction.garageLevelShareOfTier.value * 100)}% garage share (Assumption, edit me)`;
        break;
      case "slope_adder": {
        const def = slope?.id === "steep_slope" ? config.siteAdders.steepSlope : config.siteAdders.moderateSlope;
        const you = edited("slopeAdder") || mineLine("slope_adder");
        source = you ? USER : badge(ASSUMPTION_BADGE, def.sourceLabel);
        basis = you ? "Your number" : `$${def.range[0]}–$${def.range[1]} per sq ft of building footprint (Assumption, edit me: confirm with bids)`;
        if (plan.footprintSf && likely != null)
          tri = { unit: "$/SF of footprint", used: roundRange((lo ?? 0) / plan.footprintSf, likely / plan.footprintSf, (hi ?? 0) / plan.footprintSf, 1),
            points: [{ label: def.label, badge: ASSUMPTION_BADGE, low: def.range[0]!, high: def.range[1]!, value: def.value, note: "Estimate; confirm with bids." }] };
        break;
      }
      case "retaining_walls":
      case "foundation_walls":
      case "excavation": {
        const q = takeoff?.lines.find((l) => l.id === b.id);
        if (q && q.unitCost) {
          source = mineLine(b.id) ? USER : badge(ASSUMPTION_BADGE, q.sourceLabel);
          basis = mineLine(b.id) ? "Your number" : `${q.quantity?.toLocaleString("en-US")} ${q.unit} × $${q.unitCost.low}–$${q.unitCost.high} ${q.unitCost.unit.replace(/^\$ /, "")} (Assumption, edit me: confirm with bids)`;
        } else {
          source = mineLine("retaining_walls") ? USER : badge(ASSUMPTION_BADGE, rwDef.sourceLabel);
          basis = mineLine("retaining_walls") ? "Your number" : `$${rwDef.range[0]!.toLocaleString("en-US")}–$${rwDef.range[1]!.toLocaleString("en-US")} per building (Assumption, edit me: confirm with bids)`;
        }
        break;
      }
      case "grouting":
        source = edited("grouting") ? USER : badge("Local project data (owner-provided)");
        basis = edited("grouting") ? "Your number" : `Grouting range $${grout.range[0]!.toLocaleString("en-US")}–$${grout.range[1]!.toLocaleString("en-US")} (Local project data (owner-provided); not a quote)`;
        tri = { unit: "$", used: roundRange(lo ?? 0, likely ?? 0, hi ?? 0, 1000),
          points: [{ label: "Local project data (owner-provided)", badge: "Local project data (owner-provided)", low: grout.range[0]!, high: grout.range[1]!, value: grout.value, note: grout.sourceNote ?? null }] };
        break;
      case "tap_fees":
        source = data("Pittsburgh Water (PWSA) published tariff", null);
        basis = "Published fee schedule: one number";
        break;
      case "ae": case "permits": case "other_soft": {
        const [sl, sh, sm] = shares[b.id]!;
        const hardMid = v(cMid.hard);
        if (hardMid != null) { lo = sl * (v(cLo.hard) ?? hardLo); hi = sh * (v(cHi.hard) ?? hardHi); }
        const key = b.id === "other_soft" ? "other" : b.id;
        if (edited(key) || mineLine(b.id)) source = USER;
        else if (b.id === "permits" && pgh) source = data(`${config.softCosts.pittsburghBuildingPermitFee.sourceLabel}`, config.softCosts.pittsburghBuildingPermitFee.effectiveDate);
        else source = badge(ASSUMPTION_BADGE, b.sourceLabel);
        basis = sl === sh ? `${r1(sm * 100)}% of hard cost; moves with the hard-cost range` : `${r1(sl * 100)}–${r1(sh * 100)}% of hard cost (Assumption, edit me)`;
        tri = { unit: "share of hard cost (%)", used: { low: r1(sl * 100), likely: r1(sm * 100), high: r1(sh * 100) },
          points: [{ label: source.label, badge: source.badge, low: r1(sl * 100), high: r1(sh * 100), value: r1(sm * 100), note: null }] };
        break;
      }
      case "contingency":
        lo = v(cLo.contingency); hi = v(cHi.contingency);
        source = edited("contingency") || mineLine("contingency") ? USER : badge(ASSUMPTION_BADGE);
        basis = `${r1(plan.shares.contingency * 100)}% of hard cost; moves with the hard-cost range`;
        break;
      case "interest":
        lo = v(cLo.constructionInterest); hi = v(cHi.constructionInterest);
        source = edited("constructionRate") ? USER : badge(ASSUMPTION_BADGE, b.sourceLabel);
        basis = "Loan interest moves with the cost range (rate: an assumed construction-loan rate)";
        break;
      case "loan_fees": {
        const lLo = v(cLo.constructionLoan), lHi = v(cHi.constructionLoan);
        if (lLo != null && lHi != null) { lo = lLo * plan.loanFeeShare; hi = lHi * plan.loanFeeShare; }
        source = badge(ASSUMPTION_BADGE);
        basis = "Share of the loan; moves with the cost range";
        break;
      }
      case "holding":
        source = data("County assessment × millage (County Treasurer)", null);
        basis = "Monthly tax × months; one number";
        break;
      default:
        if (isUser(b.sourceLabel) || mineLine(b.id)) { basis = "Your number"; source = USER; }
    }
    lines.push({
      id: b.id, group: b.group, label: b.label,
      range: likely != null ? roundRange(lo ?? likely, likely, hi ?? likely, 1000) : null,
      rangeBasis: basis, source, triangulation: tri,
    });
  }

  // ---- Totals
  const tLo = v(cLo.tdc), tMid = v(cMid.tdc), tHi = v(cHi.tdc);
  const tdc = tLo != null && tMid != null && tHi != null ? roundRange(tLo, tMid, tHi, 10000) : null;
  if (tdc && plan.units) {
    const per = benchmarks.map((p) => p.perUnit);
    const usedPer = roundRange(tLo! / plan.units, tMid! / plan.units, tHi! / plan.units, 1000);
    lines.push({
      id: "tdc", group: "total", label: "Total development cost (TDC)", range: tdc, rangeBasis: "Sum of the line ranges through the finance module",
      source: { kind: "data", badge: null, label: "Finance module", asOf: null },
      triangulation: { unit: "$ per home, all-in", used: usedPer, points: [
        { label: `Recent Allegheny County projects (${benchmarks.length})`, badge: "Local project benchmark", low: Math.min(...per), high: Math.max(...per), value: null, note: "Mostly new multifamily and affordable; all-in cost per home." },
      ] },
    });
  }

  // ---- Revenue: sale. Value low / high = 25th / 75th percentile of the comps' $/SF (with at least
  // MIN_COMPS_FOR_PERCENTILES comps), else ±VALUE_FALLBACK_SHARE, labeled as an assumption.
  const vc = plan.valueComps as (CompSet | SalesCompsLike | null);
  const rows = vc && "comps" in vc && Array.isArray((vc as CompSet).comps) ? (vc as CompSet).comps.map((c) => c.pricePerSqft).filter(has) : [];
  const saleUser = plan.sources.sale.kind === "user";
  const ppsf = plan.revenue.sale.pricePerSf;
  let pLo = 1, pHi = 1;
  let saleBasis = "Your price";
  if (!saleUser && ppsf != null) {
    const q1 = rows.length >= MIN_COMPS_FOR_PERCENTILES ? quantile(rows, 0.25) : null;
    const q3 = rows.length >= MIN_COMPS_FOR_PERCENTILES ? quantile(rows, 0.75) : null;
    if (q1 != null && q3 != null) { pLo = Math.min(1, q1 / ppsf); pHi = Math.max(1, q3 / ppsf); saleBasis = `25th–75th percentile of ${rows.length} comparable sales per sq ft`; }
    else { pLo = 1 - VALUE_FALLBACK_SHARE; pHi = 1 + VALUE_FALLBACK_SHARE; saleBasis = `±${Math.round(VALUE_FALLBACK_SHARE * 100)}% (Assumption, edit me: fewer than ${MIN_COMPS_FOR_PERCENTILES} comps listed for percentiles)`; }
  }
  const sMid = forSaleProForma(plan.forSale).sales;
  const gLo = forSaleProForma(salePriceChange<ForSaleInputs>().apply(plan.forSale, pLo - 1)).sales;
  const gHi = forSaleProForma(salePriceChange<ForSaleInputs>().apply(plan.forSale, pHi - 1)).sales;
  const tri3 = (a: Receipt, b: Receipt, c: Receipt, step: number) => {
    const x = v(a), y = v(b), z = v(c);
    return x != null && y != null && z != null ? roundRange(x, y, z, step) : null;
  };
  // Derived results (profit, gap, margin, yield) never pair opposite extremes (low value with high
  // cost). The value and cost ranges are combined as independent uncertainties: each side moves by
  // sqrt(Δvalue² + Δcost²).
  const netMid = v(sMid.netSales), netLo = v(gLo.netSales), netHi = v(gHi.netSales);
  const profMid = v(sMid.profit);
  let profit: MoneyRange | null = null;
  let marginPct: PctRange | null = null;
  if (profMid != null && netMid != null && netLo != null && netHi != null && tMid != null && tLo != null && tHi != null) {
    const down = Math.hypot(netMid - netLo, tHi - tMid);
    const up = Math.hypot(netHi - netMid, tMid - tLo);
    profit = roundRange(profMid - down, profMid, profMid + up, 10000);
    const m = profMid / tMid;
    marginPct = pctRange(m - down / tMid, m, m + up / tMid);
  }
  const sale = {
    grossSales: tri3(gLo.grossSales, sMid.grossSales, gHi.grossSales, 10000),
    netSales: tri3(gLo.netSales, sMid.netSales, gHi.netSales, 10000),
    profit,
    marginPct,
    pricePerSf: ppsf != null ? roundRange(ppsf * pLo, ppsf, ppsf * pHi, 1) : null,
    basis: saleBasis,
    method: RANGE_METHOD,
    source: plan.sources.sale,
  };

  // ---- Revenue: rent (no rent comps: the index / FMR is one number, so the sensitivity move sets the range)
  const rentUser = plan.sources.rent.kind === "user";
  const rpu = plan.revenue.rent.perUnit;
  const re = plan.rentEstimate;
  const fromEst = !rentUser && re && re.low != null && re.high != null && rpu;
  const rrLo = rentUser ? 0 : fromEst ? 1 - re!.low! / rpu! : sv.revenueShare.value;
  const rrHi = rentUser ? 0 : fromEst ? re!.high! / rpu! - 1 : sv.revenueShare.value;
  const rLow = rentalProForma(rentChange<RentalInputs>().apply(plan.rental, -rrLo));
  const rMid = rentalProForma(plan.rental);
  const rHigh = rentalProForma(rentChange<RentalInputs>().apply(plan.rental, rrHi));
  const noiMid = v(rMid.noi), noiLo = v(rLow.noi), noiHi = v(rHigh.noi);
  let yieldOnCostPct: PctRange | null = null;
  if (noiMid != null && noiLo != null && noiHi != null && tMid != null && tLo != null && tHi != null && tMid > 0) {
    // Yield = NOI ÷ cost: relative errors of the two combined as independent uncertainties.
    const y = noiMid / tMid;
    const rel = (dn: number, dc: number) => Math.abs(y) * Math.hypot(noiMid ? dn / noiMid : 0, dc / tMid);
    yieldOnCostPct = pctRange(y - rel(noiMid - noiLo, tHi - tMid), y, y + rel(noiHi - noiMid, tMid - tLo));
  }
  const rent = {
    monthlyPerUnit: rpu != null ? roundRange(rpu * (1 - rrLo), rpu, rpu * (1 + rrHi), rentUser ? 1 : 50) : null,
    noi: tri3(rLow.noi, rMid.noi, rHigh.noi, 1000),
    yieldOnCostPct,
    basis: rentUser ? "Your rent" : fromEst ? `${re!.method}` : `±${Math.round(sv.revenueShare.value * 100)}% around the assumed rent (Assumption, edit me)`,
    method: RANGE_METHOD,
    source: plan.sources.rent,
  };

  const headline = rangeHeadline(plan.tenure, sale.profit, tdc);

  return {
    lines, tdc, sale, rent,
    land: { range: lines.find((l) => l.id === "land")?.range ?? null, source: plan.sources.land },
    headline,
  };
}
