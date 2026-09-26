// "Does it pencil?" on the parcel page (server component). The numbers come from the engine's
// cost builder and finance module; the form below re-requests the page with pf_* query keys, so
// every recalculation runs on the server with the same code as the PDF report.

import Link from "next/link";
import { assumptions, finance } from "@easescore/engine";
import { PF } from "@/lib/proforma";

type SP = Record<string, string | string[] | undefined>;

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}` : "—");
const pct = (share: number | null | undefined) => (typeof share === "number" && Number.isFinite(share) ? `${share < 0 ? "−" : ""}${Math.abs(share * 100).toFixed(1)}%` : "—");

const VERDICT_STYLE: Record<string, string> = {
  yes: "bg-emerald-100 text-emerald-800",
  thin: "bg-amber-100 text-amber-800",
  no: "bg-red-100 text-red-800",
};
const VERDICT_TEXT: Record<string, string> = { yes: "Pencils", thin: "Thin", no: "Does not pencil" };
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

export default function ProFormaPanel({ parid, result, strategyLabel, sp }: {
  parid: string;
  result: assumptions.ProFormaResult;
  strategyLabel: string;
  sp: SP;
}) {
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
  const groups = ["land", "hard", "soft", "contingency", "financing"] as const;

  return (
    <section aria-label="Does it pencil?" className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Does it pencil? · {strategyLabel} · {sale ? "to sell" : "to rent"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {r.verdict && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${VERDICT_STYLE[r.verdict]}`}>{VERDICT_TEXT[r.verdict]}</span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${EVIDENCE_STYLE[p.evidence]}`}>{EVIDENCE_TEXT[p.evidence]}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{p.configVersion}</span>
      </div>
      <p className="mt-2 text-sm text-slate-900">{r.headline}</p>

      {r.sentences.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-800">
          {r.sentences.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Total cost</p>
          <p className="text-sm font-semibold tabular-nums text-slate-900">{usd(r.tdc)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{sale ? "Profit" : "NOI / year"}</p>
          <p className="text-sm font-semibold tabular-nums text-slate-900">{usd(sale ? r.sale.profit : r.rent.noi)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500" title={sale ? "Profit ÷ total cost" : "NOI ÷ total cost"}>{sale ? "Margin" : "Yield on cost"}</p>
          <p className="text-sm font-semibold tabular-nums text-slate-900">{pct(sale ? r.sale.margin : r.rent.yieldOnCost)}</p>
        </div>
      </div>

      {p.exclusions.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[13px] text-amber-950">
          <p className="font-semibold">Not included yet (cost unknown, so the total is low by these amounts)</p>
          <ul className="mt-0.5 space-y-0.5">
            {p.exclusions.map((e) => <li key={e.id}>{e.text}. <span className="text-amber-900/70">{e.reason}.</span></li>)}
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

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 underline decoration-dotted underline-offset-2">Cost lines and sources</summary>
        <table className="mt-1 w-full text-left text-[12px]">
          <tbody>
            {groups.map((g) => {
              const rows = r.budget.filter((b) => b.group === g);
              if (!rows.length) return null;
              return [
                <tr key={`h-${g}`}><td colSpan={2} className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_TEXT[g]}</td></tr>,
                ...rows.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="py-0.5 pr-2">
                      <span className="text-slate-800">{b.label}</span>
                      <span className="block text-[11px] text-slate-500">{b.basis} · {b.sourceLabel}</span>
                    </td>
                    <td className="py-0.5 text-right tabular-nums text-slate-900">{usd(b.amount)}</td>
                  </tr>
                )),
              ];
            })}
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-1">Total development cost</td>
              <td className="py-1 text-right tabular-nums">{usd(r.tdc)}</td>
            </tr>
            <tr>
              <td className="text-[11px] text-slate-500">Per home · per finished sq ft</td>
              <td className="text-right text-[11px] tabular-nums text-slate-600">{usd(r.costPerUnit)} · {usd(r.costPerSf)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-slate-600">
          {sale ? <>Sale value: {p.revenue.sale.basis} ({p.revenue.sale.sourceLabel}).</> : <>Rent: {p.revenue.rent.basis} ({p.revenue.rent.sourceLabel}).</>}
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

      <details className="mt-2 rounded-lg border border-slate-200 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Change the assumptions</summary>
        <form method="get" action={`/parcel/${encodeURIComponent(parid)}`} className="mt-2 grid grid-cols-2 gap-2">
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
            <Link href={`/parcel/${encodeURIComponent(parid)}${reset.toString() ? `?${reset}` : ""}`} scroll={false} prefetch={false} className="text-xs text-slate-500 underline">Reset to defaults</Link>
          </div>
          <p className="col-span-2 text-[11px] text-slate-500">Blank fields use the default shown in grey. Percent fields take percents (8 = 8%).</p>
        </form>
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
