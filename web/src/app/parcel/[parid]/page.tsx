import Link from "next/link";
import { notFound } from "next/navigation";
import { assumptions, evaluateRequirements, narrative, PHASE_ORDER, score, type ParcelFacts, type ProjectAnswers, type RequirementResult } from "@easescore/engine";
import { parcelExists, parcelMap, quickfitInput } from "@/lib/data";
import { readCostOverrides } from "@/lib/proforma";
import { loadPane } from "@/lib/pane";
import { comparePlans, type PlanComparison } from "@/lib/summary";
import { titleCase } from "@/lib/report/assess";
import { Callouts, DetailsContent, FactorBars, ScoreBlock } from "./EaseScorePanel";
import ProFormaPanel, { AssumptionsForm } from "./ProFormaPanel";
import ParcelShell from "./ParcelShell";
import ParcelThumb from "./ParcelThumb";
import CopyParcelId from "./CopyParcelId";
import SummaryText from "./SummaryText";
import DownloadReport from "./report/DownloadReport";
import { Timing } from "@/lib/timing";
import { OpenDrawer } from "./Drawers";

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
      <h1 className="mt-4 text-xl font-bold text-slate-900">Parcel {parid}</h1>
      <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Some data for this parcel is temporarily unavailable. Our database is busy right now; please refresh in a moment.
      </p>
      <a href={`/parcel/${encodeURIComponent(parid)}`} className="mt-4 inline-block rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Refresh</a>
    </main>
  );
}

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
  const loaded = await loadPane(parid, asOf, quickfitP, T);
  if (!loaded.ok) {
    // 404 only when the parcel ID truly does not exist; a data error (e.g. a database timeout) gets a retry page.
    const exists = await T.time("rest_parcel_exists", parcelExists(parid));
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
  const wanted = typeof sp.strategy === "string" ? sp.strategy : null;
  const selected = easeResult
    ? easeResult.strategies.find((x) => x.strategy === wanted) ?? easeResult.strategies.find((x) => x.strategy === easeResult!.best) ?? easeResult.strategies[0] ?? null
    : null;
  // Pro forma for the selected option: cost defaults from the versioned config, the user's pf_* edits,
  // comps and rents from the database. A failure hides the section, never the page.
  let pf: assumptions.ProFormaResult | null = null;
  if (selected?.applicable) {
    try {
      const rehab = selected.strategy === "rehab_existing";
      const newComps = P.newComps[selected.strategy] ?? null;
      const matched = rehab ? P.rehabComps : null;
      const plan = assumptions.buildDevelopmentInputs({
        strategy: selected.strategy,
        facts: f as assumptions.ProFormaFacts,
        scheme: easeResult?.schemes?.[selected.strategy] ?? null,
        comps: rehab ? matched : sfComps,
        newComps,
        rents: rent as assumptions.RentCompsLike | null,
        primeRate: prime?.rate ?? null,
        primeRateDate: prime?.date ?? null,
        permitMonths: selected.predictedMonthsToPermit?.months ?? null,
        tapFeesPerUnit: tapFees,
        overrides: readCostOverrides(sp),
      });
      pf = T.timeSync("proforma", () => assumptions.evaluateDevelopment(plan));
    } catch {
      pf = null;
    }
  }
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
  // Best by-right and best with-approval options (each through the same pro forma) for the summary.
  let plans: PlanComparison | null = null;
  if (easeResult) {
    try {
      plans = await T.time("compare_plans", comparePlans({
        parid, facts: f, result: easeResult, zba: zba as { by_relief?: Record<string, score.ZbaReliefCounts> } | null,
        sfComps, sales, rent, prime, tapFeesPerUnit: tapFees, overrides: readCostOverrides(sp), asOf,
        known: selected ? { strategy: selected.strategy, pf } : null,
        precomputed: { newComps: P.newComps, rehabComps: P.rehabComps },
      }));
    } catch {
      plans = null;
    }
  }

  T.add("server_total", T.total(), `pane ${loaded.source}`);
  const a = f.assessment as (Record<string, any> & { address?: string; municipality?: string; year_built?: number | null; living_area_sqft?: number | null; lot_area_sqft?: number | null }) | undefined;
  const byPhase = PHASE_ORDER.map((ph) => [ph, results.filter((r) => r.phase === ph)] as const);
  const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const s = sales as any, r = rent as any;

  // Query for the full report: same keys, with the report's names for the building type and tenure.
  const REPORT_STRATEGY: Record<string, string> = { new_sf: "single_family", duplex: "duplex", townhouse_row: "townhouse_row" };
  const rq = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "" && k !== "strategy") rq.set(k, v);
  const rs = selected ? REPORT_STRATEGY[selected.strategy] : undefined;
  if (rs) rq.set("strategy", rs);
  if (typeof sp.pf_tenure === "string" && (sp.pf_tenure === "sale" || sp.pf_tenure === "rent")) rq.set("tenure", sp.pf_tenure);
  const reportQuery = rq.toString();
  const pdfHref = `/api/report/${encodeURIComponent(parid)}?${reportQuery}${reportQuery ? "&" : ""}download=0`;
  const reportHtml = `/parcel/${encodeURIComponent(parid)}/report${reportQuery ? `?${reportQuery}` : ""}`;

  // Header: address, then the parcel ID, then neighborhood and zoning.
  const place = (f.context?.neighborhood as string | undefined) ?? titleCase(f.context?.municipality ?? a?.municipality) ?? null;
  const address = titleCase(a?.address) || `Parcel ${parid}`; // parcel_facts' address already has the house number
  const subline = [place, f.zoning?.code ? `Zoning ${f.zoning.code}` : "Zoning not in our data"].filter(Boolean).join(" · ");

  // 3. Fact tiles.
  const NR = "Not on record";
  const lotSf = (f.lot_area_sqft_gis as number | undefined) ?? a?.lot_area_sqft ?? null;
  const slope = (f.slope_1m ?? f.slope) as { mean_pct?: number; share_over_25?: number; steep_share?: number } | undefined;
  const over25 = slope?.share_over_25 ?? slope?.steep_share;
  const tiles: [string, string, string | null][] = [
    ["Year built", a?.year_built ? String(a.year_built) : NR, null],
    ["House sq ft", a?.living_area_sqft ? Math.round(a.living_area_sqft).toLocaleString("en-US") : NR, null],
    ["Lot sq ft", lotSf ? Math.round(lotSf).toLocaleString("en-US") : NR, null],
    ["Average slope", slope?.mean_pct != null ? `${Math.round(Number(slope.mean_pct))}%` : NR, over25 != null ? `${Math.round(Number(over25) * 100)}% over 25%` : null],
  ];

  // 8. "Pencils?" chip for the selected option.
  let chip = "Pencils? Not computed for this option";
  let chipTone = "border-slate-300 bg-white text-slate-700";
  if (pf) {
    const pctTxt = (x: number) => `${Math.round(x * 100)}%`;
    const usdK = (x: number) => narrative.money(x);
    if (pf.plan.missing.length) chip = pf.plan.strategy === "rehab_existing" && pf.plan.missing.some((t) => /rehab cost|cost per/i.test(t)) ? "Enter your rehab cost to price this" : "Pencils? Can't tell yet: an input is missing";
    else if (pf.plan.tenure === "sale" && pf.sale.profit != null) {
      if (pf.verdict === "no") { chip = `Gap of about ${usdK(-pf.sale.profit)} at market rate${selected ? ` (${selected.strategyLabel.toLowerCase()})` : ""}`; chipTone = "border-red-200 bg-red-50 text-red-900"; }
      else { chip = `Pencils at market rate${selected ? ` (${selected.strategyLabel.toLowerCase()})` : ""}: ${pf.verdict === "thin" ? "barely" : "yes"}, about ${pctTxt(pf.sale.margin ?? 0)} margin`; chipTone = pf.verdict === "thin" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"; }
    } else if (pf.plan.tenure === "rent" && pf.rent.noi != null) {
      chip = pf.verdict === "no" ? "Does not pencil as a rental: rent does not cover running costs" : `As a rental: about ${pctTxt(pf.rent.yieldOnCost ?? 0)} a year on cost`;
    }
  }

  const pane = (
    <>
      {/* 1. Address, parcel ID (copy), neighborhood and zoning */}
      <header>
        <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">{address}</h1>
        <div className="mt-1"><CopyParcelId parid={parid} /></div>
        <p className="mt-0.5 text-xs text-slate-500">{subline}</p>
      </header>
      <div className="flex items-center justify-between">
        <Link href="/#parcel-search" className="text-xs font-medium text-slate-500 hover:text-slate-800">← New search</Link>
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Test build</span>
      </div>
      {/* 2. Property image (streams in after the pane) */}
      <ParcelThumb stage={stage} date={asOf} />
      {/* 3. Fact row */}
      <section aria-label="Key facts" className="grid grid-cols-4 gap-1.5">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="rounded-lg border border-slate-200 bg-white/70 px-1.5 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{k}</p>
            <p className={`tabular-nums ${v === NR ? "text-[11px] text-slate-400" : "text-sm font-semibold text-slate-900"}`}>{v}</p>
            {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
          </div>
        ))}
      </section>
      {/* 4-6. Score, factor bars, callouts */}
      {easeResult && selected ? (
        <>
          <ScoreBlock parid={parid} result={easeResult} selected={selected} sp={sp} />
          <FactorBars selected={selected} reportHref={`${reportHtml}#appD`} />
          <Callouts selected={selected} />
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600">We could not score this parcel right now. The report and the process checklist still apply.</p>
      )}
      {/* 7. Two-sentence summary + fine print */}
      {plans && <SummaryText input={plans.summaryInput} template={plans.summary} />}
      {/* 8. Pencils? */}
      <OpenDrawer id="pencils" className={`w-full rounded-full border px-3 py-1.5 text-left text-sm font-semibold ${chipTone}`} label="Open the pro forma">
        {chip} <span aria-hidden className="float-right opacity-60">›</span>
      </OpenDrawer>
      {/* 9. Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <a href={pdfHref} target="_blank" rel="noopener" className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open the full report</a>
        <OpenDrawer id="plan" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-slate-500">Change the plan</OpenDrawer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <OpenDrawer id="process" className="underline decoration-dotted underline-offset-2 hover:text-slate-800">Process checklist</OpenDrawer>
        <OpenDrawer id="details" className="underline decoration-dotted underline-offset-2 hover:text-slate-800">Details</OpenDrawer>
        <DownloadReport parid={parid} query={reportQuery} label="Download the PDF" hint={null} variant="secondary" className="ml-auto [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs" />
      </div>
    </>
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
        { id: "pencils", title: "Does it pencil?", content: pf && selected ? <ProFormaPanel parid={parid} result={pf} strategyLabel={selected.strategyLabel} sp={sp} /> : <p className="text-sm text-slate-600">No cost and value estimate for this option yet.{pencilsNote ? ` ${pencilsNote}` : ""}</p> },
        { id: "process", title: "Process checklist", content: process },
        { id: "details", title: "Details", content: details },
      ]}
      stage={stage} outline={P.outline} rules={(f.zoning as any)?.rules ?? null} zoneCode={f.zoning?.code ?? null} />
  );
}
