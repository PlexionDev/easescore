// Ease Score v0.1 on the parcel page (server component). Order: red flags banner, score + band +
// strategy switcher, the four answers, "Review required" callouts, factor bars, the pro forma, months to permit,
// planning badge, "What would unlock it". Popovers use <details>, so no client JS is needed here.

import type { ReactNode } from "react";
import Link from "next/link";
import { narrative, score } from "@easescore/engine";
import FourAnswers from "./FourAnswers";

type Result = score.EaseScoreResult;
type Strategy = score.StrategyResult;

const BAND_STYLE: Record<string, string> = {
  Easy: "bg-emerald-100 text-emerald-800",
  Moderate: "bg-amber-100 text-amber-800",
  Hard: "bg-orange-100 text-orange-800",
  "Very hard": "bg-red-100 text-red-800",
};
const BAR_STYLE: Record<string, string> = {
  Easy: "bg-emerald-500",
  Moderate: "bg-amber-500",
  Hard: "bg-orange-500",
  "Very hard": "bg-red-500",
};
const EVIDENCE_STYLE: Record<score.Evidence, string> = {
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  missing: "bg-slate-100 text-slate-600 ring-slate-200",
};
const EVIDENCE_TEXT: Record<score.Evidence, string> = { complete: "Complete data", partial: "Partial data", missing: "No data" };

function Receipt({ sources, dates }: { sources: string[]; dates: Record<string, string | null> }) {
  const uniq = [...new Set(sources)];
  return (
    <details className="group relative inline-block">
      <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-800">
        Receipt
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 text-[11px] leading-snug text-slate-700 shadow-lg">
        <p className="font-semibold text-slate-900">Sources</p>
        <ul className="mt-0.5 list-disc pl-4">
          {uniq.map((s) => (
            <li key={s}>{s}{dates[s] ? <span className="text-slate-500"> · data date {dates[s]}</span> : null}</li>
          ))}
        </ul>
        {!uniq.some((s) => dates[s]) && <p className="mt-1 text-slate-500">These sources do not record a data date.</p>}
      </div>
    </details>
  );
}

function FactorBar({ f, band }: { f: score.FactorResult; band: string | null }) {
  const v = f.subscore;
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-800">{f.id} · {f.label} <span className="text-xs font-normal text-slate-400">({f.weight}%)</span></span>
        <span className="shrink-0 tabular-nums text-slate-700">{v == null ? "—" : Math.round(v)}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {v != null
          ? <div className={`h-full rounded-full ${BAR_STYLE[band ?? ""] ?? "bg-slate-500"}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
          : <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#e2e8f0_0,#e2e8f0_4px,transparent_4px,transparent_8px)]" />}
      </div>
      <p className="mt-1 text-xs text-slate-600">{f.oneLiner}{v == null ? " Left out of the score." : ""}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${EVIDENCE_STYLE[f.evidence]}`}>{EVIDENCE_TEXT[f.evidence]}</span>
        {f.partialCoverage && <span className="text-[10px] text-slate-500">source covers part of the county</span>}
        <span className="ml-auto"><Receipt sources={f.sources} dates={f.dates} /></span>
      </div>
    </li>
  );
}

function strategyHref(sp: Record<string, string | string[] | undefined>, parid: string, id: string) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "strategy") q.set(k, v);
  q.set("strategy", id);
  return `/parcel/${encodeURIComponent(parid)}?${q.toString()}`;
}

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

export default function EaseScorePanel({ parid, result, selected, answers, sp, proForma, pencilsNote }: {
  parid: string;
  result: Result;
  selected: Strategy;
  answers: narrative.NarrativeResult | null;
  sp: Record<string, string | string[] | undefined>;
  /** "Does it pencil?" section, shown after the factor bars. */
  proForma?: ReactNode;
  /** Shown under the "Does it pencil?" answer, e.g. what the estimate leaves out. */
  pencilsNote?: string | null;
}) {
  const s = selected;
  const blocked = s.labels.includes(score.BLOCKED);
  const preliminary = s.labels.includes(score.PRELIMINARY);
  const missing = s.factors.filter((f) => f.evidence === "missing").length;
  const p = s.predictedMonthsToPermit;
  const pb = s.planningBadge;
  const unlocks = s.unlocks.filter((u) => u.evaluated);
  const unlockGains = unlocks.filter((u) => (u.scoreDelta ?? 0) > 0 || (u.unitsDelta ?? 0) > 0);
  const notEvaluated = s.unlocks.find((u) => !u.evaluated)?.reason;
  // The strategy already says when zoning is not loaded; skip the parcel-level copy of that note.
  const zoningNote = s.notes.some((n) => /is not loaded/.test(n));
  const notes = [...new Set([...s.notes, ...result.notes.filter((n) => !(zoningNote && n.startsWith("Outside the City")))])];

  return (
    <>
      {/* Red flags banner: above the score, never averaged in */}
      {s.redFlags.length > 0 && (
        <section className="rounded-xl border border-red-300 bg-red-50/95 p-3 text-sm text-red-950" aria-label="Red flags">
          <h2 className="text-base font-semibold text-red-900">Blocked unless resolved</h2>
          <ul className="mt-1 space-y-2">
            {s.redFlags.map((x) => (
              <li key={x.id}>
                <p><b>{x.title}.</b> {x.reason}</p>
                <p className="mt-0.5"><span className="font-semibold">Way forward:</span> {x.path}</p>
                <p className="text-[11px] text-red-800/70">Source: {x.source}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Score + band + strategy switcher */}
      <section aria-label="Ease Score" className="rounded-xl border border-slate-200 bg-white/80 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ease Score · {s.strategyLabel}</p>
            {s.applicable ? (
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-bold tabular-nums tracking-tight text-slate-900">{s.score ?? "—"}</span>
                <span className="text-sm text-slate-400">/ 100</span>
                {s.band && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${BAND_STYLE[s.band]}`}>{s.band}</span>}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-600">Not an option here: {s.notApplicableReason}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">config v{s.configVersion.replace(/^ease-score\.v/, "")}</span>
        </div>
        {blocked && <p className="mt-1 text-sm font-semibold text-red-800">Blocked unless resolved: see the red flag above. The number shows how hard the rest would be.</p>}
        {preliminary && <p className="mt-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Preliminary — insufficient evidence. Less than 60% of the score has data behind it.</p>}
        {s.range && (
          <p className="mt-1 text-xs text-slate-600">
            Could be anywhere from <b>{s.range[0]}</b> to <b>{s.range[1]}</b>: {missing} factor{missing === 1 ? " has" : "s have"} no data yet.
          </p>
        )}
        {!s.redFlags.length && s.applicable && <p className="mt-1 text-xs text-emerald-800">No red flags found in our data (floodway, no street access, active cleanup site on the lot).</p>}
        <p className="mt-1 text-[11px] text-slate-500">How easy the site and approvals are (0 = very hard, 100 = easy). Cost and profit are judged separately.</p>

        <nav aria-label="Housing strategy" className="mt-3 flex flex-wrap gap-1.5">
          {result.strategies.map((x) => {
            const on = x.strategy === s.strategy;
            return (
              <Link key={x.strategy} href={strategyHref(sp, parid, x.strategy)} scroll={false} prefetch={false}
                aria-current={on ? "true" : undefined}
                title={x.applicable ? undefined : x.notApplicableReason}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-slate-900 bg-slate-900 text-white" : x.applicable ? "border-slate-200 bg-white text-slate-700 hover:border-slate-400" : "border-slate-100 bg-slate-50 text-slate-400"}`}>
                {x.strategyLabel}
                <span className={`ml-1 tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{x.applicable ? x.score ?? "—" : "n/a"}</span>
                {x.strategy === result.best && <span className={`ml-1 text-[10px] font-semibold uppercase ${on ? "text-emerald-300" : "text-emerald-700"}`}>best</span>}
              </Link>
            );
          })}
        </nav>
      </section>

      {/* The four answers */}
      {answers
        ? <FourAnswers result={answers} pencilsNote={pencilsNote} />
        : <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">The plain-English summary is not available for this option.</p>}

      {/* Review required: amber, never hidden */}
      {s.reviewCallouts.length > 0 && (
        <section aria-label="Review required">
          <h2 className="text-base font-semibold text-slate-900">Review required</h2>
          <ul className="mt-2 space-y-2">
            {s.reviewCallouts.map((c) => (
              <li key={c.id} className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                <p><b>{c.title.replace(/^Review required:\s*/i, "").replace(/^./, (m) => m.toUpperCase())}.</b> {c.reason}</p>
                {c.checklist.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px]">
                    {c.checklist.map((t) => <li key={t}>{t}</li>)}
                  </ol>
                )}
                {c.costNotes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[13px]">
                    {c.costNotes.map((t) => <li key={t}><span className="font-semibold">Cost:</span> {t}</li>)}
                  </ul>
                )}
                {c.citations.length > 0 && <p className="mt-1 text-[11px] text-amber-900/70">Citations: {c.citations.join("; ")}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Factor bars */}
      {s.applicable && (
        <section aria-label="Score factors">
          <h2 className="text-base font-semibold text-slate-900">What the score is made of</h2>
          <ul className="divide-y divide-slate-100">
            {s.factors.map((f) => <FactorBar key={f.id} f={f} band={s.band} />)}
          </ul>
        </section>
      )}

      {/* Pro forma: cost, value and "does it pencil" for this option */}
      {s.applicable && proForma}

      {/* Months to permit + planning badge */}
      {s.applicable && (
        <section className="grid gap-3">
          {p && (
            <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
              <h2 className="text-sm font-semibold text-slate-900">Time to a permit</h2>
              <p className="mt-0.5 text-sm text-slate-800">
                About <b>{p.months} months</b>{p.upperMonths != null ? ` (up to ${p.upperMonths})` : ""}
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {p.estimate ? "Estimate" : "City permit records"}
                </span>
              </p>
              {p.targetOnly && <p className="text-[11px] text-slate-500">Building-permit part: the City&apos;s review target for one round ({p.label ?? "City target, not measured"}). Each revision request adds time.</p>}
              {p.dateRangeLabel && <p className="text-[11px] text-slate-500">{p.dateRangeLabel}</p>}
              {p.queuePending != null && <p className="text-[11px] text-slate-500">{p.queuePending} building permits waiting for City review{p.queueAsOf ? ` (as of ${p.queueAsOf})` : ""}.</p>}
              <details className="mt-1 text-xs text-slate-600">
                <summary className="cursor-pointer text-slate-500 underline decoration-dotted underline-offset-2">How we got this</summary>
                <ul className="mt-1 list-disc pl-4">{p.basis.map((b) => <li key={b}>{b}</li>)}</ul>
              </details>
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Planning badge</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pb.tier ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>
                {pb.tier ?? "No priority tier"} · {pb.points} pts
              </span>
              <span className="text-[10px] text-slate-500">{pb.status}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">Separate from the Ease Score. Placeholder weights until City planners set them.</p>
            <details className="mt-1 text-xs text-slate-700">
              <summary className="cursor-pointer text-slate-500 underline decoration-dotted underline-offset-2">Why?</summary>
              <ul className="mt-1 space-y-0.5">
                {pb.criteria.map((c) => (
                  <li key={c.id} className="flex gap-1.5">
                    <span className="w-4 shrink-0 text-center">{c.matched == null ? "?" : c.matched ? "✓" : "–"}</span>
                    <span><b>{c.label}</b> ({c.weight} pts): {c.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      )}

      {/* What would unlock it */}
      {s.applicable && (
        <section aria-label="What would unlock it">
          <h2 className="text-base font-semibold text-slate-900">What would unlock it</h2>
          <p className="text-[11px] text-slate-500">One policy change at a time, rerun through the same lot-fit test.</p>
          {unlocks.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {(unlockGains.length ? unlockGains : unlocks).map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                  <span className="text-slate-800">{u.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-600">
                    {u.scoreDelta != null ? `${signed(u.scoreDelta)} points` : "score n/a"}
                    {u.unitsDelta != null ? ` · ${signed(u.unitsDelta)} unit${Math.abs(u.unitsDelta) === 1 ? "" : "s"} by right` : ""}
                  </span>
                </li>
              ))}
              {!unlockGains.length && <li className="text-xs text-slate-500">None of these changes would raise the score or the units allowed by right here.</li>}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{notEvaluated ?? "Not checked for this option."}</p>
          )}
        </section>
      )}

      {notes.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-slate-500">
          {notes.map((n) => <li key={n}>Note: {n}</li>)}
        </ul>
      )}
    </>
  );
}
