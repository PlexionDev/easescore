// "Does it pencil?" on the parcel page (server component). The numbers come from the engine's
// cost builder and finance module; the form below re-requests the page with pf_* query keys, so
// every recalculation runs on the server with the same code as the PDF report.

import Link from "next/link";
import { assumptions, finance } from "@easescore/engine";
import CompsMini from "./CompsMini";
import { PF } from "@/lib/proforma";
import { OpenDrawer } from "./Drawers";
import { PctRangeValue, RangeValue, SourceBadge, TriangulationStrip } from "./RangeBits";
import ProFormaLive, { type LiveInputs } from "./ProFormaLive";

type SP = Record<string, string | string[] | undefined>;

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}` : "—");

const VERDICT_STYLE: Record<string, string> = {
  yes: "bg-emerald-100 text-emerald-800",
  thin: "bg-red-100 text-red-800",
  no: "bg-red-100 text-red-800",
};
const VERDICT_TEXT: Record<string, string> = { yes: "Pencils", thin: "Doesn't pencil", no: "Doesn't pencil" };
const VERDICT_TIP = "Meets the target profit margin at default assumptions";
const EVIDENCE_TEXT: Record<assumptions.Evidence, string> = { complete: "Complete estimate", partial: "Partial estimate", missing: "Missing inputs" };
const EVIDENCE_STYLE: Record<assumptions.Evidence, string> = {
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  missing: "bg-slate-100 text-slate-600 ring-slate-200",
};
const GROUP_TEXT: Record<string, string> = { land: "Land", hard: "Hard costs", soft: "Soft costs", contingency: "Contingency", financing: "Financing and holding" };

function Field({ name, label, sp, placeholder, suffix, prefix }: { name: string; label: string; sp: SP; placeholder: string; suffix?: string; prefix?: string }) {
  const v = typeof sp[name] === "string" ? (sp[name] as string) : "";
  return (
    <label className="flex flex-col text-xs text-slate-600">
      {label}
      <span className="mt-0.5 flex items-center rounded border border-slate-300 bg-white px-1.5 focus-within:ring-2 focus-within:ring-slate-400">
        {prefix && <span className="text-slate-400">{prefix}</span>}
        <input name={name} inputMode="decimal" defaultValue={v} placeholder={placeholder} className="w-full min-w-0 bg-transparent px-1 py-1 text-sm text-slate-900 outline-none" />
        {suffix && <span className="text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

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

export default function ProFormaPanel({ parid, result, strategyLabel, sp, live, overrides }: {
  parid: string;
  result: assumptions.ProFormaResult;
  strategyLabel: string;
  sp: SP;
  /** When given, the panel runs in the browser: build-quality slider and editable budget lines recompute instantly. */
  live?: LiveInputs | null;
  overrides?: assumptions.CostOverrides;
}) {
  if (live) return <ProFormaLive parid={parid} live={live} initial={overrides ?? {}} strategyLabel={strategyLabel} />;
  const r = result;
  const p = r.plan;
  const cfg = assumptions.COST_CONFIG;
  const sale = p.tenure === "sale";
  const groups = ["land", "hard", "soft", "contingency", "financing"] as const;
  const minor = r.budget.filter((b) => b.minor);
  const minorSum = minor.reduce((t, b) => t + (b.amount ?? 0), 0);
  const rg = r.ranges;
  const gap = (rg.sale.profit?.likely ?? 0) < 0;
  const line = (id: string) => rg.lines.find((l) => l.id === id) ?? null;
  const minorRange = minor.reduce<assumptions.MoneyRange | null>((t, b) => {
    const x = line(b.id)?.range;
    return x ? { low: (t?.low ?? 0) + x.low, likely: (t?.likely ?? 0) + x.likely, high: (t?.high ?? 0) + x.high } : t;
  }, null);

  return (
    <section aria-label="Pro forma" className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Does it pencil? · {strategyLabel} · {sale ? "to sell" : "to rent"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {r.verdict && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${VERDICT_STYLE[r.verdict]}`} title={VERDICT_TIP} aria-describedby="pf-panel-verdict-tip">{VERDICT_TEXT[r.verdict]}<span id="pf-panel-verdict-tip" className="sr-only">{`Pencils = ${VERDICT_TIP.toLowerCase()}`}</span></span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${EVIDENCE_STYLE[p.evidence]}`}>{EVIDENCE_TEXT[p.evidence]}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{p.configVersion}</span>
      </div>
      {rg.headline && <p className="mt-2 text-base font-semibold text-slate-900">{rg.headline}</p>}
      <p className="mt-1 text-sm text-slate-700">{r.headline}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">Ranges come from each input&apos;s documented range; the &ldquo;likely&rdquo; figure uses the defaults. Rounded to $1,000 per line and $10,000 for totals. {sale ? rg.sale.method : rg.rent.method}</p>

      {p.units != null && p.finishedSf != null && (
        <p className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-800">
          <b>Size:</b> {p.units} home{p.units === 1 ? "" : "s"} × {Math.round(p.finishedSf / p.units).toLocaleString("en-US")} sq ft finished
          {p.units > 1 ? ` (${p.finishedSf.toLocaleString("en-US")} sq ft total)` : ""}. <span className="text-slate-500">{p.sizeBasis}.</span>
        </p>
      )}
      {p.sizeWarning && <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-950">{p.sizeWarning}</p>}
      {p.priceCheck && <p className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[13px] text-sky-950">{p.priceCheck}</p>}
      {sale && <CompBlock plan={p} comps={p.valueComps} floor={p.floor?.text ?? null} newBuild={p.strategy !== "rehab_existing"} />}

      {r.sentences.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-800">
          {r.sentences.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

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
      <ul className="mt-2 space-y-1 text-[12px] text-slate-700">
        <li className="flex flex-wrap items-center gap-1"><b>Land:</b> <RangeValue r={rg.land.range} /> <SourceBadge s={rg.land.source} /></li>
        {sale
          ? <li className="flex flex-wrap items-center gap-1"><b>Value:</b> {rg.sale.pricePerSf ? `$${rg.sale.pricePerSf.low}–$${rg.sale.pricePerSf.high}/SF (likely $${rg.sale.pricePerSf.likely})` : "not set"} <SourceBadge s={rg.sale.source} /> <span className="text-[11px] text-slate-500">{rg.sale.basis}</span></li>
          : <li className="flex flex-wrap items-center gap-1"><b>Rent:</b> {rg.rent.monthlyPerUnit ? `$${rg.rent.monthlyPerUnit.low.toLocaleString("en-US")}–$${rg.rent.monthlyPerUnit.high.toLocaleString("en-US")} a month (likely $${rg.rent.monthlyPerUnit.likely.toLocaleString("en-US")})` : "not set"} <SourceBadge s={rg.rent.source} /> <span className="text-[11px] text-slate-500">{rg.rent.basis}</span></li>}
      </ul>

      {p.exclusions.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[13px] text-amber-950">
          <p className="font-semibold">Not included yet (cost unknown, so the total is low by these amounts)</p>
          <ul className="mt-0.5 space-y-0.5">
            {p.exclusions.map((e) => <li key={e.id}>{e.text}. <span className="text-amber-800">{e.reason}.</span></li>)}
          </ul>
          <p className="mt-1 text-[11px] text-amber-900/80">Enter a cost below to include it.</p>
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
            {p.adders.map((a) => (
              <li key={a.id}>{a.reason} <span className="text-[11px] text-slate-500">({a.sourceLabel}{a.range ? `; range ${a.range}` : ""})</span></li>
            ))}
          </ul>
        </div>
      )}

      <details open className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 underline decoration-dotted underline-offset-2">Cost lines, ranges and sources</summary>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">Badges: <SourceBadge s={{ kind: "badge", badge: "Pittsburgh builders (2026)", label: "Pittsburgh builders (2026)", asOf: null }} /> published local source · <SourceBadge s={{ kind: "data", badge: null, label: "Public data (dated)", asOf: null }} /> dataset · <SourceBadge s={{ kind: "badge", badge: "Assumption, edit me", label: "Assumption, edit me", asOf: null }} /> our assumption: edit it under &ldquo;Change the plan&rdquo;</p>
        <table className="mt-1 w-full text-left text-[12px]">
          <tbody>
            {groups.map((g) => {
              const rows = r.budget.filter((b) => b.group === g && !b.minor);
              if (!rows.length) return null;
              return [
                <tr key={`h-${g}`}><td colSpan={2} className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_TEXT[g]}</td></tr>,
                ...rows.map((b) => {
                  const l = line(b.id);
                  return (
                    <tr key={b.id} className="align-top">
                      <td className="py-1 pr-2">
                        <span className="text-slate-800">{b.label}</span> {l && <SourceBadge s={l.source} />}
                        <span className="block text-[11px] text-slate-500">{b.basis}{l ? ` · ${l.rangeBasis}` : ""}</span>
                        {l?.triangulation && l.triangulation.points.length > 1 && <TriangulationStrip t={l.triangulation} />}
                      </td>
                      <td className="py-1 text-right text-slate-900">{l ? <RangeValue r={l.range} /> : usd(b.amount)}</td>
                    </tr>
                  );
                }),
              ];
            })}
            <tr className="align-top">
              <td colSpan={2} className="pt-2">
                <details>
                  <summary className="flex cursor-pointer justify-between text-slate-800">
                    <span>Closing, selling &amp; carrying costs</span>
                    <span className="tabular-nums">{minorRange ? <RangeValue r={minorRange} /> : usd(minorSum)}</span>
                  </summary>
                  <table className="mt-1 w-full">
                    <tbody>
                      {minor.map((b) => (
                        <tr key={b.id} className="align-top">
                          <td className="py-0.5 pr-2 pl-3"><span className="text-slate-700">{b.label}</span> {line(b.id) && <SourceBadge s={line(b.id)!.source} />}<span className="block text-[11px] text-slate-500">{b.basis}{line(b.id) ? ` · ${line(b.id)!.rangeBasis}` : ""}</span></td>
                          <td className="py-0.5 text-right text-slate-700">{line(b.id) ? <RangeValue r={line(b.id)!.range} /> : usd(b.amount)}</td>
                        </tr>
                      ))}
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
                  <span className="block text-[11px] text-slate-500">Default $0 (cost-to-build basis). Enter it under &ldquo;Change the plan&rdquo;; it is taken from the sale price with the selling costs, not part of the total below.</span>
                </td>
                <td className="py-1 text-right tabular-nums text-slate-900">{usd(p.salesCommission)}</td>
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
        <p className="mt-1 text-[11px] text-slate-600">
          {sale ? <>Sale value: {p.revenue.sale.basis} ({p.sources.sale.label}).</> : <>Rent: {p.revenue.rent.basis} ({p.sources.rent.label}).</>} Land: {p.sources.land.label}.
        </p>
        <p className="text-[11px] text-slate-600">Size: {p.sizeBasis}.</p>
        {p.msiPremium?.status === "ok" && (
          <p className="text-[11px] text-slate-600">Mine subsidence insurance: {usd(p.msiPremium.value)} a year on {usd(p.msiCoverage)} of coverage ({p.msiPremium.formula}).</p>
        )}
        {p.notes.map((n) => <p key={n} className="text-[11px] text-slate-500">{n}</p>)}
      </details>

      <p className="mt-2 text-[12px] text-slate-700">{r.benchmark.line}</p>
      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer text-slate-500 underline decoration-dotted underline-offset-2">Which projects?</summary>
        <ul className="mt-1 list-disc pl-4">
          {r.benchmark.projects.map((b) => <li key={b.name}>{b.name}: {b.type}, {b.units} homes, {usd(b.totalCost)} ({usd(b.perUnit)} per home). Source: {b.sourceLabel}.</li>)}
        </ul>
        <p className="mt-1">{cfg.benchmarks.homeownershipSubsidy.label}: {usd(cfg.benchmarks.homeownershipSubsidy.range[0])} to {usd(cfg.benchmarks.homeownershipSubsidy.range[1])}.</p>
        <p>{cfg.construction.nationalReference.label}: {usd(cfg.construction.nationalReference.value)}/SF ({cfg.construction.nationalReference.sourceLabel}).</p>
      </details>

      <OpenDrawer id="plan" className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-500">
        Change the plan
      </OpenDrawer>

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

/** The pf_* assumptions form, shown in the "Change the plan" drawer. */
export function AssumptionsForm({ parid, result, sp }: { parid: string; result: assumptions.ProFormaResult; sp: SP }) {
  const r = result;
  const p = r.plan;
  const cfg = assumptions.COST_CONFIG;
  const sale = p.tenure === "sale";
  const pfKeys = new Set<string>(Object.values(PF));
  const keep = Object.entries(sp).filter(([k, v]) => typeof v === "string" && !pfKeys.has(k)) as [string, string][];
  const reset = new URLSearchParams(keep);
  const def = (key: string) => p.assumptions.find((a) => a.key === key);
  const mineApplies = p.minePath != null;
  const excluded = new Set(p.exclusions.map((e) => e.id));
  return (
    <section aria-label="Cost assumptions" className="rounded-xl border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-900">Cost assumptions</h3>
      <p className="text-[11px] text-slate-500">For {p.strategy === "rehab_existing" ? "fixing up the building" : "the selected building type"}. Blank fields use the default shown in grey.</p>
      <form method="get" action={`/parcel/${encodeURIComponent(parid)}#drawer=plan`} className="mt-2 grid grid-cols-2 gap-2">
        {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex flex-col text-xs text-slate-600">Sell or rent
          <select name={PF.tenure} defaultValue={typeof sp[PF.tenure] === "string" ? (sp[PF.tenure] as string) : ""} className="mt-0.5 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900">
            <option value="">Default ({sale ? "sell" : "rent"})</option>
            <option value="sale">Sell</option>
            <option value="rent">Rent</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">Construction quality
          <select name={PF.tier} defaultValue={typeof sp[PF.tier] === "string" ? (sp[PF.tier] as string) : ""} className="mt-0.5 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900">
            <option value="">Default: {assumptions.tierOf(cfg, undefined).label}</option>
            {cfg.construction.tiers.map((t) => <option key={t.id} value={t.id}>{t.label} ({usd(t.costPerSf.value)}/SF)</option>)}
          </select>
        </label>
        <Field name={PF.costPerSf} label="Cost per finished sq ft" prefix="$" sp={sp} placeholder={String(p.costPerSf)} />
        <Field name={PF.land} label={p.strategy === "rehab_existing" ? "Purchase price" : "Land price"} prefix="$" sp={sp} placeholder={p.land.value != null ? String(Math.round(p.land.value)) : "enter"} />
        {sale
          ? <Field name={PF.salePricePerSf} label="Sale price per sq ft" prefix="$" sp={sp} placeholder={p.revenue.sale.pricePerSf != null ? String(Math.round(p.revenue.sale.pricePerSf)) : "enter"} />
          : <Field name={PF.rentPerUnit} label="Rent per home, monthly" prefix="$" sp={sp} placeholder={p.revenue.rent.perUnit != null ? String(Math.round(p.revenue.rent.perUnit)) : "enter"} />}
        {sale && <Field name={`${PF.lineAmounts}sales_commission`} label="Sales commission, all homes (default $0)" prefix="$" sp={sp} placeholder="0" />}
        {p.adders.some((a) => a.id === "steep_slope" || a.id === "moderate_slope") && (
          <Field name={PF.slopeAdderPerSf} label="Hillside adder per sq ft" prefix="$" sp={sp} placeholder={String(p.adders.find((a) => a.perSf != null)?.perSf ?? "")} />
        )}
        <Field name={PF.aeShare} label="Architecture & engineering" suffix="%" sp={sp} placeholder={String(+(p.shares.ae * 100).toFixed(2))} />
        <Field name={PF.permitShare} label="Permits & fees" suffix="%" sp={sp} placeholder={String(+(p.shares.permits * 100).toFixed(2))} />
        <Field name={PF.softOtherShare} label="Survey, title, legal" suffix="%" sp={sp} placeholder={String(+(p.shares.other * 100).toFixed(2))} />
        <Field name={PF.contingencyShare} label={`Contingency (${p.shares.contingencyKind})`} suffix="%" sp={sp} placeholder={String(+(p.shares.contingency * 100).toFixed(2))} />
        <Field name={PF.constructionRate} label="Construction loan rate" suffix="%" sp={sp} placeholder={def("constructionRate") ? def("constructionRate")!.value.replace("%", "") : "enter"} />
        <Field name={PF.ltc} label="Loan-to-cost" suffix="%" sp={sp} placeholder={def("ltc")?.value.replace("%", "") ?? ""} />
        <Field name={PF.approvalMonths} label="Months to approval" sp={sp} placeholder={def("approvalMonths")?.value ?? ""} />
        <Field name={PF.constructionMonths} label="Months to build" sp={sp} placeholder={def("constructionMonths")?.value ?? ""} />
        <p className="col-span-2 mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your program (optional)</p>
        <Field name={PF.units} label="Homes" sp={sp} placeholder={p.units != null ? String(p.units) : ""} />
        <Field name={PF.storiesAboveGarage} label="Living floors (above any garage)" sp={sp} placeholder={p.program ? String(p.program.storiesAboveGarage) : ""} />
        <label className="flex flex-col text-xs text-slate-600">Parking
          <select name={PF.parking} defaultValue={typeof sp[PF.parking] === "string" ? (sp[PF.parking] as string) : ""} className="mt-0.5 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900">
            <option value="">Site-fit default</option>
            <option value="tuck_under">Tuck-under garage (ground floor)</option>
            <option value="pad">Parking pad</option>
            <option value="none">None</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field name={PF.bedrooms} label="Bedrooms" sp={sp} placeholder="—" />
          <Field name={PF.baths} label="Baths" sp={sp} placeholder="—" />
        </div>
        <Field name={PF.costPerUnit} label="Construction cost per home" prefix="$" sp={sp} placeholder="use tier × sq ft" />
        <label className="flex flex-col text-xs text-slate-600">Per-home cost includes site work &amp; foundation?
          <select name={PF.costIncludesSite} defaultValue={typeof sp[PF.costIncludesSite] === "string" ? (sp[PF.costIncludesSite] as string) : ""} className="mt-0.5 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900">
            <option value="">No (site adders added on top)</option>
            <option value="yes">Yes (no site adders)</option>
          </select>
        </label>
        {sale && <Field name={PF.salePricePerUnit} label="Sale price per home" prefix="$" sp={sp} placeholder={p.revenue.sale.pricePerUnit != null ? String(Math.round(p.revenue.sale.pricePerUnit)) : "enter"} />}
        {mineApplies && (
          <label className="flex flex-col text-xs text-slate-600">Mine subsidence path
            <select name={PF.minePath} defaultValue={typeof sp[PF.minePath] === "string" ? (sp[PF.minePath] as string) : ""} className="mt-0.5 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900">
              <option value="">Default ({p.minePath})</option>
              <option value="grouting">Grouting</option>
              <option value="insurance">Insurance</option>
            </select>
          </label>
        )}
        {p.minePath === "grouting" && <Field name={PF.groutingCost} label="Grouting (lump sum)" prefix="$" sp={sp} placeholder={String(cfg.siteAdders.mineGrouting.value)} />}
        {(excluded.has("demolition") || p.lines.some((l) => l.id === "demolition")) && <Field name={PF.demolition} label="Demolition (total)" prefix="$" sp={sp} placeholder="not set" />}
        {(excluded.has("geotech") || p.lines.some((l) => l.id === "geotech")) && <Field name={PF.geotech} label="Geotechnical report" prefix="$" sp={sp} placeholder="not set" />}
        {(excluded.has("dumpsters") || p.lines.some((l) => l.id === "dumpsters")) && <Field name={PF.dumpsters} label="Dumpsters & street permit" prefix="$" sp={sp} placeholder="not set" />}
        <div className="col-span-2 flex items-center gap-3">
          <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">Recalculate</button>
          <Link href={`/parcel/${encodeURIComponent(parid)}${reset.toString() ? `?${reset}` : ""}#drawer=plan`} scroll={false} prefetch={false} className="text-xs text-slate-500 underline">Reset to defaults</Link>
        </div>
        <p className="col-span-2 text-[11px] text-slate-500">Blank fields use the default shown in grey. Percent fields take percents (8 = 8%).</p>
      </form>
    </section>
  );
}
