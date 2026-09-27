// "Best options for this lot" (top of the parcel pane): one row per housing option, ranked by
// score.rankOptions — the easiest option that pencils first. Each row shows the Ease Score and band,
// the zoning path in words and a separate "Pencils?" chip (ease and money are never blended). Tapping
// a row selects ?strategy=, so the factor bars, receipts, budget and 3D below all follow the one
// SelectedScheme. This list is the pane's only option switcher.

import Link from "next/link";
import { score } from "@easescore/engine";

type SP = Record<string, string | string[] | undefined>;

const BAND_STYLE: Record<string, string> = {
  Easy: "bg-emerald-100 text-emerald-800",
  Moderate: "bg-amber-100 text-amber-800",
  Hard: "bg-orange-100 text-orange-800",
  "Very hard": "bg-red-100 text-red-800",
};

const PENCIL: Record<score.PencilState, { text: string; style: string }> = {
  yes: { text: "Pencils", style: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  thin: { text: "Barely pencils", style: "border-amber-200 bg-amber-50 text-amber-900" },
  no: { text: "Doesn't pencil", style: "border-red-200 bg-red-50 text-red-900" },
  pricing: { text: "Pricing…", style: "border-slate-200 bg-slate-50 text-slate-600" },
  unknown: { text: "Can't tell yet", style: "border-slate-200 bg-white text-slate-600" },
  none: { text: "—", style: "border-transparent text-slate-500" },
};

const ZONING_STYLE: Partial<Record<score.ZoningPathKind, string>> = {
  allowed: "text-emerald-800",
  existing: "text-emerald-800",
  not_allowed: "text-red-800",
  no_fit: "text-red-800",
};

function strategyHref(sp: SP, parid: string, id: string) {
  const q = new URLSearchParams();
  // Other keys stay (3D layout keys are read per building type, so they never leak into another option).
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "strategy") q.set(k, v);
  q.set("strategy", id);
  return `/parcel/${encodeURIComponent(parid)}?${q.toString()}`;
}

export default function BestOptions({ parid, rows, detail, selected, sp }: { parid: string; rows: score.OptionRow[]; detail?: Partial<Record<score.StrategyId, string>>; selected: score.StrategyId | null; sp: SP }) {
  return (
    <section aria-labelledby="best-options-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="best-options-h" className="text-sm font-semibold text-slate-900">Best options for this lot</h2>
        <span className="hidden text-[10px] text-slate-500 sm:inline">Ease Score · zoning · money, kept separate</span>
      </div>
      <ol className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white/80">
        {rows.map((r) => {
          const on = r.strategy === selected;
          const p = PENCIL[r.pencils];
          const scoreText = r.score != null ? String(r.score) : r.range ? `${r.range[0]}–${r.range[1]}` : "—";
          const body = (
            <>
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-slate-500">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{r.name}</span>
                {r.applicable && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900" title={"Ease Score out of 100"}>{scoreText}</span>
                )}
                {r.band && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${BAND_STYLE[r.band]}`}>{r.band}</span>}
                {r.applicable && <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${p.style}`} title={"Does it pencil? (from the pro forma)"}>{detail?.[r.strategy] ?? p.text}</span>}
              </div>
              <p className={`ml-6 mt-0.5 text-[11px] leading-snug ${ZONING_STYLE[r.zoning.kind] ?? "text-slate-600"}`}>
                {r.zoning.text}
                {r.leadLabel && <span className="ml-1 rounded bg-slate-900 px-1 py-px text-[10px] font-semibold text-white">{r.leadLabel}</span>}
              </p>
            </>
          );
          return (
            <li key={r.strategy}>
              {r.applicable ? (
                <Link href={strategyHref(sp, parid, r.strategy)} scroll={false} prefetch={false} aria-current={on ? "true" : undefined}
                  className={`block px-2 py-1.5 ${on ? "bg-slate-100 ring-2 ring-inset ring-slate-900" : "hover:bg-slate-50"}`}>
                  {body}
                  <span className="sr-only">{on ? " (selected)" : " (show this option's details)"}</span>
                </Link>
              ) : (
                <div className="px-2 py-1.5 opacity-85">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
