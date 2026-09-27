"use client";

// Runs the QuickFit 3D generator in a Web Worker (lib/quickfit-worker.ts). Every control change is sent
// at most once per animation frame; while a solve is in flight only the newest controls wait (older ones
// are dropped), so the view never lags behind a slider. Falls back to the main thread when workers are
// unavailable. Solve and pro forma times are kept on window.__qfTimes for measurement.

import { useEffect, useRef, useState } from "react";
import type { quickfit, score } from "@easescore/engine";
import { financeFor, generate, metricsOf, sameControls, type FinanceInputs, type GenControls, type GenInput, type GenMetrics, type GenResult, type GenTypology } from "./quickfit-gen";

export interface QuickFitRun {
  result: GenResult | null;
  metrics: GenMetrics | null;
  /** Worker compute times and the main-thread round trip, milliseconds. */
  ms: { solve: number; finance: number; roundTrip: number } | null;
  error: string | null;
}

type Req = { kind: "run"; controls: GenControls } | { kind: "finance"; strategy: score.StrategyId };

export function useQuickFit(input: GenInput | null, fin: FinanceInputs | null, fixed: Partial<Record<score.StrategyId, quickfit.Scheme>>, defaults: Partial<Record<GenTypology, GenControls>>, req: Req | null): QuickFitRun {
  const [run, setRun] = useState<QuickFitRun>({ result: null, metrics: null, ms: null, error: null });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const busy = useRef<{ id: number; t0: number; req: Req } | null>(null);
  const pending = useRef<Req | null>(null);
  const raf = useRef(0);
  const ready = useRef(false);

  const record = (ms: QuickFitRun["ms"]) => {
    try {
      const w = window as unknown as { __qfTimes?: unknown[] };
      (w.__qfTimes ??= []).push(ms);
    } catch { /* measurement only */ }
  };

  const send = (r: Req) => {
    const id = ++seq.current;
    const t0 = performance.now();
    const w = worker.current;
    if (w) {
      busy.current = { id, t0, req: r };
      w.postMessage(r.kind === "run" ? { type: "run", id, controls: r.controls } : { type: "finance", id, strategy: r.strategy });
      return;
    }
    // Main-thread fallback (no Worker support).
    if (!input || !fin) return;
    try {
      const a = performance.now();
      const d = r.kind === "run" ? defaults[r.controls.typology] : undefined;
      const own = r.kind === "run" && d && sameControls({ ...r.controls, stories: d.stories, unitWidthFt: d.unitWidthFt, parking: d.parking }, d) ? fixed[strategyFor(r.controls)] ?? null : null;
      const result = r.kind === "run" ? generate(input, r.controls, own) : null;
      const b = performance.now();
      const f = financeFor(fin, result ? result.strategy : (r as { strategy: score.StrategyId }).strategy, result?.scheme ?? null, result?.stepping ?? null);
      const ms = { solve: b - a, finance: performance.now() - b, roundTrip: performance.now() - t0 };
      record(ms);
      setRun({ result, metrics: metricsOf(f.selected, f.pf), ms, error: null });
    } catch (e) {
      setRun((x) => ({ ...x, error: String((e as Error)?.message ?? e) }));
    }
  };

  // One worker per parcel's inputs.
  useEffect(() => {
    if (!input || !fin) return;
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./quickfit-worker.ts", import.meta.url), { type: "module" });
    } catch {
      w = null;
    }
    worker.current = w;
    ready.current = true;
    if (w) {
      w.postMessage({ type: "init", input, fin, fixed, defaults });
      w.onmessage = (e: MessageEvent<{ id: number; result: GenResult | null; metrics: GenMetrics; ms: { solve: number; finance: number }; error?: string }>) => {
        const b = busy.current;
        busy.current = null;
        const d = e.data;
        if (b && d.id === b.id) {
          if (d.error) setRun((x) => ({ ...x, error: d.error! }));
          else {
            const ms = { ...d.ms, roundTrip: performance.now() - b.t0 };
            record(ms);
            setRun({ result: d.result, metrics: d.metrics, ms, error: null });
          }
        }
        const next = pending.current;
        pending.current = null;
        if (next) send(next);
      };
      w.onerror = () => {
        // Worker failed to load: fall back to the main thread (redo what was in flight, then the newest request).
        w?.terminate();
        worker.current = null;
        const inFlight = busy.current?.req ?? null;
        busy.current = null;
        const next = pending.current ?? inFlight;
        pending.current = null;
        if (next) send(next);
      };
    }
    return () => {
      w?.terminate();
      worker.current = null;
      busy.current = null;
      ready.current = false;
    };
  }, [input, fin, fixed, defaults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce to one animation frame; coalesce while a solve is in flight.
  const key = req ? JSON.stringify(req) : "";
  useEffect(() => {
    if (!req || !input || !fin) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (busy.current) pending.current = req;
      else send(req);
    });
    return () => cancelAnimationFrame(raf.current);
  }, [key, input, fin]); // eslint-disable-line react-hooks/exhaustive-deps

  return run;
}

const STRATEGY: Record<GenControls["typology"], score.StrategyId> = { sf: "new_sf", duplex: "duplex", plex: "three_four_unit", townhouse: "townhouse_row", adu: "adu" };
const strategyFor = (c: GenControls) => STRATEGY[c.typology];
