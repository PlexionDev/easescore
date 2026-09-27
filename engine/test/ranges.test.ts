import { describe, expect, it } from "vitest";
import { assumptions, score, type ParcelFacts } from "../src";
import ura from "./fixtures/score/ura-lot-rm-m.json";

const { proFormaRanges, rangeText, roundRange, SOURCE_BADGES } = assumptions;
const fx = ura as any;
const facts = { ...fx.facts, assessment: { ...fx.facts.assessment, tax_year: 2026 } };
const r = score.scoreParcel(facts as ParcelFacts, { quickfitInput: fx.quickfitInput, easeInputs: fx.easeInputs, zba: fx.zba, unlocks: false });

// Sixteen new-construction sales with the bimodal $/SF spread seen near this lot (synthetic ids).
const PPSF = [231, 238, 301, 304, 307, 311, 315, 436, 523, 569, 620, 640, 685, 722, 724, 802];
function compSet(ppsf: number[]): assumptions.CompSet {
  const comps = ppsf.map((x, i) => ({ parid: `SYN-${i}`, address: null, saleDate: "2025-01-01", price: x * 2000, livingAreaSqft: 2000, pricePerSqft: x, yearBuilt: 2020, distanceMi: 0.8 }));
  const med = assumptions.median(ppsf)!;
  return { kind: "new_construction", status: "ok", sufficient: true, count: comps.length, radius_mi: 1, search_steps: [], comparable_use: "new single-family homes",
    median_price: med * 2000, median_price_per_sqft: med, median_living_area_sqft: 2000, year_built_range: { from: 2020, to: 2020 },
    date_range: { from: "2024-01-01", to: "2026-06-01" }, note: null, rule: "", sourceLabel: "Allegheny County sales (valid new-construction comps)", comps };
}

function pf(strategy: score.StrategyId, overrides: assumptions.CostOverrides = {}, rents: unknown = fx.rent, newComps: assumptions.CompSet | null = null) {
  const s = r.strategies.find((x) => x.strategy === strategy)!;
  const selected = score.selectScheme({ strategy, scheme: r.schemes![strategy]!, result: s, overrides });
  const plan = assumptions.buildDevelopmentInputs({
    strategy, facts, scheme: null, selected, comps: fx.comps, newComps, rents: rents as assumptions.RentCompsLike,
    primeRate: 0.075, primeRateDate: "2026-09-25", permitMonths: s.predictedMonthsToPermit?.months ?? null, tapFeesPerUnit: 5000, overrides,
  });
  return assumptions.evaluateDevelopment(plan);
}

describe("ranges: no false precision", () => {
  const res = pf("new_sf", { salePricePerSf: 300 });
  const g = res.ranges;

  it("every line is low <= likely <= high, rounded to $1,000; totals to $10,000", () => {
    for (const l of g.lines) {
      if (!l.range) continue;
      expect(l.range.low).toBeLessThanOrEqual(l.range.likely);
      expect(l.range.likely).toBeLessThanOrEqual(l.range.high);
      const step = l.group === "total" ? 10000 : 1000;
      for (const x of [l.range.low, l.range.likely, l.range.high]) expect(Math.abs(x % step)).toBe(0);
    }
    for (const t of [g.tdc, g.sale.grossSales, g.sale.netSales]) for (const x of Object.values(t!)) expect(Math.abs(x % 10000)).toBe(0);
    // Profit's low / high to $10,000; its "likely" is the exact difference of the rounded figures (sales − selling − cost), to $1,000.
    for (const x of [g.sale.profit!.low, g.sale.profit!.high]) expect(Math.abs(x % 10000)).toBe(0);
    expect(g.sale.profit!.likely).toBe(res.sale.profit);
    expect(Math.abs(g.sale.profit!.likely % 1000)).toBe(0);
    for (const x of Object.values(g.sale.marginPct!)) expect(Math.round(x * 10) / 10).toBe(x);
    expect(Math.abs(g.tdc!.likely - res.tdc!)).toBeLessThanOrEqual(5000);
  });

  it("ranges come from the documented input ranges", () => {
    const hard = g.lines.find((l) => l.id === "hard_base")!;
    expect(hard.triangulation!.used).toEqual({ low: 165, likely: 190, high: 210 });
    const slope = g.lines.find((l) => l.id === "slope_adder")!;
    // Per sq ft of building footprint.
    expect(slope.triangulation!.unit).toBe("$/SF of footprint");
    expect(slope.triangulation!.used).toEqual({ low: 30, likely: 45, high: 70 });
    // A&E: 4% of hard cost, at least $8,000 (range 2–8%).
    expect(g.lines.find((l) => l.id === "ae")!.triangulation!.used).toMatchObject({ low: 2, high: 8 });
    // Basic / builder-grade tier: $160 (150–170), cost to build.
    const basic = pf("new_sf", { salePricePerSf: 300, tier: "basic" }).ranges;
    expect(basic.lines.find((l) => l.id === "hard_base")!.triangulation!.used).toEqual({ low: 150, likely: 160, high: 170 });
    expect(g.tdc!.low).toBeLessThan(g.tdc!.likely);
    expect(g.tdc!.high).toBeGreaterThan(g.tdc!.likely);
  });

  it("each line has a source badge from the fixed set, a dataset with its date, or your input", () => {
    for (const l of g.lines) {
      if (l.source.kind === "badge") expect(SOURCE_BADGES).toContain(l.source.badge);
      else expect(l.source.badge).toBeNull();
      expect(l.source.badge).not.toBe("ICC BVD Feb 2026, national, permit-fee average");
    }
    // Default Standard infill: Pittsburgh builders' published ranges with the builder's fee removed.
    expect(g.lines.find((l) => l.id === "hard_base")!.source.badge).toBe("Pittsburgh builders (2026)");
    expect(g.lines.find((l) => l.id === "slope_adder")!.source.badge).toBe("Assumption, edit me");
    expect(g.lines.find((l) => l.id === "contingency")!.source.badge).toBe("Assumption, edit me");
  });

  it("triangulates hard cost per SF against NAHB national and local project benchmarks", () => {
    const pts = g.lines.find((l) => l.id === "hard_base")!.triangulation!.points;
    // Cost to build (fee removed), the published retail range as the cross-check, NAHB national, local projects.
    expect(pts.map((p) => p.badge)).toEqual(["Pittsburgh builders (2026)", "Pittsburgh builders (2026), retail price including builder fee", "NAHB 2024, national, excludes builder fee", "Local project benchmark"]);
    expect([pts[1]!.low, pts[1]!.high]).toEqual([200, 250]);
    expect(pts[2]!.value).toBe(162);
    expect(g.lines.find((l) => l.id === "tdc")!.triangulation!.points[0]!.badge).toBe("Local project benchmark");
  });

  it("land and rent carry source and year", () => {
    // Land from vacant-land sales (never the assessed land value), with the sales' dates.
    expect(g.land.source).toMatchObject({ kind: "data", asOf: "2019-01 to 2026-08" });
    expect(g.land.source.label).toMatch(/^Allegheny County vacant-land sales, the City of Pittsburgh, \d+ sales/);
    // Rent by bedroom count: a 3-bedroom for a single-family home, a 2-bedroom in a 3–4 unit building.
    expect(g.rent.source.label).toBe("HUD Small Area Fair Market Rent FY2026, ZIP 15219 (benchmark, not listings), 3-bedroom");
    const fmrOnly = pf("three_four_unit", {}, { ...fx.rent, zori: null }).ranges.rent.source;
    expect(fmrOnly.label).toBe("HUD Small Area Fair Market Rent FY2026, ZIP 15219 (benchmark, not listings), 2-bedroom");
    const none = pf("three_four_unit", {}, null).ranges.rent.source;
    expect(none).toMatchObject({ kind: "assumption", label: "Assumption, edit me" });
  });

  it("your own numbers are single values badged as your input", () => {
    const g2 = pf("new_sf", { costPerSf: 300, land: 50000, salePricePerSf: 300 }).ranges;
    const hard = g2.lines.find((l) => l.id === "hard_base")!;
    expect(hard.source.kind).toBe("user");
    expect(hard.range!.low).toBe(hard.range!.high);
    expect(g2.land.range!.low).toBe(g2.land.range!.high);
    expect(g2.land.source.kind).toBe("user");
  });

  it("formats a range as low–high, likely", () => {
    expect(rangeText({ low: 620000, likely: 650000, high: 690000 })).toBe("$620K–$690K, likely $650K");
    expect(rangeText(roundRange(1234567, 1300000, 1411111, 10000))).toBe("$1.23M–$1.41M, likely $1.3M");
    expect(g.headline).toMatch(/^(Gap \$|Profit \$|From a \$)/);
  });
});

describe("derived ranges combine cost and value as independent uncertainties", () => {
  const res = pf("townhouse_row", {}, fx.rent, compSet(PPSF));
  const g = res.ranges;

  it("value uses the comps' 25th-75th percentile $/SF", () => {
    expect(g.sale.basis).toMatch(/^25th–75th percentile of 16 comparable sales/);
    expect(g.sale.pricePerSf!.low).toBeLessThan(g.sale.pricePerSf!.likely);
    expect(g.sale.pricePerSf!.high).toBeGreaterThan(g.sale.pricePerSf!.likely);
  });

  it("profit is ordered and no wider than about twice the value range", () => {
    const p = g.sale.profit!;
    expect(p.low).toBeLessThanOrEqual(p.likely);
    expect(p.likely).toBeLessThanOrEqual(p.high);
    const valueWidth = g.sale.netSales!.high - g.sale.netSales!.low;
    const costWidth = g.tdc!.high - g.tdc!.low;
    const width = p.high - p.low;
    expect(width).toBeLessThanOrEqual(2 * valueWidth + 20000);
    // Strictly narrower than pairing opposite extremes (value width + cost width).
    expect(width).toBeLessThan(valueWidth + costWidth);
    const m = g.sale.marginPct!;
    expect(m.low).toBeLessThanOrEqual(m.likely);
    expect(m.likely).toBeLessThanOrEqual(m.high);
    expect(g.sale.method).toMatch(/independent uncertainties/);
  });

  it("with fewer than 8 comps the value moves ±15% and says it is an assumption", () => {
    const few = pf("townhouse_row", {}, fx.rent, compSet(PPSF.slice(0, 6))).ranges;
    expect(few.sale.basis).toMatch(/^±15% \(Assumption, edit me/);
    const r = few.sale.pricePerSf!;
    expect(r.high / r.likely).toBeCloseTo(1.15, 1);
  });

  it("rental yield is ordered", () => {
    const y = pf("three_four_unit").ranges.rent.yieldOnCostPct!;
    expect(y.low).toBeLessThanOrEqual(y.likely);
    expect(y.likely).toBeLessThanOrEqual(y.high);
  });

});
