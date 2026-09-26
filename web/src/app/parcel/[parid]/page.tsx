import Link from "next/link";
import { notFound } from "next/navigation";
import { assumptions, evaluateRequirements, narrative, PHASE_ORDER, score, type ParcelFacts, type ProjectAnswers, type RequirementResult } from "@easescore/engine";
import { easeInputs, parcelFacts, parcelMap, permitTimes, quickfitInput, rentComps, salesComps, zbaGrantRates } from "@/lib/data";
import { primeRate, readCostOverrides, singleFamilyComps, tapFeesPerHome } from "@/lib/proforma";
import EaseScorePanel from "./EaseScorePanel";
import ProFormaPanel from "./ProFormaPanel";
import ParcelShell from "./ParcelShell";

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

export default async function ParcelPage({ params, searchParams }: PageProps<"/parcel/[parid]">) {
  const { parid } = await params;
  const sp = await searchParams;
  const factsP = parcelFacts(parid);
  const salesP = salesComps(parid);
  const [facts, sales, rent, mapData, qfInput, ease, zba, permits, sfComps, prime, tapFees] = await Promise.all([
    factsP, salesP, rentComps(parid), parcelMap(parid), quickfitInput(parid), easeInputs(parid),
    factsP.then((x) => zbaGrantRates((x as ParcelFacts | null)?.zoning?.code)).catch(() => null), permitTimes(),
    salesP.then((x) => singleFamilyComps(parid, x as assumptions.SalesCompsLike | null)).catch(() => null),
    primeRate(),
    factsP.then((x) => tapFeesPerHome((x as { assessment?: { is_pittsburgh?: boolean } } | null)?.assessment?.is_pittsburgh === true)).catch(() => null),
  ]);
  if (!facts) notFound();
  const f = facts as unknown as ParcelFacts & Record<string, any>;
  const project = readProject(sp);
  const results = evaluateRequirements(f, project);

  // Ease Score v0.1, computed on the server. A failure hides the score block, never the page.
  let easeResult: score.EaseScoreResult | null = null;
  try {
    // Permit times and review targets are City of Pittsburgh data: only used for City parcels.
    easeResult = score.scoreParcel(f, { quickfitInput: qfInput ?? null, easeInputs: ease, zba, permitTimes: score.isCityParcel(f) ? permits : undefined, unlocks: true });
  } catch {
    easeResult = null;
  }
  const wanted = typeof sp.strategy === "string" ? sp.strategy : null;
  const selected = easeResult
    ? easeResult.strategies.find((x) => x.strategy === wanted) ?? easeResult.strategies.find((x) => x.strategy === easeResult!.best) ?? easeResult.strategies[0] ?? null
    : null;
  // Pro forma for the selected option: cost defaults from the versioned config, the user's pf_* edits,
  // comps and rents from the database. A failure hides the section, never the page.
  let pf: assumptions.ProFormaResult | null = null;
  if (selected?.applicable) {
    try {
      const plan = assumptions.buildDevelopmentInputs({
        strategy: selected.strategy,
        facts: f as assumptions.ProFormaFacts,
        scheme: easeResult?.schemes?.[selected.strategy] ?? null,
        comps: sfComps,
        rents: rent as assumptions.RentCompsLike | null,
        primeRate: prime?.rate ?? null,
        primeRateDate: prime?.date ?? null,
        permitMonths: selected.predictedMonthsToPermit?.months ?? null,
        tapFeesPerUnit: tapFees,
        overrides: readCostOverrides(sp),
      });
      pf = assumptions.evaluateDevelopment(plan);
    } catch {
      pf = null;
    }
  }
  const pencilsNote = pf && pf.plan.exclusions.length
    ? `Partial estimate. Not included yet: ${pf.plan.exclusions.map((e) => e.label.charAt(0).toLowerCase() + e.label.slice(1)).join("; ")}.`
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
  const a = f.assessment;
  const byPhase = PHASE_ORDER.map((ph) => [ph, results.filter((r) => r.phase === ph)] as const);
  const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const s = sales as any, r = rent as any;

  return (
    <ParcelShell
      top={<>
      {/* Key facts */}
      <section className="flex flex-wrap gap-1.5 text-xs">
        {[
          f.slope_1m ? `Slope avg ${Math.round(Number((f as any).slope_1m.mean_pct))}% · ${Math.round(Number((f as any).slope_1m.share_over_25) * 100)}% of lot over 25%` : null,
          (f as any).flood_1pct_share > 0 ? `${Math.round((f as any).flood_1pct_share * 100)}% in 100-yr flood` : "Outside FEMA flood zones",
          (f as any).mines?.in_mined_out ? "Over mapped mine (DEP)" : (f as any).mines?.in_city_undermined ? "City undermined overlay" : "No mapped mine within 500 ft",
          f.overlays?.some((o: any) => o.layer === "landslide_prone_pgh") ? "Landslide-prone overlay" : null,
          f.zoning?.code ? `Zoned ${f.zoning.code}` : "Zoning not loaded here",
          (f as any).transit?.nearest_frequent_stop_m != null ? `Frequent transit ${Math.round((f as any).transit.nearest_frequent_stop_m)} m` : null,
        ].filter(Boolean).map((t) => <span key={String(t)} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{t}</span>)}
      </section>
      {easeResult && selected
        ? <EaseScorePanel parid={parid} result={easeResult} selected={selected} answers={answers} sp={sp} pencilsNote={pencilsNote}
            proForma={pf ? <ProFormaPanel parid={parid} result={pf} strategyLabel={selected.strategyLabel} sp={sp} /> : null} />
        : <section className="rounded-xl border border-dashed border-slate-300 p-3">
            <h2 className="text-base font-semibold text-slate-900">Ease Score</h2>
            <p className="text-sm text-zinc-600">We could not score this parcel right now. The facts, checklist and comps below still apply.</p>
          </section>}
      </>}
      mapData={mapData} qfInput={qfInput} rules={(f.zoning as any)?.rules ?? null} zoneCode={f.zoning?.code ?? null}
      header={
        <div>
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xs font-medium text-slate-500 hover:text-slate-800">← Search</Link>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">v0.5 test build</span>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{a?.address || parid}</h1>
          <p className="text-sm text-slate-600">{a?.municipality} · {f.zoning?.code ? `Zoned ${f.zoning.code}` : "Zoning not available"} · {a?.use}</p>
          <p className="text-xs text-slate-400">Parcel {parid}</p>
        </div>
      }>
      {/* Project answers */}
      <section>
        <h2 className="text-lg font-semibold">Your project</h2>
        <form className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {typeof sp.strategy === "string" && <input type="hidden" name="strategy" value={sp.strategy} />}
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
          <button className="col-span-2 rounded-lg bg-slate-900 px-3 py-2 text-white">Update checklist</button>
        </form>
      </section>

      {/* 3. Requirements checklist */}
      <section>
        <h2 className="text-lg font-semibold">Process checklist</h2>
        <p className="text-sm text-zinc-600">
          {Object.entries(counts).map(([k, v]) => `${v} ${k.replace("_", " ").toLowerCase()}`).join(" · ")}
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
                      <p className="font-medium">{it.item} <span className="text-xs font-normal text-zinc-500">· {it.issuer}</span></p>
                      {it.reasons.slice(0, 3).map((t, i) => (
                        <p key={i} className="text-sm text-zinc-700">{i > 0 && <span className="text-zinc-400">also: </span>}{t.reason}{t.source && <span className="text-zinc-400"> [{t.source}]</span>}</p>
                      ))}
                      {it.advisories.map((adv, i) => (
                        <p key={`a${i}`} className="mt-1 rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">ⓘ {adv}</p>
                      ))}
                      {it.citation && <p className="mt-0.5 text-xs text-zinc-500">Citation: {it.citation}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 4. Financial evidence — separate from site ease */}
      <section className="grid gap-4">
        <div className="rounded border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">Sales comps</h2>
          <p className="text-sm">
            <span className={s?.status === "ok" ? "text-green-700" : "text-red-700"}>{s?.status ?? "unavailable"}</span>
            {s && ` · ${s.count} ${s.comparable_use} sales · within ${s.radius_mi} mi · ${s.date_range?.from ?? "?"} → ${s.date_range?.to ?? "?"}`}
          </p>
          {s?.fallback_note && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">{s.fallback_note}</p>}
          {s?.note && <p className="mt-1 text-sm text-zinc-600">{s.note}</p>}
          {s?.status === "ok" && <p className="mt-1 text-sm">Median {money(s.median_price)} · {money(s.median_price_per_sqft)}/sq ft</p>}
          <ul className="mt-2 max-h-56 overflow-auto text-xs text-zinc-600">
            {(s?.comps ?? []).map((c: any) => (
              <li key={`${c.parid}${c.sale_date}`}>{c.sale_date} · {money(c.price)} · {c.address} · {c.distance_mi} mi</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-400">{s?.rules}</p>
        </div>
        <div className="rounded border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">Rent evidence</h2>
          {r?.note && <p className="text-sm text-zinc-600">{r.note}</p>}
          {r?.zori && <p className="mt-1 text-sm">Zillow rent index (ZIP {r.zori.zip}): {money(r.zori.latest_rent)}/mo ({r.zori.latest_month}); a year earlier {money(r.zori.rent_12m_ago)}</p>}
          {r?.hud_fmr && <p className="mt-1 text-sm">HUD Fair Market Rent {r.hud_fmr.year} ({r.hud_fmr.level}): 1BR {money(r.hud_fmr.br1)} · 2BR {money(r.hud_fmr.br2)} · 3BR {money(r.hud_fmr.br3)}</p>}
          <p className="mt-1 text-sm text-zinc-500">RentEase: {r?.rentease?.status ?? "not available"}</p>
        </div>
      </section>

      {/* Raw facts for checking the data */}
      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">All parcel facts (raw data, for checking)</summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto text-xs">{JSON.stringify(facts, null, 2)}</pre>
      </details>

      <p className="mt-8 text-xs text-zinc-500">Decision support only. Verify with your lender, accountant, and the permitting office.</p>
    </ParcelShell>
  );
}
