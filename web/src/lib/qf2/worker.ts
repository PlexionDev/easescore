/// <reference lib="webworker" />
// QuickFit v2 worker: solves every building type for the map controls off the main thread (the
// solver is pure and deterministic, so the server gets the same answer for the same URL), then prices
// the selected one with the engine pro forma. Messages:
//   { type: "init", data, fin }                 once per parcel
//   { type: "run", id, controls, strategy }     -> { id, scheme, all, metrics, ms: { solve, finance } }

import type { score } from "@easescore/engine";
import { financeFor, metricsOf, type FinanceInputs } from "../quickfit-gen";
import { QF2_TYPES, sourcesOf, solveApp, steppingOf, toParcelInput, toV1Scheme, unknownUses, type AppControls, type Qf2Data } from "./core";

type Msg =
  | { type: "init"; data: Qf2Data; fin: FinanceInputs | null }
  | { type: "run"; id: number; controls: AppControls; strategy: score.StrategyId | null };

let data: Qf2Data | null = null;
let fin: FinanceInputs | null = null;

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === "init") { data = m.data; fin = m.fin; return; }
  if (!data) return;
  try {
    const t0 = performance.now();
    const src = sourcesOf(data, m.controls.frontEdgeIndex);
    const input = toParcelInput(src);
    if (!input) { (self as unknown as Worker).postMessage({ id: m.id, error: "no-input" }); return; }
    const unknown = unknownUses(src);
    const all = QF2_TYPES.map((t) => solveApp(input, { ...m.controls, typology: t.id }, unknown));
    const scheme = all.find((s) => s.typology === m.controls.typology)!;
    const t1 = performance.now();
    let metrics = null;
    if (fin && m.strategy) {
      const v1 = scheme.footprintWorld && scheme.status !== "not_allowed" ? toV1Scheme(scheme, input) : null;
      const f = financeFor(fin, m.strategy, v1, steppingOf(scheme));
      metrics = metricsOf(f.selected, f.pf);
    }
    (self as unknown as Worker).postMessage({
      id: m.id, scheme, metrics,
      all: all.map((s) => ({ typology: s.typology, status: s.status, units: s.units.length, sentence: s.statusSentence })),
      ms: { solve: t1 - t0, finance: performance.now() - t1 },
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String((err as Error)?.message ?? err) });
  }
};
