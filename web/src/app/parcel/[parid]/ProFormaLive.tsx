"use client";

// "Does it pencil?" computed in the browser: the build-quality slider and every budget line re-run the
// engine pro forma (lib/quickfit-gen.ts financeFor: the same code the server and the PDF report use)
// instantly. Edits are kept in the URL (pf_tier, pf_line_<id>) with history.replaceState, so a reload
// or the report keeps them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assumptions, finance, rents, type score } from "@easescore/engine";
import CompsMini from "./CompsMini";
import { financeFor, type FinanceInputs, type SteppingResult } from "@/lib/quickfit-gen";
import type { quickfit } from "@easescore/engine";
import { PctRangeValue, RangeValue, SourceBadge, TriangulationStrip } from "./RangeBits";
import { CommunityMedian, ScenarioShare, useCommunity } from "@/components/scenarios/ScenarioShare";
import DecisionLive from "./DecisionLive";
import { OpenDrawer } from "./Drawers";

export interface LiveInputs {
  fin: FinanceInputs;
  strategy: score.StrategyId;
  scheme: quickfit.Scheme | null;
  stepping: SteppingResult | null;
}

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}` : "—");
const VERDICT_STYLE: Record<string, string> = { yes: "bg-emerald-100 text-emerald-800", thin: "bg-red-100 text-red-800", no: "bg-red-100 text-red-800" };
const VERDICT_TEXT: Record<string, string> = { yes: "Pencils", thin: "Doesn't pencil", no: "Doesn't pencil" };
const VERDICT_TIP = "Meets the target profit margin at default assumptions";
const EVIDENCE_TEXT: Record<assumptions.Evidence, string> = { complete: "Complete estimate", partial: "Partial estimate", missing: "Missing inputs" };
const EVIDENCE_STYLE: Record<assumptions.Evidence, string> = {
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  missing: "bg-slate-100 text-slate-600 ring-slate-200",
};
const GROUP_TEXT: Record<string, string> = { land: "Land", hard: "Hard costs", soft: "Soft costs", contingency: "Contingency", financing: "Financing and holding" };
/** Budget lines you can type your own number into (financing lines follow the loan terms). */
const EDITABLE = new Set(["land", "hard_base", "garage_level", "slope_adder", "retaining_walls", "grouting", "demolition", "geotech", "dumpsters", "ae", "permits", "other_soft", "contingency"]);
const LINE_KEY = "pf_line_";

type Comps = assumptions.DevelopmentPlan["valueComps"];

function CompBlock({ comps, floor, newBuild, plan }: { comps: Comps; floor: string | null; newBuild: boolean; plan: assumptions.DevelopmentPlan }) {
  const c = comps as assumptions.CompSet | null;
  const title = newBuild ? "New-construction comps" : "Comparable sales";
  if (!c) return <p className="mt-1.5 text-[12px] text-slate-600"><b>{title}:</b> not available for this lot.{floor ? ` ${floor}` : ""}</p>;
  const full = "median_living_area_sqft" in c;
  return (
    <div className="mt-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700">
      <p>
        <b>{title}:</b> {c.status === "ok" ? "" : "insufficient — "}{c.count} sale{c.count === 1 ? "" : "s"} within {c.radius_mi} mi
        {c.median_price != null ? ` · median ${usd(c.median_price)}` : ""}
        {c.median_price_per_sqft != null ? ` · ${usd(c.median_price_per_sqft)}/SF` : ""}
        {full && c.median_living_area_sqft != null ? ` · ${Math.round(c.median_living_area_sqft).toLocaleString("en-US")} sq ft` : ""}
        {full && c.year_built_range ? ` · built ${c.year_built_range.from}–${c.year_built_range.to}` : ""}
        {c.date_range?.from ? ` · sold ${c.date_range.from} to ${c.date_range.to}` : ""}
      </p>
      {c.search_steps?.length ? <p className="text-[11px] text-slate-500">Search: {c.search_steps.join(" → ")}.</p> : null}
      {c.note && <p className="text-[11px] text-slate-500">{c.note}</p>}
      {c.selection && <p className="text-[11px] text-slate-600">{c.selection.receipt}</p>}
      {c.selection && c.selection.dropped.length > 0 && (
        <ul className="text-[11px] text-slate-500">
          {c.selection.dropped.map((d) => <li key={`${d.row.parid}${d.row.saleDate}`}>Dropped: {d.row.saleDate} · {usd(d.row.price)} · {d.reason}.</li>)}
        </ul>
      )}
      {floor && <p className="text-[11px] text-amber-800">{floor}</p>}
      {full && c.kind === "new_construction" && <CompsMini plan={plan} />}
      {full && c.kind !== "new_construction" && c.comps.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-slate-500 underline decoration-dotted underline-offset-2">The sales</summary>
          <ul className="mt-0.5 max-h-40 overflow-auto">
            {c.comps.map((x) => (
              <li key={`${x.parid}${x.saleDate}`}>{x.saleDate} · {usd(x.price)} · {x.livingAreaSqft.toLocaleString("en-US")} sq ft · {usd(x.pricePerSqft)}/SF{x.yearBuilt ? ` · built ${x.yearBuilt}` : ""} · {x.distanceMi} mi{x.address ? ` · ${assumptions.blockLevelAddressOf(x.address)}` : ""}</li>
            ))}
          </ul>
          <p className="text-slate-500">{c.rule}</p>
        </details>
      )}
    </div>
  );
}

/** Build-quality slider: one stop per tier; shows the chosen $/SF, its range and its source. */
function QualitySlider({ tierId, onTier }: { tierId: string; onTier: (id: string) => void }) {
  const tiers = assumptions.COST_CONFIG.construction.tiers;
  const i = Math.max(0, tiers.findIndex((t) => t.id === tierId));
  const t = tiers[i]!;
  const top = t.id === "custom" ? "+" : "";
  const def = assumptions.COST_CONFIG.construction.defaultTier;
  const sourceOf = (x: typeof t) => x.costPerSf.sourceLabel;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor="pf-quality" className="text-xs font-semibold text-slate-700">Build quality</label>
        <p className="text-[13px] text-slate-900"><b>{t.label}</b>{t.id === def ? " (default)" : ""} · ${t.costPerSf.value}/SF <span className="text-slate-600">(range ${t.costPerSf.range[0]}–${t.costPerSf.range[1]}{top}/SF)</span></p>
      </div>
      <input id="pf-quality" type="range" min={0} max={tiers.length - 1} step={1} value={i} onChange={(e) => onTier(tiers[Number(e.target.value)]!.id)}
        aria-valuetext={`${t.label}, $${t.costPerSf.value} per sq ft`} className="mt-1 w-full accent-slate-900" list="pf-quality-stops" />
      <div className="grid text-[10px] text-slate-500" style={{ gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))` }}>
        {tiers.map((x, k) => (
          <button key={x.id} type="button" aria-pressed={x.id === t.id} onClick={() => onTier(x.id)} className={`min-h-6 leading-tight ${k === 0 ? "text-left" : k === tiers.length - 1 ? "text-right" : "text-center"} ${x.id === t.id ? "font-semibold text-slate-900" : ""}`}>
            <span className="block">{x.label.replace(/ \(spec\)$/, "")}</span>
            <span className="block tabular-nums">${x.costPerSf.value}/SF</span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-600">{t.meaning}. Cost to build per finished sq ft, builder fee removed; site adders are separate lines. Cross-check: {t.retail.label}.</p>
      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer underline decoration-dotted underline-offset-2">Source: {sourceOf(t)}</summary>
        <p className="mt-0.5">{t.costPerSf.sourceNote}</p>
      </details>
    </div>
  );
}

function LineEditor({ id, value, mine, onSet, onReset }: { id: string; value: number | null; mine: boolean; onSet: (id: string, v: number) => void; onReset: (id: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft.replace(/[$,\s]/g, ""));
    if (draft.trim() !== "" && Number.isFinite(n) && n >= 0) onSet(id, Math.round(n));
    setDraft(null);
  };
  return (
    <span className="mt-0.5 flex items-center justify-end gap-1">
      <span className="flex items-center rounded border border-slate-300 bg-white px-1 focus-within:ring-2 focus-within:ring-slate-400">
        <span className="text-[11px] text-slate-400">$</span>
        <input aria-label={`Your number for ${id.replace(/_/g, " ")}`} inputMode="numeric" className="w-[5.5rem] bg-transparent px-0.5 py-0.5 text-right text-[12px] tabular-nums text-slate-900 outline-none"
          placeholder={value != null ? Math.round(value).toLocaleString("en-US") : "enter"}
          value={draft ?? (value != null ? Math.round(value).toLocaleString("en-US") : "")} onChange={(e) => setDraft(e.target.value)} onFocus={() => setDraft("")} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setDraft(null); }} />
      </span>
      {mine && <button type="button" onClick={() => onReset(id)} className="text-[10px] text-sky-800 underline" title="Back to the estimate">reset</button>}
    </span>
  );
}

/** Rehab is never estimated automatically: the visitor enters a budget (total or per sq ft), which prices the construction line. */
function RehabBudget({ finishedSf, total, onSet, onReset }: { finishedSf: number | null; total: number | null; onSet: (v: number) => void; onReset: () => void }) {
  const [draft, setDraft] = useState("");
  const [per, setPer] = useState<"total" | "sf">("total");
  const commit = () => {
    const v = Number(draft.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return;
    onSet(per === "sf" && finishedSf ? Math.round(v * finishedSf) : Math.round(v));
    setDraft("");
  };
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12px] text-slate-700">
      <p>Renovate the existing building: not evaluated. Condition inside is unknown; needs an inspection. Rehab is not estimated automatically.</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <label htmlFor="pf-rehab-budget" className="font-semibold">Enter your rehab budget</label>
        <input id="pf-rehab-budget" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="$"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} className="w-24 rounded border border-slate-400 px-1.5 py-0.5 text-right tabular-nums" />
        <label htmlFor="pf-rehab-per" className="sr-only">Budget is</label>
        <select id="pf-rehab-per" value={per} onChange={(e) => setPer(e.target.value as "total" | "sf")} className="rounded border border-slate-400 px-1 py-0.5">
          <option value="total">total</option>
          <option value="sf" disabled={!finishedSf}>per sq ft</option>
        </select>
        <button type="button" onClick={commit} className="min-h-6 rounded border border-slate-400 bg-white px-2 py-0.5 font-semibold">Use</button>
        {total != null && <button type="button" onClick={onReset} className="text-[11px] text-sky-800 underline">clear</button>}
      </div>
      {total != null && <p className="mt-1 text-[11px] text-slate-600">Your rehab budget: {usd(total)}. The after-repair value comes from Good-or-better comparable sales, based on your rehab budget.</p>}
    </div>
  );
}

export default function ProFormaLive({ parid, live, initial, strategyLabel }: { parid: string; live: LiveInputs; initial: assumptions.CostOverrides; strategyLabel: string }) {
  const [over, setOver] = useState<assumptions.CostOverrides>(initial);
  // Rents by bedroom from nearby listings (RentCast via /api/rents): loaded after the page, never blocking it.
  // Until they arrive (or without them) the rent is the labeled HUD / ZIP-index benchmark.
  const [rentsBr, setRentsBr] = useState<assumptions.PlanArgs["rentsByBedroom"]>(live.fin.rentsByBedroom ?? null);
  useEffect(() => {
    if (live.fin.rentsByBedroom) return;
    const ac = new AbortController();
    fetch(`/api/rents/${encodeURIComponent(parid)}`, { signal: ac.signal })
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => { if (j && j.byBedroom) setRentsBr(j); })
      .catch(() => {});
    return () => ac.abort();
  }, [parid, live.fin.rentsByBedroom]);
  const r = useMemo(() => {
    try {
      return financeFor({ ...live.fin, overrides: over, rentsByBedroom: rentsBr }, live.strategy, live.scheme, live.stepping).pf;
    } catch {
      return null;
    }
  }, [live, over, rentsBr]);

  // Scenario data loop (TODO 6): off unless the server enables it; see components/scenarios.
  const community = useCommunity(parid, live.strategy, r?.plan.tier.id ?? null);

  const sync = useCallback((o: assumptions.CostOverrides) => {
    try {
      const u = new URL(window.location.href);
      if (o.tier) u.searchParams.set("pf_tier", o.tier); else u.searchParams.delete("pf_tier");
      for (const k of [...u.searchParams.keys()]) if (k.startsWith(LINE_KEY)) u.searchParams.delete(k);
      for (const [k, v] of Object.entries(o.lineAmounts ?? {})) u.searchParams.set(`${LINE_KEY}${k}`, String(v));
      window.history.replaceState(window.history.state, "", u);
    } catch { /* URL sync is a convenience */ }
  }, []);
  const update = (f: (o: assumptions.CostOverrides) => assumptions.CostOverrides) => setOver((o) => { const n = f(o); sync(n); return n; });
  const setTier = (id: string) => update((o) => ({ ...o, tier: id }));
  const setLine = (id: string, v: number) => update((o) => ({ ...o, lineAmounts: { ...(o.lineAmounts ?? {}), [id]: v } }));
  const resetLine = (id: string) => update((o) => {
    const la = { ...(o.lineAmounts ?? {}) };
    delete la[id];
    // The drawer's own override for the same line goes too, so "reset" returns to the estimate.
    const n: assumptions.CostOverrides = { ...o, lineAmounts: la };
    if (id === "land") delete n.land;
    return n;
  });
  const resetAll = () => update((o) => ({ ...o, tier: undefined, lineAmounts: {} }));

  if (!r) return <p className="text-sm text-slate-600">No cost and value estimate for this option yet.</p>;
  const p = r.plan;
  const cfg = assumptions.COST_CONFIG;
  const sale = p.tenure === "sale";
  const rehab = p.strategy === "rehab_existing";
  const groups = ["land", "hard", "soft", "contingency", "financing"] as const;
  const minor = r.budget.filter((b) => b.minor);
  const rg = r.ranges;
  const gap = (rg.sale.profit?.likely ?? 0) < 0;
  const line = (id: string) => rg.lines.find((l) => l.id === id) ?? null;
  const mine = (id: string) => p.userLines.includes(id) || (id === "land" && p.sources.land.kind === "user");
  const minorRange = minor.reduce<assumptions.MoneyRange | null>((t, b) => {
    const x = line(b.id)?.range;
    return x ? { low: (t?.low ?? 0) + x.low, likely: (t?.likely ?? 0) + x.likely, high: (t?.high ?? 0) + x.high } : t;
  }, null);
  const anyEdits = !!over.tier || Object.keys(over.lineAmounts ?? {}).length > 0;
  const rentE = p.rentEstimate;

  const lineRow = (b: assumptions.BudgetLine, indent = false) => {
    const l = line(b.id);
    const you = mine(b.id);
    return (
      <tr key={b.id} className="align-top">
        <td className={`py-1 pr-2 ${indent ? "pl-3" : ""}`}>
          <span className="text-slate-800">{b.label}</span> {you ? <SourceBadge s={{ kind: "user", badge: null, label: "Your number", asOf: null }} /> : l && <SourceBadge s={l.source} />}
          <span className="block text-[11px] text-slate-500">{b.basis}{l && !you ? ` · ${l.rangeBasis}` : ""}</span>
          {l?.triangulation && l.triangulation.points.length > 1 && <TriangulationStrip t={l.triangulation} />}
        </td>
        <td className="py-1 text-right text-slate-900">
          {l ? <RangeValue r={l.range} /> : usd(b.amount)}
          {EDITABLE.has(b.id) && <LineEditor id={b.id} value={b.amount} mine={you} onSet={setLine} onReset={resetLine} />}
          {EDITABLE.has(b.id) && <CommunityMedian m={community.medians[b.id]} enabled={community.enabled} />}
        </td>
      </tr>
    );
  };

  return (
    <section aria-label="Pro forma" className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <LiveResult text={`${r.verdict ? `${VERDICT_TEXT[r.verdict]}. ` : ""}${rg.headline ? `${rg.headline}. ` : ""}${r.headline}`} />
      {rehab ? (
        <RehabBudget finishedSf={p.finishedSf} total={over.lineAmounts?.hard_base ?? null} onSet={(v) => setLine("hard_base", v)} onReset={() => resetLine("hard_base")} />
      ) : (
        <QualitySlider tierId={over.tier ?? p.tier.id} onTier={setTier} />
      )}

      <div className="mt-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Does it pencil? · {strategyLabel} · {sale ? "to sell" : "to rent"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {r.verdict && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${VERDICT_STYLE[r.verdict]}`} title={VERDICT_TIP} aria-describedby="pf-live-verdict-tip">{VERDICT_TEXT[r.verdict]}<span id="pf-live-verdict-tip" className="sr-only">{`Pencils = ${VERDICT_TIP.toLowerCase()}`}</span></span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${EVIDENCE_STYLE[p.evidence]}`}>{EVIDENCE_TEXT[p.evidence]}</span>
            {p.land.flag && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900 ring-1 ring-violet-200">{p.land.flag}</span>}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{p.configVersion}</span>
      </div>

      {rg.headline && <p className="mt-2 text-base font-semibold text-slate-900">{rg.headline}</p>}
      <DecisionLive result={r} />
      <p className="mt-1 text-[11px] text-slate-600">Sale price, land price, loan rate and loan-to-cost: <OpenDrawer id="plan" className="min-h-6 font-semibold underline decoration-dotted underline-offset-2 hover:text-slate-900">Change the plan</OpenDrawer>. Budget lines: type your own number below.</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Total cost</p>
          <p className="text-sm"><RangeValue r={rg.tdc} strong /></p>
        </div>
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{sale ? (gap ? "Gap (short)" : "Profit") : "NOI / year"}</p>
          <p className="text-sm"><RangeValue r={sale ? (gap && rg.sale.profit ? { low: -rg.sale.profit.high, likely: -rg.sale.profit.likely, high: -rg.sale.profit.low } : rg.sale.profit) : rg.rent.noi} strong /></p>
          {sale && r.sellOutCarry ? <p className="text-[10px] leading-tight text-slate-600">before about ${Math.round(r.sellOutCarry / 1000)}K of loan interest after completion</p> : null}
        </div>
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500" title={sale ? "Profit ÷ total cost" : "NOI ÷ total cost"}>{sale ? "Margin" : "Yield on cost"}</p>
          <p className="text-sm"><PctRangeValue r={sale ? rg.sale.marginPct : rg.rent.yieldOnCostPct} /></p>
        </div>
      </div>
      {p.units != null && p.finishedSf != null && (
        <p className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-800">
          <b>Layout:</b> {live.scheme?.id ? "the QuickFit layout, " : ""}{p.units} home{p.units === 1 ? "" : "s"} × {Math.round(p.finishedSf / p.units).toLocaleString("en-US")} sq ft finished
          {p.units > 1 ? ` (${p.finishedSf.toLocaleString("en-US")} sq ft total)` : ""}. <span className="text-slate-500">{p.sizeBasis}.</span>
        </p>
      )}
      <div className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Development budget</h3>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Hard costs · soft costs · financing</p>
          </div>
          {anyEdits && <button type="button" onClick={resetAll} className="text-[11px] text-slate-600 underline">Reset all to the estimate</button>}
        </div>
        <p className="text-[11px] text-slate-500">A budget, not an invoice: every line is prefilled from the sources shown, low–likely–high. Type your own number on any line; it is marked &ldquo;Your number&rdquo; and everything recomputes.</p>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">Badges: <SourceBadge s={{ kind: "badge", badge: "Pittsburgh builders (2026)", label: "Pittsburgh builders (2026)", asOf: null }} /> published local source · <SourceBadge s={{ kind: "data", badge: null, label: "Public data (dated)", asOf: null }} /> dataset · <SourceBadge s={{ kind: "badge", badge: "Assumption, edit me", label: "Assumption, edit me", asOf: null }} /> our assumption · <SourceBadge s={{ kind: "user", badge: null, label: "Your number", asOf: null }} /> yours</p>
        <table className="mt-1 w-full text-left text-[12px]">
          <tbody>
            {groups.map((g) => {
              const rows = r.budget.filter((b) => b.group === g && !b.minor);
              if (!rows.length) return null;
              return [<tr key={`h-${g}`}><td colSpan={2} className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_TEXT[g]}</td></tr>, ...rows.map((b) => lineRow(b))];
            })}
            <tr className="align-top">
              <td colSpan={2} className="pt-2">
                <details>
                  <summary className="flex cursor-pointer justify-between text-slate-800">
                    <span>Closing, selling &amp; carrying costs</span>
                    <span className="tabular-nums">{minorRange ? <RangeValue r={minorRange} /> : usd(minor.reduce((t, b) => t + (b.amount ?? 0), 0))}</span>
                  </summary>
                  <table className="mt-1 w-full">
                    <tbody>
                      {minor.map((b) => lineRow(b, true))}
                      {sale && r.sale.sellingCosts != null && (
                        <tr className="align-top">
                          <td className="py-0.5 pr-2 pl-3"><span className="text-slate-700">Selling costs at sale (seller&apos;s transfer tax{p.salesCommission ? ", sales commission" : ""})</span><span className="block text-[11px] text-slate-500">Taken from the sale price, not part of the total below</span></td>
                          <td className="py-0.5 text-right tabular-nums text-slate-700">{usd(r.sale.sellingCosts)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </details>
              </td>
            </tr>
            {sale && (
              <tr className="align-top">
                <td className="py-1 pr-2">
                  <span className="text-slate-800">{p.salesCommission ? "Sales commission (your number)" : "Sales commission: not included (often 5–6% if listed with an agent)"}</span>
                  <span className="block text-[11px] text-slate-500">Default $0 (cost-to-build basis). A number you enter is taken from the sale price with the selling costs, not part of the total below.</span>
                </td>
                <td className="py-1 text-right text-slate-900">
                  {usd(p.salesCommission)}
                  <LineEditor id="sales_commission" value={p.salesCommission} mine={mine("sales_commission")} onSet={setLine} onReset={resetLine} />
                </td>
              </tr>
            )}
            <tr className="border-t border-slate-300 align-top font-semibold">
              <td className="py-1">Total development cost{line("tdc")?.triangulation && <TriangulationStrip t={line("tdc")!.triangulation!} />}</td>
              <td className="py-1 text-right"><RangeValue r={rg.tdc} strong /></td>
            </tr>
            <tr>
              <td className="text-[11px] text-slate-500">Per home · per finished sq ft</td>
              <td className="text-right text-[11px] tabular-nums text-slate-600">{usd(r.costPerUnit)} · {usd(r.costPerSf)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] font-medium text-slate-700">{assumptions.COST_CONFIG.disclaimer}</p>
        <p className="mt-1 text-[11px] text-slate-600">
          {sale ? <>Sale value: {p.revenue.sale.basis} ({p.sources.sale.label}).</> : <>Rent: {p.revenue.rent.basis} ({p.sources.rent.label}).</>} Land: {p.sources.land.label}.
        </p>
        {p.land.estimate && p.sources.land.kind !== "user" && <p className="text-[11px] text-slate-600">{p.land.estimate.basis}</p>}
        <p className="text-[11px] text-slate-600">Size: {p.sizeBasis}.</p>
        {p.msiPremium?.status === "ok" && <p className="text-[11px] text-slate-600">Mine subsidence insurance: {usd(p.msiPremium.value)} a year on {usd(p.msiCoverage)} of coverage ({p.msiPremium.formula}).</p>}
        {p.notes.map((n) => <p key={n} className="text-[11px] text-slate-500">{n}</p>)}
        <ScenarioShare enabled={community.enabled} parid={parid} strategy={live.strategy} scheme={live.scheme?.id ?? null} tier={p.tier.id}
          anyEdits={anyEdits || Object.keys(initial).length > 0} editsKey={JSON.stringify(over)}
          summary={{ units: p.units ?? undefined, finishedSf: p.finishedSf ?? undefined, tdc: rg.tdc?.likely, costPerSf: r.costPerSf ?? undefined, costPerUnit: r.costPerUnit ?? undefined,
            marginPct: rg.sale.marginPct?.likely, yieldPct: rg.rent.yieldOnCostPct?.likely, verdict: r.verdict ?? undefined, tenure: p.tenure }} />
      </div>

      <h3 className="mt-3 text-sm font-semibold text-slate-900">How we got these numbers</h3>
      <p className="mt-1 text-sm text-slate-700">{r.headline}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">Ranges come from each input&apos;s documented range; the &ldquo;likely&rdquo; figure uses the defaults. Rent to the nearest $50, sale price to $5,000 a home, cost lines to $1,000, totals to $10,000 — the math uses the rounded numbers. {sale ? rg.sale.method : rg.rent.method}</p>

      {p.sizeWarning && <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-950">{p.sizeWarning}</p>}
      {p.priceCheck && <p className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[13px] text-sky-950">{p.priceCheck}</p>}
      {sale && <CompBlock plan={p} comps={p.valueComps} floor={p.floor?.text ?? null} newBuild={!rehab} />}

      {r.sentences.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-800">
          {r.sentences.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      <ul className="mt-2 space-y-1 text-[12px] text-slate-700">
        <li className="flex flex-wrap items-center gap-1"><b>Land:</b> <RangeValue r={rg.land.range} /> <SourceBadge s={rg.land.source} />{p.rounding.land && <span className="text-[11px] text-slate-500">({p.rounding.land})</span>}</li>
        {sale
          ? <li className="flex flex-wrap items-center gap-1"><b>Value:</b> {rg.sale.pricePerSf ? `$${rg.sale.pricePerSf.low}–$${rg.sale.pricePerSf.high}/SF (likely $${rg.sale.pricePerSf.likely})` : "not set"} <SourceBadge s={rg.sale.source} /> <span className="text-[11px] text-slate-500">{rg.sale.basis}{p.rounding.sale ? `; ${p.rounding.sale}` : ""}</span></li>
          : (
            <li>
              <span className="flex flex-wrap items-center gap-1"><b>Rent:</b> {rg.rent.monthlyPerUnit ? `$${rg.rent.monthlyPerUnit.low.toLocaleString("en-US")}–$${rg.rent.monthlyPerUnit.high.toLocaleString("en-US")} a month (likely $${rg.rent.monthlyPerUnit.likely.toLocaleString("en-US")})` : "not set"} <SourceBadge s={rg.rent.source} /></span>
              {rentE && p.sources.rent.kind !== "user" && <span className="block text-[11px] text-slate-600">{rents.rentOneLiner(rentE)}</span>}
              {p.rounding.rent && <span className="block text-[11px] text-slate-500">{p.rounding.rent}.</span>}
              {rentE && <span className="block text-[11px] text-slate-500">{rentE.method} {rents.CAVEAT}</span>}
            </li>
          )}
        {!sale && p.assessedAfter && <li className="text-[11px] text-slate-600"><b className="text-[12px] text-slate-700">Property tax:</b> {p.assessedAfter.receipt}</li>}
      </ul>

      {p.exclusions.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[13px] text-amber-950">
          <p className="font-semibold">Not included yet (cost unknown, so the total is low by these amounts)</p>
          <ul className="mt-0.5 space-y-0.5">
            {p.exclusions.map((e) => <li key={e.id}>{e.text}. <span className="text-amber-800">{e.reason}.</span></li>)}
          </ul>
          <p className="mt-1 text-[11px] text-amber-900/80">Type a cost on its budget line below, or under &ldquo;Change the plan&rdquo;, to include it.</p>
        </div>
      )}
      {p.outliers.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          {p.outliers.map((o) => <li key={o}>{o}</li>)}
        </ul>
      )}
      {p.adders.length > 0 && (
        <div className="mt-2 text-[13px] text-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Site adders that apply</p>
          <ul className="mt-0.5 space-y-0.5">
            {p.adders.map((a) => <li key={a.id}>{a.reason} <span className="text-[11px] text-slate-500">({a.sourceLabel}{a.range ? `; range ${a.range}` : ""})</span></li>)}
          </ul>
        </div>
      )}

      <p className="mt-2 text-[12px] text-slate-700">{r.benchmark.line}</p>
      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer text-slate-500 underline decoration-dotted underline-offset-2">Which projects?</summary>
        <ul className="mt-1 list-disc pl-4">
          {r.benchmark.projects.map((b) => <li key={b.name}>{b.name}: {b.type}, {b.units} homes, {usd(b.totalCost)} ({usd(b.perUnit)} per home). Source: {b.sourceLabel}.</li>)}
        </ul>
        <p className="mt-1">{cfg.benchmarks.homeownershipSubsidy.label}: {usd(cfg.benchmarks.homeownershipSubsidy.range[0])} to {usd(cfg.benchmarks.homeownershipSubsidy.range[1])}.</p>
        <p>{cfg.construction.nationalReference.label}: {usd(cfg.construction.nationalReference.value)}/SF ({cfg.construction.nationalReference.sourceLabel}).</p>
      </details>

      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 underline decoration-dotted underline-offset-2">Every assumption, its range and source</summary>
        <table className="mt-1 w-full text-left">
          <tbody>
            {p.assumptions.map((a) => (
              <tr key={a.key} className="align-top">
                <td className="py-0.5 pr-2 text-slate-800">{a.label}{a.edited && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-800">edited</span>}</td>
                <td className="py-0.5 pr-2 tabular-nums text-slate-900">{a.value}{a.range ? <span className="block text-[10px] text-slate-500">range {a.range}</span> : null}</td>
                <td className="py-0.5 text-[11px] text-slate-500">{a.sourceLabel}{a.sourceNote ? ` — ${a.sourceNote}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="mt-2 text-[11px] text-slate-500">{finance.FINANCE_DISCLAIMER}</p>
    </section>
  );
}

/** Announces the result politely after an edit (a slider, tier or line change), never on first render. */
function LiveResult({ text }: { text: string }) {
  const first = useRef(text);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (text === first.current) return;
    const t = setTimeout(() => setSaid(`Updated. ${text}`), 700);
    return () => clearTimeout(t);
  }, [text]);
  return <p className="sr-only" role="status">{said}</p>;
}
