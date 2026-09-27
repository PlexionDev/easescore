import { describe, expect, it } from "vitest";
import { assumptions, finance } from "../src";

const { buildDevelopmentInputs, evaluateDevelopment, COST_CONFIG } = assumptions;
type Facts = assumptions.ProFormaFacts;

// Small synthetic parcels (not real lots): a flat vacant lot, a steep landslide-prone lot, a
// moderate-slope lot with confirmed mine subsidence risk and a building on it.
const FLAT: Facts = {
  slope_1m: { mean_pct: 3, share_over_15: 0, share_over_25: 0 },
  overlays: [],
  mines: { in_city_undermined: false, in_mined_out: false, msi_risk: null },
  site: { building_count: 0 },
  assessment: { use: "VACANT LAND", fmv_land: 10000, fmv_total: 10000, is_pittsburgh: true, lot_area_sqft: 3000 },
  property_tax: { general_mills: 24 },
  transfer_tax: { total_pct: 4 },
  owner_class: "private",
  area: "Larimer",
};
const STEEP: Facts = {
  ...FLAT,
  slope_1m: { mean_pct: 40, share_over_15: 0.9, share_over_25: 0.8 },
  overlays: [{ layer: "landslide_prone_pgh", share: 1 }],
};
const MINE: Facts = {
  ...FLAT,
  slope_1m: { mean_pct: 18, share_over_15: 0.5, share_over_25: 0.1 },
  mines: { in_city_undermined: false, in_mined_out: false, msi_risk: "confirmed" },
  site: { building_count: 1 },
  building_footprint_sqft: 800,
};
const UNDERMINED: Facts = { ...FLAT, mines: { in_city_undermined: true } };

const SCHEME = { units: 1, grossFloorAreaSf: 2000, netFloorAreaSf: 1700, footprintSf: 1000, stories: 2 };

// Synthetic sales around a synthetic point: six new homes ($300/SF, 1,800 SF) and many old resales ($150/SF).
const AT = { lat: 40.4, lon: -80.0 };
const mi = (m: number) => m / 69; // degrees of latitude per mile, close enough for tests
const NEW_SALES: assumptions.SaleRecord[] = [0.1, 0.15, 0.2, 0.35, 0.4, 0.45].map((d, i) => ({
  parid: `N${i}`, saleDate: `2026-0${(i % 6) + 1}-15`, price: 540000, livingAreaSqft: 1800, yearBuilt: 2024, use: "SINGLE FAMILY", lat: AT.lat + mi(d), lon: AT.lon,
}));
const OLD_SALES: assumptions.SaleRecord[] = Array.from({ length: 20 }, (_, i) => ({
  parid: `O${i}`, saleDate: "2025-05-01", price: 180000, livingAreaSqft: 1200, yearBuilt: 1920, use: "SINGLE FAMILY", lat: AT.lat + mi(0.05), lon: AT.lon,
}));
const NEW = assumptions.newConstructionComps(AT, [...OLD_SALES, ...NEW_SALES], { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "single-family homes" });
const COMPS: assumptions.SalesCompsLike = { status: "ok", sufficient: true, count: 12, radius_mi: 0.5, comparable_use: "single family", median_price_per_sqft: 300 };
const RENTS: assumptions.RentCompsLike = { zori: { zip: "15000", latest_rent: 1500, latest_month: "2026-08-31" } };

const plan = (facts: Facts, extra: Partial<assumptions.PlanArgs> = {}) =>
  buildDevelopmentInputs({ strategy: "new_sf", facts, scheme: SCHEME, comps: COMPS, newComps: NEW, rents: RENTS, primeRate: 0.07, permitMonths: 4, tapFeesPerUnit: 1000, ...extra });

describe("cost config", () => {
  it("has a version stamp and Standard infill at $190 (cost to build, builder fee removed) as the default", () => {
    expect(COST_CONFIG.version).toBe("cost-assumptions.v0.2");
    const def = assumptions.tierOf(COST_CONFIG, undefined);
    expect(def.label).toBe("Standard infill");
    expect(def.costPerSf.value).toBe(190);
    expect(COST_CONFIG.construction.tiers.map((t) => `${t.label} ${t.costPerSf.value} (${t.costPerSf.range.join("–")}) retail ${t.retail.range.join("–")}`)).toEqual([
      "Basic / builder-grade 160 (150–170) retail 178–200",
      "Standard infill 190 (165–210) retail 200–250",
      "Mid-range 240 (210–270) retail 250–325",
      "High-end 320 (270–375) retail 325–450",
      "Custom / luxury 420 (375–470) retail 450–565",
    ]);
    expect(COST_CONFIG.disclaimer).toBe("Costs are the cost to build and exclude builder fees, general contractor markup and sales commissions. If you hire a builder, add their fee (often 15–25%). Soft costs, fees and taxes follow published local schedules where available and labeled assumptions elsewhere. Confirm with local bids.");
  });
  it("labels the grouting default as owner-provided local data", () => {
    expect(COST_CONFIG.siteAdders.mineGrouting.value).toBe(40000);
    expect(COST_CONFIG.siteAdders.mineGrouting.sourceLabel).toBe("Local project data (owner-provided)");
  });
  it("keeps items without local data as null, never zero", () => {
    expect(COST_CONFIG.siteAdders.geotechReport.value).toBeNull();
    expect(COST_CONFIG.siteAdders.demolition.value).toBeNull();
    expect(COST_CONFIG.siteAdders.dumpstersAndStreetPermit.value).toBeNull();
  });
});

describe("comparable sales", () => {
  it("values a new build from new-construction sales, not older resales", () => {
    expect(NEW.status).toBe("ok");
    expect(NEW.count).toBe(6);
    expect(NEW.radius_mi).toBe(0.5);
    expect(NEW.search_steps).toEqual(["3 within 0.25 mi", "6 within 0.5 mi"]);
    expect(NEW.median_price_per_sqft).toBe(300);
    expect(NEW.median_living_area_sqft).toBe(1800);
    expect(NEW.year_built_range).toEqual({ from: 2024, to: 2024 });
    const p = plan(FLAT);
    expect(p.revenue.sale.pricePerSf).toBe(300);
    expect(p.valueComps).toBe(NEW);
  });
  it("says 'insufficient new-construction comps' and shows older homes only as a floor", () => {
    const few = assumptions.newConstructionComps(AT, [...OLD_SALES, ...NEW_SALES.slice(0, 4)], { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "single-family homes" });
    expect(few.status).toBe("insufficient comps");
    expect(few.radius_mi).toBe(3);
    expect(few.note).toMatch(/^Insufficient new-construction comps: only 4 sale/);
    const oldComps = { status: "ok", sufficient: true, count: 20, radius_mi: 0.25, comparable_use: "single family", median_price_per_sqft: 150 };
    const p = plan(FLAT, { newComps: few, comps: oldComps });
    expect(p.revenue.sale.pricePerSf).toBeNull();
    expect(p.floor?.pricePerSf).toBe(150);
    expect(p.missing[0]).toMatch(/Insufficient new-construction comps/);
    expect(p.missing[0]).toMatch(/That is a floor, not the value of a new home/);
    const r = evaluateDevelopment(p);
    expect(r.sale.grossSales).toBeNull();
    expect(r.narrative?.risks?.[0]).toMatch(/Too few recent new-home sales/);
  });
  it("ignores homes older than ten years at sale and sales outside the window", () => {
    const stale = NEW_SALES.map((x) => ({ ...x, yearBuilt: 2010 }));
    expect(assumptions.newConstructionComps(AT, stale, { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "x" }).count).toBe(0);
    expect(assumptions.newConstructionComps(AT, NEW_SALES, { asOf: "2030-01-01", uses: ["SINGLE FAMILY"], useLabel: "x" }).count).toBe(0);
  });
  it("is deterministic regardless of record order", () => {
    const shuffled = [...NEW_SALES, ...OLD_SALES].reverse();
    expect(JSON.stringify(assumptions.newConstructionComps(AT, shuffled, { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "single-family homes" }))).toBe(JSON.stringify(NEW));
  });
  it("warns when the layout is small for new construction nearby", () => {
    const p = plan(FLAT, { scheme: { units: 1, grossFloorAreaSf: 1100, netFloorAreaSf: 900 } });
    expect(p.sizeWarning).toBe("This layout is small for new construction nearby: 900 vs 1,800 sq ft typical per home. The value assumes a home this size sells for the same price per sq ft.");
  });
  it("values a rehab from Good-or-better sales only (after-repair value), matched on size", () => {
    const base = { comparable_use: "single family", radius_mi: 0.25, comps: [
      ...Array.from({ length: 5 }, (_, i) => ({ parid: `G${i}`, sale_date: "2025-01-01", price: 250000, living_area_sqft: 1000, year_built: 1920, condition_desc: "GOOD", distance_mi: 0.1 })),
      ...Array.from({ length: 6 }, (_, i) => ({ parid: `F${i}`, sale_date: "2025-01-01", price: 90000, living_area_sqft: 1000, year_built: 1920, condition_desc: "FAIR", distance_mi: 0.1 })),
      { parid: "B", sale_date: "2025-01-01", price: 900000, living_area_sqft: 3000, year_built: 2020, condition_desc: "VERY GOOD", distance_mi: 0.1 },
    ] };
    const m = assumptions.matchedExistingComps({ livingAreaSqft: 1000, yearBuilt: 1915 }, base);
    expect(m.count).toBe(5);
    expect(m.median_price_per_sqft).toBe(250);
    // As-is sales of homes in Fair condition never set the after-repair value.
    const onlyFair = assumptions.matchedExistingComps({ livingAreaSqft: 1000, yearBuilt: 1915 }, { ...base, comps: base.comps.filter((c) => c.condition_desc === "FAIR") });
    expect(onlyFair.sufficient).toBe(false);
  });
});

describe("your own program", () => {
  const TOWN = { units: 4, grossFloorAreaSf: 4800, netFloorAreaSf: 4080, footprintSf: 1600, stories: 3 };
  const prog = { parking: "tuck_under" as const, storiesAboveGarage: 2, bedrooms: 2, baths: 2.5 };
  it("counts a tuck-under garage as gross area, never as finished area", () => {
    const p = plan(FLAT, { scheme: TOWN, strategy: "townhouse_row", overrides: prog });
    expect(p.program).toMatchObject({ units: 4, footprintPerUnitSf: 400, finishedPerUnitSf: 680, garagePerUnitSf: 400, grossSf: 4800 });
    expect(p.finishedSf).toBe(2720);
    // Tier cost: finished area at $190 (to $1,000) + garage level at half the tier rate.
    expect(p.lines.find((l) => l.id === "garage_level")?.amount).toBe(1600 * 190 * 0.5);
    expect(p.forSale.hardCost).toBe(517000 + 1600 * 95);
  });
  it("uses your cost per home without double counting the garage, and adds site adders unless they are included", () => {
    const no = plan(STEEP, { scheme: TOWN, strategy: "townhouse_row", overrides: { ...prog, costPerUnit: 200000 } });
    expect(no.forSale.hardCost).toBe(800000);
    expect(no.lines.some((l) => l.id === "garage_level")).toBe(false);
    // Slope premium on the footprint (1,600 sq ft), never on the 2,720 finished sq ft of every floor.
    expect(no.lines.find((l) => l.id === "slope_adder")?.amount).toBe(45 * 1600);
    expect(no.lines.find((l) => l.id === "retaining_walls")?.amount).toBe(15000);
    expect(no.lines.find((l) => l.id === "hard_base")?.sourceLabel).toBe("Your number");
    const yes = plan(STEEP, { scheme: TOWN, strategy: "townhouse_row", overrides: { ...prog, costPerUnit: 200000, costIncludesSite: true } });
    expect(yes.lines.some((l) => l.id === "slope_adder" || l.id === "retaining_walls")).toBe(false);
    expect(yes.adders[0]!.reason).toBe("Steep slope (lot average, no building footprint yet): 40% (25% or more) → included in your per-home cost");
    expect(yes.exclusions.map((e) => e.id)).toEqual([]);
    expect(yes.lines.some((l) => l.id === "lateral")).toBe(false);
  });
  it("uses your sale price per home and checks it against new-build sales", () => {
    const p = plan(FLAT, { scheme: TOWN, strategy: "townhouse_row", overrides: { ...prog, salePricePerUnit: 350000, units: 3 } });
    expect(p.units).toBe(3);
    expect(p.revenue.sale.grossSales).toBe(1050000);
    expect(p.priceCheck).toBe("Your price $350,000 per home vs. recent new-build median $540,000 ($300/SF, 1,800 sq ft; 6 sales within 0.5 mi).");
    expect(evaluateDevelopment(p).sentences[1]).toBe("Value: $350,000 per home × 3 homes = $1,050,000 in sales.");
  });
});

describe("site adders", () => {
  it("fires nothing on a flat lot", () => {
    const p = plan(FLAT);
    expect(p.adders).toEqual([]);
    // Only the water and sewer laterals ($10,000 per house).
    expect(p.forSale.hardSiteLines).toEqual({ siteWork: 10000 });
  });
  it("fires the steep adder with a plain reason", () => {
    const p = plan(STEEP);
    expect(p.adders.map((a) => a.id)).toEqual(["steep_slope", "retaining_walls"]);
    expect(p.adders[0]!.reason).toBe("Steep slope (lot average, no building footprint yet): 40% (25% or more) → +$45 per sq ft of footprint");
    // Footprint 1,000 sq ft × $45, not 1,700 finished sq ft × a per-floor rate.
    expect(p.adders[0]!.amount).toBe(45 * 1000);
    expect(p.adders[1]!.amount).toBe(15000);
  });
  it("fires the moderate adder over 15% (lot average when there is no footprint slope)", () => {
    const p = plan(MINE);
    expect(p.adders[0]!.id).toBe("moderate_slope");
    expect(p.adders[0]!.reason).toBe("Moderate slope (lot average, no building footprint yet): 18% (over 15%) → +$20 per sq ft of footprint");
    expect(p.adders[0]!.amount).toBe(20 * 1000);
    expect(p.adders.some((a) => a.id === "retaining_walls")).toBe(false);
  });
  it("lists missing slope data instead of assuming flat", () => {
    const p = plan({ ...FLAT, slope_1m: null });
    expect(p.exclusions.map((e) => e.id)).toContain("slope_adder");
    expect(p.evidence).toBe("partial");
  });
  it("uses grouting in the City undermined area and insurance elsewhere", () => {
    const g = plan(UNDERMINED);
    expect(g.minePath).toBe("grouting");
    expect(g.forSale.hardSiteLines?.grouting).toBe(40000);
    expect(g.adders.find((a) => a.id === "mine_grouting")?.sourceLabel).toBe("Local project data (owner-provided)");

    const i = plan(MINE);
    expect(i.minePath).toBe("insurance");
    expect(i.forSale.hardSiteLines?.grouting).toBeUndefined();
    // PA DEP chart: $3.75 + $0.25 per $1,000 of coverage; coverage = construction cost.
    expect(i.msiCoverage).toBe(323000);
    expect(i.msiPremium?.value).toBeCloseTo(3.75 + (0.25 * 323000) / 1000, 6);
    expect(finance.msiAnnualPremium(i.msiCoverage).value).toBe(i.msiPremium?.value);
  });
  it("lets the user switch the mine path", () => {
    const p = plan(UNDERMINED, { overrides: { minePath: "insurance" } });
    expect(p.minePath).toBe("insurance");
    expect(p.forSale.hardSiteLines?.grouting).toBeUndefined();
  });
});

describe("contingency", () => {
  it("is flat on a flat lot, hillside on slopes or hazards, rehab for rehab", () => {
    expect(plan(FLAT).shares).toMatchObject({ contingencyKind: "flat", contingency: 0.1 });
    expect(plan(STEEP).shares).toMatchObject({ contingencyKind: "hillside", contingency: 0.15 });
    // Cost model v0.2 (run D): 15% only in the landslide-prone overlay or on a steep site; undermined ground alone is 10%.
    expect(plan(UNDERMINED).shares).toMatchObject({ contingencyKind: "flat", contingency: 0.1 });
    expect(plan({ ...FLAT, slope_1m: { mean_pct: 20, share_over_15: 0.2, share_over_25: 0 } }).shares).toMatchObject({ contingencyKind: "flat", contingency: 0.1 });
    // A steep footprint on an otherwise flat lot is a steep site.
    expect(plan(FLAT, { footprintSlopePct: 30 }).shares).toMatchObject({ contingencyKind: "hillside", contingency: 0.15 });
    const r = buildDevelopmentInputs({ strategy: "rehab_existing", facts: { ...FLAT, assessment: { ...FLAT.assessment, use: "SINGLE FAMILY", living_area_sqft: 1200, fmv_total: 50000 } }, scheme: null, comps: COMPS, asIsComps: COMPS, rents: RENTS, primeRate: 0.07, permitMonths: 3 });
    expect(r.shares).toMatchObject({ contingencyKind: "rehab", contingency: 0.15 });
    // Purchase price from nearby as-is sales ($300/SF × 1,200 sq ft), never the assessed value.
    expect(r.land).toMatchObject({ value: 360000, sourceLabel: "Nearby home sales (as-is)" });
  });
});

describe("items that apply but have no cost yet", () => {
  it("are listed as not included, never counted as zero", () => {
    const p = plan(MINE);
    expect(p.exclusions.map((e) => e.text)).toContain("Not included: Demolition of the existing building — cost not set yet");
    expect(p.forSale.hardSiteLines?.demolition).toBeUndefined();
    expect(p.evidence).toBe("partial");
    const s = plan(STEEP);
    // A steep City lot stages in the street: a labeled DOMI staging-permit estimate, no longer "not included".
    expect(s.exclusions).toEqual([]);
    expect(s.lines.find((l) => l.id === "dumpsters")).toMatchObject({ label: "Street occupancy and staging (estimate)" });
    // The geotechnical report is priced: $7,000 in the landslide-prone overlay or on a steep site.
    expect(s.forSale.softSiteLines?.geotechnical).toBe(7000);
    // The pro forma still computes with the known lines.
    const r = evaluateDevelopment(s);
    expect(r.tdc).not.toBeNull();
    expect(r.tdc).toBeGreaterThan(0);
  });
  it("disappear from the list once the user enters a cost", () => {
    const p = plan(STEEP, { overrides: { geotech: 5000, dumpsters: 3000 } });
    expect(p.exclusions).toEqual([]);
    expect(p.evidence).toBe("complete");
    expect(p.forSale.softSiteLines?.geotechnical).toBe(5000);
  });
  it("counts water/sewer connection fees once, inside the permits line (City: Pittsburgh Water $610)", () => {
    const p = plan(FLAT, { tapFeesPerUnit: null });
    expect(p.exclusions).toEqual([]);
    expect(p.lines.some((l) => l.id === "tap_fees")).toBe(false);
    expect(p.shares.permitsBasis).toMatch(/Pittsburgh Water permit and connection \$610/);
  });
  it("uses a flat $12,000 per house outside the City, flagged to confirm with the municipality", () => {
    const p = plan({ ...FLAT, assessment: { ...FLAT.assessment, is_pittsburgh: false }, transfer_tax: { total_pct: 2 } });
    const r = evaluateDevelopment(p);
    expect(r.budget.find((b) => b.id === "permits")!.amount).toBe(12000);
    expect(p.shares.permitsBasis).toMatch(/confirm with the municipality/);
    expect(p.notes.some((n) => /Confirm with the municipality/.test(n))).toBe(true);
  });
});

describe("land lot area", () => {
  it("prices land on the mapped GIS lot (what the pane shows), not a smaller assessor lot", () => {
    const p = plan({ ...FLAT, assessment: { ...FLAT.assessment, lot_area_sqft: 1200 }, lot_area_sqft_gis: 6000 });
    const gisOnly = plan({ ...FLAT, assessment: { ...FLAT.assessment, lot_area_sqft: 6000 } });
    expect(p.land.value).toBe(gisOnly.land.value);
    expect(p.land.estimate?.basis).toMatch(/6,000 sq ft/);
    expect(p.land.estimate?.basis).not.toMatch(/1,200 sq ft/);
  });
  it("falls back to the assessor lot when there is no GIS outline", () => {
    const p = plan({ ...FLAT, lot_area_sqft_gis: null });
    expect(p.land.estimate?.basis).toMatch(/3,000 sq ft/);
  });
});

describe("pro forma", () => {
  it("adds up: TDC equals the sum of the budget lines (hand-checked flat lot)", () => {
    const r = evaluateDevelopment(plan(FLAT));
    // Cost model v0.2 (run D), City flat lot: 1,700 sq ft × $190 = $323,000 + $10,000 laterals.
    const hard = 323000 + 10000;
    const land = 13000; // Larimer vacant-land sales: $4.46/sq ft × 3,000 sq ft = $13,380, rounded
    const ae = Math.max(0.04 * hard, 8000); // 13,320
    const pli = (v: number) => Math.min(8000, Math.max(130, (6 * v) / 1000)) + 4.5 + 5 + (v > 10000 ? 25 : 15);
    const permits = pli(hard) + 2 * pli(hard * 0.05) + 130 + 610; // building + electrical + mechanical + CO + Pittsburgh Water
    const other = 2500 + 0.015 * hard + 0.015 * land; // survey + builder's risk + title/closing (no structural, no civil: 3,000 sq ft disturbed)
    const soft = ae + permits + other;
    const contingency = hard * 0.1;
    const before = land + hard + soft + contingency;
    const loan = 0.8 * before;
    const interest = (loan * 0.55 * 0.0775 * 10) / 12; // 7.75%, 10 months, 55% drawn on average
    const fees = loan * 0.01;
    const holding = ((10000 * 27.307) / 1000 / 12) * (4 + 10); // City 2026 millage
    const tdc = before + interest + fees + holding;
    // Totals to $10,000; lines to $1,000 (their sum is within rounding of the total).
    expect(r.tdc).toBe(Math.round(tdc / 10000) * 10000);
    const parts = r.budget.filter((b) => b.group !== "total").reduce((t, b) => t + (b.amount ?? 0), 0);
    expect(Math.abs(parts - tdc)).toBeLessThanOrEqual(5000);
    for (const b of r.budget) if (b.amount != null && b.group !== "total") expect(b.amount % 1000).toBe(0);
    // Sale: $300/SF × 1,700 SF = $510,000 (to $5,000); selling costs: no commissions + half of the City's 5% transfer tax, to $1,000.
    expect(r.sale.grossSales).toBe(510000);
    expect(r.sale.sellingCosts).toBe(13000);
    // The math uses the rounded figures: sales − selling costs − total cost.
    expect(r.sale.profit).toBe(510000 - 13000 - r.tdc!);
    expect(r.narrative).toMatchObject({ tenure: "sale", totalCost: r.tdc, value: r.sale.netSales });
    expect(r.sentences[0]).toMatch(/^Cost: land \$13,000 \+ construction \$323,000 \+ /);
  });
  it("says so plainly when there are not enough comps", () => {
    const p = plan(FLAT, { newComps: null });
    expect(p.revenue.sale.pricePerSf).toBeNull();
    expect(p.evidence).toBe("missing");
    const r = evaluateDevelopment(p);
    expect(r.sale.grossSales).toBeNull();
    expect(r.narrative).toMatchObject({ tenure: "sale", totalCost: r.tdc, value: null });
    expect(p.missing[0]).toMatch(/New-construction sales near this lot could not be loaded/);
    expect(r.headline).toMatch(/^Can't tell yet: it costs about \$[\d,]+, but no sale value/);
  });
  it("prices rent from the ZIP index and reports NOI and yield on cost", () => {
    const r = evaluateDevelopment(plan(FLAT, { overrides: { tenure: "rent" } }));
    expect(r.rent.annualRent).toBe(1500 * 12);
    expect(r.rent.vacancy).toBe(1000); // 5% of $18,000 = $900, to $1,000
    expect(r.rent.noi).toBe(18000 - r.rent.vacancy! - r.rent.opex!);
    expect(r.narrative).toMatchObject({ tenure: "rent", monthlyRent: 1500, noi: r.rent.noi });
  });
  it("applies overrides and marks them as the user's", () => {
    const p = plan(FLAT, { overrides: { tier: "mid_range", land: 30000, aeShare: 0.13 } });
    expect(p.costPerSf).toBe(240);
    expect(p.land).toMatchObject({ value: 30000, sourceLabel: "Your number", flag: null });
    expect(p.assumptions.find((a) => a.key === "ae")).toMatchObject({ edited: true, sourceLabel: "Your input" });
    expect(p.outliers[0]).toMatch(/unusually high — verify/);
  });
  it("is deterministic", () => {
    const a = evaluateDevelopment(plan(STEEP));
    const b = evaluateDevelopment(plan(STEEP));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("compares against local benchmarks", () => {
    const r = evaluateDevelopment(plan(FLAT));
    expect(r.benchmark.line).toMatch(/^Your estimate: \$[\d,]+ per home\. Recent Allegheny County projects: \$300,000 to \$594,000 per home/);
  });
});

describe("privacy", () => {
  // Encoded so this file does not contain them either.
  const FORBIDDEN = ["NDI0IFdpbGxpYW0=", "V2lsbGlhbSBTdA==", "SmVhbm5ldHRl", "UGF1bA==", "MDAwNEwwMDE3NzAwMDAwMA==", "MDAxNUUwMDAwOTAwMDAwMA==", "L1VzZXJzLw=="].map((b) => atob(b));
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
  const sources: Record<string, string> = {
    ...import.meta.glob<string>("../config/cost-assumptions.*.json", { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob<string>("../src/assumptions/*.ts", { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob<string>(
      ["../../web/src/lib/proforma.ts", "../../web/src/app/parcel/*/ProFormaPanel.tsx", "../../web/src/lib/report/load.ts", "../../web/src/app/parcel/*/report/sections.tsx"],
      { query: "?raw", import: "default", eager: true },
    ),
  };
  const files = Object.keys(sources);
  const read = (f: string) => sources[f] ?? "";
  it("scans the config, the assumptions module and the pages that show them", () => expect(files.length).toBeGreaterThanOrEqual(9));
  it.each(files)("%s has no personal names, private addresses, parcel IDs, paths or emails", (file: string) => {
    const text = read(file);
    for (const s of FORBIDDEN) expect(text.includes(s), `${file} contains a forbidden string`).toBe(false);
    expect(EMAIL.test(text)).toBe(false);
  });
  it("the strings a pro forma shows contain none of them", () => {
    const text = JSON.stringify([evaluateDevelopment(plan(STEEP)), evaluateDevelopment(plan(UNDERMINED)), evaluateDevelopment(plan(MINE, { overrides: { tenure: "rent" } }))]);
    for (const s of FORBIDDEN) expect(text.includes(s)).toBe(false);
    expect(EMAIL.test(text)).toBe(false);
  });
});

describe("cost model v0.2 = backtest run D (COST-MODEL-LOCKED §H sanity house)", () => {
  // 2,000 sq ft on 2 floors, City of Pittsburgh, flat lot, no hazards, land excluded; approval 4 months.
  const H: Facts = {
    slope_1m: { mean_pct: 2, share_over_15: 0, share_over_25: 0 }, overlays: [], mines: { in_city_undermined: false, in_mined_out: false, msi_risk: null }, site: { building_count: 0 },
    assessment: { use: null, fmv_land: 0, fmv_total: 0, living_area_sqft: null, is_pittsburgh: true, lot_area_sqft: 3000 },
    property_tax: { general_mills: 27.307 }, transfer_tax: { total_pct: 5 }, owner_class: "private", area: null,
  };
  it("costs $473,014 before land, as run D computed it", () => {
    const p = buildDevelopmentInputs({
      strategy: "new_sf", facts: H, scheme: { units: 1, grossFloorAreaSf: 2000, netFloorAreaSf: 2000, footprintSf: 1000, stories: 2 },
      comps: null, newComps: null, rents: null, primeRate: 0.07, permitMonths: 4, overrides: { tenure: "sale", salePricePerUnit: 600000, land: 0 },
    });
    const c = evaluateDevelopment(p).forSale.costs;
    const val = (x: finance.Receipt) => (x.status === "ok" ? Math.round(x.value) : null);
    expect(val(c.hard)).toBe(390000); // $380,000 building + $10,000 laterals
    expect(val(c.soft)).toBe(27394); // A&E $15,600 + permits $3,444 + survey $2,500 + insurance $5,850
    expect(val(c.contingency)).toBe(39000);
    expect(val(c.financing)).toBe(16620); // interest $12,969 + lender fees $3,651
    expect(val(c.tdc)).toBe(473014);
  });
});

describe("Pencils verdict and sales commission", () => {
  it("pencils only at or above the decision box's target margin; otherwise doesn't pencil", () => {
    for (const price of [250000, 350000, 450000, 600000, 800000]) {
      const r = evaluateDevelopment(plan(FLAT, { overrides: { salePricePerUnit: price } }));
      const box = assumptions.decisionBox(r);
      if (box.profitOnCost == null) continue;
      expect(r.verdict).toBe(box.profitOnCost >= assumptions.DEFAULT_CRITERIA.targetMargin - 1e-9 ? "yes" : "no");
    }
  });
  it("sales commission defaults to $0 and a number you enter comes out of selling costs", () => {
    const base = evaluateDevelopment(plan(FLAT, { overrides: { salePricePerUnit: 500000 } }));
    expect(base.plan.salesCommission).toBe(0);
    const withC = evaluateDevelopment(plan(FLAT, { overrides: { salePricePerUnit: 500000, lineAmounts: { sales_commission: 30000 } } }));
    expect(withC.plan.salesCommission).toBe(30000);
    expect(withC.sale.sellingCosts! - base.sale.sellingCosts!).toBe(30000);
    expect(withC.tdc).toBe(base.tdc);
  });
});
