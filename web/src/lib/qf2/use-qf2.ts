"use client";

// Runs QuickFit v2 in a Web Worker (lib/qf2/worker.ts). A control change is sent at most once per
// animation frame; while a solve is in flight only the newest request waits. Falls back to the main
// thread when workers are unavailable. The first layout never waits on the worker: if the worker has not
// answered within FIRST_MS (its script still loading or compiling), that request is solved on the main
// thread (about 70 ms), so the plan and the model show at once. New lot data for the same parcel (the
// existing buildings arrive with the map data) re-initializes the worker instead of replacing it, so an
// answer in flight is never thrown away.

import { useEffect, useRef, useState } from "react";
import type { score } from "@easescore/engine";
import { financeFor, metricsOf, type FinanceInputs, type GenMetrics } from "../quickfit-gen";
import { QF2_TYPES, sourcesOf, solveApp, steppingOf, toParcelInput, toV1Scheme, unknownUses, type AppControls, type Qf2Data, type Scheme, type Typology } from "./core";

export interface TypeSummary { typology: Typology; status: Scheme["status"]; units: number; sentence: string }
export interface Qf2Run {
  scheme: Scheme | null;
  all: TypeSummary[];
  metrics: GenMetrics | null;
  controls: AppControls | null;
  ms: { solve: number; finance: number; roundTrip: number } | null;
  error: string | null;
}
type Req = { controls: AppControls; strategy: score.StrategyId | null };
const FIRST_MS = 500;

function solveHere(data: Qf2Data, fin: FinanceInputs | null, r: Req) {
  const src = sourcesOf(data, r.controls.frontEdgeIndex);
  const input = toParcelInput(src);
  if (!input) return null;
  const unknown = unknownUses(src);
  const all = QF2_TYPES.map((t) => solveApp(input, { ...r.controls, typology: t.id }, unknown));
  const scheme = all.find((s) => s.typology === r.controls.typology)!;
  let metrics: GenMetrics | null = null;
  if (fin && r.strategy) {
    const v1 = scheme.footprintWorld && scheme.status !== "not_allowed" ? toV1Scheme(scheme, input) : null;
    const f = financeFor(fin, r.strategy, v1, steppingOf(scheme));
    metrics = metricsOf(f.selected, f.pf);
  }
  return { scheme, metrics, all: all.map((s) => ({ typology: s.typology, status: s.status, units: s.units.length, sentence: s.statusSentence })) };
}

export function useQf2(data: Qf2Data | null, fin: FinanceInputs | null, req: Req | null): Qf2Run {
  const [run, setRun] = useState<Qf2Run>({ scheme: null, all: [], metrics: null, controls: null, ms: null, error: null });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const busy = useRef<{ id: number; t0: number; req: Req } | null>(null);
  const pending = useRef<Req | null>(null);
  const raf = useRef(0);
  const answered = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const send = (r: Req) => {
    const id = ++seq.current;
    const t0 = performance.now();
    const w = worker.current;
    if (w) {
      busy.current = { id, t0, req: r };
      w.postMessage({ type: "run", id, controls: r.controls, strategy: r.strategy });
      return;
    }
    solveMain(r, t0);
  };
  const solveMain = (r: Req, t0 = performance.now()) => {
    const d = dataRef.current;
    if (!d) return;
    try {
      const a = performance.now();
      const out = solveHere(d, fin, r);
      if (!out) return;
      answered.current = true;
      setRun({ ...out, controls: r.controls, ms: { solve: performance.now() - a, finance: 0, roundTrip: performance.now() - t0 }, error: null });
    } catch (e) {
      setRun((x) => ({ ...x, error: String((e as Error)?.message ?? e) }));
    }
  };

  const parid = data?.parid ?? null;
  useEffect(() => {
    if (!parid || !dataRef.current) return;
    answered.current = false;
    let w: Worker | null = null;
    try { w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }); } catch { w = null; }
    worker.current = w;
    if (w) {
      w.postMessage({ type: "init", data: dataRef.current, fin });
      w.onmessage = (e: MessageEvent<{ id: number; scheme?: Scheme; all?: TypeSummary[]; metrics?: GenMetrics | null; ms?: { solve: number; finance: number }; error?: string }>) => {
        const b = busy.current;
        busy.current = null;
        const d = e.data;
        if (b && d.id === b.id) {
          if (d.error) setRun((x) => ({ ...x, error: d.error! }));
          else {
            answered.current = true;
            const ms = { ...d.ms!, roundTrip: performance.now() - b.t0 };
            try { ((window as unknown as { __qf2Times?: unknown[] }).__qf2Times ??= []).push(ms); } catch { /* measurement only */ }
            setRun({ scheme: d.scheme ?? null, all: d.all ?? [], metrics: d.metrics ?? null, controls: b.req.controls, ms, error: null });
          }
        }
        const next = pending.current;
        pending.current = null;
        if (next) send(next);
      };
      w.onerror = () => {
        w?.terminate();
        worker.current = null;
        const inFlight = busy.current?.req ?? null;
        busy.current = null;
        const next = pending.current ?? inFlight;
        pending.current = null;
        if (next) send(next);
      };
    }
    return () => { w?.terminate(); worker.current = null; busy.current = null; };
  }, [parid, fin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same parcel, new data (existing buildings from the map data): re-initialize the worker in place.
  const initFor = useRef<Qf2Data | null>(null);
  useEffect(() => {
    if (!data || !worker.current) { initFor.current = data; return; }
    if (initFor.current && initFor.current !== data) worker.current.postMessage({ type: "init", data, fin });
    initFor.current = data;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The first layout: solve on the main thread when the worker is slow to start.
  const firstKey = req && data ? `${data.parid}` : "";
  useEffect(() => {
    if (!firstKey) return;
    const t = setTimeout(() => { if (!answered.current && req) solveMain(req); }, FIRST_MS);
    return () => clearTimeout(t);
  }, [firstKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = req ? JSON.stringify(req) : "";
  useEffect(() => {
    if (!req || !data) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (busy.current) pending.current = req;
      else send(req);
    });
    return () => cancelAnimationFrame(raf.current);
  }, [key, data, fin]); // eslint-disable-line react-hooks/exhaustive-deps

  return run;
}
