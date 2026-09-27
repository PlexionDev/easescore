import "server-only";

// Loads and computes everything the Feasibility Study shows. Pure computation after the fetches:
// the same database rows and the same query give the same numbers. The generated date is the only
// value that changes between runs (and it can be pinned with ?date=YYYY-MM-DD).

import {
  assumptions,
  evaluateRequirements,
  finance,
  quickfit,
  score as easeEngine,
  type ParcelFacts,
  type ProjectAnswers,
  type RequirementResult,
} from "@easescore/engine";
import { parcelFacts, quickfitInput, rentComps, salesComps } from "@/lib/data";
import { homeTapFees, newCompsFor, primeRate, readCostOverrides, singleFamilyComps } from "@/lib/proforma";
import { compArea } from "@/lib/pane-core";
import { loadEaseScore, type EaseScoreView } from "./score";
import { comparePlans, type PlanComparison } from "@/lib/summary";
import { buildSitePlanSheet, type SitePlanSheet } from "./sitesheet";
import { loadPane } from "@/lib/pane";
import { Timing } from "@/lib/timing";
import { pageQueryFromReport, pageStrategyFromReport, parcelPlan, type ParcelPlan } from "@/lib/parcel-plan";

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
  /** Site plan sheet EA-101 (true-scale SVG); null when the lot outline is not available. */
  sitePlan: SitePlanSheet | null;
  /** The parcel page's plan for the same URL (lib/parcel-plan.ts): when set, `scheme` and `proForma` are the page's. */
  pagePlan: Pick<ParcelPlan, "scheme" | "stepping" | "selected" | "pf"> & { strategy: string } | null;
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

export async function loadReport(parid: string, sp: SP): Promise<ReportModel | null> {
  // The heavier RPCs occasionally hit a statement timeout on a cold cache; one retry fixes it.
  const [factsRaw, salesRaw, rentRaw, qfRaw, easeRaw] = await Promise.all([
    retry(() => parcelFacts(parid)),
    retry(() => salesComps(parid)),
    retry(() => rentComps(parid)),
    retry(() => quickfitInput(parid)),
    retry(() => rpc<EaseInputs>("parcel_ease_inputs", { p_parid: parid })),
  ]);
  if (!factsRaw) return null;
  const facts = factsRaw as unknown as Facts;
  const zone = facts.zoning?.code ?? null;
  const pgh = !!facts.assessment?.is_pittsburgh;

  const [zba, tapFees, rentLimits] = await Promise.all([
    zone ? retry(() => rpc<ZbaRates>("zba_grant_rates", { p_district: zone })) : Promise.resolve(null),
    pgh
      ? select<TapFee>("utility_tap_fees?select=authority,service,fee_type,amount,unit,effective_date,source_url,confidence&authority=eq.Pittsburgh%20Water%20(PWSA)&order=service,fee_type")
      : Promise.resolve([] as TapFee[]),
    select<RentLimit>("affordable_rent_limits?select=source,year,ami_pct,bedrooms,max_rent,effective_date,source_url&source=eq.phfa_lihtc&bedrooms=lte.4&order=year.desc,ami_pct,bedrooms"),
  ]);

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
      qf = quickfit.solveQuickFit(base);
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
  const asOf0 = todayIso(sp);
  let pagePlan: ReportModel["pagePlan"] = null;
  try {
    const pageStrategy = pageStrategyFromReport(sp) ?? (scenario.strategy === "best" ? TYPOLOGY_STRATEGY[pickScheme(qf, "best")?.typology ?? ""] ?? null : null);
    const loaded = pageStrategy ? await loadPane(parid, asOf0, Promise.resolve(qfRaw), new Timing("report", parid)) : null;
    if (loaded?.ok && pageStrategy) {
      const psp = pageQueryFromReport(sp);
      const ov = { ...(str(sp, "tenure") ? { tenure: scenario.tenure } : {}), ...readCostOverrides(psp) };
      const pp = parcelPlan({ P: loaded.payload, sp: psp, overrides: ov, strategy: pageStrategy, qf: (qfRaw as never) ?? null });
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
  const perType: quickfit.Scheme[] = [];
  for (const s of qf?.ranked ?? []) {
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
  const requirements = evaluateRequirements(facts as unknown as ParcelFacts, project);

  const sales = (salesRaw as SalesPayload | null) ?? null;
  const rent = (rentRaw as RentPayload | null) ?? null;

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

  const score = loadEaseScore({
    facts: facts as unknown as ParcelFacts,
    quickfitInput: qfRaw,
    zbaRates: zba,
    easeInputs: easeRaw,
    typology: scheme?.typology ?? null,
    affordable: scenario.affordable,
  });

  // Pro forma: the cost config defaults, the pf_* edits, single-family comps, rents, the prime rate and
  // the published tap fees, through the same builder as the parcel page.
  const pfStrategy = TYPOLOGY_STRATEGY[(scheme ?? closest)?.typology ?? ""] ?? TYPOLOGY_STRATEGY[scenario.strategy] ?? "new_sf";
  const asOf = todayIso(sp);
  const [sfComps, prime, newComps] = await Promise.all([
    retry(() => singleFamilyComps(parid, sales as assumptions.SalesCompsLike | null)),
    primeRate(),
    newCompsFor(pfStrategy, parid, facts.centroid as { lat?: number; lon?: number } | null, asOf, compArea(facts)),
  ]);
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
  try {
    const raw = easeEngine.scoreParcel(facts as unknown as ParcelFacts, {
      quickfitInput: qfRaw as never,
      easeInputs: easeRaw as never,
      zba: zba as never,
      project: { affordableUnitsProposed: scenario.affordable },
    });
    const tapPerUnit = homeFees.length ? homeFees.reduce((t, x) => t + x.amount, 0) : null;
    plans = await comparePlans({
      parid, facts: facts as unknown as ParcelFacts & Record<string, unknown>, result: raw, zba, sfComps, sales, rent, prime,
      tapFeesPerUnit: tapPerUnit, overrides, asOf,
    });
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

  const sitePlan = await buildSitePlanSheet({
    parid, facts, qfInput, qf, qfError, rules, scheme, closest, frontInferred, generatedDate: todayIso(sp), score,
  }).catch(() => null);

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
    sitePlan,
    pagePlan,
  };
}
