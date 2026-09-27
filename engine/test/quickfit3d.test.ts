// QuickFit 3D generator (web/src/lib/quickfit-gen.ts; v1, no longer drawn in the UI): deterministic runs,
// hillside stepping that follows the lidar grade, metrics that equal the engine pro forma for the same
// scheme, and massing that stays inside the lot. Synthetic lots and terrain only (no real parcels).

import { describe, expect, it } from "vitest";
import { assumptions, score, type ZoningRules } from "../src";
import {
  STEPPING, controlsFromScheme, financeFor, generate, metricsOf, plates, proFormaFacts, schemeBoxes, solveControls,
  type FinanceInputs, type GenControls, type GenInput,
} from "../../web/src/lib/quickfit-gen";
import { groundAt, type TerrainGrid } from "../../web/src/lib/terrain-grid";

type Pt = [number, number];

// A synthetic 45 x 110 ft lot, street along y = 0 (edge 0), in a district shaped like R1D-M.
const LOT: Pt[] = [[0, 0], [45, 0], [45, 110], [0, 110]];
const RULES: ZoningRules = {
  district_name: "Synthetic R1D-M", single_unit_detached: "P", two_unit: "P", three_unit: "S", multi_unit: "N",
  min_lot_area_sqft: 3200, min_front_setback_ft: 15, min_rear_setback_ft: 15, min_side_setback_ft: 3,
  max_height_ft: 40, max_height_stories: 3, parking_per_unit: 1, contextual_front_setback: false, citation: null, confidence: "confirmed",
};

/** Terrain grid over the lot: z = 1000 - slope * y (feet), 3 ft cells. */
function grid(slopePct: number, cross = 0): TerrainGrid {
  const step = 3, x0 = -6, y0 = -6, nx = 22, ny = 44;
  const z: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z.push(Math.round((1000 - (slopePct / 100) * (y0 + j * step) - (cross / 100) * (x0 + i * step)) * 10) / 10);
  return { x0, y0, step, nx, ny, z };
}

const input = (terrain: TerrainGrid | null): GenInput => ({ qf: { parcel: LOT, frontEdges: [0], streetSideEdges: [], masks: [] }, zoneCode: "R1D-M", rulesRow: RULES as never, terrain });
const C = (p: Partial<GenControls> = {}): GenControls => ({ typology: "sf", stories: 2, unitWidthFt: null, parking: "none", front: null, side: null, rear: null, ...p });

function inRing([x, y]: Pt, r: Pt[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const onOrIn = (p: Pt, r: Pt[]) => inRing(p, r) || r.some((q, i) => { const s = r[(i + 1) % r.length]!; const cross = (s[0] - q[0]) * (p[1] - q[1]) - (s[1] - q[1]) * (p[0] - q[0]); return Math.abs(cross) < 1e-6 * Math.hypot(s[0] - q[0], s[1] - q[1]) + 1e-6 && Math.min(q[0], s[0]) - 1e-6 <= p[0] && p[0] <= Math.max(q[0], s[0]) + 1e-6 && Math.min(q[1], s[1]) - 1e-6 <= p[1] && p[1] <= Math.max(q[1], s[1]) + 1e-6; });

// Synthetic sales (not real): six new homes at $300/SF and older resales, as in assumptions.test.ts.
const AT = { lat: 40.4, lon: -80.0 };
const NEW_SALES: assumptions.SaleRecord[] = [0.1, 0.15, 0.2, 0.35, 0.4, 0.45].map((d, i) => ({
  parid: `N${i}`, saleDate: `2026-0${(i % 6) + 1}-15`, price: 540000, livingAreaSqft: 1800, yearBuilt: 2024, use: "SINGLE FAMILY", lat: AT.lat + d / 69, lon: AT.lon,
}));
const NEW = assumptions.newConstructionComps(AT, NEW_SALES, { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "single-family homes" });
const FACTS = {
  slope_1m: { mean_pct: 12, share_over_15: 0.2, share_over_25: 0.05 }, overlays: [], mines: { in_city_undermined: false, in_mined_out: false, msi_risk: null },
  site: { building_count: 0 }, assessment: { use: "VACANT LAND", fmv_land: 12000, fmv_total: 12000, is_pittsburgh: true, living_area_sqft: null },
  property_tax: { general_mills: 24 }, transfer_tax: { total_pct: 4 }, unrelated: "ignored",
};
const FIN: FinanceInputs = {
  facts: proFormaFacts(FACTS), sfComps: null, newComps: { new_sf: NEW, duplex: NEW, three_four_unit: NEW, townhouse_row: NEW }, rehabComps: null,
  rents: { hud_fmr: { year: 2026, br2: 1400, br3: 1700 } }, prime: { rate: 0.075, date: "2026-09-01" }, tapFees: 3000,
  permitMonths: { new_sf: 3 }, overrides: {}, results: {},
};

describe("QuickFit 3D generator", () => {
  it("is deterministic: identical controls give identical results", () => {
    // The browser worker for this generator is retired (QuickFit v2 runs in web/src/lib/qf2/worker.ts); the pure function stays.
    const c = C({ typology: "duplex", stories: 3 });
    expect(JSON.stringify(generate(input(grid(30)), c))).toBe(JSON.stringify(generate(input(grid(30)), c)));
  });

  it("steps floor plates down the grade in whole increments, each within half an increment of the lidar ground", () => {
    const g = grid(30);
    const r = generate(input(g), C({ stories: 2 }));
    expect(r.scheme).not.toBeNull();
    expect(r.stepping.footprintSlopePct).toBeGreaterThan(STEPPING.thresholdPct);
    expect(r.stepping.applies).toBe(true);
    expect(r.stepping.steps).toBeGreaterThanOrEqual(1);
    const inc = STEPPING.incrementFt;
    const base = Math.min(...r.stepping.cells.map((c) => c.plate));
    for (const c of r.stepping.cells) {
      expect(Math.abs(c.plate - c.ground)).toBeLessThanOrEqual(inc / 2 + 0.1);
      const k = (c.plate - base) / inc;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(0.05);
    }
    // Ground-floor boxes sit on their plate: within half an increment (plus the cell's own grade) of the ground at their center.
    for (const b of r.boxes.filter((x) => x.floor === 0)) {
      const cx = b.ring.reduce((s, p) => s + p[0], 0) / 4, cy = b.ring.reduce((s, p) => s + p[1], 0) / 4;
      expect(Math.abs(b.z0 - groundAt(g, cx, cy)!)).toBeLessThanOrEqual(inc / 2 + 0.3 * 8);
    }
    // Downhill plates are lower: the grade falls with y, so do the plates.
    const pl = plates(r.scheme!.footprints, g).cells;
    const front = pl.reduce((a, c) => (c.cell.v0 < a.cell.v0 ? c : a)), back = pl.reduce((a, c) => (c.cell.v0 > a.cell.v0 ? c : a));
    expect(back.plate).toBeLessThan(front.plate);
  });

  it("keeps one flat plate below the stepping threshold", () => {
    const r = generate(input(grid(4)), C());
    expect(r.stepping.applies).toBe(false);
    expect(new Set(r.boxes.filter((b) => b.floor === 0).map((b) => b.z0)).size).toBe(1);
  });

  it("keeps every box inside the lot and the building inside the buildable envelope", () => {
    for (const c of [C(), C({ typology: "duplex", stories: 3, parking: "tuck" }), C({ typology: "townhouse", parking: "pad" }), C({ typology: "plex", stories: 3, parking: "pad" }), C({ typology: "sf", front: 5, side: 0 })]) {
      const r = generate(input(grid(20, 5)), c);
      expect(r.scheme, JSON.stringify(c)).not.toBeNull();
      for (const b of r.boxes) for (const p of b.ring) expect(onOrIn(p, LOT), `${c.typology} ${b.kind} ${p}`).toBe(true);
      // The envelope drawn is the code one (a setback what-if shows as the building crossing the setback line).
      if (c.front != null || c.side != null) { expect(r.scheme!.badge).toBe("needs_approval"); continue; }
      const env = r.envelope.map((poly) => poly[0]!);
      for (const f of r.scheme!.footprints) for (const p of f) expect(env.some((e) => onOrIn(p, e)), `${c.typology} footprint ${p}`).toBe(true);
    }
  });

  it("draws floors x units: stories x units unit boxes, a garage bay per tuck-under unit, one stair core per unit", () => {
    const r = generate(input(null), C({ typology: "townhouse", stories: 3, parking: "tuck" }));
    const s = r.scheme!;
    expect(s.parking).toBe("garage");
    expect(r.boxes.filter((b) => b.kind === "garage")).toHaveLength(s.units);
    expect(r.boxes.filter((b) => b.kind === "core")).toHaveLength(s.units);
    expect(new Set(r.boxes.filter((b) => b.kind === "townhouse").map((b) => `${b.unit}|${b.floor}`)).size).toBe(s.units * s.stories);
  });

  it("reproduces the score's priced scheme from its own controls", () => {
    const q = input(null).qf as score.QuickFitParcelInput;
    const rules = score.solverRules("R1D-M", RULES as never);
    const fits = score.runStrategyFits(q, rules, { probeSetbacksFt: score.DEFAULT_CONFIG.f1.varianceProbeSetbacksFt });
    for (const [t, strategy] of [["sf", "new_sf"], ["duplex", "duplex"], ["townhouse", "townhouse_row"]] as const) {
      const priced = fits.schemes[strategy];
      if (!priced || fits.fits[strategy]?.status !== "by_right") continue;
      const got = solveControls(input(null), controlsFromScheme(t, priced, "by_right", []));
      expect(got.scheme?.id).toBe(priced.id);
      expect(got.scheme?.units).toBe(priced.units);
      expect(got.scheme?.grossFloorAreaSf).toBe(priced.grossFloorAreaSf);
    }
  });

  it("shows exactly the engine pro forma for the same scheme (metrics bar = pro forma)", () => {
    const r = generate(input(grid(30)), C({ typology: "duplex", stories: 3 }));
    const { selected, pf } = financeFor(FIN, "duplex", r.scheme, r.stepping);
    // The page's path, written out: selectScheme -> buildDevelopmentInputs (with the stepping input) -> evaluateDevelopment.
    const sel2 = score.selectScheme({ strategy: "duplex", scheme: r.scheme, result: null, existing: { livingAreaSqft: null, use: "VACANT LAND" }, overrides: {} });
    const pf2 = assumptions.evaluateDevelopment(assumptions.buildDevelopmentInputs({
      strategy: "duplex", facts: proFormaFacts(FACTS), scheme: r.scheme, selected: sel2, comps: null, newComps: NEW,
      rents: FIN.rents, primeRate: 0.075, primeRateDate: "2026-09-01", permitMonths: null, tapFeesPerUnit: 3000, overrides: {},
      stepping: { steps: r.stepping.steps, dropFt: r.stepping.dropFt, footprintSlopePct: r.stepping.footprintSlopePct!, thresholdPct: STEPPING.thresholdPct, incrementFt: STEPPING.incrementFt },
      footprintSlopePct: r.stepping.footprintSlopePct,
    }));
    expect(pf).not.toBeNull();
    expect(JSON.stringify(pf!.ranges)).toBe(JSON.stringify(pf2.ranges));
    const m = metricsOf(selected, pf);
    expect(m.totalCost).toEqual(pf2.ranges.tdc);
    expect(m.profit).toEqual(pf2.ranges.sale.profit);
    expect(m.value).toEqual(pf2.ranges.sale.grossSales);
    expect(m.yieldOnCostPct).toEqual(pf2.ranges.rent.yieldOnCostPct);
    expect(m.units).toBe(sel2.units);
    expect(m.grossSf).toBe(sel2.grossFloorAreaSf);
    expect(m.avgUnitSf).toBe(Math.round(sel2.finishedSf! / sel2.units!));
    // The slope under the footprint prices the foundation once, through the builder.
    expect(pf!.plan.slopeBasis).toBe("under the building footprint");
    expect(pf!.plan.lines.filter((l) => l.id === "slope_adder")).toHaveLength(1);
  });

  it("draws a parking pad inside the lot for surface parking", () => {
    const r = generate(input(null), C({ typology: "sf", parking: "pad" }));
    const pad = r.boxes.find((b) => b.kind === "pad");
    expect(r.scheme?.parking).toBe("surface");
    expect(pad).toBeDefined();
    for (const p of pad!.ring) expect(onOrIn(p, LOT)).toBe(true);
    // Drawn boxes never change the solver's areas.
    expect(schemeBoxes(r.scheme!, LOT, null).boxes.length).toBe(r.boxes.length);
  });
});

describe("Slope under the building footprint in the pro forma (cost model v0.2 = backtest run D)", () => {
  const base = (facts: assumptions.ProFormaFacts, stepping: assumptions.SteppingInput | null, footprintSlopePct?: number | null) =>
    assumptions.buildDevelopmentInputs({ strategy: "new_sf", facts, scheme: { units: 1, grossFloorAreaSf: 2000, netFloorAreaSf: 1700, footprintSf: 1000, stories: 2 }, comps: null, newComps: NEW, rents: null, stepping, footprintSlopePct });
  const ST: assumptions.SteppingInput = { steps: 2, dropFt: 5, footprintSlopePct: 22, thresholdPct: 15, incrementFt: 2.5 };
  const f = (mean: number, sh25: number): assumptions.ProFormaFacts => ({ ...proFormaFacts(FACTS), slope_1m: { mean_pct: mean, share_over_15: 0, share_over_25: sh25 } });

  it("prices the moderate premium and the structural engineer when the footprint slope is over 15%", () => {
    const p = base(f(4, 0), ST);
    const l = p.lines.filter((x) => x.id === "slope_adder");
    expect(l).toHaveLength(1);
    // Priced on the footprint (1,000 sq ft), not the finished area of every floor.
    expect(l[0]!.amount).toBe(assumptions.COST_CONFIG.siteAdders.moderateSlope.value * 1000);
    expect(p.adders.map((a) => a.id)).toEqual(["moderate_slope"]);
    expect(p.assumptions.find((r) => r.key === "structural")!.value).toBe("$8,000");
  });

  it("prices the steep premium and retaining walls at 25% or more under the footprint", () => {
    const p = base(f(4, 0), { ...ST, footprintSlopePct: 30 });
    expect(p.adders.map((a) => a.id)).toEqual(["steep_slope", "retaining_walls"]);
    expect(p.stepping?.pricedBy).toBe("steep_slope_adder");
  });

  it("uses the footprint slope, not the lot, when both are known", () => {
    const flatSpot = base(f(40, 0.8), null, 10);
    expect(flatSpot.adders).toEqual([]);
    expect(flatSpot.assumptions.find((r) => r.key === "structural")!.value).toMatch(/^not needed/);
  });

  it("falls back to the lot's average slope when there is no footprint slope", () => {
    expect(base(f(20, 0), null).adders.map((a) => a.id)).toEqual(["moderate_slope"]);
    expect(base(f(12, 0), null).adders).toEqual([]);
    expect(base(f(20, 0), null).slopeBasis).toBe("lot average (no building footprint)");
  });
});
