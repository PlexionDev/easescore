"use client";

// Decision box in the Pencil calculator: the same engine function as the report (assumptions.decisionBox),
// with the investment criteria editable here. Criteria edits are kept in the URL (dc_margin, dc_cont,
// dc_ltc, whole percents) with history.replaceState, so a reload or the PDF keeps them.

import { useEffect, useId, useState } from "react";
import { assumptions } from "@easescore/engine";

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}` : "—");
const k1 = (n: number | null | undefined) => (n == null ? null : Math.round(n / 1000) * 1000);
const pc = (s: number | null | undefined, d = 1) => (typeof s === "number" && Number.isFinite(s) ? `${s < 0 ? "−" : ""}${(Math.abs(s) * 100).toFixed(d)}%` : "—");
const KEYS = assumptions.CRITERIA_KEYS;
const DEF = assumptions.DEFAULT_CRITERIA;

function readUrl(): assumptions.InvestmentCriteria {
  try {
    return assumptions.criteriaFromQuery(Object.fromEntries(new URL(window.location.href).searchParams));
  } catch {
    return DEF;
  }
}

function syncUrl(c: assumptions.InvestmentCriteria) {
  try {
    const u = new URL(window.location.href);
    for (const k of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
      const v = Math.round(c[k] * 1000) / 10;
      if (c[k] === DEF[k]) u.searchParams.delete(KEYS[k]);
      else u.searchParams.set(KEYS[k], String(v));
    }
    window.history.replaceState(window.history.state, "", u);
  } catch { /* URL sync is a convenience */ }
}

function PctInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (share: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 1000) / 10);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n / 100);
    setDraft(null);
  };
  return (
    <label htmlFor={id} className="flex flex-col text-[11px] text-slate-600">
      <span>{label}</span>
      <span className="mt-0.5 flex items-center rounded border border-slate-300 bg-white px-1 focus-within:ring-2 focus-within:ring-slate-400">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={0.5} value={shown}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className="min-h-6 w-14 bg-transparent text-right text-[13px] tabular-nums text-slate-900 outline-none" />
        <span className="pl-0.5 text-slate-500">%</span>
      </span>
    </label>
  );
}

export default function DecisionLive({ result }: { result: assumptions.ProFormaResult }) {
  const [c, setC] = useState<assumptions.InvestmentCriteria>(DEF);
  useEffect(() => { setC(readUrl()); }, []);
  const set = (k: keyof assumptions.InvestmentCriteria) => (share: number) => setC((o) => { const n = { ...o, [k]: share }; syncUrl(n); return n; });
  const d = assumptions.decisionBox(result, c);
  const rlv = d.residual.value;
  const row = (label: string, value: string, strong = false) => (
    <tr className={strong ? "border-t border-slate-300 font-semibold" : ""}>
      <td className="py-0.5 pr-2 text-slate-700">{label}</td>
      <td className="py-0.5 text-right tabular-nums text-slate-900">{value}</td>
    </tr>
  );
  return (
    <section aria-labelledby="decision-h" className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
      <h3 id="decision-h" className="text-sm font-semibold text-slate-900">Decision box: what can you pay for the land, and what must it sell for?</h3>
      <fieldset className="mt-1">
        <legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Investment criteria (editable)</legend>
        <div className="mt-0.5 flex flex-wrap gap-3">
          <PctInput label="Target profit, % of cost" value={c.targetMargin} min={0} max={100} onChange={set("targetMargin")} />
          <PctInput label="Min. contingency, % of hard" value={c.minContingency} min={0} max={50} onChange={set("minContingency")} />
          <PctInput label="Max. loan-to-cost" value={c.maxLtc} min={0} max={100} onChange={set("maxLtc")} />
        </div>
      </fieldset>
      {d.missing ? (
        <p className="mt-2 rounded border border-dashed border-slate-300 px-2 py-1 text-[12px] text-slate-600">{d.missing}</p>
      ) : (
        <>
          <p className="mt-2 text-[13px] font-medium text-slate-900" aria-live="polite">{d.sentence}</p>
          {d.rentalPlan && <p className="text-[11px] text-slate-600">This option is priced as a rental; the box tests building the same homes to sell.</p>}
          <table className="mt-1 w-full text-left text-[12px]">
            <tbody>
              {row(`Gross sellout (${d.units} × ${usd(d.pricePerUnit)}, ${usd(d.pricePerSf)}/sf)`, usd(d.grossSellout))}
              {row("Less selling and closing", `−${usd(d.sellingClosing)}`)}
              {row("Net sale proceeds", usd(d.netProceeds), true)}
              {row("Less total development cost", `−${usd(d.tdc)}`)}
              {row("Developer profit", usd(d.profit), true)}
              {row("Profit on cost · on revenue", `${pc(d.profitOnCost)} · ${pc(d.profitOnRevenue)}`)}
              {d.levered && d.unleveredProfit != null && row("Unlevered profit (before loan interest and fees)", `${usd(d.unleveredProfit)} (${pc(d.unleveredOnCost)})`)}
              {row(`Sale price for ${pc(c.targetMargin, 0)}: per home · per sf`, `${usd(k1(d.breakEven.perUnit))} · ${usd(d.breakEven.perSf)}/sf`, true)}
              {row("Zero-profit price: per home · per sf", `${usd(k1(d.breakEven.zeroPerUnit))} · ${usd(d.breakEven.zeroPerSf)}/sf`)}
              {row((d.costReduction ?? 0) > 0 ? "Cost reduction needed" : "Cost headroom", usd(k1(Math.abs(d.costReduction ?? 0))))}
              {row("Residual land value (max land price for the target)", usd(k1(rlv)), true)}
              {row("Land price used", usd(d.residual.landUsed))}
            </tbody>
          </table>
          {rlv != null && rlv <= 0 && <p className="mt-1 text-[12px] font-semibold text-red-800">The site doesn&apos;t support a land price at this margin.</p>}
          <p className="mt-1 text-[11px] text-slate-600">Residual land value: {d.residual.formula}. Land source: {d.residual.landSource}.</p>
          <p className="text-[11px] text-slate-600">{d.contingency.text} {d.ltc.text}</p>
          <p className="text-[11px] text-slate-500">{d.sellingBasis} {d.financingBasis}</p>
        </>
      )}
    </section>
  );
}
