"use client";

// "Build it in 3D" view: the QuickFit v2 scheme as a clay model on the lidar ground (lib/qf2/render3d.ts),
// or as a plan drawing (lib/qf2/plan.ts) where a click on a lot edge makes it the front lot line.
// Keyboard: focus the view, then arrows orbit, + / - zoom, Home resets; in the plan, Tab to an edge and
// press Enter. Buttons do the same for pointer users.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildable as buildableOf, classify } from "@easescore/engine/src/quickfit2/src/geom";
import { elevFn } from "@easescore/engine/src/quickfit2/app";
import { describeScheme, type ParcelInput, type Pt, type Ring, type Scheme } from "@/lib/qf2/core";
import { planSvg } from "@/lib/qf2/plan";
import type { ClayView } from "@/lib/qf2/render3d";
import type { TerrainGrid } from "@/lib/terrain-grid";

export type ClayMode = "3d" | "plan";

export default function Clay3D({ scheme, input, terrain, neighbors, streetName, onPickFront, insets, mode, onModeChange }: {
  scheme: Scheme | null;
  /** The solver input the scheme came from (lot-local feet). */
  input: ParcelInput | null;
  terrain: TerrainGrid | null;
  /** Neighboring lots and buildings, lot-local feet. */
  neighbors: { parcel?: Ring; building?: Ring; heightFt?: number }[];
  streetName: string;
  onPickFront: (edge: number) => void;
  insets: { left: number; bottom: number };
  mode: ClayMode;
  onModeChange: (m: ClayMode) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<ClayView | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Lot geometry for drawing (also when the scheme has none, e.g. "not allowed").
  const geo = useMemo(() => {
    if (!scheme || !input) return null;
    const d = (scheme as unknown as { debug?: { localRing: Pt[]; edges: { i: number; a: Pt; b: Pt; kind: string; setbackFt: number; alley?: boolean }[]; buildable: Pt[][][] } }).debug;
    if (d) return { localRing: d.localRing, edges: d.edges, buildable: d.buildable };
    try {
      const c = classify(input, { typology: scheme.typology });
      const b = buildableOf(c.localRing, c.edges, (input.floodway ?? []).map((r) => r.map(c.toLocal)));
      return { localRing: c.localRing, edges: c.edges, buildable: b.buildable as Pt[][][] };
    } catch { return null; }
  }, [scheme, input]);

  const elevAt = useMemo(() => (terrain ? elevFn(terrain) : null), [terrain]);

  useEffect(() => {
    if (mode !== "3d" || !host.current) return;
    let live = true;
    import("@/lib/qf2/render3d").then(({ ClayView }) => {
      if (!live || !host.current) return;
      try { view.current = new ClayView(host.current); setReady(true); } catch { setFailed(true); }
    });
    return () => { live = false; view.current?.dispose(); view.current = null; setReady(false); };
  }, [mode]);

  useEffect(() => {
    if (!ready || !view.current || !scheme || !geo) return;
    view.current.update(scheme, { elevAt, neighbors: neighbors.filter((n) => n.building).map((n) => ({ footprint: n.building!, heightFt: n.heightFt })) }, geo);
    const w = window as unknown as { __qf2View?: ClayView };
    w.__qf2View = view.current;
  }, [ready, scheme, geo, elevAt, neighbors]);

  const plan = useMemo(() => (mode === "plan" && scheme && geo
    ? planSvg({ s: scheme, localRing: geo.localRing, edges: geo.edges, buildable: geo.buildable, streetName, neighbors, floodway: input?.floodway ?? [] })
    : null), [mode, scheme, geo, streetName, neighbors, input]);

  const key = (e: React.KeyboardEvent) => {
    const v = view.current;
    if (!v) return;
    const k = e.key;
    if (k === "ArrowLeft") v.orbit(0.15, 0); else if (k === "ArrowRight") v.orbit(-0.15, 0);
    else if (k === "ArrowUp") v.orbit(0, -0.08); else if (k === "ArrowDown") v.orbit(0, 0.08);
    else if (k === "+" || k === "=") v.zoom(0.85); else if (k === "-" || k === "_") v.zoom(1.18);
    else if (k === "Home") v.reset(); else return;
    e.preventDefault();
  };
  const pick = (t: EventTarget | null) => {
    const el = t as Element | null;
    const i = el?.getAttribute?.("data-edge");
    if (i != null) onPickFront(Number(i));
  };
  const summary = scheme ? describeScheme(scheme) : "Solving the lot…";

  return (
    <div className="absolute inset-0 bg-[#e6eaec]">
      <div className="absolute right-0 top-0" style={{ left: insets.left, bottom: insets.bottom }}>
        {mode === "3d" ? (
          <div ref={host} tabIndex={0} role="img" onKeyDown={key}
            aria-label={`Clay model of the building on the lot. ${summary} Arrow keys orbit, plus and minus zoom, Home resets.`}
            className="absolute inset-0 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-sky-600">
            {failed && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-slate-800">This browser can’t draw 3D (WebGL is off). Use the Plan view.</p>}
          </div>
        ) : (
          <div className="absolute inset-0 overflow-auto p-4 pt-28 md:pt-20">
            {plan ? (
              <svg viewBox={plan.viewBox} role="group" aria-label={`Plan of the lot. ${summary} Lot edges are buttons: press Enter on one to make it the front.`}
                className="qf2-plan mx-auto h-full max-h-[calc(100%-1rem)] w-full max-w-[900px] rounded-xl bg-white shadow"
                onClick={(e) => pick(e.target)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e.target); } }}
                dangerouslySetInnerHTML={{ __html: plan.body }} />
            ) : <p className="text-sm text-slate-800">Solving the lot…</p>}
          </div>
        )}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full border border-slate-300 bg-white/95 p-1 text-sm shadow-lg" role="toolbar" aria-label="Build view">
          <div role="radiogroup" aria-label="Drawing" className="flex gap-1">
            {(["3d", "plan"] as ClayMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onModeChange(m)}
                className={`h-9 rounded-full px-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${mode === m ? "bg-slate-900 text-white" : "text-slate-900 hover:bg-slate-100"}`}>{m === "3d" ? "3D" : "Plan"}</button>
            ))}
          </div>
          {mode === "3d" && <>
            <span aria-hidden className="mx-1 h-5 w-px bg-slate-300" />
            <Btn label="Rotate left" onClick={() => view.current?.orbit(0.4, 0)}>↺</Btn>
            <Btn label="Rotate right" onClick={() => view.current?.orbit(-0.4, 0)}>↻</Btn>
            <Btn label="Zoom in" onClick={() => view.current?.zoom(0.8)}>+</Btn>
            <Btn label="Zoom out" onClick={() => view.current?.zoom(1.25)}>−</Btn>
            <Btn label="Reset view" onClick={() => view.current?.reset()}>Reset</Btn>
          </>}
        </div>
        <p className="sr-only" aria-live="polite">{summary}</p>
      </div>
      <style>{`.qf2-plan .el{font:600 3.2px system-ui,sans-serif;fill:#1f2937;letter-spacing:.2px}.qf2-plan .dim{font:600 3.6px system-ui,sans-serif;fill:#111827}.qf2-plan .qf2-edge{cursor:pointer}.qf2-plan .qf2-edge:hover,.qf2-plan .qf2-edge:focus-visible{stroke:#0369a1;stroke-opacity:1;stroke-width:2.4px;outline:none}`}</style>
    </div>
  );
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="h-9 min-w-9 rounded-full px-2.5 font-semibold text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">{children}</button>
  );
}
