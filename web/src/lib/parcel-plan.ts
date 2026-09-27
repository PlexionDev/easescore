// The priced plan for one parcel and option, shared by the parcel page and the Feasibility Study
// (lib/report/load.ts), so the same URL gives the same scheme, stepping, budget lines and metrics in
// both: the score's fit scheme, or the QuickFit 3D generator's scheme when the map controls (qf_*) are
// in the URL, priced through lib/quickfit-gen.ts financeFor (selectScheme -> buildDevelopmentInputs ->
// evaluateDevelopment) with the pane's comps, rents, rates and lidar grid. Pure: no I/O.

import { assumptions, quickfit, score, type ParcelFacts } from "@easescore/engine";
import type { PanePayload } from "./pane-core";
import {
  GEN_TYPOLOGIES, controlsFromQuery, controlsFromScheme, financeFor, generate, plates, proFormaFacts, sameControls, typologyForStrategy,
  type FinanceInputs, type GenControls, type GenInput, type GenParcel, type GenTypology, type SteppingResult,
} from "./quickfit-gen";

type SP = Record<string, string | string[] | undefined>;

export interface ParcelPlan {
  fin: FinanceInputs;
  isCity: boolean;
  rulesRow: quickfit.QuickFitRules | null;
  genTyp: GenTypology | null;
  /** The map controls from the URL for this option's building type (null = its priced layout). */
  urlControls: GenControls | null;
  /** Per building type: the controls that reproduce its priced scheme. */
  genDefaults: Record<GenTypology, GenControls>;
  scheme: quickfit.Scheme | null;
  stepping: SteppingResult | null;
  selected: score.SelectedScheme | null;
  pf: assumptions.ProFormaResult | null;
}

/** True when pricing this option needs the lot geometry (the URL carries map controls for it). */
export function planNeedsLot(sp: SP, strategy: score.StrategyId | null | undefined): boolean {
  const t = typologyForStrategy(strategy);
  return !!t && controlsFromQuery(sp, t) != null;
}

export function parcelPlan(a: { P: PanePayload; sp: SP; overrides: assumptions.CostOverrides; strategy: score.StrategyId | null; qf: GenParcel | null }): ParcelPlan {
  const { P, sp } = a;
  const f = P.facts as unknown as ParcelFacts & Record<string, unknown>;
  const ease = P.score;
  const isCity = score.isCityParcel(f);
  const rulesRow = isCity ? ((f.zoning as { rules?: quickfit.QuickFitRules | null } | undefined)?.rules ?? null) : null;
  const fin: FinanceInputs = {
    facts: proFormaFacts(f), sfComps: P.sfComps, newComps: P.newComps, rehabComps: P.rehabComps,
    rents: P.rent as FinanceInputs["rents"], prime: P.prime, tapFees: P.tapFees,
    permitMonths: Object.fromEntries((ease?.strategies ?? []).map((x) => [x.strategy, x.predictedMonthsToPermit?.months ?? null])),
    overrides: a.overrides,
    results: Object.fromEntries((ease?.strategies ?? []).map((x) => [x.strategy, { schemeId: x.schemeId ?? null, f1: (x.factors.find((q) => q.id === "F1")?.inputs ?? null) as Record<string, unknown> | null }])),
  };
  const genDefaults = Object.fromEntries(GEN_TYPOLOGIES.map((t) => {
    const sch = ease?.schemes?.[t.strategy] ?? null;
    const sr = ease?.strategies.find((x) => x.strategy === t.strategy);
    const f1 = sr?.factors.find((q) => q.id === "F1")?.inputs as { fitStatus?: string | null; varianceRules?: string[] } | undefined;
    return [t.id, controlsFromScheme(t.id, sch, f1?.fitStatus ?? null, f1?.varianceRules ?? [])];
  })) as Record<GenTypology, GenControls>;
  const genTyp = typologyForStrategy(a.strategy);
  const urlControls = genTyp ? controlsFromQuery(sp, genTyp) : null;
  const sr = a.strategy ? ease?.strategies.find((x) => x.strategy === a.strategy) ?? null : null;
  let scheme: quickfit.Scheme | null = a.strategy ? ease?.schemes?.[a.strategy] ?? null : null;
  let stepping: SteppingResult | null = null;
  if (sr?.applicable && urlControls && a.qf) {
    const gi: GenInput = { qf: a.qf, zoneCode: (f.zoning as { code?: string } | undefined)?.code ?? null, rulesRow, terrain: P.terrain };
    const d = genDefaults[urlControls.typology];
    const own = sameControls({ ...urlControls, stories: d.stories, unitWidthFt: d.unitWidthFt, parking: d.parking }, d) ? scheme : null;
    const g = generate(gi, urlControls, own);
    scheme = g.scheme;
    stepping = g.stepping;
  } else if (scheme) stepping = plates(scheme.footprints, P.terrain).stepping;
  let selected: score.SelectedScheme | null = null;
  let pf: assumptions.ProFormaResult | null = null;
  if (sr?.applicable && a.strategy) {
    try {
      const out = financeFor(fin, a.strategy, scheme, stepping);
      selected = out.selected;
      pf = out.pf;
    } catch {
      selected = null;
      pf = null;
    }
  }
  return { fin, isCity, rulesRow, genTyp, urlControls, genDefaults, scheme, stepping, selected, pf };
}

// ------------------------------------------------------------------------------ page -> report

const REPORT_STRATEGY: Partial<Record<score.StrategyId, string>> = { new_sf: "single_family", duplex: "duplex", townhouse_row: "townhouse_row" };
const FROM_REPORT: Record<string, score.StrategyId> = { single_family: "new_sf", duplex: "duplex", townhouse_row: "townhouse_row" };
const STRATEGIES: score.StrategyId[] = ["new_sf", "duplex", "three_four_unit", "townhouse_row", "adu", "rehab_existing"];

/** The report query for the page's selection: every page key (pf_*, qf_*, checklist), the report's strategy name, and `sel` = the page's option. */
export function reportQueryFor(sp: SP, selected: score.StrategyId | null): string {
  const rq = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "" && k !== "strategy" && k !== "sel") rq.set(k, v);
  const rs = selected ? REPORT_STRATEGY[selected] : undefined;
  if (rs) rq.set("strategy", rs);
  if (selected) rq.set("sel", selected);
  if (typeof sp.pf_tenure === "string" && (sp.pf_tenure === "sale" || sp.pf_tenure === "rent")) rq.set("tenure", sp.pf_tenure);
  return rq.toString();
}

/** The page option a report URL stands for: `sel`, else the report's strategy name; null for "best". */
export function pageStrategyFromReport(sp: SP): score.StrategyId | null {
  const sel = typeof sp.sel === "string" ? sp.sel : null;
  if (sel && (STRATEGIES as string[]).includes(sel)) return sel as score.StrategyId;
  const s = typeof sp.strategy === "string" ? sp.strategy : "";
  return FROM_REPORT[s] ?? null;
}

/** The page's query the report query came from (for parcelPlan): `sel` back to `strategy`. */
export function pageQueryFromReport(sp: SP): SP {
  const out: SP = { ...sp };
  const st = pageStrategyFromReport(sp);
  if (st) out.strategy = st;
  return out;
}
