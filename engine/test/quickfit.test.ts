import { describe, expect, it } from "vitest";
import { quickfit } from "../src";

type Pt = [number, number];
type Rules = quickfit.QuickFitRules;
type Input = quickfit.QuickFitInput;

// Synthetic rules shaped like an R1D-H row of the zoning table. No real parcel is used anywhere here.
const R1D_H: Rules = {
  district_name: "synthetic R1D-H",
  single_unit_detached: "P",
  two_unit: "N",
  three_unit: "N",
  multi_unit: "N",
  min_lot_area_sqft: 1200,
  min_front_setback_ft: 15,
  min_rear_setback_ft: 15,
  min_side_setback_ft: 5,
  max_height_ft: 40,
  max_height_stories: 3,
  parking_per_unit: 1,
  contextual_front_setback: true,
  citation: null,
  confidence: "confirmed",
  ...quickfit.attachedRulesForDistrict("R1D-H"),
};

/** Axis-aligned w x d lot, front edge 0 along y = 0. */
const lot = (w: number, d: number): Pt[] => [[0, 0], [w, 0], [w, d], [0, d]];
const rectPoly = (x0: number, y0: number, x1: number, y1: number): Pt[][] => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];

const solve = (over: Partial<Input> & { parcel: Pt[] }) =>
  quickfit.solveQuickFit({ frontEdges: [0], rules: R1D_H, ...over });

const only = (res: quickfit.QuickFitResult, typ: string) => res.all.filter((s) => s.typology === typ);
const maxBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));

describe("envelope", () => {
  it("40 x 100 lot with 15/15/5 setbacks gives a 30 x 70 = 2,100 sf envelope", () => {
    const res = solve({ parcel: lot(40, 100) });
    expect(res.lotAreaSf).toBe(4000);
    expect(res.envelope.areaSf).toBe(2100);
    expect(res.units).toBe("ft");
  });

  it("is the same for the lot rotated 30 degrees, wound clockwise, at State Plane-sized coordinates", () => {
    const a = (30 * Math.PI) / 180;
    const move = ([x, y]: Pt): Pt => [1_340_000 + x * Math.cos(a) - y * Math.sin(a), 410_000 + x * Math.sin(a) + y * Math.cos(a)];
    // Clockwise order; the front (y = 0) edge is now edge 3: (40,0) -> (0,0).
    const cw = ([[0, 0], [0, 100], [40, 100], [40, 0]] as Pt[]).map(move);
    const res = solve({ parcel: cw, frontEdges: [3] });
    expect(res.envelope.areaSf).toBeCloseTo(2100, 3);
    const flat = solve({ parcel: lot(40, 100) });
    expect(res.all.map((s) => [s.id, s.units, s.grossFloorAreaSf])).toEqual(
      flat.all.map((s) => [s.id, s.units, s.grossFloorAreaSf]),
    );
    // Footprints come back in the input coordinates.
    const fp = res.best!.footprints[0]!;
    expect(fp[0]![0]).toBeGreaterThan(1_339_000);
  });

  it("cuts a triangular steep area out of the envelope (2,100 - 200 = 1,900 sf)", () => {
    const res = solve({
      parcel: lot(40, 100),
      masks: [{ polygon: [[[0, 100], [40, 100], [40, 60]]], label: "Slope over 25%" }],
    });
    // Hypotenuse y = 100 - x crosses the 30 x 70 envelope; the cut is the integral of (x - 15) for x in 15..35.
    expect(res.envelope.areaSf).toBe(1900);
  });
});

describe("placement and binding constraints", () => {
  it("20 x 90 lot: the front setback is the limit", () => {
    // Synthetic rules: 25 ft front, 15 ft rear, 2 ft sides; preset depth editable up to 70 ft.
    // Envelope 16 x 50. Dropping the front setback frees 20 ft of depth (capped at 70); the rear only 15.
    const res = solve({
      parcel: lot(20, 90),
      rules: { ...R1D_H, min_front_setback_ft: 25, min_side_setback_ft: 2 },
      typologies: [{ ...quickfit.SINGLE_FAMILY, unitDepthFt: { min: 24, max: 70, step: 1 } }],
      parkingOptions: ["none"],
    });
    expect(res.envelope.areaSf).toBe(800);
    expect(res.all.length).toBe(2); // one width (16 ft) x two story counts
    for (const s of res.all) {
      expect(s.unitWidthFt).toBe(16);
      expect(s.unitDepthFt).toBe(50);
      expect(s.binding.id).toBe("front_setback");
      expect(s.binding.label).toBe("Front setback is the limit");
      expect(s.binding.detail).toContain(`+${16 * 20 * s.stories} sf`);
    }
  });

  it("masked steep strip along one side: the unbuildable area is the limit", () => {
    const res = solve({
      parcel: lot(40, 100),
      masks: [{ polygon: rectPoly(0, 0, 15, 100), label: "Slope over 25%" }],
      parkingOptions: ["none"],
    });
    expect(res.envelope.areaSf).toBe(20 * 70);
    const sf = only(res, "single_family");
    expect(Math.max(...sf.map((s) => s.unitWidthFt))).toBe(20);
    const widest = sf.find((s) => s.unitWidthFt === 20 && s.stories === 2)!;
    expect(widest.binding.id).toBe("unbuildable_area");
    expect(widest.binding.label).toBe("Unbuildable area (Slope over 25%) is the limit");
    expect(only(res, "townhouse_row")).toHaveLength(0); // 20 ft is too narrow for two 16 ft units
  });

  it("width sweep on a 100 x 100 lot gives the known row counts (90 ft of frontage in the envelope)", () => {
    const res = solve({ parcel: lot(100, 100), parkingOptions: ["none"] });
    const count = (w: number) => only(res, "townhouse_row").find((s) => s.unitWidthFt === w && s.stories === 3)!.units;
    const expected: Record<number, number> = { 16: 5, 17: 5, 18: 5, 19: 4, 22: 4, 23: 3, 26: 3 };
    for (const [w, n] of Object.entries(expected)) expect(count(Number(w))).toBe(n);
    const w18 = only(res, "townhouse_row").find((s) => s.unitWidthFt === 18 && s.stories === 3)!;
    expect(w18.grossFloorAreaSf).toBe(5 * 18 * 40 * 3);
    expect(w18.footprints).toHaveLength(5);
    expect(w18.needsSubdivision).toBe(true);
    expect(w18.subLots).toEqual({ count: 5, maxWidthFt: 23, minWidthFt: 18, minAreaSf: 1800 });
    expect(res.best!.units).toBe(5);
    expect(res.best!.byRight).toBe(true);
  });

  it("lot area per unit caps the row and is reported as the binding constraint", () => {
    const res = solve({ parcel: lot(100, 100), rules: { ...R1D_H, min_lot_area_per_unit_sqft: 2500 }, parkingOptions: ["none"] });
    const w16 = only(res, "townhouse_row").find((s) => s.unitWidthFt === 16 && s.stories === 3)!;
    expect(w16.units).toBe(4);
    expect(w16.binding.id).toBe("lot_area_per_unit");
  });

  it("stops the row at the preset cap and says so", () => {
    const res = solve({ parcel: lot(150, 100), parkingOptions: ["none"] });
    const w16 = only(res, "townhouse_row").find((s) => s.unitWidthFt === 16 && s.stories === 2)!;
    expect(w16.units).toBe(8);
    expect(w16.binding.id).toBe("row_length");
  });
});

describe("zoning checks", () => {
  it("R1D attached: by right when every new lot is <= 35 ft wide, special exception when wider (§911.04.A.69A)", () => {
    const res = solve({ parcel: lot(150, 100), parkingOptions: ["none"] });
    const narrow = only(res, "townhouse_row").find((s) => s.unitWidthFt === 16 && s.stories === 2)!;
    expect(narrow.subLots!.maxWidthFt).toBe(27); // 16 + (150 - 8 x 16) / 2
    expect(narrow.permission.code).toBe("P");
    expect(narrow.byRight).toBe(true);
    const wide = only(res, "townhouse_row").find((s) => s.unitWidthFt === 26 && s.stories === 2)!;
    expect(wide.units).toBe(5);
    expect(wide.subLots!.maxWidthFt).toBe(36); // 26 + (150 - 130) / 2
    expect(wide.permission.code).toBe("S");
    expect(wide.badge).toBe("needs_approval");
    expect(wide.approvals[0]!.label).toMatch(/Special exception.*wider than 35 ft/);
    expect(wide.needsSubdivision).toBe(true);
  });

  it("a duplex where two-unit is N is kept out of the ranking unless asked for", () => {
    const res = solve({ parcel: lot(60, 100) });
    const dup = only(res, "duplex");
    expect(dup.length).toBeGreaterThan(0);
    expect(dup.every((s) => s.badge === "not_permitted")).toBe(true);
    expect(res.ranked.some((s) => s.typology === "duplex")).toBe(false);
    const incl = solve({ parcel: lot(60, 100), includeNotPermitted: true });
    expect(incl.ranked.some((s) => s.typology === "duplex")).toBe(true);
  });

  it("flags missing parking and over-height stories as variances", () => {
    const res = solve({
      parcel: lot(40, 100),
      typologies: [{ ...quickfit.SINGLE_FAMILY, stories: { min: 3, max: 4 } }],
    });
    const none = res.all.find((s) => s.parking === "none" && s.stories === 3)!;
    expect(none.parkingRequired).toBe(1);
    expect(none.approvals.map((a) => a.rule)).toEqual(["parking_per_unit"]);
    const four = res.all.find((s) => s.parking === "garage" && s.stories === 4)!;
    expect(four.approvals.map((a) => a.rule)).toEqual(["max_height_stories"]);
    expect(four.byRight).toBe(false);
    const garage3 = res.all.find((s) => s.parking === "garage" && s.stories === 3 && s.unitWidthFt === 30)!;
    expect(garage3.byRight).toBe(true);
    expect(garage3.garageAreaSf).toBe(200);
    expect(garage3.netFloorAreaSf).toBe(Math.round((3600 - 200) * 0.85 * 10) / 10);
    expect(garage3.lotCoveragePct).toBe(30);
  });

  it("warns when a footprint overlaps a flag-only mask", () => {
    const res = solve({
      parcel: lot(40, 100),
      masks: [{ polygon: rectPoly(0, 0, 40, 30), label: "Landslide-prone overlay", mode: "flag" }],
    });
    expect(res.envelope.areaSf).toBe(2100);
    expect(res.best!.warnings.some((w) => w.includes("Landslide-prone overlay"))).toBe(true);
  });
});

describe("variance toggles", () => {
  // Shallow 100 x 60 lot: the by-right envelope is only 30 ft deep.
  const shallow = lot(100, 60);
  const front = { rule: "front_setback", value: 5, reliefType: "variance", codeSection: "903.03" } as const;

  it("reports the units / floor-area delta against the by-right best", () => {
    const res = solve({ parcel: shallow, parkingOptions: ["none"], variances: [front] });
    const v = res.variance!;
    // 5 x 18 ft fits the 90 x 30 envelope, but an 18 ft new lot is 18 x 60 = 1,080 sf < 1,200 sf, so
    // the best by-right row is 4 x 22 ft (interior lots 22 x 60 = 1,320 sf), 30 ft deep, 3 stories.
    expect(v.byRightBest).toMatchObject({ units: 4, grossFloorAreaSf: 4 * 22 * 30 * 3 });
    expect(v.withVariancesBest).toMatchObject({ units: 4, grossFloorAreaSf: 4 * 22 * 40 * 3 });
    expect(v.deltaUnits).toBe(0);
    expect(v.deltaGrossFloorAreaSf).toBe(2640);
    expect(v.perToggle[0]).toMatchObject({ rule: "front_setback", from: 15, to: 5, deltaGrossFloorAreaSf: 2640 });
    const five = res.all.find((s) => s.id === "townhouse_row|w18|s3|none")!;
    expect(five.approvals.map((a) => [a.rule, a.toggled])).toEqual([["front_setback", true], ["min_lot_area", false]]);
    expect(v.deltaProfit).toBeNull();

    const deep = res.all.find((s) => s.id === v.withVariancesBest!.schemeId)!;
    expect(deep.approvals).toHaveLength(1);
    expect(deep.approvals[0]).toMatchObject({ rule: "front_setback", toggled: true });
    expect(deep.badge).toBe("needs_approval");
  });

  it("gives historical odds only with at least 5 decided cases", () => {
    const four = [{ reliefType: "variance", codeSection: "903.03.D", granted: 3, denied: 1 }];
    const r4 = solve({ parcel: shallow, parkingOptions: ["none"], variances: [front], zbaCounts: four });
    expect(r4.variance!.perToggle[0]!.odds).toEqual({ status: "insufficient_history", n: 4 });
    const six = [...four, { reliefType: "variance", codeSection: "903.03.A", granted: 1, denied: 1 }, { reliefType: "special_exception", codeSection: "903.03", granted: 9, denied: 0 }];
    const r6 = solve({ parcel: shallow, parkingOptions: ["none"], variances: [front], zbaCounts: six });
    expect(r6.variance!.perToggle[0]!.odds).toEqual({ status: "rate", rate: 4 / 6, n: 6, granted: 4, denied: 2 });
  });

  it("historicalOdds threshold", () => {
    expect(quickfit.historicalOdds({ granted: 4, denied: 0 })).toEqual({ status: "insufficient_history", n: 4 });
    expect(quickfit.historicalOdds({ granted: 4, denied: 1 })).toMatchObject({ status: "rate", rate: 0.8, n: 5 });
    expect(quickfit.historicalOdds(null)).toEqual({ status: "insufficient_history", n: 0 });
  });

  it("a height toggle makes 4-story schemes depend only on that variance", () => {
    const res = solve({
      parcel: lot(40, 100),
      typologies: [{ ...quickfit.SINGLE_FAMILY, stories: { min: 3, max: 4 } }],
      parkingOptions: ["garage"],
      variances: [{ rule: "max_height_stories", value: 4 }],
    });
    const four = res.all.find((s) => s.stories === 4 && s.unitWidthFt === 30)!;
    expect(four.approvals).toEqual([
      { kind: "variance", rule: "max_height_stories", label: "Variance: 4 stories (limit 3)", toggled: true, odds: { status: "insufficient_history", n: 0 } },
    ]);
    expect(res.variance!.deltaGrossFloorAreaSf).toBe(30 * 40);
  });
});

describe("costs, revenue and ranking", () => {
  it("returns null cost fields when no cost table is given, and never ships numbers of its own", () => {
    const res = solve({ parcel: lot(100, 100) });
    for (const s of res.all) {
      expect(s.finance.hardCost).toBeNull();
      expect(s.finance.totalCost).toBeNull();
      expect(s.finance.profit).toBeNull();
      expect(s.finance.affordableGap).toBeNull();
    }
  });

  // Synthetic arithmetic values (1, 2, 3 ...), not prices.
  const costs = { hardCostPerGsf: { single_family: 1, duplex: 1, townhouse_row: 1 }, softCostPctOfHard: 0.5, surfaceParkingCostPerSpace: 10 };
  const revenue = { tenure: "sale" as const, salePricePerNsf: 2, affordableMonthlyRentPerUnit: 1, operatingExpenseRatio: 0.5, capRate: 0.1 };

  it("does the arithmetic from user inputs only", () => {
    const res = solve({ parcel: lot(100, 100), parkingOptions: ["none"], costs, revenue });
    const s = res.all.find((x) => x.id === "townhouse_row|w18|s3|none")!;
    expect(s.finance.hardCost).toBe(10800);
    expect(s.finance.softCost).toBe(5400);
    expect(s.finance.totalCost).toBe(16200);
    expect(s.finance.notes).toContain("Total cost excludes land (no land cost given).");
    expect(s.finance.revenue).toBeCloseTo(10800 * 0.85 * 2, 6);
    expect(s.finance.profit).toBeCloseTo(18360 - 16200, 6);
    expect(s.finance.affordableGap).toBeCloseTo(16200 - (1 * 12 * 5 * 0.5) / 0.1, 6);
  });

  it("ranks by goal", () => {
    const base = { parcel: lot(150, 100), costs, revenue };
    const units = solve({ ...base, goal: "most_units" });
    expect(units.best!.units).toBe(8);
    const byRight = solve({ ...base, goal: "by_right_only" });
    expect(byRight.ranked.every((s) => s.byRight)).toBe(true);
    const ret = solve({ ...base, goal: "best_return" });
    const profits = ret.ranked.map((s) => s.finance.profit!);
    expect(profits).toEqual([...profits].sort((a, b) => b - a));
    expect(ret.best!.finance.profit).toBe(maxBy(ret.ranked, (s) => s.finance.profit!).finance.profit);
    const gap = solve({ ...base, goal: "smallest_affordable_gap" });
    const gaps = gap.ranked.map((s) => s.finance.affordableGap!);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
  });

  it("is deterministic: same inputs, same outputs", () => {
    const input: Input = {
      parcel: lot(100, 60),
      frontEdges: [0],
      rules: R1D_H,
      masks: [{ polygon: [[[0, 60], [100, 60], [100, 45]]], label: "Slope over 25%" }],
      variances: [{ rule: "front_setback", value: 5 }],
      costs,
      revenue,
    };
    expect(quickfit.solveQuickFit(input)).toEqual(quickfit.solveQuickFit(structuredClone(input)));
  });
});
