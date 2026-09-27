import "server-only";

// Builds the computed JSON behind the two-sentence summary and the product-type comparison:
// every housing option the Ease Score engine checked, classified as by right or needing approval,
// each run through the same pro forma builder as the parcel page. The best by-right option (most
// profit) and the best with-approval option (more homes than by right) feed narrative.generateSummary.

import { assumptions, narrative, score, type ParcelFacts } from "@easescore/engine";
import { newCompsFor, rehabComps } from "@/lib/proforma";

type Strategy = score.StrategyResult;
type ZbaRow = { granted: number; denied: number; from?: string | null; to?: string | null };

export interface PlanOption {
  strategy: score.StrategyId;
  label: string;
  /** Noun phrase for sentences, e.g. "one single-family home". */
  phrase: string;
  units: number | null;
  path: "by_right" | "approval";
  /** Plain words with an article, e.g. "a special exception"; null when by right. */
  approval: string | null;
  reliefType: narrative.ReliefType | null;
  precedent: narrative.SummaryPrecedent | null;
  score: number | null;
  band: string | null;
  pf: assumptions.ProFormaResult | null;
}

export interface PlanComparison {
  options: PlanOption[];
  byRight: PlanOption | null;
  withApproval: PlanOption | null;
  summaryInput: narrative.SummaryInput;
  summary: narrative.SummaryResult;
}

const PHRASE: Record<score.StrategyId, (u: number | null) => string> = {
  new_sf: () => "one single-family home",
  duplex: () => "a duplex (two homes)",
  three_four_unit: (u) => (u ? `a ${u}-unit building` : "a 3-4 unit building"),
  townhouse_row: (u) => (u ? `a row of ${u} townhouses` : "a townhouse row"),
  adu: () => "a backyard cottage (ADU)",
  rehab_existing: () => "fixing up the existing building",
};

/** Program keys that belong to one layout; not carried over to the other options. */
const PROGRAM_KEYS: (keyof assumptions.CostOverrides)[] = ["units", "storiesAboveGarage", "parking", "bedrooms", "baths", "costPerUnit", "costIncludesSite", "salePricePerUnit"];

function f1Inputs(s: Strategy) {
  const f1 = s.factors.find((f) => f.id === "F1");
  return { subscore: f1?.subscore ?? null, ...((f1?.inputs ?? {}) as { permissionCode?: string | null; fitStatus?: string | null; varianceRules?: string[]; lotOfRecordPath?: boolean; nonconforming?: boolean }) };
}

function precedentOf(zba: Record<string, ZbaRow> | null | undefined, relief: narrative.ReliefType | null): narrative.SummaryPrecedent | null {
  if (!relief || relief === "administrator_exception") return null;
  const c = zba?.[relief];
  if (!c) return { granted: 0, decided: 0, sinceYear: null };
  const year = c.from ? Number(c.from.slice(0, 4)) : null;
  return { granted: c.granted, decided: c.granted + c.denied, sinceYear: Number.isFinite(year) ? year : null };
}

/** How a strategy is allowed: by right, with a named approval, or not classifiable from our data. */
export function classify(s: Strategy, zba: Record<string, ZbaRow> | null | undefined): Pick<PlanOption, "path" | "approval" | "reliefType" | "precedent"> | null {
  if (!s.applicable || s.strategy === "adu") return null;
  const i = f1Inputs(s);
  if (i.subscore == null || !i.permissionCode) return null;
  const code = i.permissionCode;
  const fit = i.fitStatus ?? null;
  if (fit === "no_fit" || fit == null) return null;
  if (i.lotOfRecordPath)
    return { path: "approval", approval: "an administrator exception for a lot of record", reliefType: "administrator_exception", precedent: null };
  const variance = fit === "variance";
  const rules = (i.varianceRules ?? []).map((r) => r.replace(/_/g, " "));
  const names = rules.map((r) => r.replace(/^min /, "minimum ").replace(/^max /, "maximum "));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const varianceText = names.length ? `a variance for the ${list}` : "a dimensional variance";
  if (code === "P" || (s.strategy === "rehab_existing" && i.nonconforming)) {
    if (!variance) return { path: "by_right", approval: null, reliefType: null, precedent: null };
    return { path: "approval", approval: varianceText, reliefType: "dimensional_variance", precedent: precedentOf(zba, "dimensional_variance") };
  }
  const relief: narrative.ReliefType = code === "S" ? "special_exception" : code === "C" ? "conditional_use" : code === "A" ? "administrator_exception" : "use_variance";
  const base = code === "S" ? "a special exception" : code === "C" ? "conditional use approval" : code === "A" ? "an administrator exception" : "a use variance";
  return { path: "approval", approval: variance ? `${base} and ${varianceText}` : base, reliefType: relief, precedent: precedentOf(zba, relief) };
}

/** Profit for a sale, yearly NOI for a rental; used to rank options by "most financial sense". */
const value = (pf: assumptions.ProFormaResult | null) => (pf ? (pf.plan.tenure === "sale" ? pf.sale.profit : pf.rent.noi != null && pf.tdc ? pf.rent.noi / pf.tdc : null) : null);

function costDriver(pf: assumptions.ProFormaResult | null): { costDriver: string | null; costDriverEffect: string | null } {
  if (!pf || pf.tdc == null) return { costDriver: null, costDriverEffect: null };
  const line = (id: string) => pf.plan.lines.find((l) => l.id === id)?.amount ?? null;
  const cands: { amount: number; driver: string; effect: string }[] = [];
  const slope = line("slope_adder");
  if (slope) {
    const steep = pf.plan.adders.some((a) => a.id === "steep_slope");
    cands.push(steep
      ? { amount: slope, driver: "the steep slope", effect: `points to a stepped foundation and retaining walls that add about ${narrative.money(slope)}` }
      : { amount: slope, driver: "the slope", effect: `adds about ${narrative.money(slope)} of foundation and site work` });
  }
  const grout = line("grouting");
  if (grout) cands.push({ amount: grout, driver: "old coal mines under the lot", effect: `add about ${narrative.money(grout)} for grouting` });
  const demo = line("demolition");
  if (demo) cands.push({ amount: demo, driver: "tearing down the existing building", effect: `adds about ${narrative.money(demo)}` });
  const top = cands.sort((a, b) => b.amount - a.amount)[0];
  if (top) return { costDriver: top.driver, costDriverEffect: top.effect };
  const land = pf.plan.land.value;
  if (land != null && land / pf.tdc >= 0.25) return { costDriver: "the land price", costDriverEffect: `of about ${narrative.money(land)} is a large part of the cost` };
  return { costDriver: "construction", costDriverEffect: `at about ${narrative.money(pf.plan.costPerSf)} per finished sq ft is the main cost` };
}

function toSummaryOption(o: PlanOption): narrative.SummaryOption {
  const pf = o.pf;
  const sale = pf?.plan.tenure !== "rent";
  const margin = pf ? (sale ? pf.sale.margin : pf.rent.yieldOnCost) : null;
  const gap = pf && sale && pf.sale.profit != null && pf.sale.profit < 0 ? -pf.sale.profit : null;
  return {
    strategyId: o.strategy,
    label: o.phrase,
    units: o.units,
    tenure: sale ? "sale" : "rent",
    verdict: pf?.verdict ?? null,
    marginPct: margin != null ? Math.round(margin * 1000) / 10 : null,
    gap: gap != null ? Math.round(gap) : null,
    ...costDriver(pf),
    needs: pf && pf.plan.missing.length ? (pf.plan.strategy === "rehab_existing" && pf.plan.missing.some((t) => /rehab cost/i.test(t)) ? "your rehab cost" : "an input our data does not have") : null,
  };
}

export async function comparePlans(a: {
  parid: string;
  facts: ParcelFacts & Record<string, unknown>;
  result: score.EaseScoreResult;
  zba: { by_relief?: Record<string, ZbaRow> } | null;
  sfComps: assumptions.SalesCompsLike | null;
  sales: unknown;
  rent: unknown;
  prime: { rate: number; date: string } | null;
  tapFeesPerUnit: number | null;
  overrides: assumptions.CostOverrides;
  asOf: string;
  /** Already-computed pro forma for one strategy (the page's selected option), reused as is. */
  known?: { strategy: score.StrategyId; pf: assumptions.ProFormaResult | null } | null;
  /** Precomputed comps (the parcel pane row): new-construction comps per strategy and the rehab's matched comps. */
  precomputed?: { newComps: Partial<Record<score.StrategyId, assumptions.CompSet | null>>; rehabComps: assumptions.CompSet | null } | null;
}): Promise<PlanComparison> {
  const f = a.facts as ParcelFacts & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const zba = a.zba?.by_relief ?? null;
  const shared: assumptions.CostOverrides = { ...a.overrides };
  for (const k of PROGRAM_KEYS) delete shared[k];

  const rows = a.result.strategies.map((s) => ({ s, c: classify(s, zba) })).filter((x) => x.c != null) as { s: Strategy; c: NonNullable<ReturnType<typeof classify>> }[];
  const options = await Promise.all(
    rows.map(async ({ s, c }): Promise<PlanOption> => {
      let pf: assumptions.ProFormaResult | null = null;
      if (a.known && a.known.strategy === s.strategy) pf = a.known.pf;
      else {
        try {
          const rehab = s.strategy === "rehab_existing";
          const pre = a.precomputed;
          const [newComps, matched] = pre
            ? [pre.newComps[s.strategy] ?? null, rehab ? pre.rehabComps : null]
            : await Promise.all([
                newCompsFor(s.strategy, a.parid, f.centroid, a.asOf),
                rehab ? rehabComps(a.sales as Parameters<typeof rehabComps>[0], { livingAreaSqft: (f.assessment as { living_area_sqft?: number | null } | undefined)?.living_area_sqft ?? null, yearBuilt: f.assessment?.year_built ?? null }) : Promise.resolve(null),
              ]);
          const plan = assumptions.buildDevelopmentInputs({
            strategy: s.strategy,
            facts: f as assumptions.ProFormaFacts,
            scheme: a.result.schemes?.[s.strategy] ?? null,
            comps: rehab ? matched : a.sfComps,
            newComps,
            rents: a.rent as assumptions.RentCompsLike | null,
            primeRate: a.prime?.rate ?? null,
            primeRateDate: a.prime?.date ?? null,
            permitMonths: s.predictedMonthsToPermit?.months ?? null,
            tapFeesPerUnit: a.tapFeesPerUnit,
            overrides: shared,
          });
          pf = assumptions.evaluateDevelopment(plan);
        } catch {
          pf = null;
        }
      }
      const units = pf?.plan.units ?? s.units ?? null;
      return { strategy: s.strategy, label: s.strategyLabel, phrase: PHRASE[s.strategy](units), units, ...c, score: s.score, band: s.band, pf };
    }),
  );

  const rank = (xs: PlanOption[]) => [...xs].sort((x, y) => (value(y.pf) ?? -Infinity) - (value(x.pf) ?? -Infinity) || (y.units ?? 0) - (x.units ?? 0));
  const byRight = rank(options.filter((o) => o.path === "by_right"))[0] ?? null;
  const approvals = options.filter((o) => o.path === "approval" && (byRight == null || (o.units ?? 0) > (byRight.units ?? 0)));
  const mostUnits = Math.max(0, ...approvals.map((o) => o.units ?? 0));
  const withApproval = rank(approvals.filter((o) => (o.units ?? 0) === mostUnits))[0] ?? null;

  const best = a.result.strategies.find((s) => s.strategy === a.result.best) ?? a.result.strategies[0];
  const district = score.isCityParcel(f) ? f.zoning?.code ?? null : null;
  const summaryInput: narrative.SummaryInput = {
    parid: a.parid,
    district,
    municipality: (f.context?.municipality as string | undefined) ?? f.assessment?.municipality ?? null,
    byRight: byRight ? toSummaryOption(byRight) : null,
    withApproval: withApproval
      ? { ...toSummaryOption(withApproval), approval: withApproval.approval ?? "an approval", reliefType: withApproval.reliefType, precedent: withApproval.precedent }
      : null,
    redFlags: (best?.redFlags ?? []).map((r) => r.title),
  };
  return { options, byRight, withApproval, summaryInput, summary: narrative.generateSummary(summaryInput) };
}
