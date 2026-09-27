import { describe, expect, it } from "vitest";
import { assumptions } from "../src";

const { buildDevelopmentInputs, evaluateDevelopment, COST_CONFIG, landEstimate, assessedAfterCompletion, rehabEstimate } = assumptions;
type Facts = assumptions.ProFormaFacts;

// Synthetic lots (not real parcels).
const FLAT: Facts = {
  slope_1m: { mean_pct: 3, share_over_15: 0, share_over_25: 0 },
  overlays: [], mines: { in_city_undermined: false, in_mined_out: false, msi_risk: null }, site: { building_count: 0 },
  assessment: { use: "VACANT LAND", fmv_land: 10000, fmv_total: 10000, is_pittsburgh: true, lot_area_sqft: 3000 },
  property_tax: { general_mills: 24 }, transfer_tax: { total_pct: 4 }, owner_class: "private", area: "Larimer",
};
const STEEP: Facts = { ...FLAT, slope_1m: { mean_pct: 40, share_over_15: 0.9, share_over_25: 0.8 } };
const NEW: assumptions.CompSet = {
  kind: "new_construction", status: "ok", sufficient: true, count: 8, radius_mi: 1, search_steps: [], comparable_use: "new single-family homes",
  median_price: 540000, median_price_per_sqft: 300, median_living_area_sqft: 1800, year_built_range: { from: 2022, to: 2024 },
  date_range: { from: "2024-01-01", to: "2026-06-01" }, note: null, rule: "", sourceLabel: "Allegheny County sales (valid new-construction comps)", comps: [],
};
const HUD = { hud_fmr: { year: 2026, zip: "15000", level: "safmr", br0: 900, br1: 1010, br2: 1233, br3: 1483, br4: 1700 } };
const scheme = (stories: number) => ({ units: 1, grossFloorAreaSf: 1000 * stories, netFloorAreaSf: 850 * stories, footprintSf: 1000, stories });
const plan = (facts: Facts, extra: Partial<assumptions.PlanArgs> = {}) =>
  buildDevelopmentInputs({ strategy: "new_sf", facts, scheme: scheme(2), comps: null, newComps: NEW, rents: HUD, primeRate: 0.07, permitMonths: 4, tapFeesPerUnit: 1000, ...extra });

describe("fix 1: slope premium on the footprint, not per finished sq ft of every floor", () => {
  it("a taller building on the same footprint pays the same slope premium", () => {
    const two = plan(STEEP), three = plan(STEEP, { scheme: scheme(3) });
    const s2 = two.lines.find((l) => l.id === "slope_adder")!.amount, s3 = three.lines.find((l) => l.id === "slope_adder")!.amount;
    expect(s2).toBe(COST_CONFIG.siteAdders.steepSlope.value * 1000);
    expect(s3).toBe(s2);
    expect(three.finishedSf).toBeGreaterThan(two.finishedSf!);
    expect(two.lines.find((l) => l.id === "slope_adder")!.basis).toMatch(/1,000 sq ft building footprint × \$45\/SF/);
  });
  it("soft costs and contingency apply to the corrected hard cost", () => {
    const r = evaluateDevelopment(plan(STEEP));
    const hard = r.plan.lines.filter((l) => l.group === "hard").reduce((t, l) => t + l.amount, 0);
    expect(r.budget.find((b) => b.id === "ae")!.amount).toBe(Math.round((r.plan.shares.ae * hard) / 1000) * 1000);
    expect(r.budget.find((b) => b.id === "contingency")!.amount).toBe(Math.round((0.15 * hard) / 1000) * 1000);
  });
  it("a stepped building is priced once (the lot's steep adder covers it)", () => {
    const st = { steps: 2, dropFt: 5, footprintSlopePct: 30, thresholdPct: 15, incrementFt: 2.5 };
    const p = plan(STEEP, { stepping: st });
    expect(p.lines.filter((l) => l.id === "slope_adder")).toHaveLength(1);
    expect(p.lines.filter((l) => l.id === "retaining_walls")).toHaveLength(1);
    expect(p.stepping?.pricedBy).toBe("steep_slope_adder");
  });
});

describe("fix 2: property tax from completed projects", () => {
  it("assessed value = median ratio of assessed value to sale price × the value, with method, count and dates", () => {
    const a = assessedAfterCompletion({ value: 500000, isCity: true, attached: false, valueBasis: "(test value)" })!;
    const g = assumptions.TAX_RATIOS.groups.city_detached!;
    expect(a.ratio).toBe(g.ratio[1]);
    expect(a.assessed).toBeCloseTo(g.ratio[1]! * 500000, 6);
    expect(a.receipt).toContain(`${g.sales} new homes`);
    expect(a.receipt).toContain(`built ${g.builtFrom}–${g.builtTo}`);
    expect(a.receipt).toMatch(/sold \d{4}-\d{2} to \d{4}-\d{2}/);
    expect(a.receipt).toMatch(/Check only \(not used\): City building-permit values/);
  });
  it("the rental's taxes use it, not land + construction cost", () => {
    const p = plan(FLAT, { overrides: { tenure: "rent" } });
    expect(p.assessedAfter).not.toBeNull();
    expect(p.rental.assessedValue).toBeCloseTo(p.assessedAfter!.ratio * p.revenue.sale.grossSales!, 6);
  });
});

describe("fix 3: land from vacant-land sales, adjusted by owner type", () => {
  it("prices a private lot from the area's sales; the assessed land value never moves it", () => {
    const a = plan(FLAT), b = plan({ ...FLAT, assessment: { ...FLAT.assessment, fmv_land: 999000 } });
    expect(a.land.value).toBe(b.land.value);
    const est = landEstimate({ lotSqft: 3000, area: "Larimer", isCity: true, ownerClass: "private" })!;
    expect(a.land.value).toBe(est.likely);
    expect(est.low).toBeLessThanOrEqual(est.likely);
    expect(est.high).toBeGreaterThanOrEqual(est.likely);
    expect(a.land.flag).toBeNull();
  });
  it("public lots: a range from agency sales up to the private market, flagged", () => {
    const pub = plan({ ...FLAT, owner_class: "ura" });
    const priv = landEstimate({ lotSqft: 3000, area: "Larimer", isCity: true, ownerClass: "private" })!;
    expect(pub.land.flag).toBe("Public land: price set by the agency");
    expect(pub.land.estimate!.public).toBe(true);
    expect(pub.land.value!).toBeLessThanOrEqual(priv.likely);
    expect(pub.land.estimate!.high).toBe(priv.likely);
    expect(pub.land.estimate!.basis).toMatch(/^Public land: price set by the agency/);
  });
  it("your number always overrides", () => {
    const p = plan({ ...FLAT, owner_class: "ura" }, { overrides: { lineAmounts: { land: 1 } } });
    expect(p.land.value).toBe(1);
    expect(p.land.flag).toBeNull();
    expect(p.sources.land.kind).toBe("user");
  });
  it("no sales and no lot area: asks for the price instead of using the assessment", () => {
    const p = plan({ ...FLAT, assessment: { ...FLAT.assessment, lot_area_sqft: null }, lot_area_sqft_gis: null });
    expect(p.land.value).toBeNull();
    expect(p.missing[0]).toMatch(/assessed land value is not a price/);
  });
});

describe("fix 4: rehab cost by condition tier", () => {
  it("maps County condition to a tier with an editable range; older houses cost more", () => {
    expect(rehabEstimate({ condition: "GOOD", yearBuilt: 1990, finishedSf: 1000 }).tier.id).toBe("light");
    expect(rehabEstimate({ condition: "AVERAGE", yearBuilt: 1990, finishedSf: 1000 }).perSf).toEqual([50, 75, 110]);
    expect(rehabEstimate({ condition: "POOR", yearBuilt: 1990, finishedSf: 1000 }).tier.id).toBe("heavy");
    expect(rehabEstimate({ condition: "UNSOUND", yearBuilt: 1990, finishedSf: 1000 }).tier.id).toBe("gut");
    const old = rehabEstimate({ condition: "AVERAGE", yearBuilt: 1910, finishedSf: 1000 });
    expect(old.perSf[1]).toBe(Math.round(75 * 1.15));
    expect(old.basis).toMatch(/before 1940/);
    expect(rehabEstimate({ condition: null, yearBuilt: null, finishedSf: null }).tier.id).toBe("moderate");
  });
  it("rehab is never priced automatically: without the user's budget it asks for one", () => {
    const facts: Facts = { ...FLAT, site: { building_count: 1 }, assessment: { ...FLAT.assessment, use: "SINGLE FAMILY", living_area_sqft: 1200, condition: "FAIR", year_built: 1925 } };
    const asIs = { status: "ok", sufficient: true, count: 9, radius_mi: 0.5, comparable_use: "single family", median_price_per_sqft: 100 };
    const r = evaluateDevelopment(buildDevelopmentInputs({ strategy: "rehab_existing", facts, scheme: null, comps: null, asIsComps: asIs, rents: HUD, primeRate: 0.07, permitMonths: 3 }));
    expect(r.budget.find((b) => b.id === "hard_base")).toBeUndefined();
    expect(r.plan.rehab).toBeNull();
    expect(r.plan.missing.some((m) => /^Enter your rehab budget/.test(m))).toBe(true);
    expect(r.plan.land.value).toBe(120000);
  });
  it("with the user's rehab budget per sq ft, the rehab is priced from it", () => {
    const facts: Facts = { ...FLAT, site: { building_count: 1 }, assessment: { ...FLAT.assessment, use: "SINGLE FAMILY", living_area_sqft: 1200, condition: "FAIR", year_built: 1925 } };
    const asIs = { status: "ok", sufficient: true, count: 9, radius_mi: 0.5, comparable_use: "single family", median_price_per_sqft: 100 };
    const r = evaluateDevelopment(buildDevelopmentInputs({ strategy: "rehab_existing", facts, scheme: null, comps: null, asIsComps: asIs, rents: HUD, primeRate: 0.07, permitMonths: 3, overrides: { costPerSf: 90 } }));
    expect(r.budget.find((b) => b.id === "hard_base")!.amount).toBe(108000);
    expect(r.plan.missing.some((m) => /rehab budget/i.test(m))).toBe(false);
  });
});

describe("fix 5: build quality recomputes the pro forma", () => {
  it("each tier prices finished area × its rate; site adders stay separate lines", () => {
    for (const t of COST_CONFIG.construction.tiers) {
      const p = plan(STEEP, { overrides: { tier: t.id } });
      expect(p.lines.find((l) => l.id === "hard_base")!.amount).toBe(Math.round((t.costPerSf.value * p.finishedSf!) / 1000) * 1000);
      expect(p.lines.find((l) => l.id === "slope_adder")!.amount).toBe(45 * 1000);
    }
  });
});

describe("fix 6: budget lines take your number", () => {
  it("a line you type is used as is, marked 'Your number', and the total moves with it", () => {
    const base = evaluateDevelopment(plan(STEEP));
    const r = evaluateDevelopment(plan(STEEP, { overrides: { lineAmounts: { slope_adder: 10000, ae: 5000 } } }));
    expect(r.budget.find((b) => b.id === "slope_adder")).toMatchObject({ amount: 10000, sourceLabel: "Your number" });
    expect(r.budget.find((b) => b.id === "ae")).toMatchObject({ amount: 5000, sourceLabel: "Your number" });
    expect(r.ranges.lines.find((l) => l.id === "slope_adder")!.source.kind).toBe("user");
    expect(r.tdc!).toBeLessThan(base.tdc!);
    // Removing it (reset) returns to the estimate.
    expect(JSON.stringify(evaluateDevelopment(plan(STEEP, { overrides: { lineAmounts: {} } })).budget)).toBe(JSON.stringify(base.budget));
  });
});

describe("fix 7: rounding (display and math use rounded values)", () => {
  it("rent to $50 with the raw value shown once", () => {
    const p = plan(FLAT, { overrides: { tenure: "rent" } });
    expect(p.revenue.rent.perUnit).toBe(1500);
    expect(p.rounding.rent).toBe("HUD Fair Market Rent $1,483, rounded to $1,500");
    const r = evaluateDevelopment(p);
    expect(r.rent.annualRent).toBe(1500 * 12);
    for (const x of Object.values(r.ranges.rent.monthlyPerUnit!)) expect(x % 50).toBe(0);
  });
  it("sale price per home to $5,000; lines to $1,000; totals to $10,000; percentages to one decimal", () => {
    const r = evaluateDevelopment(plan(FLAT, { newComps: { ...NEW, median_price_per_sqft: 301.37 } }));
    expect(r.plan.revenue.sale.pricePerUnit! % 5000).toBe(0);
    expect(r.plan.rounding.sale).toMatch(/^\$301\/SF × 1,700 sq ft = \$512,329 per home, rounded to \$510,000$/);
    for (const b of r.budget) if (b.amount != null) expect(b.amount % 1000).toBe(0);
    expect(r.tdc! % 10000).toBe(0);
    expect(r.sale.profit).toBe(r.sale.grossSales! - r.sale.sellingCosts! - r.tdc!);
    expect(Math.round(r.sale.margin! * 1000)).toBe(r.sale.margin! * 1000);
    expect(r.sentences.find((s) => s.startsWith("Value:"))).toMatch(/rounded to \$510,000; × 1 home = \$510,000 in sales/);
  });
});

describe("rent by bedroom count", () => {
  it("uses the default bedroom mix per option and the rents module's estimate when given", () => {
    const p = plan(FLAT, { strategy: "three_four_unit", overrides: { tenure: "rent" } });
    expect(p.bedrooms).toBe(2);
    expect(p.revenue.rent.perUnit).toBe(1250);
    const byBr = { asOf: "2026-09-27", hud: null, zori: null, sources: [], caveat: "", byBedroom: { 3: { bedrooms: 3, likely: 1800, low: 1650, high: 1950, basis: "rentcast_comps", basisLabel: "Asking rents from 12 nearby listings (RentCast, Sep 2026)", comps: [], compCount: 12, radiusMi: 1, targetSqft: 1250, rules: "", method: "Median of the listings.", hud: 1483, zori: null, note: null } } } as unknown as assumptions.PlanArgs["rentsByBedroom"];
    const q = evaluateDevelopment(plan(FLAT, { rentsByBedroom: byBr, overrides: { tenure: "rent" } }));
    expect(q.plan.revenue.rent.perUnit).toBe(1800);
    expect(q.ranges.rent.monthlyPerUnit).toEqual({ low: 1650, likely: 1800, high: 1950 });
    expect(q.plan.sources.rent.label).toBe("Asking rents from 12 nearby listings (RentCast, Sep 2026), 3-bedroom");
  });
});
