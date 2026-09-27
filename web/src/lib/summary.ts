import "server-only";

// Builds the computed JSON behind the two-sentence summary and the product-type comparison:
// every housing option the Ease Score engine checked, classified as by right or needing approval,
// each run through the same pro forma builder as the parcel page. The best by-right option (most
// profit) and the best with-approval option (more homes than by right) feed narrative.generateSummary.

import { assumptions, narrative, score, type ParcelFacts } from "@easescore/engine";
import { newCompsFor, rehabComps } from "@/lib/proforma";
import { compArea } from "@/lib/pane-core";

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
  townhouse_row: (u) => (u ? narrative.schemePhrase("Townhouse row", u) : "a townhouse row"),
  adu: () => "a backyard cottage (ADU)",
  rehab_existing: () => "fixing up the existing building",
};

/** Program keys that belong to one layout; not carried over to the other options. */
const PROGRAM_KEYS: (keyof assumptions.CostOverrides)[] = ["units", "storiesAboveGarage", "parking", "bedrooms", "baths", "costPerUnit", "costIncludesSite", "salePricePerUnit"];

/** How a strategy is allowed: by right, with a named approval, or not classifiable from our data (engine: narrative.classifyPlan). */
export function classify(s: Strategy, zba: Record<string, ZbaRow> | null | undefined): Pick<PlanOption, "path" | "approval" | "reliefType" | "precedent"> | null {
  const c = narrative.classifyPlan(s, zba);
  return c ? { path: c.path, approval: c.approval, reliefType: c.reliefType, precedent: c.precedent } : null;
}

/**
 * "Most financial sense", on one scale for both tenures: profit margin on cost for a sale, yield on
 * cost for a rental (both are return ÷ total cost).
 */
const value = (pf: assumptions.ProFormaResult | null) => (pf ? (pf.plan.tenure === "sale" ? pf.sale.margin : pf.rent.yieldOnCost) : null);

function costDriver(pf: assumptions.ProFormaResult | null): { costDriver: string | null; costDriverEffect: string | null } {
  if (!pf || pf.tdc == null) return { costDriver: null, costDriverEffect: null };
  const line = (id: string) => pf.plan.lines.find((l) => l.id === id)?.amount ?? null;
  const cands: { amount: number; driver: string; effect: string }[] = [];
  // Stepped/hillside foundation and the retaining-wall line together, so the summary matches the budget's two lines.
  const slope = (line("slope_adder") ?? 0) + (line("retaining_walls") ?? 0) || null;
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
}): Promise<PlanComparison & { ctx: SummaryCtx }> {
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
                newCompsFor(s.strategy, a.parid, f.centroid, a.asOf, compArea(f)),
                rehab ? rehabComps(a.sales as Parameters<typeof rehabComps>[0], { livingAreaSqft: (f.assessment as { living_area_sqft?: number | null } | undefined)?.living_area_sqft ?? null, yearBuilt: f.assessment?.year_built ?? null }) : Promise.resolve(null),
              ]);
          const plan = assumptions.buildDevelopmentInputs({
            strategy: s.strategy,
            facts: f as assumptions.ProFormaFacts,
            scheme: a.result.schemes?.[s.strategy] ?? null,
            // The same SelectedScheme the score's fit read (no program edits: those belong to the page's selected option).
            selected: score.selectScheme({
              strategy: s.strategy, scheme: a.result.schemes?.[s.strategy] ?? null, result: s,
              existing: { livingAreaSqft: (f.assessment as { living_area_sqft?: number | null } | undefined)?.living_area_sqft ?? null, use: f.assessment?.use ?? null },
            }),
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

  const ctx: SummaryCtx = {
    parid: a.parid,
    district: score.isCityParcel(f) ? f.zoning?.code ?? null : null,
    municipality: (f.context?.municipality as string | undefined) ?? f.assessment?.municipality ?? null,
    redFlags: ((a.result.strategies.find((s) => s.strategy === a.result.best) ?? a.result.strategies[0])?.redFlags ?? []).map((r) => r.title),
  };
  return summarize(options, ctx, null);
}

interface SummaryCtx { parid: string; district: string | null; municipality: string | null; redFlags: string[] }

const approvalOption = (o: PlanOption): narrative.SummaryApprovalOption => ({
  ...toSummaryOption(o), approval: o.approval ?? "an approval", reliefType: o.reliefType, precedent: o.precedent,
});

/**
 * Picks the featured by-right option (most financial sense; ties go to the higher Ease Score) and the
 * with-approval option, and writes the two sentences. `lead`: the strategy the visitor chose, when it
 * is not the featured by-right option (sentence 1 then describes it).
 */
function summarize(options: PlanOption[], ctx: SummaryCtx, lead: score.StrategyId | null): PlanComparison & { ctx: SummaryCtx } {
  const { byRight, withApproval } = narrative.pickPlans(options.map((o) => ({ ...o, value: value(o.pf) })));
  const leadOpt = lead && lead !== byRight?.strategy ? options.find((o) => o.strategy === lead) ?? null : null;
  const summaryInput: narrative.SummaryInput = {
    parid: ctx.parid,
    district: ctx.district,
    municipality: ctx.municipality,
    byRight: byRight ? toSummaryOption(byRight) : null,
    withApproval: withApproval ? approvalOption(withApproval) : null,
    ...(leadOpt ? { lead: approvalOption(leadOpt) } : {}),
    redFlags: ctx.redFlags,
  };
  return { options, byRight, withApproval, summaryInput, summary: narrative.generateSummary(summaryInput), ctx };
}

/**
 * Puts the page's selected option (its pro forma with the visitor's program edits) into the
 * comparison and rewrites the summary; `explicit` when the visitor chose the strategy.
 */
export function withSelected(plans: PlanComparison & { ctx: SummaryCtx }, strategy: score.StrategyId, pf: assumptions.ProFormaResult | null, explicit: boolean): PlanComparison & { ctx: SummaryCtx } {
  const options = plans.options.map((o) => (o.strategy === strategy && pf ? { ...o, pf, units: pf.plan.units ?? o.units, phrase: PHRASE[o.strategy](pf.plan.units ?? o.units) } : o));
  return summarize(options, plans.ctx, explicit ? strategy : null);
}
