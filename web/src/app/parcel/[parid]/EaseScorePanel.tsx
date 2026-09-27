// Ease Score pieces of the parcel pane (server components): the score with its band and the compact
// strategy switcher, the seven factor bars with receipt sheets, the red and amber callouts, and the
// "Details" drawer content (four answers, time to a permit, planning badge, what would unlock it).

import Link from "next/link";
import { narrative, score } from "@easescore/engine";
import FourAnswers from "./FourAnswers";
import { SheetButton } from "./Drawers";

type Result = score.EaseScoreResult;
type Strategy = score.StrategyResult;
type SP = Record<string, string | string[] | undefined>;

const BAND_WORD: Record<string, string> = { Easy: "Easy to build", Moderate: "Moderate to build", Hard: "Hard to build", "Very hard": "Very hard to build" };
const BAND_STYLE: Record<string, string> = {
  Easy: "bg-emerald-100 text-emerald-800",
  Moderate: "bg-amber-100 text-amber-800",
  Hard: "bg-orange-100 text-orange-800",
  "Very hard": "bg-red-100 text-red-800",
};
const BAR_STYLE: Record<string, string> = { Easy: "bg-emerald-500", Moderate: "bg-amber-500", Hard: "bg-orange-500", "Very hard": "bg-red-500" };
const EVIDENCE_TEXT: Record<score.Evidence, string> = { complete: "Complete data", partial: "Partial data", missing: "No data" };

const cfg = score.DEFAULT_CONFIG;
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

/** The rule or curve each factor applies, read from the versioned score config. */
function factorRule(id: score.FactorId): string {
  switch (id) {
    case "F1": {
      const p = cfg.f1.permission as Record<string, number>;
      const d = cfg.f1.dimensional;
      return `Use permission points: by right ${p.P}, administrator exception ${p.A}, special exception ${p.S}, conditional use ${p.C}, not permitted ${p.N}. Multiplied by how the building fits: fits 1, contextual setback ${d.contextualSetback}, needs a variance ${d.varianceBase} + ${d.varianceRateWeight} × the past grant rate (default ${pctOf(cfg.f1.zba.defaultGrantRate)} when fewer than ${cfg.f1.zba.minCases} decided cases), nothing fits ${d.noFit}.`;
    }
    case "F2":
      return `Share of the lot steeper than 25% → points: ${(cfg.f2.steepSlopeCurve as number[][]).map(([x, y]) => `${x}% → ${y}`).join(", ")} (straight lines between). Multiplied by ${cfg.f2.envelopeFactor.tooSmall} when the buildable area is smaller than the smallest footprint for this building type.`;
    case "F3": {
      const m = cfg.f3.multipliers as Record<string, number>;
      return `Starts at 100 and is multiplied for each hazard found: landslide-prone ${m.landslideProne}, undermined ${m.undermined}, mapped slope movement on the lot ${m.slopeMovementOnLot}, 100-year floodplain ${m.floodplain100yr}, contamination on or next to the lot ${m.contaminationOnOrAdjacent}, combined sewer ${m.combinedSewer}.`;
    }
    case "F4": {
      const f = cfg.f4.frontage as Record<string, number>;
      const u = cfg.f4.utilities as Record<string, number>;
      return `Street frontage points: street ${f.street}, paper street ${f.paper}, city steps ${f.steps}, none ${f.none}. Multiplied by water and sewer service: inside a service area ${u.inside}, unknown ${u.unknown}, outside ${u.outside}. Plus ${cfg.f4.transitBonus} points with frequent transit within ${cfg.f4.transitBonusMaxDistanceM} m.`;
    }
    case "F5":
      return `Starts at ${cfg.f5.start}; minus ${cfg.f5.perDiscretionaryApproval} per discretionary approval, ${cfg.f5.geotechRequired} when a geotechnical report is required, ${cfg.f5.historicDistrict} in a historic district, ${cfg.f5.demolition} when a building must be torn down.`;
    case "F6":
      return `Vacant or teardown lot ${cfg.f6.vacantOrTeardown}; existing building ${cfg.f6.existingStructure} (rehab uses the building's condition). Multiplied by the title path: clear ${cfg.f6.titlePath.clear}, tax delinquent ${cfg.f6.titlePath.taxDelinquent}, public owner ${cfg.f6.titlePath.publicOwner}.`;
    case "F7":
      return "The sub-score is the percentile rank (0 to 100) of nearby valid sales plus completed building permits in the last 3 years, against a fixed sample of parcels.";
  }
}

/** Plain name for an engine input key, e.g. "shareOver25" → "share over 25". */
function inputName(k: string): string {
  return k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}
function inputValue(v: unknown): string {
  if (v == null) return "not recorded";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return v.length ? v.map(inputValue).join("; ") : "none";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${inputName(k)}: ${inputValue(x)}`).join("; ");
  return String(v);
}

function FactorBar({ f, band, reportHref }: { f: score.FactorResult; band: string | null; reportHref: string }) {
  const v = f.subscore;
  const sources = [...new Set(f.sources)];
  const inputs = Object.entries(f.inputs);
  return (
    <li className="py-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium text-slate-800">{f.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-slate-700">{v == null ? "No data" : Math.round(v)}</span>
          <SheetButton label="Receipt" title={`${f.label}: receipt`}>
            <p className="text-slate-800">{f.oneLiner}</p>
            <p className="mt-1 text-[12px] text-slate-500">Weight {f.weight}% · {EVIDENCE_TEXT[f.evidence]}{f.partialCoverage ? " · source covers part of the county" : ""} · sub-score {v == null ? "left out of the score" : Math.round(v)}</p>
            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Inputs</h4>
            {inputs.length ? (
              <ul className="mt-0.5 space-y-0.5">
                {inputs.map(([k, x]) => <li key={k}><span className="text-slate-500">{inputName(k)}:</span> {inputValue(x)}</li>)}
              </ul>
            ) : <p className="text-slate-500">No inputs were available.</p>}
            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rule applied</h4>
            <p>{factorRule(f.id)}</p>
            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</h4>
            <ul className="mt-0.5 list-disc pl-4">
              {sources.map((s) => <li key={s}>{s}<span className="text-slate-500"> · {f.dates[s] ? `data date ${f.dates[s]}` : "no data date recorded"}</span></li>)}
            </ul>
            <a href={reportHref} target="_blank" rel="noopener" className="mt-3 inline-block text-[12px] font-semibold text-slate-800 underline">See this factor in the full report</a>
          </SheetButton>
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {v != null
          ? <div className={`h-full rounded-full ${BAR_STYLE[band ?? ""] ?? "bg-slate-500"}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
          : <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#e2e8f0_0,#e2e8f0_4px,transparent_4px,transparent_8px)]" />}
      </div>
    </li>
  );
}

function strategyHref(sp: SP, parid: string, id: string) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "strategy") q.set(k, v);
  q.set("strategy", id);
  return `/parcel/${encodeURIComponent(parid)}?${q.toString()}`;
}

/** 4. Big number + band words; range and "Preliminary" when evidence is thin; compact strategy switcher. */
export function ScoreBlock({ parid, result, selected, sp }: { parid: string; result: Result; selected: Strategy; sp: SP }) {
  const s = selected;
  const preliminary = s.labels.includes(score.PRELIMINARY);
  return (
    <section aria-label="Ease Score">
      {s.applicable ? (
        <div className="flex items-end gap-3">
          <span className="text-5xl font-bold tabular-nums leading-none tracking-tight text-slate-900">{preliminary && s.range ? `${s.range[0]}–${s.range[1]}` : s.score ?? "—"}</span>
          <div className="pb-0.5">
            {s.band && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${BAND_STYLE[s.band]}`}>{BAND_WORD[s.band]}</span>}
            <p className="mt-1 text-[11px] text-slate-500">
              Ease Score out of 100{preliminary ? " · Preliminary (thin evidence)" : s.range && s.range[0] !== s.range[1] ? ` · could be ${s.range[0]}–${s.range[1]}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{s.strategyLabel} is not an option here: {s.notApplicableReason}</p>
      )}
      {s.cap && (
        <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-950" title={`Without the cap the factors average ${s.cap.uncappedScore}.`}>
          {s.cap.label}. <span className="text-amber-800">Hazards like these hold the score at {s.cap.band} or lower.</span>
        </p>
      )}
      <nav aria-label="Housing strategy" className="mt-2 flex gap-1 overflow-x-auto pb-1">
        {result.strategies.map((x) => {
          const on = x.strategy === s.strategy;
          return (
            <Link key={x.strategy} href={strategyHref(sp, parid, x.strategy)} scroll={false} prefetch={false}
              aria-current={on ? "true" : undefined} title={x.applicable ? undefined : x.notApplicableReason}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-slate-900 bg-slate-900 text-white" : x.applicable ? "border-slate-200 bg-white text-slate-700 hover:border-slate-400" : "border-slate-100 bg-slate-50 text-slate-600"}`}>
              {x.strategyLabel} <span className={on ? "text-white/80" : "text-slate-600"}>{x.applicable ? x.score ?? "—" : "n/a"}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

/** 5. The seven factor bars, each with a receipt sheet. */
export function FactorBars({ selected, reportHref }: { selected: Strategy; reportHref: string }) {
  if (!selected.applicable) return null;
  return (
    <section aria-label="Score factors">
      <ul className="divide-y divide-slate-100">
        {selected.factors.map((f) => <FactorBar key={f.id} f={f} band={selected.band} reportHref={reportHref} />)}
      </ul>
    </section>
  );
}

/** 6. Red flags (red, rare) then "Review required" (amber); at most 3 visible, the rest behind "+N more". */
export function Callouts({ selected }: { selected: Strategy }) {
  const items = [
    ...selected.redFlags.map((x) => ({ id: x.id, tone: "red" as const, title: x.title, reason: x.reason })),
    ...selected.reviewCallouts.map((c) => ({ id: c.id, tone: "amber" as const, title: c.title.replace(/^Review required:\s*/i, "").replace(/^./, (m) => m.toUpperCase()), reason: c.reason })),
  ];
  if (!items.length) return null;
  const row = (c: (typeof items)[number]) => (
    <li key={c.id} className={`rounded-lg border px-3 py-1.5 text-[13px] ${c.tone === "red" ? "border-red-300 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wide">{c.tone === "red" ? "Red flag" : "Review required"}</span>
      <b>{c.title}.</b> <span className="opacity-80">{c.reason.split(". ")[0]!.replace(/\.$/, "")}.</span>
    </li>
  );
  return (
    <section aria-label="Red flags and review items">
      <ul className="space-y-1.5">{items.slice(0, 3).map(row)}</ul>
      {items.length > 3 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600 underline decoration-dotted underline-offset-2">+{items.length - 3} more</summary>
          <ul className="mt-1.5 space-y-1.5">{items.slice(3).map(row)}</ul>
        </details>
      )}
    </section>
  );
}

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

/** The "Details" drawer: four answers, full callouts, time to a permit, planning badge, unlocks, notes. */
export function DetailsContent({ result, selected, answers, pencilsNote }: { result: Result; selected: Strategy; answers: narrative.NarrativeResult | null; pencilsNote?: string | null }) {
  const s = selected;
  const p = s.predictedMonthsToPermit;
  const pb = s.planningBadge;
  const unlocks = s.unlocks.filter((u) => u.evaluated);
  const unlockGains = unlocks.filter((u) => (u.scoreDelta ?? 0) > 0 || (u.unitsDelta ?? 0) > 0);
  const notEvaluated = s.unlocks.find((u) => !u.evaluated)?.reason;
  const zoningNote = s.notes.some((n) => /is not loaded/.test(n));
  const notes = [...new Set([...s.notes, ...result.notes.filter((n) => !(zoningNote && n.startsWith("Outside the City")))])];
  return (
    <>
      {answers
        ? <FourAnswers result={answers} pencilsNote={pencilsNote} />
        : <p className="text-sm text-slate-600">The plain-English answers are not available for this option.</p>}
      {(s.redFlags.length > 0 || s.reviewCallouts.length > 0) && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Red flags and review items, in full</h3>
          <ul className="mt-1 space-y-2 text-[13px]">
            {s.redFlags.map((x) => (
              <li key={x.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-950">
                <p><b>{x.title}.</b> {x.reason}</p>
                <p className="mt-0.5"><b>Way forward:</b> {x.path}</p>
                <p className="text-[11px] opacity-70">Source: {x.source}</p>
              </li>
            ))}
            {s.reviewCallouts.map((c) => (
              <li key={c.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                <p><b>{c.title.replace(/^Review required:\s*/i, "")}.</b> {c.reason}</p>
                {c.checklist.length > 0 && <ol className="mt-1 list-decimal space-y-0.5 pl-5">{c.checklist.map((t) => <li key={t}>{t}</li>)}</ol>}
                {c.costNotes.map((t) => <p key={t} className="mt-0.5"><b>Cost:</b> {t}</p>)}
                {c.citations.length > 0 && <p className="mt-1 text-[11px] opacity-70">Citations: {c.citations.join("; ")}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.applicable && p && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Time to a permit</h3>
          <p className="text-sm text-slate-800">About <b>{p.months} months</b>{p.upperMonths != null ? ` (up to ${p.upperMonths})` : ""} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{p.estimate ? "Estimate" : "City permit records"}</span></p>
          {p.targetOnly && <p className="text-[11px] text-slate-500">Building-permit part: the City&apos;s review target for one round ({p.label ?? "City target, not measured"}). Each revision request adds time.</p>}
          {p.queuePending != null && <p className="text-[11px] text-slate-500">{p.queuePending} building permits waiting for City review{p.queueAsOf ? ` (as of ${p.queueAsOf})` : ""}.</p>}
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">{p.basis.map((b) => <li key={b}>{b}</li>)}</ul>
        </section>
      )}
      {s.applicable && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Planning badge <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${pb.tier ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>{pb.tier ?? "No priority tier"} · {pb.points} pts</span></h3>
          <p className="text-[11px] text-slate-500">Separate from the Ease Score. {pb.status}.</p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {pb.criteria.map((c) => <li key={c.id}>{c.matched == null ? "?" : c.matched ? "✓" : "–"} <b>{c.label}</b> ({c.weight} pts): {c.note}</li>)}
          </ul>
        </section>
      )}
      {s.applicable && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">What would unlock it</h3>
          <p className="text-[11px] text-slate-500">One policy change at a time, rerun through the same lot-fit test.</p>
          {unlocks.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {(unlockGains.length ? unlockGains : unlocks).map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                  <span>{u.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-600">{u.scoreDelta != null ? `${signed(u.scoreDelta)} points` : "score n/a"}{u.unitsDelta != null ? ` · ${signed(u.unitsDelta)} unit${Math.abs(u.unitsDelta) === 1 ? "" : "s"} by right` : ""}</span>
                </li>
              ))}
              {!unlockGains.length && <li className="text-xs text-slate-500">None of these changes would raise the score or the units allowed by right here.</li>}
            </ul>
          ) : <p className="mt-1 text-sm text-slate-600">{notEvaluated ?? "Not checked for this option."}</p>}
        </section>
      )}
      {notes.length > 0 && <ul className="space-y-0.5 text-[11px] text-slate-500">{notes.map((n) => <li key={n}>Note: {n}</li>)}</ul>}
      <p className="text-[11px] text-slate-500">Scoring config v{s.configVersion.replace(/^ease-score\.v/, "")}.</p>
    </>
  );
}
