"use client";

// Live metrics bar along the bottom of the map: the engine pro forma for the scheme on the map
// (lib/quickfit-gen.ts metricsOf: every number is the engine's), the binding constraint in plain
// words, and "Pin scheme" to compare up to three schemes side by side.

import { useState } from "react";
import { assumptions } from "@easescore/engine";
import type { GenMetrics, Money3 } from "@/lib/quickfit-gen";
import { typeOf, type AppControls } from "@/lib/qf2/core";

export interface Pinned {
  key: string;
  label: string;
  controls: AppControls;
  metrics: GenMetrics;
  binding: string | null;
}

const MAX_PINS = 3;
const sm = assumptions.shortMoney;
// Ranges that cross or sit below zero read "−$970K to −$360K" rather than a dash between two minus signs.
const money = (r: Money3 | null) => (r ? (r.low === r.high ? sm(r.likely) : `${sm(r.low)}${r.low < 0 ? " to " : "–"}${sm(r.high)}`) : "—");
/** Phones: the likely value only ("~$1.7M"); the range is in the pinned compare and the pro forma. */
const m1 = (r: Money3 | null) => (r ? `${r.low === r.high ? "" : "≈ "}${sm(r.likely)}` : "—");
const likely = (r: Money3 | null) => (r && r.low !== r.high ? `likely ${sm(r.likely)}` : null);
const p1 = (x: number) => `${x < 0 ? "−" : ""}${Math.abs(x)}%`;
const pct = (r: Money3 | null) => (r ? (r.low === r.high ? p1(r.likely) : r.low < 0 ? `${p1(r.low)} to ${p1(r.high)}` : `${r.low}–${r.high}%`) : "—");
const n = (x: number | null | undefined, unit = "") => (x == null ? "—" : `${Math.round(x).toLocaleString("en-US")}${unit}`);

export function controlsLabel(c: AppControls): string {
  const sb = (Object.entries(c.setbacks ?? {}) as [string, number][]).map(([k, v]) => `${k === "streetSide" ? "street side" : k} ${v}`).join(", ");
  return `${typeOf(c.typology).label}, ${c.stories != null ? `${c.stories} st` : "auto stories"}, ${c.unitWidthFt != null ? `${c.unitWidthFt} ft wide` : "auto width"}${c.depthFt != null ? `, ${c.depthFt} ft deep` : ""}, ${c.parking === "tuck" ? "tuck-under" : c.parking === "pad" ? "pad" : c.parking === "none" ? "no" : "auto"} parking${sb ? `, setbacks ${sb} ft` : ""}`;
}

function cells(m: GenMetrics | null) {
  const rent = m?.tenure === "rent";
  const pk = m?.parking;
  return [
    { k: "Homes", v: n(m?.units), sub: null },
    { k: "Avg home", v: n(m?.avgUnitSf, " sf"), sub: "finished" },
    { k: "Gross area", v: n(m?.grossSf, " sf"), sub: null },
    { k: "Parking", v: pk?.spaces != null ? String(pk.spaces) : pk?.kind === "none" ? "0" : "—", sub: pk?.required != null ? `${pk.required} required` : pk?.kind === "tuck" ? "tuck-under" : pk?.kind === "pad" ? "pad" : null },
    { k: "Total cost", v: money(m?.totalCost ?? null), sub: likely(m?.totalCost ?? null) },
    { k: rent ? "Rent a year" : "Value (sales)", v: money(m?.value ?? null), sub: likely(m?.value ?? null) },
    { k: rent ? "NOI a year" : (m?.profit?.likely ?? 0) < 0 ? "Gap" : "Profit", v: money(m?.profit ?? null), sub: likely(m?.profit ?? null), tone: m?.profit ? (m.profit.likely < 0 ? "neg" : "pos") : null },
    { k: "Yield on cost", v: pct(m?.yieldOnCostPct ?? null), sub: rent ? "a year" : m?.marginPct ? `sale margin ${pct(m.marginPct)}` : "if rented" },
  ] as { k: string; v: string; sub: string | null; tone?: "neg" | "pos" | null }[];
}

export default function MetricsBar({ metrics, binding, reason, controls, pins, onPin, onUnpin, onRestore, compact, busy }: {
  metrics: GenMetrics | null;
  binding: string | null;
  reason: string | null;
  controls: AppControls | null;
  pins: Pinned[];
  onPin: () => void;
  onUnpin: (key: string) => void;
  onRestore: (p: Pinned) => void;
  compact: boolean;
  busy: boolean;
}) {
  const [trayWanted, setTray] = useState(false);
  const tray = trayWanted && pins.length > 0;
  const cs = cells(metrics);
  const pinnedNow = controls ? pins.some((p) => p.key === JSON.stringify(controls)) : false;
  const missing = metrics?.missing[0] ?? null;
  const sentence = reason ?? binding;

  return (
    <div className="pointer-events-auto relative">
      {tray && pins.length > 0 && (
        <section aria-label="Pinned schemes" className="absolute bottom-full left-0 right-0 mb-2 max-h-[55vh] overflow-auto rounded-2xl border border-white/50 bg-white/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Compare pinned schemes</h3>
            <button type="button" onClick={() => setTray(false)} className="rounded px-2 text-xs text-slate-600 hover:bg-slate-100">Close</button>
          </div>
          <div className={`grid gap-2 ${pins.length === 1 ? "grid-cols-1" : pins.length === 2 ? "grid-cols-2" : "grid-cols-3"} min-w-[min(100%,540px)]`}>
            {pins.map((p) => (
              <div key={p.key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 text-xs">
                <p className="font-semibold text-slate-900">{p.label}</p>
                <p className="text-[11px] text-slate-500">{controlsLabel(p.controls)}</p>
                <dl className="mt-1.5 space-y-0.5">
                  {cells(p.metrics).map((c) => (
                    <div key={c.k} className="flex justify-between gap-2"><dt className="text-slate-500">{c.k}</dt><dd className={`text-right font-semibold tabular-nums ${c.tone === "neg" ? "text-red-700" : "text-slate-900"}`}>{c.v}</dd></div>
                  ))}
                </dl>
                {p.binding && <p className="mt-1 text-[11px] text-slate-600">{p.binding}</p>}
                <div className="mt-1.5 flex gap-1">
                  <button type="button" onClick={() => onRestore(p)} className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">Show</button>
                  <button type="button" onClick={() => onUnpin(p.key)} className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700">Unpin</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Each column is the engine pro forma for that scheme (ranges from each input&apos;s documented range).</p>
        </section>
      )}
      <div role="region" aria-label="Live metrics for the scheme on the map" aria-busy={busy}
        className="rounded-2xl border border-white/50 bg-slate-900/88 px-3 py-2 text-white shadow-2xl backdrop-blur-md">
        <div className={`grid items-start gap-x-3 gap-y-1 ${compact ? "grid-cols-4" : "grid-cols-[0.55fr_0.75fr_0.85fr_0.65fr_1.3fr_1.2fr_1.2fr_0.9fr_auto]"}`}>
          {(compact ? [cs[0]!, { ...cs[4]!, v: m1(metrics?.totalCost ?? null) }, { ...cs[6]!, v: m1(metrics?.profit ?? null) }, { ...cs[7]!, k: "Yield" }] : cs).map((c) => (
            <div key={c.k} className="min-w-0">
              <p className="truncate text-[10px] uppercase tracking-wide text-slate-400" title={c.k === "Yield" ? "Yield on cost" : undefined}>{c.k === "Yield" ? <abbr title="Yield on cost" className="no-underline">Yield</abbr> : c.k}</p>
              <p className={`truncate text-sm font-semibold tabular-nums ${c.tone === "neg" ? "text-red-300" : c.tone === "pos" ? "text-emerald-300" : ""}`}>{c.v}</p>
              {!compact && c.sub && <p className="truncate text-[10px] text-slate-400">{c.sub}</p>}
            </div>
          ))}
          {!compact && (
            <div className="flex flex-col items-end gap-1">
              <button type="button" onClick={onPin} disabled={!metrics || pinnedNow || pins.length >= MAX_PINS}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 disabled:opacity-40" title={pins.length >= MAX_PINS ? "Up to 3 schemes; unpin one first" : "Pin this scheme to compare"}>
                {pinnedNow ? "Pinned" : "Pin scheme"}
              </button>
              {pins.length > 0 && <button type="button" onClick={() => setTray(!tray)} className="text-[11px] text-sky-300 underline">Compare ({pins.length})</button>}
            </div>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-200" title={sentence ?? undefined}>
            {sentence ? <><span className="font-semibold text-amber-300">Limit: </span>{sentence}</> : missing ? <span className="text-amber-200">{missing}</span> : <span className="text-slate-400">Pick a building type to generate a layout.</span>}
          </p>
          {compact && (
            <>
              <button type="button" onClick={onPin} disabled={!metrics || pinnedNow || pins.length >= MAX_PINS} className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-900 disabled:opacity-40">{pinnedNow ? "Pinned" : "Pin"}</button>
              {pins.length > 0 && <button type="button" onClick={() => setTray(!tray)} className="shrink-0 text-[11px] text-sky-300 underline">Compare {pins.length}</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
