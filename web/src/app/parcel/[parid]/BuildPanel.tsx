"use client";

// QuickFit 3D controls, floating over the map: building type, stories, unit width, parking and setback
// what-ifs. Every change re-solves in the worker within a frame; the building type also switches the
// selected option (?strategy=) so the score and pro forma follow. Seat UI kit controls.

import { CheckboxField, RangeSlider, Segmented } from "@/components/seats/FilterRail";
import "@/components/seats/seats.css";
import { BOX_COLORS, BOX_LABEL, GEN_TYPOLOGIES, STEPPING, typologyDef, type BoxKind, type GenControls, type GenParking, type GenResult, type GenTypology } from "@/lib/quickfit-gen";

const PARKING_LABEL: Record<GenParking, string> = { pad: "Pad", tuck: "Tuck-under", none: "None" };

export default function BuildPanel({ controls, onChange, onReset, isDefault, code, result, ms, open, onToggle, notApplicable }: {
  controls: GenControls;
  onChange: (c: GenControls) => void;
  onReset: () => void;
  /** True when the controls reproduce the priced (score) layout. */
  isDefault: boolean;
  /** Code setbacks in feet (placeholders for the blank fields). */
  code: { front: number | null; side: number | null; rear: number | null };
  result: GenResult | null;
  ms: { solve: number; finance: number; roundTrip: number } | null;
  open: boolean;
  onToggle: () => void;
  /** Building types the score says are not options here, with the reason. */
  notApplicable: Partial<Record<GenTypology, string>>;
}) {
  const def = typologyDef(controls.typology);
  const set = (p: Partial<GenControls>) => onChange({ ...controls, ...p });
  const widthAuto = controls.unitWidthFt == null;
  const kinds = [...new Set((result?.boxes ?? []).map((b) => b.kind))] as BoxKind[];
  const na = notApplicable[controls.typology];

  return (
    <div className="es-seat pointer-events-auto w-full rounded-2xl border border-white/50 bg-white/92 text-[13px] shadow-xl backdrop-blur-md">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="whitespace-nowrap font-semibold text-slate-900"><span className="md:hidden">Build</span><span className="hidden md:inline">Build it in 3D</span></span>
        <span className="truncate text-xs text-slate-500">{open ? "Hide" : `${def.label} · ${controls.stories} st${result?.scheme ? ` · ${result.scheme.units} home${result.scheme.units === 1 ? "" : "s"}` : ""}`}</span>
      </button>
      {open && (
        <div className="max-h-[min(62vh,560px)] space-y-3 overflow-y-auto border-t border-slate-200/80 px-3 pb-3 pt-2.5">
          <Segmented label="Building type" size="sm" value={controls.typology}
            options={GEN_TYPOLOGIES.map((t) => ({ value: t.id, label: t.short, title: t.label }))}
            onChange={(t) => onChange({ ...controls, typology: t })} />
          {na && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{def.label} is not an option here by the score: {na}</p>}
          <RangeSlider label="Stories" min={def.stories.min} max={def.stories.max} step={1} value={Math.min(def.stories.max, Math.max(def.stories.min, controls.stories))}
            format={(v: number) => `${v} stor${v === 1 ? "y" : "ies"}`} onChange={(v: number) => set({ stories: v })} />
          <div>
            <CheckboxField label="Widest unit that fits" checked={widthAuto} onChange={(v) => { set({ unitWidthFt: v ? null : result?.scheme?.unitWidthFt ?? Math.round((def.width.min + def.width.max) / 2) }); }} />
            {!widthAuto && (
              <RangeSlider label={def.id === "plex" ? "Building width" : "Unit width"} min={def.width.min} max={def.width.max} step={1}
                value={controls.unitWidthFt ?? def.width.min} format={(v: number) => `${v} ft`} onChange={(v: number) => set({ unitWidthFt: v })} />
            )}
          </div>
          <Segmented label="Parking" size="sm" value={def.parking.includes(controls.parking) ? controls.parking : "none"}
            options={def.parking.map((p) => ({ value: p, label: PARKING_LABEL[p] }))} onChange={(p) => set({ parking: p })} />
          <fieldset>
            <legend className="es-field-label">Setbacks (ft) — blank = code</legend>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(["front", "side", "rear"] as const).map((k) => (
                <label key={k} className="flex flex-col text-[11px] text-slate-600">
                  <span className="capitalize">{k}</span>
                  <input type="number" inputMode="decimal" min={0} max={60} step={1} value={controls[k] ?? ""} placeholder={code[k] != null ? `code ${code[k]}` : "code"}
                    onChange={(e) => { const v = e.target.value.trim(); set({ [k]: v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(60, Number(v))) } as Partial<GenControls>); }}
                    className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[13px] tabular-nums text-slate-900" />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Smaller than code is a variance what-if; the layout is marked “needs approval”.</p>
          </fieldset>
          {kinds.length > 0 && (
            <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-slate-600" aria-label="Colors">
              {kinds.map((k) => (
                <li key={k} className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BOX_COLORS[k][0] }} />{BOX_LABEL[k]}</li>
              ))}
              <li className="flex items-center gap-1"><span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed border-green-600" />Setback line (code)</li>
            </ul>
          )}
          {result?.stepping.applies && (
            <p className="rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
              Hillside: the ground under the building slopes {Math.round(result.stepping.footprintSlopePct ?? 0)}%, so the floors step {result.stepping.steps} time{result.stepping.steps === 1 ? "" : "s"} ({result.stepping.dropFt} ft in all). {STEPPING.label}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>{result ? `${result.tried} layout${result.tried === 1 ? "" : "s"} checked` : "Waiting for the lot geometry…"}{ms ? ` · solved in ${ms.solve.toFixed(1)} ms` : ""}</span>
            <button type="button" onClick={onReset} disabled={isDefault} className="rounded-md px-2 py-0.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:text-slate-400 disabled:hover:bg-transparent">Priced layout</button>
          </div>
        </div>
      )}
    </div>
  );
}
