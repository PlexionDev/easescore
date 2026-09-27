import { describe, expect, it } from "vitest";
import { assumptions, score, type ParcelFacts } from "../src";
import ura from "./fixtures/score/ura-lot-rm-m.json";

const { proFormaRanges, rangeText, roundRange, SOURCE_BADGES } = assumptions;
const fx = ura as any;
const facts = { ...fx.facts, assessment: { ...fx.facts.assessment, tax_year: 2026 } };
const r = score.scoreParcel(facts as ParcelFacts, { quickfitInput: fx.quickfitInput, easeInputs: fx.easeInputs, zba: fx.zba, unlocks: false });

function pf(strategy: score.StrategyId, overrides: assumptions.CostOverrides = {}, rents: unknown = fx.rent) {
  const s = r.strategies.find((x) => x.strategy === strategy)!;
  const selected = score.selectScheme({ strategy, scheme: r.schemes![strategy]!, result: s, overrides });
  const plan = assumptions.buildDevelopmentInputs({
    strategy, facts, scheme: null, selected, comps: fx.comps, newComps: null, rents: rents as assumptions.RentCompsLike,
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
    for (const t of [g.tdc, g.sale.profit, g.sale.grossSales, g.sale.netSales]) for (const x of Object.values(t!)) expect(Math.abs(x % 10000)).toBe(0);
    for (const x of Object.values(g.sale.marginPct!)) expect(Math.round(x * 10) / 10).toBe(x);
    expect(Math.abs(g.tdc!.likely - res.tdc!)).toBeLessThanOrEqual(5000);
  });

  it("ranges come from the documented input ranges", () => {
    const hard = g.lines.find((l) => l.id === "hard_base")!;
    expect(hard.triangulation!.used).toEqual({ low: 225, likely: 250, high: 275 });
    const slope = g.lines.find((l) => l.id === "slope_adder")!;
    expect(slope.triangulation!.used).toEqual({ low: 40, likely: 60, high: 90 });
    expect(g.lines.find((l) => l.id === "ae")!.triangulation!.used).toEqual({ low: 5, likely: 8, high: 12 });
    expect(g.tdc!.low).toBeLessThan(g.tdc!.likely);
    expect(g.tdc!.high).toBeGreaterThan(g.tdc!.likely);
  });

  it("each line has a source badge from the fixed set, a dataset with its date, or your input", () => {
    for (const l of g.lines) {
      if (l.source.kind === "badge") expect(SOURCE_BADGES).toContain(l.source.badge);
      else expect(l.source.badge).toBeNull();
      expect(l.source.badge).not.toBe("ICC BVD Feb 2026, national, permit-fee average");
    }
    expect(g.lines.find((l) => l.id === "hard_base")!.source.badge).toBe("Pittsburgh builders (2026)");
    expect(g.lines.find((l) => l.id === "slope_adder")!.source.badge).toBe("Assumption, edit me");
    expect(g.lines.find((l) => l.id === "contingency")!.source.badge).toBe("Assumption, edit me");
  });

  it("triangulates hard cost per SF against NAHB national and local project benchmarks", () => {
    const pts = g.lines.find((l) => l.id === "hard_base")!.triangulation!.points;
    expect(pts.map((p) => p.badge)).toEqual(["Pittsburgh builders (2026)", "NAHB 2024, national, excludes builder fee", "Local project benchmark"]);
    expect(pts[1]!.value).toBe(162);
    expect(g.lines.find((l) => l.id === "tdc")!.triangulation!.points[0]!.badge).toBe("Local project benchmark");
  });

  it("land and rent carry source and year", () => {
    expect(g.land.source).toMatchObject({ kind: "data", asOf: "2026" });
    expect(g.land.source.label).toMatch(/tax year 2026/);
    expect(g.rent.source.label).toBe("Zillow Observed Rent Index, ZIP 15219, 2026-08");
    const fmrOnly = pf("three_four_unit", {}, { ...fx.rent, zori: null }).ranges.rent.source;
    expect(fmrOnly.label).toBe("HUD Fair Market Rent FY2026, ZIP 15219, 2 bedrooms");
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
    expect(g.headline).toMatch(/^(Gap|Profit) \$/);
  });
});
