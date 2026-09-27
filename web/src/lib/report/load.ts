import "server-only";

// Loads and computes everything the Feasibility Study shows. Pure computation after the fetches:
// the same database rows and the same query give the same numbers. The generated date is the only
// value that changes between runs (and it can be pinned with ?date=YYYY-MM-DD).

import {
  assumptions,
  evaluateRequirements,
  finance,
  narrative,
  quickfit,
  score as easeEngine,
  type ParcelFacts,
  type ProjectAnswers,
  type RequirementResult,
} from "@easescore/engine";
import type { rents as rentsEngine } from "@easescore/engine";
import { parcelMap, quickfitInput } from "@/lib/data";
import { homeTapFees, readCostOverrides } from "@/lib/proforma";
import { PANE_VERSION, type PanePayload } from "@/lib/pane-core";
import { loadEaseScore, type EaseScoreView } from "./score";
import { comparePlans, withSelected, type PlanComparison } from "@/lib/summary";
import { buildSitePlanSheet, type SitePlanSheet } from "./sitesheet";
import { loadPane, type PaneLoad } from "@/lib/pane";
import { loadRents } from "@/lib/rents";
import { Timing } from "@/lib/timing";
import { memo as memoCore, reportQueryKey, type Entry } from "./cache-core";
import { pageQueryFromReport, pageStrategyFromReport, parcelPlan, userBuildingPlan, type ParcelPlan } from "@/lib/parcel-plan";
import { DEFAULT_CONTROLS, QF2_TYPES, qf2Data, solveFor } from "@/lib/qf2/core";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return r.ok ? ((await r.json()) as T) : null;
}

async function retry<T>(fn: () => Promise<T | null>, attempts = 3): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn().catch(() => null);
    if (v !== null) return v;
  }
  return null;
}

async function select<T>(pathAndQuery: string): Promise<T[]> {
  const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: KEY }, cache: "no-store" });
  return r.ok ? ((await r.json()) as T[]) : [];
}

// ---------------------------------------------------------------------------------------------
// Shapes of the database payloads the report reads (only the fields it uses).

export interface SaleComp {
  parid: string;
  address: string | null;
  sale_date: string;
  price: number;
  price_per_sqft: number | null;
  living_area_sqft: number | null;
  lot_area_sqft: number | null;
  distance_mi: number;
}
export interface SalesPayload {
  status: string;
  sufficient?: boolean;
  count: number;
  radius_mi: number;
  years?: number;
  comparable_use: string;
  median_price: number | null;
  median_price_per_sqft: number | null;
  date_range?: { from: string | null; to: string | null };
  search_steps?: string[];
  fallback_note?: string | null;
  note?: string | null;
  rules?: string;
  source?: string;
  comps: SaleComp[];
}
export interface RentPayload {
  status?: string;
  zip?: string;
  note?: string | null;
  rules?: string;
  zori?: { zip: string; latest_rent: number; latest_month: string; rent_12m_ago: number | null; from: string; to: string; months: number; source: string } | null;
  hud_fmr?: { year: number; level: string; zip?: string; br0: number; br1: number; br2: number; br3: number; br4: number; source: string } | null;
  rentease?: { status: string; note?: string };
}
export interface QFInputPayload {
  parcel: [number, number][];
  frontEdges: number[];
  streetSideEdges: number[];
  masks: { label: string; mode: "cut" | "flag"; polygon: [number, number][][] }[];
  zbaCounts: quickfit.ZbaCountRow[];
  notes: (string | null)[];
  edges?: { i: number; len: number; az: number; street_ft: number }[];
  /** Affine from the local feet coordinates back to lon/lat (used by the site plan). */
  toLonLat?: { lat0: number; lon0: number; lat_per_x: number; lat_per_y: number; lon_per_x: number; lon_per_y: number };
}
export interface ZbaRates {
  district: string;
  rules: string;
  source: string;
  by_relief: Record<string, { granted: number; denied: number; decided: number; from: string | null; to: string | null }>;
}
export interface EaseInputs {
  env_sites: { on_parcel: number; adjacent_50ft: number; active_on_or_adjacent: number; rules: string; source: string };
  market: {
    sales_3y_half_mile: number;
    completed_permits_3y_half_mile: number | null;
    activity: number;
    percentile: number | null;
    scope: string;
    sample_n: number;
    as_of: string;
    rules: string;
    source: string;
  };
}
export interface TapFee {
  authority: string;
  service: string;
  fee_type: string;
  amount: number;
  unit: string;
  effective_date: string | null;
  source_url: string;
  confidence: string;
}
export interface RentLimit {
  source: string;
  year: number;
  ami_pct: number;
  bedrooms: number;
  max_rent: number;
  effective_date: string | null;
  source_url: string;
}

/** parcel_facts payload. Loosely typed on purpose: the RPC returns more fields than ParcelFacts lists. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Facts = Record<string, any> & { parid: string; overlays: ParcelFacts["overlays"] };

// ---------------------------------------------------------------------------------------------
// Scenario (what the report studies), read from the query string.

export type Strategy = "best" | "single_family" | "duplex" | "townhouse_row";
export interface Scenario {
  strategy: Strategy;
  goal: quickfit.Goal;
  tenure: "sale" | "rent";
  affordable: boolean;
  project: ProjectAnswers;
  /** Plain-language list of what differs from the defaults. */
  changes: string[];
}

export interface FigureImages {
  context?: string;
  terrain?: string;
  analysis?: string;
}

type SP = Record<string, string | string[] | undefined>;
const str = (sp: SP, k: string) => (typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined);

export function readScenario(sp: SP): Scenario {
  const changes: string[] = [];
  const s = (k: string) => str(sp, k);
  const n = (k: string) => (s(k) !== undefined && Number.isFinite(Number(s(k))) ? Number(s(k)) : undefined);
  const b = (k: string) => (s(k) === "yes" || s(k) === "1" ? true : s(k) === "no" || s(k) === "0" ? false : undefined);

  const strategy = (["single_family", "duplex", "townhouse_row"].includes(s("strategy") ?? "") ? s("strategy") : "best") as Strategy;
  if (strategy !== "best") changes.push(`Building type set to ${STRATEGY_LABEL[strategy].toLowerCase()}`);
  const goal = (s("goal") === "by_right_only" ? "by_right_only" : "most_units") as quickfit.Goal;
  if (goal === "by_right_only") changes.push("Only schemes allowed by right");
  const tenure = s("tenure") === "rent" ? "rent" : "sale";
  if (tenure === "rent") changes.push("Built to rent (not for sale)");
  const affordable = b("affordable") === true;
  if (affordable) changes.push("Affordable mode on");

  const type = (s("type") as ProjectAnswers["type"]) ?? "new_build";
  if (type !== "new_build") changes.push(`Project type: ${type.replace("_", " ")}`);
  const project: ProjectAnswers = {
    type,
    units: n("units"),
    stories: n("stories"),
    financed: b("financed"),
    party_wall: b("party_wall"),
    touches_street: b("touches_street"),
    new_driveway: b("new_driveway"),
    lot_split_or_merge: b("lot_split"),
    cut_fill_over_25: b("cut_fill"),
    minor_work: s("minor_work") as ProjectAnswers["minor_work"],
    tenure,
    affordable_financing: affordable || undefined,
  };
  for (const [k, label] of [["financed", "financed"], ["party_wall", "party wall"], ["touches_street", "work in the street"], ["new_driveway", "new driveway"], ["lot_split", "lot split or merge"], ["cut_fill", "cut/fill over 25%"]] as const) {
    const v = b(k);
    if (v !== undefined) changes.push(`${label[0]!.toUpperCase()}${label.slice(1)}: ${v ? "yes" : "no"}`);
  }
  if (project.units !== undefined) changes.push(`Units set to ${project.units}`);
  if (project.stories !== undefined) changes.push(`Stories set to ${project.stories}`);
  return { strategy, goal, tenure, affordable, project, changes };
}

/** Only same-origin paths or inline images are accepted as figure images (no remote fetches). */
export function readImages(sp: SP): FigureImages {
  const ok = (v: string | undefined) => (v && (/^\/(?!\/)/.test(v) || /^data:image\/(png|jpeg|webp);base64,/.test(v)) ? v : undefined);
  return { context: ok(str(sp, "img_context")), terrain: ok(str(sp, "img_terrain")), analysis: ok(str(sp, "img_analysis")) };
}

/** QuickFit typology (or the report's strategy) → the score engine's strategy id used by the cost builder. */
const TYPOLOGY_STRATEGY: Record<string, "new_sf" | "duplex" | "townhouse_row"> = {
  single_family: "new_sf",
  duplex: "duplex",
  townhouse_row: "townhouse_row",
};

export const STRATEGY_LABEL: Record<Strategy, string> = {
  best: "Best fit found by QuickFit",
  single_family: "Single-family house",
  duplex: "Duplex (two units, side by side)",
  townhouse_row: "Townhouse row",
};

// ---------------------------------------------------------------------------------------------

export interface UnlockRow {
  label: string;
  rule: quickfit.VarianceRule;
  from: number | null;
  to: number;
  deltaUnits: number;
  deltaGrossFloorAreaSf: number;
}

export interface ReportModel {
  parid: string;
  facts: Facts;
  sales: SalesPayload | null;
  rent: RentPayload | null;
  qfInput: QFInputPayload | null;
  /** Set when the front edge was inferred by the report (nearest edge to an opened street). */
  frontInferred: { edge: number; distFt: number; lenFt: number } | null;
  qf: quickfit.QuickFitResult | null;
  qfError: string | null;
  /** Merged rules the solver used. */
  rules: quickfit.QuickFitRules | null;
  scheme: quickfit.Scheme | null;
  /** When no scheme is allowed: the closest one the solver tried, to explain what blocks it. */
  closest: quickfit.Scheme | null;
  /** Best scheme per building type, for the comparison table. */
  perType: quickfit.Scheme[];
  unlocks: UnlockRow[];
  zba: ZbaRates | null;
  ease: EaseInputs | null;
  tapFees: TapFee[];
  rentLimits: RentLimit[];
  requirements: RequirementResult[];
  /** The one approvals record (use permission + zoning checks of the studied scheme) every section reads. */
  approvals: narrative.ApprovalsRecord;
  scenario: Scenario;
  score: EaseScoreView;
  forSale: finance.ForSaleProForma;
  rental: finance.RentalProForma;
  /** Cost builder + finance run for the studied scheme (same code as the parcel page). */
  proForma: assumptions.ProFormaResult;
  sensitivity: assumptions.SensitivityResult;
  /** Single-family comps used to price a finished home (null when unavailable). */
  sfComps: assumptions.SalesCompsLike | null;
  prime: { rate: number; date: string } | null;
  /** Sale price per unit used as a market reference (comps median $/sq ft × net sq ft per unit). */
  refSalePricePerUnit: number | null;
  /** Land reference from vacant-land comps (median $ per sq ft of lot × lot area), vacant lots only. */
  refLandValue: number | null;
  /** Monthly rent per unit used as a market reference (ZIP rent index). */
  refRentPerUnit: number | null;
  msiPer100k: finance.Receipt;
  generatedDate: string;
  images: FigureImages;
  /** Every housing option the Ease Score checked, by right vs with approval, each with its pro forma; null when scoring failed. */
  plans: PlanComparison | null;
  /** Affordable column: the by-right (else with-approval) building rented at the 60% AMI limit. */
  affordable: { option: string; ami: number; bedrooms: number; rent: number; year: number; pf: assumptions.ProFormaResult } | null;
  /** Tax abatement scenario inputs (defaults from the cost config, pf_abate_* overrides). */
  abatement: { share: number; years: number; edited: boolean };
  /** Investment criteria for the decision box (dc_* keys; defaults from engine/config/decision-criteria). */
  criteria: assumptions.InvestmentCriteria;
  /** Site plan sheet EA-101 (true-scale SVG); null when the lot outline is not available. */
  sitePlan: SitePlanSheet | null;
  /** The parcel page's plan for the same URL (lib/parcel-plan.ts): when set, `scheme` and `proForma` are the page's. */
  pagePlan: Pick<ParcelPlan, "scheme" | "stepping" | "selected" | "pf"> & { strategy: string } | null;
  /** Zoning not loaded here: the study prices the building the user entered (ub_* keys); zoning never checked for it. */
  userBuilding: easeEngine.UserBuilding | null;
  /** Rents by bedroom (RentCast ZIP market statistics from the cache — the report never calls RentCast; HUD SAFMR fallback). */
  rentsByBedroom: rentsEngine.RentsByBedroom | null;
  /** Where the parcel data came from: the precomputed pane row, or computed now (and stored for next time). */
  paneSource: "row" | "live";
  /** "Best options for this lot", ranked as on the parcel page (ease and money kept separate); null when scoring failed. */
  options: easeEngine.OptionRow[] | null;
  /** The block's existing pattern and the contextual front setback (City parcels); null when not measured. */
  precedent: easeEngine.StreetPrecedent | null;
}

/** Policy what-ifs for "What would unlock it". Each relaxes one rule; values are hypotheticals, not proposals. */
const UNLOCK_TOGGLES: { rule: quickfit.VarianceRule; value: number; label: string }[] = [
  { rule: "parking_per_unit", value: 0, label: "No parking minimum" },
  { rule: "min_lot_area", value: 0, label: "No minimum lot size" },
  { rule: "min_lot_area_per_unit", value: 0, label: "No minimum lot area per unit" },
];

function pickScheme(qf: quickfit.QuickFitResult | null, strategy: Strategy): quickfit.Scheme | null {
  if (!qf) return null;
  const pool = qf.ranked.length ? qf.ranked : [];
  if (strategy === "best") return pool[0] ?? null;
  return pool.find((s) => s.typology === strategy) ?? null;
}

export function todayIso(sp: SP): string {
  const d = str(sp, "date");
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Caches (per server process). The pane is shared by the report's first section (loadReportHead) and the
// full model; the model is shared by the HTML page and the PDF renderer (which prints that page).

// Short in development, where the code behind the numbers changes between requests.
const TTL_MS = process.env.NODE_ENV === "production" ? 10 * 60_000 : 60_000;
const MAX_ENTRIES = 40;
const memo = <T,>(map: Map<string, Entry<T>>, key: string, make: () => Promise<T>, keep: (v: T) => boolean) => memoCore(map, key, make, keep, TTL_MS, MAX_ENTRIES);

// On globalThis: the PDF route and the report page are separate server bundles in one process, and
// both read the same parcel (the route checks it exists, then prints the page).
type Caches = {
  pane: Map<string, Entry<PaneLoad>>;
  model: Map<string, Entry<ReportModel | null>>;
  ease: Map<string, Entry<EaseInputs | null>>;
  qf: Map<string, Entry<unknown>>;
  map: Map<string, Entry<unknown>>;
};
const G = globalThis as { __easescoreReport?: Caches };
const C: Caches = (G.__easescoreReport ??= { pane: new Map(), model: new Map(), ease: new Map(), qf: new Map(), map: new Map() });
const paneCache = C.pane;
const modelCache = C.model;
const easeCache = C.ease;
const qfCache = C.qf;
const mapCache = C.map;

/** parcel_quickfit_input and parcel_map: read once per parcel for the first look, the HTML model and the PDF's model. */
const quickfitFor = (parid: string) => memo(qfCache, parid, () => retry(() => quickfitInput(parid)), (v) => v !== null);
const mapFor = (parid: string) => memo(mapCache, parid, () => parcelMap(parid).catch(() => null), (v) => v !== null);

/** parcel_ease_inputs, shared by the live pane (when there is no row) and the report's own reads. */
const easeFor = (parid: string) => memo(easeCache, parid, () => retry(() => rpc<EaseInputs>("parcel_ease_inputs", { p_parid: parid })), (v) => v !== null);

/**
 * The parcel pane (same data as the parcel page): the precomputed row, or computed once now and written
 * as the row (lib/pane.ts, same buildPane as scripts/pane_all.ts) so the next request reads one row.
 */
export function reportPane(parid: string, asOf: string, quickfit: Promise<unknown>, T: Timing): Promise<PaneLoad> {
  return memo(paneCache, `${parid}|${PANE_VERSION}`, () => loadPane(parid, asOf, quickfit, T, { save: true, easeInputs: easeFor(parid) }), (v) => v.ok);
}

const queryKey = (sp: SP) => reportQueryKey(sp, todayIso({}));

export interface ReportHead {
  parid: string;
  address: string | null;
  neighborhood: string | null;
  municipality: string | null;
  zoning: string | null;
  lotAreaSf: number | null;
  best: { label: string; score: number | null; band: string | null } | null;
  summary: string[];
  paneSource: "row" | "live";
}

/**
 * The parcel page's best option from one plan comparison (the pane's ranking): the easiest option that is
 * allowed and fits, never a renovation. The study opens on it when the URL names no option.
 */
function paneBestOf(res: easeEngine.EaseScoreResult, pc: PlanComparison | null): easeEngine.StrategyId | null {
  const rows = easeEngine.rankOptions(res, Object.fromEntries(res.strategies.map((x) => {
    const pf = pc?.options.find((q) => q.strategy === x.strategy)?.pf;
    const fit = (x.factors.find((q) => q.id === "F1")?.inputs as { fitStatus?: string } | undefined)?.fitStatus;
    const rehab = x.strategy === "rehab_existing";
    const v: easeEngine.PencilState = pf ? (pf.plan.missing.length ? (rehab ? "none" : "unknown") : pf.verdict ?? "unknown") : fit === "no_fit" || rehab ? "none" : "unknown";
    return [x.strategy, v];
  })));
  return (rows.find((r) => r.evaluable) ?? rows.find((r) => r.applicable && r.strategy !== "rehab_existing"))?.strategy ?? null;
}

/**
 * The report's first section, from the pane alone (one row read for a precomputed parcel): address,
 * best option, and the two-sentence summary. Shown while the full study streams in. null = no such parcel.
 */
export async function loadReportHead(parid: string, sp: SP): Promise<ReportHead | null> {
  const T = new Timing("report_head", parid);
  const loaded = await reportPane(parid, todayIso(sp), quickfitFor(parid), T);
  if (!loaded.ok) return null;
  const P = loaded.payload;
  const f = P.facts as Facts;
  const res = P.score;
  let bestId = res?.best ?? null;
  let summary: string[] = [];
  if (res) {
    try {
      const plans = await comparePlans({
        parid, facts: f as unknown as ParcelFacts & Record<string, unknown>, result: res, zba: P.zba, sfComps: P.sfComps, sales: P.sales, rent: P.rent, prime: P.prime,
        tapFeesPerUnit: P.tapFees, overrides: readCostOverrides(sp), asOf: todayIso(sp), precomputed: { newComps: P.newComps, rehabComps: P.rehabComps },
      });
      bestId = paneBestOf(res, plans) ?? bestId;
      // Sentence 1 describes the parcel page's best option (the option the study opens on).
      const led = bestId && bestId !== plans.byRight?.strategy ? withSelected(plans, bestId, plans.options.find((o) => o.strategy === bestId)?.pf ?? null, true) : plans;
      summary = [...led.summary.sentences];
    } catch {
      summary = [];
    }
  }
  const best = res ? res.strategies.find((x) => x.strategy === bestId) ?? null : null;
  return {
    parid,
    address: (f.assessment?.address as string | undefined) ?? null,
    neighborhood: (f.context?.neighborhood as string | undefined) ?? null,
    municipality: (f.context?.municipality ?? f.assessment?.municipality ?? null) as string | null,
    zoning: f.zoning?.code ?? null,
    lotAreaSf: (f.lot_area_sqft_gis as number | undefined) ?? f.assessment?.lot_area_sqft ?? null,
    best: best && easeEngine.zoningLoaded(f) ? { label: best.strategyLabel, score: best.score, band: best.band } : null,
    summary,
    paneSource: loaded.source,
  };
}

/** Everything the Feasibility Study shows, cached per parcel + query for 10 minutes (HTML view, then PDF). */
export function loadReport(parid: string, sp: SP): Promise<ReportModel | null> {
  if (str(sp, "fresh") === "1") return buildReport(parid, sp);
  return memo(modelCache, `${parid}|${PANE_VERSION}|${queryKey(sp)}`, () => buildReport(parid, sp), (v) => v !== null);
}

async function buildReport(parid: string, sp: SP): Promise<ReportModel | null> {
  const T = new Timing("report", parid);
  const asOf0 = todayIso(sp);
  // Reads that are not in the pane start now, in parallel with it: the lot geometry (solver, site plan),
  // the map layers (site plan), the Ease Score inputs (market activity, contamination), fees and rent limits.
  const qfP = T.time("rpc_quickfit_input", quickfitFor(parid));
  const mapP = T.time("rpc_parcel_map", mapFor(parid));
  const easeP = T.time("rpc_ease_inputs", easeFor(parid));
  const rentLimitsP = T.time("rest_rent_limits", select<RentLimit>("affordable_rent_limits?select=source,year,ami_pct,bedrooms,max_rent,effective_date,source_url&source=eq.phfa_lihtc&bedrooms=lte.4&order=year.desc,ami_pct,bedrooms"));
  const loaded = await T.time("pane", reportPane(parid, asOf0, qfP, T));
  if (!loaded.ok) return null;
  const P: PanePayload = loaded.payload;
  const facts = P.facts as Facts;
  const zone = facts.zoning?.code ?? null;
  const pgh = !!facts.assessment?.is_pittsburgh;
  const rentsP = T.time("rents", loadRents(parid, asOf0, undefined, { facts: P.facts, rent: P.rent }).catch(() => null));

  const [qfRaw, easeRaw, tapFees, rentLimits] = await Promise.all([
    qfP,
    easeP,
    pgh
      ? T.time("rest_tap_fees", select<TapFee>("utility_tap_fees?select=authority,service,fee_type,amount,unit,effective_date,source_url,confidence&authority=eq.Pittsburgh%20Water%20(PWSA)&order=service,fee_type"))
      : Promise.resolve([] as TapFee[]),
    rentLimitsP,
  ]);
  const zba = (zone ? P.zba : null) as ZbaRates | null;

  const scenario = readScenario(sp);
  let qfInput = (qfRaw as QFInputPayload | null) ?? null;
  // The parcel facts find a street within 20 m, but the solver's frontage rule is stricter (a centerline
  // within 45 ft of an edge). When they disagree, use the edge nearest the street and say so in the report.
  let frontInferred: ReportModel["frontInferred"] = null;
  if (qfInput && !qfInput.frontEdges.length && facts.street_frontage === "street" && qfInput.edges?.length) {
    const near = qfInput.edges
      .filter((e) => typeof e.street_ft === "number" && e.len >= 8)
      .sort((a, b) => a.street_ft - b.street_ft || b.len - a.len)[0];
    if (near) {
      qfInput = { ...qfInput, frontEdges: [near.i] };
      frontInferred = { edge: near.i, distFt: near.street_ft, lenFt: near.len };
    }
  }
  const zoningRules = (facts.zoning?.rules ?? null) as quickfit.QuickFitRules | null;
  const rules = zoningRules && zone ? { ...zoningRules, ...quickfit.attachedRulesForDistrict(zone) } : null;

  let qf: quickfit.QuickFitResult | null = null;
  let qfError: string | null = null;
  let unlockRes: quickfit.QuickFitResult | null = null;
  if (!rules) qfError = "Zoning rules for this district are not loaded (they are loaded for the City of Pittsburgh only).";
  else if (!qfInput || !qfInput.parcel?.length) qfError = "The lot outline could not be prepared for the site-fit solver.";
  else if (!qfInput.frontEdges.length) qfError = "No street frontage was found next to the lot, so the site-fit solver cannot orient a building.";
  else {
    const base: quickfit.QuickFitInput = {
      parcel: qfInput.parcel,
      frontEdges: qfInput.frontEdges,
      streetSideEdges: qfInput.streetSideEdges,
      rules,
      masks: qfInput.masks,
      zbaCounts: qfInput.zbaCounts,
      goal: scenario.goal,
    };
    try {
      qf = T.timeSync("quickfit_solve", () => quickfit.solveQuickFit(base));
      unlockRes = quickfit.solveQuickFit({
        ...base,
        goal: "most_units",
        variances: UNLOCK_TOGGLES.map((t) => ({ rule: t.rule, value: t.value })),
      });
    } catch (e) {
      qfError = `The site-fit solver could not run: ${String(e instanceof Error ? e.message : e)}`;
    }
  }

  // The parcel page's plan for this URL (same pane, same scheme, same stepping and budget lines): the report
  // studies that building whenever the page priced one; otherwise it falls back to its own pick.
  let pagePlan: ReportModel["pagePlan"] = null;
  // Best scheme per building type from QuickFit v2 (the same solver and controls as the page).
  let v2PerType: quickfit.Scheme[] | null = null;
  try {
    const qd = qf2Data({ parid, qf: qfRaw, facts, terrain: P.terrain, zba: P.zba });
    if (qd) {
      const defaults = P.qf2Defaults ?? {};
      v2PerType = QF2_TYPES.filter((t) => t.id !== "adu").map((t) => solveFor(qd, { ...DEFAULT_CONTROLS(t.id), ...(defaults[t.strategy] ?? {}) })?.v1 ?? null).filter((x): x is quickfit.Scheme => !!x);
    }
  } catch {
    v2PerType = null;
  }
  // Zoning not loaded: the building the user entered on the page (same ub_* keys, same pricing as the page's Pro forma).
  const ubPlan = (() => {
    try {
      const psp = pageQueryFromReport(sp);
      return userBuildingPlan({ P, sp: psp, overrides: { ...(str(sp, "tenure") ? { tenure: scenario.tenure } : {}), ...readCostOverrides(psp) } });
    } catch {
      return null;
    }
  })();
  // No option in the URL (the Developer seat's link, a bare /api/report/<id>): study the parcel page's best option.
  let paneBestId: easeEngine.StrategyId | null = null;
  if (!ubPlan?.pf && !pageStrategyFromReport(sp) && scenario.strategy === "best" && P.score) {
    try {
      paneBestId = paneBestOf(P.score, await T.time("compare_plans_best", comparePlans({
        parid, facts: P.facts as unknown as ParcelFacts & Record<string, unknown>, result: P.score, zba: P.zba, sfComps: P.sfComps, sales: P.sales, rent: P.rent, prime: P.prime,
        tapFeesPerUnit: P.tapFees, overrides: readCostOverrides(pageQueryFromReport(sp)), asOf: todayIso(sp), precomputed: { newComps: P.newComps, rehabComps: P.rehabComps },
      })));
    } catch {
      paneBestId = null;
    }
  }
  if (ubPlan?.pf) pagePlan = { strategy: ubPlan.strategy, scheme: null, stepping: null, selected: ubPlan.selected, pf: ubPlan.pf };
  else try {
    const pageStrategy = pageStrategyFromReport(sp) ?? paneBestId ?? (scenario.strategy === "best" ? TYPOLOGY_STRATEGY[pickScheme(qf, "best")?.typology ?? ""] ?? null : null);
    if (pageStrategy) {
      const psp = pageQueryFromReport(sp);
      const ov = { ...(str(sp, "tenure") ? { tenure: scenario.tenure } : {}), ...readCostOverrides(psp) };
      const pp = T.timeSync("page_plan", () => parcelPlan({ P, sp: psp, overrides: ov, strategy: pageStrategy, qf: (qfRaw as never) ?? null }));
      if (pp.pf && pp.scheme) pagePlan = { strategy: pageStrategy, scheme: pp.scheme, stepping: pp.stepping, selected: pp.selected, pf: pp.pf };
    }
  } catch {
    pagePlan = null;
  }
  const scheme = pagePlan ? pagePlan.scheme : pickScheme(qf, scenario.strategy);
  // When nothing is allowed, keep the closest scheme (fewest approvals, then most units) to explain why.
  const closest =
    !scheme && qf?.all.length
      ? [...qf.all].sort((a, b) => a.approvals.length - b.approvals.length || b.units - a.units || a.id.localeCompare(b.id))[0] ?? null
      : null;
  const perType: quickfit.Scheme[] = v2PerType ?? [];
  if (!v2PerType) for (const s of qf?.ranked ?? []) {
    if (!perType.some((t) => t.typology === s.typology)) perType.push(s);
  }
  const unlocks: UnlockRow[] = (unlockRes?.variance?.perToggle ?? []).map((d) => ({
    label: UNLOCK_TOGGLES.find((t) => t.rule === d.rule)?.label ?? d.rule,
    rule: d.rule,
    from: d.from,
    to: d.to,
    deltaUnits: d.deltaUnits,
    deltaGrossFloorAreaSf: d.deltaGrossFloorAreaSf,
  }));

  const project: ProjectAnswers = {
    ...scenario.project,
    units: scenario.project.units ?? scheme?.units,
    stories: scenario.project.stories ?? scheme?.stories,
  };
  scenario.project = project;
  const studied = scheme ?? closest;
  const approvals = narrative.buildApprovalsRecord({
    zoningLoaded: easeEngine.zoningLoaded(facts as unknown as ParcelFacts) && !ubPlan?.pf,
    municipality: facts.assessment?.municipality ?? null,
    district: facts.zoning?.code ?? null,
    rulesCitation: facts.zoning?.rules?.citation?.split(";")[0]?.trim() || null,
    scheme: studied,
    closest: !scheme && !!closest,
  });
  const requirements = narrative.reconcileRequirements(evaluateRequirements(facts as unknown as ParcelFacts, project), approvals);

  const sales = (P.sales as SalesPayload | null) ?? null;
  const rent = (P.rent as RentPayload | null) ?? null;

  // Market references (clearly labeled in the report). Never a price opinion.
  const nsfPerUnit = scheme && scheme.units > 0 ? scheme.netFloorAreaSf / scheme.units : null;
  const refSalePricePerUnit =
    sales?.status === "ok" && sales.sufficient !== false && sales.comparable_use !== "vacant land" && sales.median_price_per_sqft && nsfPerUnit
      ? Math.round((sales.median_price_per_sqft * nsfPerUnit) / 1000) * 1000
      : null;
  // For a vacant lot the comps are vacant-land sales: a land reference (median $ per sq ft of lot × lot area).
  const lotSf = (facts.lot_area_sqft_gis as number | undefined) ?? facts.assessment?.lot_area_sqft ?? null;
  const refLandValue =
    sales?.status === "ok" && sales.sufficient !== false && sales.comparable_use === "vacant land" && sales.median_price_per_sqft && lotSf
      ? Math.round((sales.median_price_per_sqft * lotSf) / 1000) * 1000
      : null;
  const refRentPerUnit = rent?.zori?.latest_rent ? Math.round(rent.zori.latest_rent) : null;

  const msiPer100k = finance.msiAnnualPremium(100_000);

  // The page's scored result (pane) unless affordable mode changes the scoring inputs.
  const paneScore = scenario.affordable ? null : P.score;
  const score = T.timeSync("ease_score", () => loadEaseScore({
    facts: facts as unknown as ParcelFacts,
    quickfitInput: qfRaw,
    zbaRates: zba,
    easeInputs: easeRaw,
    typology: scheme?.typology ?? null,
    affordable: scenario.affordable,
    result: paneScore,
  }));

  // Pro forma: the cost config defaults, the pf_* edits, single-family comps, rents, the prime rate and
  // the published tap fees, through the same builder as the parcel page.
  const pfStrategy = TYPOLOGY_STRATEGY[(scheme ?? closest)?.typology ?? ""] ?? TYPOLOGY_STRATEGY[scenario.strategy] ?? "new_sf";
  const asOf = todayIso(sp);
  // Comps and the prime rate come from the pane (the page's own).
  const sfComps = P.sfComps;
  const prime = P.prime;
  const newComps = P.newComps[pfStrategy] ?? null;
  const homeFees = homeTapFees(tapFees);
  const overrides = readCostOverrides(sp);
  const plan = assumptions.buildDevelopmentInputs({
    strategy: pfStrategy,
    facts: facts as assumptions.ProFormaFacts,
    // When nothing fits by right, price the closest layout (it needs approvals; Section 4 says which).
    scheme: scheme ?? (closest ? { ...closest, typologyLabel: `${closest.typologyLabel}, closest layout, needs approvals` } : null),
    comps: sfComps,
    newComps,
    rents: rent as assumptions.RentCompsLike | null,
    primeRate: prime?.rate ?? null,
    primeRateDate: prime?.date ?? null,
    permitMonths: score.status === "ready" ? score.permit?.months ?? null : null,
    tapFeesPerUnit: homeFees.length ? homeFees.reduce((t, x) => t + x.amount, 0) : null,
    overrides: { tenure: scenario.tenure, ...overrides },
  });
  // The page's pro forma when it priced this option (identical budget lines, stepping and ranges).
  const proForma = pagePlan?.pf ?? assumptions.evaluateDevelopment(plan);
  const sensitivity = assumptions.sensitivity(proForma.plan);

  // Product-type comparison and the two-sentence summary: same engine run as the parcel page.
  let plans: PlanComparison | null = null;
  let affordable: ReportModel["affordable"] = null;
  let options: easeEngine.OptionRow[] | null = null;
  try {
    const raw = paneScore ?? T.timeSync("score_affordable", () => easeEngine.scoreParcel(facts as unknown as ParcelFacts, {
      quickfitInput: qfRaw as never,
      easeInputs: easeRaw as never,
      zba: zba as never,
      project: { affordableUnitsProposed: scenario.affordable },
    }));
    const tapPerUnit = homeFees.length ? homeFees.reduce((t, x) => t + x.amount, 0) : null;
    const cmp = await T.time("compare_plans", comparePlans({
      parid, facts: facts as unknown as ParcelFacts & Record<string, unknown>, result: raw, zba, sfComps, sales, rent, prime,
      tapFeesPerUnit: tapPerUnit, overrides, asOf, precomputed: { newComps: P.newComps, rehabComps: P.rehabComps },
    }));
    // The summary's first sentence describes the studied option (the page's best option or the visitor's pick).
    plans = pagePlan && !ubPlan?.pf && cmp.byRight?.strategy !== pagePlan.strategy ? withSelected(cmp, pagePlan.strategy as easeEngine.StrategyId, pagePlan.pf, true) : cmp;
    // Same ranking as the parcel page: the pro forma's verdict per option (the page's own for the studied one).
    const pc = plans;
    const verdictOf = (x: assumptions.ProFormaResult | null | undefined, rehab: boolean): easeEngine.PencilState =>
      !x ? (rehab ? "none" : "unknown") : x.plan.missing.length ? (rehab && x.plan.missing.some((t) => /rehab budget/i.test(t)) ? "none" : "unknown") : x.verdict ?? "unknown";
    options = easeEngine.rankOptions(raw, Object.fromEntries(raw.strategies.map((x) => {
      const pf = pagePlan && pagePlan.strategy === x.strategy && !ubPlan?.pf ? pagePlan.pf : pc.options.find((q) => q.strategy === x.strategy)?.pf;
      const fit = (x.factors.find((q) => q.id === "F1")?.inputs as { fitStatus?: string } | undefined)?.fitStatus;
      return [x.strategy, pf ? verdictOf(pf, x.strategy === "rehab_existing") : fit === "no_fit" ? "none" : verdictOf(null, x.strategy === "rehab_existing")];
    })));
    const base = plans.byRight ?? plans.withApproval;
    const ami = 60;
    const bedrooms = base && (base.units ?? 1) > 1 ? 2 : 3;
    const lim = rentLimits.find((r) => r.ami_pct === ami && r.bedrooms === bedrooms);
    if (base && lim) {
      const sPlan = assumptions.buildDevelopmentInputs({
        strategy: base.strategy,
        facts: facts as assumptions.ProFormaFacts,
        scheme: raw.schemes?.[base.strategy] ?? null,
        comps: sfComps,
        newComps: null,
        rents: rent as assumptions.RentCompsLike | null,
        primeRate: prime?.rate ?? null,
        primeRateDate: prime?.date ?? null,
        permitMonths: raw.strategies.find((x) => x.strategy === base.strategy)?.predictedMonthsToPermit?.months ?? null,
        tapFeesPerUnit: tapPerUnit,
        overrides: { tier: overrides.tier, land: overrides.land, tenure: "rent", rentPerUnit: lim.max_rent },
      });
      affordable = { option: base.phrase, ami, bedrooms, rent: lim.max_rent, year: lim.year, pf: assumptions.evaluateDevelopment(sPlan) };
    }
  } catch {
    plans = null;
  }
  const abateCfg = assumptions.COST_CONFIG.taxAbatement;
  const ap = Number(str(sp, "pf_abate_pct")), ay = Number(str(sp, "pf_abate_years"));
  const abatement = {
    share: Number.isFinite(ap) && ap >= 0 && ap <= 100 && str(sp, "pf_abate_pct") ? ap / 100 : abateCfg.abatedShare.value,
    years: Number.isFinite(ay) && ay > 0 && ay <= 30 && str(sp, "pf_abate_years") ? Math.round(ay) : abateCfg.years.value,
    edited: !!(str(sp, "pf_abate_pct") || str(sp, "pf_abate_years")),
  };

  const [sitePlan, rentsByBedroom] = await Promise.all([
    T.time("site_plan", buildSitePlanSheet({
      parid, facts, qfInput, qf, qfError, rules, scheme, closest, frontInferred, generatedDate: todayIso(sp), score,
    }, mapP).catch(() => null)),
    rentsP,
  ]);
  T.add("total", T.total());

  return {
    parid,
    facts,
    sales,
    rent,
    qfInput,
    frontInferred,
    qf,
    qfError,
    rules,
    scheme,
    closest,
    perType,
    unlocks,
    zba,
    ease: easeRaw,
    tapFees,
    rentLimits: rentLimits.filter((r) => r.year === rentLimits[0]?.year),
    requirements,
    approvals,
    scenario,
    score,
    forSale: proForma.forSale,
    rental: proForma.rental,
    proForma,
    sensitivity,
    sfComps,
    prime,
    refSalePricePerUnit,
    refLandValue,
    refRentPerUnit,
    msiPer100k,
    generatedDate: todayIso(sp),
    images: readImages(sp),
    plans,
    affordable,
    abatement,
    criteria: assumptions.criteriaFromQuery(sp),
    sitePlan,
    pagePlan,
    rentsByBedroom,
    userBuilding: ubPlan?.pf ? ubPlan.building : null,
    paneSource: loaded.source,
    options,
    precedent: P.precedent ?? null,
  };
}
