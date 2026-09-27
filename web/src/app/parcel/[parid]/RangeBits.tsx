// Small pieces for showing pro forma ranges honestly: a range as "low–high, likely", a source badge
// (amber for assumptions), and a triangulation strip that shows where each source's value sits.

import { assumptions } from "@easescore/engine";

type MoneyRange = assumptions.MoneyRange;

/** "$620K–$690K" with "likely $650K" under it. */
export function RangeValue({ r, strong = false }: { r: MoneyRange | null; strong?: boolean }) {
  if (!r) return <span className="text-slate-400">—</span>;
  const s = assumptions.shortMoney;
  if (r.low === r.high) return <span className={`tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-900"}`}>{s(r.likely)}</span>;
  return (
    <span className="tabular-nums">
      <span className={strong ? "font-semibold text-slate-900" : "text-slate-900"}>{s(Math.min(r.low, r.high))}{Math.min(r.low, r.high) < 0 ? " to " : "–"}{s(Math.max(r.low, r.high))}</span>
      <span className="block text-[10px] text-slate-500">likely {s(r.likely)}</span>
    </span>
  );
}

/** "12%", "−18%" (true minus sign, whole percent). */
export const pctText = (x: number) => { const v = Math.round(x); return `${v < 0 ? "−" : ""}${Math.abs(v)}%`; };

export function PctRangeValue({ r }: { r: assumptions.PctRange | null }) {
  if (!r) return <span className="text-slate-400">—</span>;
  if (r.low === r.high) return <span className="tabular-nums font-semibold text-slate-900">{pctText(r.likely)}</span>;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-slate-900">{pctText(Math.min(r.low, r.high))} to {pctText(Math.max(r.low, r.high))}</span>
      <span className="block text-[10px] text-slate-500">likely {pctText(r.likely)}</span>
    </span>
  );
}

/** Source badge: amber for "Assumption, edit me", slate for a dataset (with its date), sky for your input. */
export function SourceBadge({ s }: { s: assumptions.LineSource | assumptions.DataSource }) {
  const kind = "badge" in s ? s.kind : s.kind === "assumption" ? "badge" : s.kind;
  const assumption = ("badge" in s && s.badge === assumptions.ASSUMPTION_BADGE) || (!("badge" in s) && s.kind === "assumption");
  const text = "badge" in s && s.kind === "badge" ? s.badge! : s.label;
  const tone = assumption
    ? "bg-amber-100 text-amber-900 ring-amber-300"
    : kind === "user" ? "bg-sky-100 text-sky-900 ring-sky-200"
      : kind === "badge" ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200";
  const title = "badge" in s && s.kind === "badge" && s.label !== s.badge ? s.label : undefined;
  return <span title={title} className={`inline-block rounded px-1 py-px text-[10px] font-medium leading-tight ring-1 ${tone}`}>{text}</span>;
}

const fmtUnit = (unit: string, x: number) => (unit.startsWith("share") ? `${x}%` : unit.startsWith("$/") ? `$${Math.round(x).toLocaleString("en-US")}` : assumptions.shortMoney(x));

/**
 * Where each source's value sits on one scale, with this estimate's range drawn on top. Agreement is
 * visible at a glance: bars that overlap the estimate agree with it.
 */
export function TriangulationStrip({ t }: { t: assumptions.Triangulation }) {
  const xs = [t.used.low, t.used.high, ...t.points.flatMap((p) => [p.low, p.high])];
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  const pad = span * 0.08;
  const x = (v: number) => ((v - (lo - pad)) / (span + 2 * pad)) * 100;
  const bar = (a: number, b: number) => ({ left: `${x(a)}%`, width: `${Math.max(1.2, x(b) - x(a))}%` });
  return (
    <div className="mt-1 rounded border border-slate-200 bg-white/70 px-2 py-1" aria-label={`How sources compare, ${t.unit}`}>
      <p className="text-[10px] text-slate-500">Sources compared ({t.unit})</p>
      <ul className="mt-0.5 space-y-0.5">
        <li className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-1.5 text-[10px]">
          <span className="truncate font-semibold text-slate-800">This estimate</span>
          <span className="relative h-2 rounded bg-slate-100"><span className="absolute inset-y-0 rounded bg-slate-800" style={bar(t.used.low, t.used.high)} /></span>
          <span className="text-right tabular-nums text-slate-700">{fmtUnit(t.unit, t.used.low)}{t.used.high !== t.used.low ? `–${fmtUnit(t.unit, t.used.high)}` : ""}</span>
        </li>
        {t.points.map((p) => {
          const amber = p.badge === assumptions.ASSUMPTION_BADGE;
          return (
            <li key={p.label} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-1.5 text-[10px]" title={p.note ?? undefined}>
              <span className="truncate text-slate-600">{p.badge ?? p.label}</span>
              <span className="relative h-2 rounded bg-slate-100">
                <span className={`absolute inset-y-0 rounded ${amber ? "bg-amber-400" : "bg-sky-500"}`} style={bar(p.low, p.high)} />
              </span>
              <span className="text-right tabular-nums text-slate-600">{fmtUnit(t.unit, p.low)}{p.high !== p.low ? `–${fmtUnit(t.unit, p.high)}` : ""}</span>
            </li>
          );
        })}
      </ul>
      {t.points.some((p) => p.note) && (
        <ul className="mt-0.5 text-[10px] leading-snug text-slate-500">
          {t.points.filter((p) => p.note).map((p) => <li key={p.label}>{p.badge ?? p.label}: {p.note}</li>)}
        </ul>
      )}
    </div>
  );
}
