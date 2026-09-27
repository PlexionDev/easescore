// The priced plan for one parcel and option, shared by the parcel page and the Feasibility Study
// (lib/report/load.ts), so the same URL gives the same scheme, stepping, budget lines and metrics in
// both: the score's QuickFit v2 scheme, or the QuickFit v2 scheme for the map controls (qf_*) in the
// URL (lib/qf2/core.ts, the same solve the browser worker runs), priced through lib/quickfit-gen.ts
// financeFor (selectScheme -> buildDevelopmentInputs -> evaluateDevelopment) with the pane's comps,
// rents, rates and lidar grid. Pure: no I/O.

import { assumptions, quickfit, score, type ParcelFacts } from "@easescore/engine";
import { compArea, type PanePayload } from "./pane-core";
import { financeFor, proFormaFacts, type FinanceInputs, type SteppingResult } from "./quickfit-gen";
import {
  DEFAULT_CONTROLS, QF2_TYPES, controlsFromQuery, qf2Data, solveFor, typologyForStrategy,
  type AppControls, type Qf2Data, type Ring, type Scheme, type Typology,
} from "./qf2/core";

type SP = Record<string, string | string[] | undefined>;

export interface ParcelPlan {
  fin: FinanceInputs;
  isCity: boolean;
  rulesRow: quickfit.QuickFitRules | null;
  genTyp: Typology | null;
  /** The map controls from the URL for this option's building type (null = its priced layout). */
  urlControls: AppControls | null;
  /** Per building type: the controls that reproduce its priced scheme (QuickFit v2). */
  genDefaults: Record<Typology, AppControls>;
  /** The solver's data for this parcel (the browser worker gets the same), null without a lot outline. */
  qf2: Qf2Data | null;
  /** The QuickFit v2 scheme behind the priced plan (null for rehab or when nothing fits). */
  v2: Scheme | null;
  scheme: quickfit.Scheme | null;
  stepping: SteppingResult | null;
  selected: score.SelectedScheme | null;
  pf: assumptions.ProFormaResult | null;
}

/** True when pricing this option needs the lot geometry: every new build (its scheme and hillside stepping come from QuickFit v2). */
export function planNeedsLot(_sp: SP, strategy: score.StrategyId | null | undefined): boolean {
  return !!typologyForStrategy(strategy);
}

export function parcelPlan(a: { P: PanePayload; sp: SP; overrides: assumptions.CostOverrides; strategy: score.StrategyId | null; qf: unknown; existing?: Ring[] }): ParcelPlan {
  const { P, sp } = a;
  const f = P.facts as unknown as ParcelFacts & Record<string, unknown>;
  const ease = P.score;
  const isCity = score.isCityParcel(f);
  const rulesRow = isCity ? ((f.zoning as { rules?: quickfit.QuickFitRules | null } | undefined)?.rules ?? null) : null;
  const fin: FinanceInputs = {
    facts: { ...proFormaFacts(f), owner_class: P.owner?.owner_class ?? null, area: compArea(f) }, sfComps: P.sfComps, newComps: P.newComps, rehabComps: P.rehabComps,
    rents: P.rent as FinanceInputs["rents"], prime: P.prime, tapFees: P.tapFees,
    permitMonths: Object.fromEntries((ease?.strategies ?? []).map((x) => [x.strategy, x.predictedMonthsToPermit?.months ?? null])),
    overrides: a.overrides,
    results: Object.fromEntries((ease?.strategies ?? []).map((x) => [x.strategy, { schemeId: x.schemeId ?? null, f1: (x.factors.find((q) => q.id === "F1")?.inputs ?? null) as Record<string, unknown> | null }])),
  };
  const genDefaults = Object.fromEntries(QF2_TYPES.map((t) => [t.id, { ...DEFAULT_CONTROLS(t.id), ...(P.qf2Defaults?.[t.strategy] ?? {}) }])) as Record<Typology, AppControls>;
  const genTyp = typologyForStrategy(a.strategy);
  const urlControls = genTyp ? controlsFromQuery(sp, genTyp) : null;
  const sr = a.strategy ? ease?.strategies.find((x) => x.strategy === a.strategy) ?? null : null;
  const qf2 = qf2Data({ parid: P.parid, qf: a.qf, facts: f, terrain: P.terrain, zba: P.zba, existing: a.existing });
  let scheme: quickfit.Scheme | null = a.strategy ? ease?.schemes?.[a.strategy] ?? null : null;
  let stepping: SteppingResult | null = null;
  let v2: Scheme | null = null;
  if (genTyp && qf2) {
    // The URL's controls, else the ones behind the score's scheme: the same solve the browser runs.
    const r = solveFor(qf2, urlControls ?? genDefaults[genTyp]);
    if (r) {
      v2 = r.scheme;
      stepping = r.stepping;
      if (urlControls || !scheme || (r.v1 && r.v1.id === scheme.id)) scheme = r.v1;
    }
  }
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
  return { fin, isCity, rulesRow, genTyp, urlControls, genDefaults, qf2, v2, scheme, stepping, selected, pf };
}

/** The pro forma on the building the user entered (only where zoning is not loaded). */
export interface UserBuildingPlan {
  building: score.UserBuilding;
  strategy: score.StrategyId;
  fin: FinanceInputs;
  /** Size-only scheme (score.userBuildingScheme): no site-fit layout, footprint or stepping. */
  scheme: quickfit.Scheme;
  selected: score.SelectedScheme | null;
  pf: assumptions.ProFormaResult | null;
}

/**
 * Where zoning is not loaded (score.zoningLoaded false: outside the City, or no district rules): the same
 * pro forma (financeFor: selectScheme -> buildDevelopmentInputs -> evaluateDevelopment, same comps, rents,
 * taxes and transfer tax) on the building the user entered (ub_* keys; default one 1,800 sq ft house).
 * No zoning path, no stepping; QuickFit stays off. Returns null where zoning is loaded.
 */
export function userBuildingPlan(a: { P: PanePayload; sp: SP; overrides: assumptions.CostOverrides }): UserBuildingPlan | null {
  const f = a.P.facts as unknown as ParcelFacts & Record<string, unknown>;
  if (score.zoningLoaded(f)) return null;
  const ease = a.P.score;
  const building = score.readUserBuilding(a.sp);
  const strategy = score.userBuildingStrategy(building);
  const fin: FinanceInputs = {
    facts: { ...proFormaFacts(f), owner_class: a.P.owner?.owner_class ?? null, area: compArea(f) }, sfComps: a.P.sfComps, newComps: a.P.newComps, rehabComps: a.P.rehabComps,
    rents: a.P.rent as FinanceInputs["rents"], prime: a.P.prime, tapFees: a.P.tapFees,
    permitMonths: Object.fromEntries((ease?.strategies ?? []).map((x) => [x.strategy, x.predictedMonthsToPermit?.months ?? null])),
    overrides: a.overrides,
    // No score fit describes the building you entered: no zoning path goes into its pro forma.
    results: {},
  };
  const scheme = score.userBuildingScheme(building) as unknown as quickfit.Scheme;
  try {
    const out = financeFor(fin, strategy, scheme, null);
    return { building, strategy, fin, scheme, selected: out.selected, pf: out.pf };
  } catch {
    return { building, strategy, fin, scheme, selected: null, pf: null };
  }
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
