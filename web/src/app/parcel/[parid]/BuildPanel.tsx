"use client";

// "QuickFit 3D" controls (QuickFit v2), floating over the view: building type (each with its status),
// stories, unit width, building depth, parking, the front lot line and setback what-ifs (blank = code).
// Every change re-solves in the worker within a frame; the building type also switches the selected
// option (?strategy=) so the score and pro forma follow. Every input has a visible label; the panel is
// a disclosure reachable by keyboard.

import { useId } from "react";
import { QF2_TYPES, STATUS_WORDS, type AppControls, type AppParking, type EdgeKind, type Scheme, type Typology } from "@/lib/qf2/core";
import type { TypeSummary } from "@/lib/qf2/use-qf2";
import { OpenDrawer } from "./Drawers";

const PARKING: { v: AppParking; label: string }[] = [
  { v: "auto", label: "Best that works" }, { v: "tuck", label: "Tuck-under garage" }, { v: "pad", label: "Pad (alley or side drive)" }, { v: "none", label: "None" },
];
const TONE: Record<Scheme["status"], string> = {
  allowed_by_right: "bg-emerald-100 text-emerald-900", needs_approval: "bg-amber-100 text-amber-900",
  not_allowed: "bg-rose-100 text-rose-900", does_not_fit: "bg-slate-200 text-slate-800",
};
const SB: { k: EdgeKind; label: string }[] = [{ k: "front", label: "Front" }, { k: "side", label: "Side" }, { k: "rear", label: "Rear" }, { k: "streetSide", label: "Street side" }];
const FIELD = "w-full rounded-md border border-slate-400 bg-white px-2 py-1 text-[13px] tabular-nums text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600";

export default function BuildPanel({ controls, onChange, onReset, isDefault, code, scheme, all, ms, unavailable, open, onToggle, notApplicable, edges }: {
  controls: AppControls;
  onChange: (c: AppControls) => void;
  onReset: () => void;
  /** True when the controls reproduce the priced (score) layout. */
  isDefault: boolean;
  /** Code setbacks in feet (placeholders for the blank fields). */
  code: Partial<Record<EdgeKind, number | null>>;
  scheme: Scheme | null;
  all: TypeSummary[];
  ms: { solve: number; finance: number; roundTrip: number } | null;
  /** Why the solver cannot run on this lot (no zoning rules / no outline); null when it can. */
  unavailable?: string | null;
  open: boolean;
  onToggle: () => void;
  /** Building types the score says are not options here, with the reason. */
  notApplicable: Partial<Record<Typology, string>>;
  /** Lot edges for the front-lot-line picker (index, kind, length). */
  edges: { i: number; kind: string; lengthFt: number }[];
}) {
  const id = useId();
  const set = (p: Partial<AppControls>) => onChange({ ...controls, ...p });
  const t = QF2_TYPES.find((x) => x.id === controls.typology)!;
  const s = scheme && scheme.typology === controls.typology ? scheme : null;
  const na = notApplicable[controls.typology];
  const numOrNull = (v: string, lo: number, hi: number) => { const x = v.trim(); return x === "" || !Number.isFinite(Number(x)) ? null : Math.max(lo, Math.min(hi, Math.round(Number(x)))); };

  return (
    <div className="pointer-events-auto w-full rounded-2xl border border-slate-300 bg-white/95 text-[13px] text-slate-900 shadow-xl backdrop-blur-md">
      <h2 className="m-0">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-body`}
          className="flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
          <span className="flex flex-col leading-tight">
            <span className="whitespace-nowrap font-semibold">QuickFit 3D</span>
            <span className="text-[10px] font-normal text-slate-500">Site test fit</span>
          </span>
          <span className="truncate text-xs text-slate-700">{open ? "Hide controls" : `${t.short}${s ? ` · ${s.units.length} home${s.units.length === 1 ? "" : "s"} · ${s.stories} st` : ""}`}</span>
        </button>
      </h2>
      {open && (
        <div id={`${id}-body`} className="max-h-[min(62vh,600px)] space-y-3 overflow-y-auto border-t border-slate-200 px-3 pb-3 pt-2.5">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-800">Building type</legend>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {QF2_TYPES.map((x) => {
                const r = all.find((a) => a.typology === x.id);
                const on = x.id === controls.typology;
                return (
                  <button key={x.id} type="button" aria-pressed={on} onClick={() => onChange({ ...controls, typology: x.id })}
                    className={`flex flex-col items-start rounded-lg border px-2 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
                    <span className="font-semibold">{x.short}</span>
                    {r && <span className={`mt-0.5 rounded px-1 text-[11px] font-medium ${TONE[r.status]}`}>{STATUS_WORDS[r.status]}{r.units ? ` · ${r.units} home${r.units === 1 ? "" : "s"}` : ""}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <OpenDrawer id="options" className="min-h-6 font-semibold text-slate-900 underline decoration-dotted underline-offset-2 hover:text-slate-700">Best options and street precedent</OpenDrawer>
            <OpenDrawer id="pencils" className="min-h-6 font-semibold text-slate-900 underline decoration-dotted underline-offset-2 hover:text-slate-700">Pro forma</OpenDrawer>
          </div>
          {na && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-950">{t.label} is not an option here by the score: {na}</p>}

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5 text-xs font-medium text-slate-800" htmlFor={`${id}-st`}>Stories
              <select id={`${id}-st`} className={FIELD} value={controls.stories ?? ""} onChange={(e) => set({ stories: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Auto{s ? ` (${s.stories})` : ""}</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs font-medium text-slate-800" htmlFor={`${id}-w`}>{controls.typology === "townhouse_row" ? "Home width" : "Width"} (ft)
              <input id={`${id}-w`} type="number" inputMode="numeric" min={12} max={80} className={FIELD} placeholder={s ? `auto ${controls.typology === "townhouse_row" ? Math.round(s.widthFt / Math.max(1, s.units.length)) : s.widthFt}` : "auto"}
                value={controls.unitWidthFt ?? ""} onChange={(e) => set({ unitWidthFt: numOrNull(e.target.value, 12, 80) })} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs font-medium text-slate-800" htmlFor={`${id}-d`}>Depth (ft)
              <input id={`${id}-d`} type="number" inputMode="numeric" min={16} max={90} className={FIELD} placeholder={s ? `auto ${s.depthFt}` : "auto"}
                value={controls.depthFt ?? ""} onChange={(e) => set({ depthFt: numOrNull(e.target.value, 16, 90) })} />
            </label>
          </div>
          <label className="flex flex-col gap-0.5 text-xs font-medium text-slate-800" htmlFor={`${id}-pk`}>Parking
            <select id={`${id}-pk`} className={FIELD} value={controls.parking} onChange={(e) => set({ parking: e.target.value as AppParking })}>
              {PARKING.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium text-slate-800" htmlFor={`${id}-fe`}>Front lot line
            <select id={`${id}-fe`} className={FIELD} value={controls.frontEdgeIndex ?? ""} onChange={(e) => set({ frontEdgeIndex: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">From the street (automatic)</option>
              {edges.map((e) => <option key={e.i} value={e.i}>Edge {e.i + 1}: {Math.round(e.lengthFt)} ft ({e.kind === "streetSide" ? "street side" : e.kind})</option>)}
            </select>
            <span className="font-normal text-slate-700">Or click an edge in the Plan view.</span>
          </label>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-800">What if the setbacks were… (ft, blank = code)</legend>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {SB.map(({ k, label }) => (
                <label key={k} htmlFor={`${id}-sb-${k}`} className="flex flex-col text-[11px] font-medium text-slate-800">{label}
                  <input id={`${id}-sb-${k}`} type="number" inputMode="numeric" min={0} max={100} step={1} className={FIELD}
                    value={controls.setbacks[k] ?? ""} placeholder={code[k] != null ? `code ${code[k]}` : "code"}
                    onChange={(e) => { const v = numOrNull(e.target.value, 0, 100); const sb = { ...controls.setbacks }; if (v == null) delete sb[k]; else sb[k] = v; set({ setbacks: sb }); }} />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-700">Less than code is a variance what-if: the scheme is marked “needs approval” with past Zoning Board outcomes.</p>
          </fieldset>

          {scheme && (
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2" aria-live="polite">
              <p><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TONE[scheme.status]}`}>{STATUS_WORDS[scheme.status]}</span> <span className="text-slate-900">{scheme.statusSentence}</span></p>
              {scheme.bindingConstraint && <p className="font-medium text-slate-900">{scheme.bindingConstraint.sentence}</p>}
              {scheme.unlock && <p className="text-slate-800">What if: {scheme.unlock.sentence}</p>}
              {scheme.approvalsNeeded.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-slate-800">
                  {scheme.approvalsNeeded.map((a, i) => (
                    <li key={i}><b>{a.kind.replace(/_/g, " ")}</b>: {a.detail}{a.code ? ` (${a.code})` : ""}
                      {a.zba && <span className="block text-[11px] text-slate-700">Past Zoning Board decisions ({a.zba.scope}{a.zba.years ? `, ${a.zba.years}` : ""}): {a.zba.granted} granted, {a.zba.denied} denied</span>}</li>
                  ))}
                </ul>
              )}
              {scheme.ground && (
                <p className="text-[12px] text-slate-800">Ground: slope under the building {scheme.ground.slopePct ?? 0}%{new Set(scheme.ground.steps.map((x) => x.elevFt)).size > 1 ? `, floors step ${new Set(scheme.ground.steps.map((x) => x.elevFt)).size - 1} time(s)` : ", floors level"}. Foundation wall ≈ {scheme.ground.foundationWallSqft.toLocaleString("en-US")} sf{scheme.ground.retainingWall.lengthFt ? `; retaining wall ≈ ${scheme.ground.retainingWall.lengthFt} ft long, up to ${scheme.ground.retainingWall.maxHeightFt} ft high` : ""}.</p>
              )}
              {scheme.flags.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-800">{scheme.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
            <span>{ms ? `All 5 types solved in ${Math.round(ms.solve)} ms` : unavailable ?? "Solving the lot…"}</span>
            <button type="button" onClick={onReset} disabled={isDefault}
              className="rounded-md px-2 py-1 font-semibold text-emerald-900 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:text-slate-500 disabled:hover:bg-transparent">Priced layout</button>
          </div>
          <p className="text-[11px] text-slate-700">Unit sizes, floor heights and parking dimensions are editable placeholders. Massing only, not a design. Decision support, not zoning advice.</p>
        </div>
      )}
    </div>
  );
}
