import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assumptions, evaluateRequirements, narrative, PHASE_ORDER, score, type ParcelFacts, type ProjectAnswers, type RequirementResult } from "@easescore/engine";
import { parcelExists, parcelMap, quickfitInput } from "@/lib/data";
import { readCostOverrides } from "@/lib/proforma";
import { loadPane } from "@/lib/pane";
import { comparePlans, withSelected, type PlanComparison } from "@/lib/summary";
import { titleCase } from "@/lib/report/assess";
import { Callouts, DetailsContent, FactorBars, PartialBlock, ScoreBlock, hazardWords, scoreSentence } from "./EaseScorePanel";
import BestOptions from "./BestOptions";
import StreetPrecedent from "./StreetPrecedent";
import ProFormaPanel, { AssumptionsForm } from "./ProFormaPanel";
import ParcelShell from "./ParcelShell";
import { overlayLabel } from "@/lib/report/describe";
import PanePhoto from "./PanePhoto";
import SiteThumb from "./SiteThumb";
import CopyParcelId from "./CopyParcelId";
import SummaryText from "./SummaryText";
import RentReceipt from "./RentReceipt";
import DownloadReport from "./report/DownloadReport";
import { Timing } from "@/lib/timing";
import { OpenDrawer, OpenView } from "./Drawers";
import { metricsOf } from "@/lib/quickfit-gen";
import { QF2_TYPES, typologyForStrategy } from "@/lib/qf2/core";
import { parcelPlan, reportQueryFor } from "@/lib/parcel-plan";

const STATUS_STYLE: Record<string, string> = {
  REQUIRED: "bg-red-100 text-red-800",
  LIKELY: "bg-orange-100 text-orange-800",
  POSSIBLE: "bg-yellow-100 text-yellow-800",
  ASK: "bg-blue-100 text-blue-800",
  NOT_NEEDED: "bg-zinc-100 text-zinc-600",
};
const PHASE_LABEL: Record<string, string> = {
  due_diligence: "Due diligence", design_engineering: "Design & engineering", zoning: "Zoning",
  permits: "Permits", construction: "Construction", closeout: "Closeout",
};

function readProject(sp: Record<string, string | string[] | undefined>): ProjectAnswers {
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined);
  const n = (k: string) => (s(k) !== undefined ? Number(s(k)) : undefined);
  const b = (k: string) => (s(k) === "yes" ? true : s(k) === "no" ? false : undefined);
  return {
    type: s("type") as ProjectAnswers["type"], units: n("units"), stories: n("stories"),
    financed: b("financed"), party_wall: b("party_wall"), touches_street: b("touches_street"),
    new_driveway: b("new_driveway"), lot_split_or_merge: b("lot_split"), cut_fill_over_25: b("cut_fill"),
    minor_work: s("minor_work") as ProjectAnswers["minor_work"],
  };
}

// Ease Score: the checklist answers each strategy stands for (for the four answers' "what next").
const STRATEGY_PROJECT: Record<score.StrategyId, ProjectAnswers> = {
  new_sf: { type: "new_build", units: 1 },
  duplex: { type: "new_build", units: 2 },
  three_four_unit: { type: "new_build", units: 3 },
  townhouse_row: { type: "new_build", units: 2, party_wall: true, lot_split_or_merge: true },
  adu: { type: "new_build", units: 1 },
  rehab_existing: { type: "rehab" },
};
const USE_LABEL: Record<score.StrategyId, string> = {
  new_sf: "a new single-family house",
  duplex: "a duplex",
  three_four_unit: "a 3-4 unit building",
  townhouse_row: "a townhouse row",
  adu: "an accessory dwelling unit",
  rehab_existing: "fixing up the existing building",
};

type Zba = { by_relief?: Record<string, score.ZbaReliefCounts> } | null;

/** The zoning part of the four answers, read from the F1 factor the engine already computed. */
function narrativeZoning(s: score.StrategyResult, district: string | null, municipality: string | null, zba: Zba): narrative.NarrativeZoning {
  const f1 = s.factors.find((f) => f.id === "F1");
  const inp = (f1?.inputs ?? {}) as { lotOfRecordPath?: boolean; nonconforming?: boolean; permissionCode?: string | null; fitStatus?: string | null; varianceRules?: string[]; grantRate?: number };
  const base = { district, useLabel: USE_LABEL[s.strategy], units: s.units, municipality: municipality ?? "the municipality" };
  if (!f1 || f1.subscore == null) return { ...base, use: "unknown", dimensional: "unknown", municipality: district ? "City zoning staff" : base.municipality };
  const use: narrative.UsePath = inp.lotOfRecordPath ? "administrator_exception" : inp.nonconforming ? "by_right" : narrative.usePathFromPermission(inp.permissionCode as Parameters<typeof narrative.usePathFromPermission>[0]);
  const fit = inp.fitStatus ?? null;
  const dimensional: narrative.DimensionalFit = inp.lotOfRecordPath || fit === "existing" || fit === "by_right" ? "fits"
    : fit === "contextual" ? "contextual" : fit === "variance" || fit === "no_fit" ? "variance" : "unknown";
  // Quote the Zoning Board record only when the engine used it (enough decided cases), never the default rate.
  const c = zba?.by_relief?.[score.DEFAULT_CONFIG.f1.zba.dimensionalReliefType];
  const decided = (c?.granted ?? 0) + (c?.denied ?? 0);
  const useRecord = dimensional === "variance" && inp.grantRate != null && decided >= score.DEFAULT_CONFIG.f1.zba.minCases;
  return {
    ...base, use, dimensional,
    varianceItems: Array.isArray(inp.varianceRules) ? inp.varianceRules.map((r) => r.replace(/_/g, " ")) : [],
    grantRate: useRecord ? inp.grantRate ?? null : null,
    grantCases: useRecord ? decided : null,
  };
}

function money(v: unknown) {
  return typeof v === "number" ? `$${Math.round(v).toLocaleString()}` : "—";
}

/** Shown when the parcel's data could not be read right now (never a 404 for an existing parcel). */
function DataUnavailable({ parid }: { parid: string }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Link href="/#parcel-search" className="text-xs font-medium text-slate-500 hover:text-slate-800">← New search</Link>
      <h1 className="mt-4 text-xl font-bold text-slate-900">{`Parcel ${parid}`}</h1>
      <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {"Some data for this parcel is temporarily unavailable. Our database is busy right now; please refresh in a moment."}
      </p>
      <a href={`/parcel/${encodeURIComponent(parid)}`} className="mt-4 inline-block rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Refresh</a>
    </main>
  );
}

/** Lot centroid [lon, lat] from the parcel facts, for aiming the 3D view before the map data arrives. */
function centerOf(f: object): [number, number] | null {
  const c = (f as { centroid?: { lon?: unknown; lat?: unknown } | null }).centroid;
  return typeof c?.lon === "number" && typeof c?.lat === "number" ? [c.lon, c.lat] : null;
}

// Vercel: a parcel that is not precomputed is computed live; never let one request run away.
export const maxDuration = 60;
/** A live pane computation slower than this shows the "database busy, retry" state instead of hanging. */
const LIVE_BUDGET_MS = 25_000;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Tab title "<address> · Parcel <id> — EaseScore.AI" from one cheap keyed read (streamed; falls back to the id). */
export async function generateMetadata({ params }: PageProps<"/parcel/[parid]">): Promise<Metadata> {
  const { parid } = await params;
  let address: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/parcel_scores?select=address&parid=eq.${encodeURIComponent(parid)}&limit=1`, {
      headers: { apikey: SB_KEY }, cache: "no-store", signal: AbortSignal.timeout(1500),
    });
    if (r.ok) address = titleCase(((await r.json()) as { address?: string | null }[])[0]?.address ?? null) || null;
  } catch {
    address = null;
  }
  return {
    title: `${address ? `${address} · ` : ""}${`Parcel ${parid}`} — EaseScore.AI`,
    description: `What it takes to build on ${address ? `${address} (parcel ${parid})` : `parcel ${parid}`} in Allegheny County: Ease Score, zoning, terrain, hazards and a pro forma, with a source behind every number.`,
  };
}

/** Resolves to null after `ms` (the caller then shows the retry state). */
const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export default async function ParcelPage({ params, searchParams }: PageProps<"/parcel/[parid]">) {
  const { parid } = await params;
  const sp = await searchParams;
  const asOf = new Date().toISOString().slice(0, 10);
  const T = new Timing("parcel", parid);
  // Map data and lot geometry stream to the browser after the pane (never awaited here).
  const quickfitP = quickfitInput(parid);
  // One retry for the map (a busy database can time a call out).
  const stage = Promise.all([T.time("rpc_parcel_map", parcelMap(parid).then((m) => m ?? parcelMap(parid))), quickfitP]).then(([mapData, qfInput]) => ({ mapData, qfInput }));
  stage.catch(() => undefined);
  // Pane data: one precomputed row (parcel_pane), or computed live when the parcel has no row yet.
  // The skeleton (loading.tsx) is already on screen; a busy database gets the retry page after LIVE_BUDGET_MS.
  const loaded = await within(loadPane(parid, asOf, quickfitP, T), LIVE_BUDGET_MS);
  if (!loaded) return <DataUnavailable parid={parid} />;
  if (!loaded.ok) {
    // 404 only when the parcel ID truly does not exist; a data error (e.g. a database timeout) gets a retry page.
    const exists = await T.time("rest_parcel_exists", within(parcelExists(parid), 4000));
    if (exists === false) notFound();
    return <DataUnavailable parid={parid} />;
  }
  const P = loaded.payload;
  const { facts, sales, rent, sfComps, prime, tapFees, zba } = P;
  const f = facts as unknown as ParcelFacts & Record<string, any>;
  const project = readProject(sp);
  const results = evaluateRequirements(f, project);

  // Ease Score for every strategy, precomputed (or computed live above). null hides the score block, never the page.
  const easeResult: score.EaseScoreResult | null = P.score;
  const overrides = readCostOverrides(sp);
  // Every option through the same pro forma (no program edits) for the summary; its featured by-right
  // option (most financial sense, ties to the higher Ease Score) is the page's default selection.
  let plans0: Awaited<ReturnType<typeof comparePlans>> | null = null;
  if (easeResult) {
    try {
      plans0 = await T.time("compare_plans", comparePlans({
        parid, facts: f, result: easeResult, zba: zba as { by_relief?: Record<string, score.ZbaReliefCounts> } | null,
        sfComps, sales, rent, prime, tapFeesPerUnit: tapFees, overrides, asOf,
        precomputed: { newComps: P.newComps, rehabComps: P.rehabComps },
      }));
    } catch {
      plans0 = null;
    }
  }
  const wantedRaw = typeof sp.strategy === "string" ? sp.strategy : null;
  const wanted = easeResult?.strategies.some((x) => x.strategy === wantedRaw) ? (wantedRaw as score.StrategyId) : null;
  // "Best options for this lot": the money signal per option from the same pro forma as the summary
  // (the selected option's own, with the visitor's edits); ease comes from the score. Never blended.
  const pencilOf = (id: score.StrategyId, x: assumptions.ProFormaResult | null | undefined): score.PencilState => {
    const rehab = id === "rehab_existing";
    if (!x) return rehab ? "pricing" : "unknown";
    if (x.plan.missing.length) return rehab && x.plan.missing.some((t) => /rehab cost|cost per/i.test(t)) ? "pricing" : "unknown";
    return x.verdict ?? "unknown";
  };
  // Options the page has priced itself (parcelPlan, the QuickFit v2 scheme) use that pro forma in the ranking.
  const pagePf: Partial<Record<score.StrategyId, assumptions.ProFormaResult | null>> = {};
  const rankWith = (pc: PlanComparison | null) => easeResult
    ? score.rankOptions(easeResult, Object.fromEntries(easeResult.strategies.map((x) => {
        if (x.strategy in pagePf) return [x.strategy, pencilOf(x.strategy, pagePf[x.strategy])];
        const o = pc?.options.find((q) => q.strategy === x.strategy);
        const fit = (x.factors.find((q) => q.id === "F1")?.inputs as { fitStatus?: string } | undefined)?.fitStatus;
        return [x.strategy, o ? pencilOf(x.strategy, o.pf) : fit === "no_fit" ? "none" : pencilOf(x.strategy, null)];
      })))
    : [];
  // The page (and QuickFit) open on the first row of that ranking; ?strategy= (a visitor's pick) wins.
  // Only an option that can be sized and priced is "best" (score.rankOptions puts those first).
  const topOf = (rows: score.OptionRow[]) => (rows.find((r) => r.evaluable) ?? rows.find((r) => r.applicable))?.strategy ?? null;
  const bestRanked = topOf(rankWith(plans0));
  const defaultId = narrative.defaultStrategy(wanted, bestRanked ?? plans0?.byRight?.strategy ?? null, easeResult?.best ?? null);
  let selected = easeResult
    ? easeResult.strategies.find((x) => x.strategy === defaultId) ?? easeResult.strategies[0] ?? null
    : null;
  // One SelectedScheme for the selected option and its pro forma (lib/parcel-plan.ts, shared with the
  // Feasibility Study): the score's fit scheme, or the QuickFit 3D generator's scheme when the visitor changed
  // the map controls (qf_* keys), plus the program edits (pf_*) and hillside stepping on the lidar grid.
  // QuickFit v2 prices every new build on the lot geometry (already loading since the top of the render).
  const qfIn = await quickfitP.catch(() => null);
  let plan = T.timeSync("proforma", () => parcelPlan({ P, sp, overrides, strategy: selected?.strategy ?? null, qf: qfIn }));
  // The summary priced every option on the score's scheme; the page prices the selected one on the QuickFit v2
  // scheme, which can change its verdict. When that moves another option to the top of the ranking, open on
  // that one instead (one more pricing, kept when it still ranks first), so the pane, the ranking and QuickFit agree.
  if (!wanted && selected && easeResult) {
    pagePf[selected.strategy] = plan.pf;
    const top = topOf(rankWith(plans0));
    const alt = top && top !== selected.strategy ? easeResult.strategies.find((x) => x.strategy === top) ?? null : null;
    if (alt) {
      const altPlan = T.timeSync("proforma_alt", () => parcelPlan({ P, sp, overrides, strategy: alt.strategy, qf: qfIn }));
      pagePf[alt.strategy] = altPlan.pf;
      if (topOf(rankWith(plans0)) === alt.strategy) { selected = alt; plan = altPlan; }
    }
  }
  const { fin, isCity, genDefaults, urlControls, genTyp } = plan;
  const chosenScheme = plan.selected;
  const pf = plan.pf;
  const pencilsNote = pf
    ? [
        pf.plan.sizeWarning,
        pf.plan.priceCheck,
        pf.plan.exclusions.length ? `Partial estimate. Not included yet: ${pf.plan.exclusions.map((e) => e.label.charAt(0).toLowerCase() + e.label.slice(1)).join("; ")}.` : null,
      ].filter(Boolean).join(" ") || null
    : null;

  let answers: narrative.NarrativeResult | null = null;
  if (selected?.applicable) {
    try {
      const reqs = evaluateRequirements(f, STRATEGY_PROJECT[selected.strategy]);
      answers = narrative.generateNarrative(narrative.fromStrategyResult({
        parid, proForma: pf?.narrative ?? null, requirements: reqs,
        // Callout titles read "Review required: X"; the answers list X alone.
        result: { ...selected, reviewCallouts: selected.reviewCallouts.map((c) => ({ ...c, title: c.title.replace(/^Review required:\s*/i, "").replace(/^./, (m) => m.toUpperCase()) })) },
        zoning: narrativeZoning(selected, score.isCityParcel(f) ? f.zoning?.code ?? null : null, f.context?.municipality ?? f.assessment?.municipality ?? null, zba),
      }));
    } catch {
      answers = null;
    }
  }
  // The summary with the selected option's own pro forma; sentence 1 describes the selected option when the visitor chose it.
  let plans: PlanComparison | null = null;
  if (plans0) {
    try {
      plans = selected ? withSelected(plans0, selected.strategy, pf, wanted != null && wanted !== plans0.byRight?.strategy) : plans0;
    } catch {
      plans = plans0;
    }
  }

  const optionRows = rankWith(plans);
  // A rental with no "thin" threshold has no verdict: show its yield on cost instead of "can't tell".
  const pencilDetail: Partial<Record<score.StrategyId, string>> = {};
  for (const o of plans?.options ?? []) {
    const y = o.pf?.rent.yieldOnCost;
    if (o.pf && !o.pf.plan.missing.length && o.pf.verdict == null && o.pf.plan.tenure === "rent" && y != null) pencilDetail[o.strategy] = `Rental: ${Math.round(y * 100)}% yield`;
  }

  T.add("server_total", T.total(), `pane ${loaded.source}`);
  const a = f.assessment as (Record<string, any> & { address?: string; municipality?: string; year_built?: number | null; living_area_sqft?: number | null; lot_area_sqft?: number | null }) | undefined;
  const byPhase = PHASE_ORDER.map((ph) => [ph, results.filter((r) => r.phase === ph)] as const);
  const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const s = sales as any, r = rent as any;

  // Query for the full report: same keys, with the report's names for the building type and tenure.
  const reportQuery = reportQueryFor(sp, selected?.strategy ?? null);
  const reportHtml = `/parcel/${encodeURIComponent(parid)}/report${reportQuery ? `?${reportQuery}` : ""}`;

  // 1. Header: address (or "No official address · near <street>"), then the parcel ID, then neighborhood and zoning.
  const place = (f.context?.neighborhood as string | undefined) ?? titleCase(f.context?.municipality ?? a?.municipality) ?? null;
  // parcel_facts' address already has the house number; a lot with none (or "0") reads "No official address · near <street>".
  const rawAddr = (a?.address ?? "").trim();
  const numbered = /^(\d+[A-Z]?)\s+(.*)$/i.exec(rawAddr);
  const address = !rawAddr ? `Parcel ${parid}` : numbered && !/^0+$/.test(numbered[1]!) ? titleCase(rawAddr) : `No official address · near ${titleCase(numbered ? numbered[2]! : rawAddr)}`;
  const subline = [place, f.zoning?.code ? `Zoning ${f.zoning.code}` : "Zoning not in our data"].filter(Boolean).join(" · ");

  // 5. General buildability: four fact tiles.
  const NR = "Not on record";
  const HAZARD_TILE: Record<string, string> = { "landslide-prone overlay": "Landslide", "undermined (old mines)": "Undermined", "old slide area": "Old slide", floodplain: "Floodplain", "cleanup site nearby": "Cleanup site", "combined sewer": "Combined sewer" };
  const lotSf = (f.lot_area_sqft_gis as number | undefined) ?? a?.lot_area_sqft ?? null;
  const slope = (f.slope_1m ?? f.slope) as { mean_pct?: number; share_over_25?: number; steep_share?: number } | undefined;
  const over25 = slope?.share_over_25 ?? slope?.steep_share;
  const hz = selected ? hazardWords(selected) : null;
  const tiles: [string, string, string | null][] = [
    ["Lot size", lotSf ? `${Math.round(lotSf).toLocaleString("en-US")} sq ft` : NR, lotSf ? `${(lotSf / 43560).toFixed(2)} acre` : null],
    ["Average slope", slope?.mean_pct != null ? `${Math.round(Number(slope.mean_pct))}%` : NR, over25 != null ? `${`${Math.round(Number(over25) * 100)}%`} over 25%` : null],
    ["Hazards", hz == null ? "No data" : hz.length ? HAZARD_TILE[hz[0]!] ?? hz[0]! : "None mapped", hz && hz.length > 1 ? `+${hz.length - 1} more` : hz ? "in our data" : null],
    ["Zoning", f.zoning?.code ?? "No data", f.zoning?.code ? (isCity ? "Pittsburgh" : titleCase(f.context?.municipality ?? a?.municipality) || null) : titleCase(f.context?.municipality ?? a?.municipality) || null],
  ];
  // The best option in one line: its name, zoning path and money signal (never blended into one number).
  // Zoning not loaded (outside the City, or no district): a partial screen, no numeric score.
  const partial = !score.zoningLoaded(f);
  const muniName = (f.context?.municipality ?? a?.municipality ?? null) as string | null;
  const best = optionRows.find((r) => r.evaluable) ?? null;
  const PENCIL_WORDS: Record<score.PencilState, string> = {
    yes: "pencils at market rate", thin: "tight margin", no: "doesn't pencil at market rate", pricing: "needs your rehab cost to price", unknown: "can't price yet", none: "",
  };
  const bestLine = !best
    ? (optionRows.some((r) => r.applicable) ? (partial ? "Can't determine; zoning not loaded" : "Can't determine yet: no option can be sized and priced") : null)
    : [best.name, best.zoning.kind === "allowed" && best.zoning.text === "Allowed" ? "allowed by right" : best.zoning.text.replace(/^./, (m) => m.toLowerCase()).replace(/:.*$/, ""),
        best.leadLabel === score.LEAD_SUBSIDY ? "needs subsidy or lower costs" : pencilDetail[best.strategy]?.toLowerCase() ?? PENCIL_WORDS[best.pencils]].filter(Boolean).join(", ");
  // Market strength beside the score: the new-construction comp set the pro forma prices from.
  const marketSet = (selected && P.newComps[selected.strategy]) ?? P.newComps.new_sf ?? Object.values(P.newComps).find(Boolean) ?? null;
  const market = assumptions.marketSignal(marketSet);
  // Existing building, from the County assessment.
  const hasBuilding = !!a?.year_built || Number(a?.fmv_building ?? 0) > 0;
  const buildingLine = hasBuilding
    ? `${a?.use ? String(a.use).toLowerCase().replace(/^./, (m) => m.toUpperCase()) : "Use not recorded"}${a?.year_built ? `, built ${a.year_built}` : ""}${a?.living_area_sqft ? `, ${Math.round(a.living_area_sqft).toLocaleString("en-US")} sq ft` : ""} (County assessment)`
    : "None on record (County assessment)";
  const canSolve = !!(plan.qf2?.rules && plan.qf2.zoneCode);
  // The site layout thumbnail shows the selected option when it is a new build, else the best new build.
  const thumbTyp = genTyp ?? typologyForStrategy(optionRows.find((r) => r.applicable && typologyForStrategy(r.strategy))?.strategy ?? null);
  const thumbLabel = thumbTyp ? score.OPTION_NAME[QF2_TYPES.find((t) => t.id === thumbTyp)!.strategy] : null;
  const detailsHint = selected ? `${selected.factors.length} factors and receipts` : "receipts";

  // One wrapper so the pane sets its own (tighter) rhythm: everything fits one 1440×900 screen.
  const pane = (
    <div className="space-y-3">
      {/* 1. Address, parcel ID (copy), neighborhood and zoning */}
      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-slate-900">{address}</h1>
          <Link href="/#parcel-search" className="mt-1 shrink-0 text-xs font-medium text-slate-600 hover:text-slate-900">← New search</Link>
        </div>
        <div className="mt-0.5"><CopyParcelId parid={parid} /></div>
        <p className="mt-0.5 text-xs text-slate-600">{subline}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs">
          <Link href={`/developer?parcel=${encodeURIComponent(parid)}`} className="text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950">Open in Developer workspace →</Link>
          <Link href="/planner" className="text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900">Compare sites in the Planner</Link>
        </p>
      </header>
      {/* 2-3. Photo (Street View or our illustrative map) beside the site layout thumbnail */}
      <div className="grid grid-cols-2 gap-2">
        <PanePhoto stage={stage} date={asOf} />
        <SiteThumb scheme={genTyp ? plan.v2 : null} qf2={plan.qf2} controls={thumbTyp ? urlControls ?? genDefaults[thumbTyp] : null} label={thumbLabel} />
      </div>
      {/* Red flags stay above the score */}
      {selected && selected.redFlags.length > 0 && <Callouts selected={selected} kinds="red" max={1} compact />}
      {/* 4. Ease Score, band and one sentence */}
      {partial ? (
        <PartialBlock municipality={muniName} market={market} />
      ) : easeResult && selected ? (
        <ScoreBlock selected={selected} sentence={scoreSentence(selected)} market={market} pencilsNo={pf?.verdict === "no"} />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600">We could not score this parcel right now (not enough evidence loaded). The report and the process checklist still apply.</p>
      )}
      {/* 5. General buildability: fact tiles, the best option, at most 2 review callouts */}
      <section aria-labelledby="buildability-h">
        <h2 id="buildability-h" className="sr-only">General buildability</h2>
        <div className="grid grid-cols-4 gap-1.5">
          {tiles.map(([k, v, sub]) => (
            <div key={k} className="min-w-0 rounded-lg border border-slate-200 bg-white/70 px-1.5 py-1 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-600">{k}</p>
              <p className={`line-clamp-2 break-words leading-tight tabular-nums ${v === NR || v === "No data" ? "text-[11px] text-slate-600" : "text-[13px] font-semibold text-slate-900"}`} title={v}>{v}</p>
              {sub && <p className="truncate text-[10px] text-slate-600">{sub}</p>}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-slate-800"><b>Existing building:</b> {buildingLine}</p>
        {bestLine && <p className="mt-1 text-[13px] text-slate-800"><b>Best option:</b> {bestLine}{best && selected && best.strategy !== selected.strategy ? <span className="text-slate-600">{` (showing ${selected.strategyLabel.toLowerCase()})`}</span> : null}</p>}
        {selected && selected.reviewCallouts.length > 0 && <div className="mt-1.5"><Callouts selected={selected} kinds="review" max={2} compact /></div>}
      </section>
      {/* 6. Three buttons */}
      <div className={`grid gap-2 ${canSolve ? "grid-cols-3" : "grid-cols-2"}`}>
        {canSolve && <OpenView view="build" className="rounded-lg bg-slate-900 px-2 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open QuickFit</OpenView>}
        <OpenDrawer id="pencils" className="rounded-lg border border-slate-400 bg-white px-2 py-2 text-sm font-semibold text-slate-900 hover:border-slate-600">Pencil calculator</OpenDrawer>
        <a href={reportHtml} target="_blank" rel="noopener" className="inline-flex items-center justify-center rounded-lg border border-slate-400 bg-white px-2 py-2 text-sm font-semibold text-slate-900 hover:border-slate-600">Full report<span className="sr-only"> (opens in a new tab)</span></a>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <OpenDrawer id="details" className="min-h-6 underline decoration-dotted underline-offset-2 hover:text-slate-900" label={`Score details: ${detailsHint}`}>Score details</OpenDrawer>
        <OpenDrawer id="process" className="min-h-6 underline decoration-dotted underline-offset-2 hover:text-slate-900">Process checklist</OpenDrawer>
        <DownloadReport parid={parid} query={reportQuery} label={"Download the PDF"} hint={null} variant="secondary" className="ml-auto [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs" />
      </div>
      <p className="text-[11px] leading-snug text-slate-600">Decision support only: not legal, financial, zoning or engineering advice. Confirm with the permitting office and a professional.</p>
    </div>
  );

  const projectForm = (
    <section className="rounded-xl border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-900">Project questions</h3>
      <p className="text-[11px] text-slate-500">These set the process checklist.</p>
      <form action={`/parcel/${encodeURIComponent(parid)}#drawer=process`} className="mt-2 grid grid-cols-2 gap-2 text-sm">
        {Object.entries(sp).filter(([k, v]) => typeof v === "string" && (k === "strategy" || k.startsWith("pf_"))).map(([k, v]) => <input key={k} type="hidden" name={k} value={v as string} />)}
        <label className="flex flex-col">Project type
          <select name="type" defaultValue={String(sp.type ?? "")} className="rounded border px-2 py-1">
            <option value="">— not set —</option><option value="new_build">New build</option><option value="addition">Addition</option>
            <option value="rehab">Rehab</option><option value="demolition">Demolition</option><option value="conversion">Conversion</option>
          </select></label>
        <label className="flex flex-col">Units<input name="units" type="number" min={1} defaultValue={String(sp.units ?? "")} className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col">Stories<input name="stories" type="number" min={1} defaultValue={String(sp.stories ?? "")} className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col">Smaller work
          <select name="minor_work" defaultValue={String(sp.minor_work ?? "")} className="rounded border px-2 py-1">
            <option value="">—</option><option value="deck">Deck</option><option value="porch">Porch</option><option value="parking_pad">Parking pad</option>
            <option value="stoop">Stoop</option><option value="balcony">Balcony</option><option value="retaining_wall">Retaining wall</option>
          </select></label>
        {([["financed", "Financed?"], ["party_wall", "Rowhouse / party wall?"], ["touches_street", "Work blocks street/sidewalk?"],
           ["new_driveway", "New driveway?"], ["lot_split", "Combine or split lots?"], ["cut_fill", "Cut/fill slopes over 25%?"]] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col">{label}
            <select name={k} defaultValue={String(sp[k] ?? "")} className="rounded border px-2 py-1">
              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
            </select></label>
        ))}
        <button className="col-span-2 rounded-lg bg-slate-900 px-3 py-2 text-white">Update the checklist</button>
      </form>
    </section>
  );

  const process = (
    <section>
      <p className="text-sm text-zinc-600">
        {Object.entries(counts).map(([k, v]) => `${v} ${k.replace("_", " ").toLowerCase()}`).join(", ")}
      </p>
      {byPhase.map(([ph, items]) => items.length > 0 && (
        <div key={ph} className="mt-4">
          <h3 className="font-semibold text-zinc-700">{PHASE_LABEL[ph]}</h3>
          <ul className="mt-1 divide-y divide-zinc-100 rounded border border-zinc-200">
            {items.map((it: RequirementResult) => (
              <li key={it.id} className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[it.status]}`}>{it.status.replace("_", " ")}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{it.item} <span className="text-xs font-normal text-zinc-500">({it.issuer})</span></p>
                    {it.reasons.slice(0, 3).map((t, i) => (
                      <p key={i} className="text-sm text-zinc-700">{i > 0 && <span className="text-zinc-400">also: </span>}{t.reason}</p>
                    ))}
                    {it.advisories.map((adv, i) => <p key={`a${i}`} className="mt-1 rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">ⓘ {adv}</p>)}
                    {(it.citation || it.reasons.some((t) => t.source)) && (
                      <p className="mt-0.5 text-xs text-zinc-500">Sources: {[...new Set([it.citation, ...it.reasons.map((t) => t.source)].filter(Boolean))].join("; ")}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-3 text-xs text-zinc-500">The project questions that set this list are under “Change the plan”.</p>
    </section>
  );

  const details = (
    <>
      {easeResult && selected && selected.applicable && (
        <section aria-labelledby="factors-h">
          <h3 id="factors-h" className="text-sm font-semibold text-slate-900">{`Ease Score factors · ${selected.strategyLabel}`}</h3>
          <p className="text-[11px] text-slate-600">Each bar is one factor&apos;s sub-score out of 100; open its receipt for the inputs, the rule applied and the sources.</p>
          <FactorBars selected={selected} reportHref={`${reportHtml}#appD`} />
        </section>
      )}
      {selected && <Callouts selected={selected} max={20} />}
      {plans && <SummaryText input={plans.summaryInput} template={plans.summary} />}
      {easeResult && selected
        ? <DetailsContent result={easeResult} selected={selected} answers={answers} pencilsNote={pencilsNote} />
        : null}
      <section className="rounded border border-zinc-200 p-3">
        <h3 className="text-sm font-semibold">Sales comps</h3>
        <p className="text-sm">
          <span className={s?.status === "ok" ? "text-green-700" : "text-red-700"}>{s?.status ?? "unavailable"}</span>
          {s && `: ${s.count} ${s.comparable_use} sales within ${s.radius_mi} mi, ${s.date_range?.from ?? "?"} to ${s.date_range?.to ?? "?"}`}
        </p>
        {s?.fallback_note && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">{s.fallback_note}</p>}
        {s?.status === "ok" && <p className="mt-1 text-sm">Median {money(s.median_price)}, {money(s.median_price_per_sqft)}/sq ft</p>}
        <ul className="mt-2 max-h-48 overflow-auto text-xs text-zinc-600">
          {(s?.comps ?? []).map((c: any) => <li key={`${c.parid}${c.sale_date}`}>{c.sale_date}, {money(c.price)}, {c.distance_mi} mi</li>)}
        </ul>
        <p className="mt-2 text-xs text-zinc-400">{s?.rules}</p>
      </section>
      <section className="rounded border border-zinc-200 p-3">
        <h3 className="text-sm font-semibold">Rent evidence</h3>
        <RentReceipt parid={parid} />
        {r?.note && <p className="text-sm text-zinc-600">{r.note}</p>}
        {r?.zori && <p className="mt-1 text-sm">Zillow rent index (ZIP {r.zori.zip}): {money(r.zori.latest_rent)}/mo ({r.zori.latest_month}); a year earlier {money(r.zori.rent_12m_ago)}</p>}
        {r?.hud_fmr && <p className="mt-1 text-sm">HUD Fair Market Rent {r.hud_fmr.year} ({r.hud_fmr.level}): 1BR {money(r.hud_fmr.br1)}, 2BR {money(r.hud_fmr.br2)}, 3BR {money(r.hud_fmr.br3)}</p>}
      </section>
      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">All parcel facts (raw data, for checking)</summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto text-xs">{JSON.stringify(facts, null, 2)}</pre>
      </details>
      <p className="text-xs text-zinc-500">Parcel {parid}. Decision support only. Verify with your lender, accountant, and the permitting office.</p>
    </>
  );

  return (
    <ParcelShell
      pane={pane}
      planExtras={<>{pf ? <AssumptionsForm parid={parid} result={pf} sp={sp} /> : null}{projectForm}</>}
      drawers={[
        { id: "pencils", title: "Pencil calculator", content: pf && selected ? <ProFormaPanel parid={parid} result={pf} strategyLabel={selected.strategyLabel} sp={sp} overrides={overrides} live={{ fin: plan.fin, strategy: selected.strategy, scheme: plan.scheme, stepping: plan.stepping }} /> : <p className="text-sm text-slate-600">No cost and value estimate for this option yet.{pencilsNote ? ` ${pencilsNote}` : ""}</p> },
        { id: "process", title: "Process checklist", content: process },
        { id: "details", title: "Score details", content: details },
        { id: "options", title: "Best options and street precedent", content: <>
          {optionRows.length > 0 ? <BestOptions parid={parid} rows={optionRows} detail={pencilDetail} selected={selected?.strategy ?? null} sp={sp} partial={partial} /> : <p className="text-sm text-slate-600">No options were scored for this lot.</p>}
          <StreetPrecedent parid={parid} precedent={P.precedent} zbaNearby={P.zbaNearby ?? null} result={easeResult} isCity={isCity} />
        </> },
      ]}
      parid={parid} stage={stage} outline={P.outline} center={centerOf(f)}
      viewFacts={{
        address, parid, zoning: f.zoning?.code ?? null, lotSf,
        slopeMeanPct: slope?.mean_pct != null ? Number(slope.mean_pct) : null, over25Share: over25 != null ? Number(over25) : null,
        overlays: ((f.overlays ?? []) as { layer: string; share: number }[]).filter((o) => o.share > 0).map((o) => ({ label: overlayLabel(o.layer), share: o.share })),
        floodwayShare: f.flood_evidence?.floodway_share ?? null, floodZoneShare: f.flood_evidence?.sfha_share ?? f.flood_1pct_share ?? null,
      }}
      gen={{
        strategy: selected?.strategy ?? null,
        controls: genTyp ? urlControls ?? genDefaults[genTyp] : null,
        defaults: genDefaults, fixed: easeResult?.schemes ?? {}, fin,
        qf2: plan.qf2, rulesRow: plan.rulesRow, serverMetrics: chosenScheme ? metricsOf(chosenScheme, pf) : null,
        code: (() => {
          const zr = (f.zoning as { rules?: { min_front_setback_ft?: number | null; min_side_setback_ft?: number | null; min_rear_setback_ft?: number | null; exterior_side_setback_ft?: number | null } } | undefined)?.rules;
          return { front: zr?.min_front_setback_ft ?? null, side: zr?.min_side_setback_ft ?? null, rear: zr?.min_rear_setback_ft ?? null, streetSide: zr?.exterior_side_setback_ft ?? zr?.min_front_setback_ft ?? null };
        })(),
        notApplicable: Object.fromEntries(QF2_TYPES.map((t) => [t.id, easeResult?.strategies.find((x) => x.strategy === t.strategy && !x.applicable)?.notApplicableReason ?? undefined]).filter(([, v]) => v)),
      }} />
  );
}
