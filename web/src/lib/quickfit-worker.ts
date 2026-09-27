/// <reference lib="webworker" />
// QuickFit 3D generator worker: solves the map controls off the main thread (lib/quickfit-gen.ts, pure
// and deterministic) and runs the engine pro forma for the scheme. Messages:
//   { type: "init", input, fin, fixed }  once per parcel (fixed = priced scheme per strategy)
//   { type: "run", id, controls }         -> { id, result, metrics, ms: { solve, finance } }
//   { type: "finance", id, strategy }     -> { id, result: null, metrics, ms }  (options without a generator, e.g. rehab)

import type { quickfit, score } from "@easescore/engine";
import { financeFor, generate, metricsOf, sameControls, type FinanceInputs, type GenControls, type GenInput, type GenTypology } from "./quickfit-gen";

type Msg =
  | { type: "init"; input: GenInput; fin: FinanceInputs; fixed: Partial<Record<score.StrategyId, quickfit.Scheme>>; defaults: Partial<Record<GenTypology, GenControls>> }
  | { type: "run"; id: number; controls: GenControls }
  | { type: "finance"; id: number; strategy: score.StrategyId };

let input: GenInput | null = null;
let fin: FinanceInputs | null = null;
let fixed: Partial<Record<score.StrategyId, quickfit.Scheme>> = {};
let defaults: Partial<Record<GenTypology, GenControls>> = {};

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === "init") {
    input = m.input;
    fin = m.fin;
    fixed = m.fixed ?? {};
    defaults = m.defaults ?? {};
    return;
  }
  if (!input || !fin) return;
  try {
    if (m.type === "finance") {
      const t0 = performance.now();
      const f = financeFor(fin, m.strategy, null, null);
      (self as unknown as Worker).postMessage({ id: m.id, result: null, metrics: metricsOf(f.selected, f.pf), ms: { solve: 0, finance: performance.now() - t0 } });
      return;
    }
    const t0 = performance.now();
    // The priced scheme stands only while the setbacks are its own.
    const own = sameSetbacks(m.controls, defaults[m.controls.typology]) ? fixed[strategyOf(m.controls)] ?? null : null;
    const r = generate(input, m.controls, own);
    const t1 = performance.now();
    const f = financeFor(fin, r.strategy, r.scheme, r.stepping);
    const metrics = metricsOf(f.selected, f.pf);
    (self as unknown as Worker).postMessage({ id: m.id, result: r, metrics, ms: { solve: t1 - t0, finance: performance.now() - t1 } });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String((err as Error)?.message ?? err) });
  }
};

const STRATEGY: Record<GenControls["typology"], score.StrategyId> = { sf: "new_sf", duplex: "duplex", plex: "three_four_unit", townhouse: "townhouse_row", adu: "adu" };
const strategyOf = (c: GenControls) => STRATEGY[c.typology];
const sameSetbacks = (a: GenControls, b: GenControls | undefined) => !!b && sameControls({ ...a, stories: b.stories, unitWidthFt: b.unitWidthFt, parking: b.parking }, b);
