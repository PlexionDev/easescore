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
  assessment: { use: "VACANT LAND", fmv_land: 10000, fmv_total: 10000, is_pittsburgh: true },
  property_tax: { general_mills: 24 },
  transfer_tax: { total_pct: 4 },
};
const STEEP: Facts = {
  ...FLAT,
  slope_1m: { mean_pct: 40, share_over_15: 0.9, share_over_25: 0.8 },
  overlays: [{ layer: "landslide_prone_pgh", share: 1 }],
};
const MINE: Facts = {
  ...FLAT,
  slope_1m: { mean_pct: 15, share_over_15: 0.5, share_over_25: 0.1 },
  mines: { in_city_undermined: false, in_mined_out: false, msi_risk: "confirmed" },
  site: { building_count: 1 },
  building_footprint_sqft: 800,
};
const UNDERMINED: Facts = { ...FLAT, mines: { in_city_undermined: true } };

const SCHEME = { units: 1, grossFloorAreaSf: 2000, netFloorAreaSf: 1700 };
const COMPS: assumptions.SalesCompsLike = { status: "ok", sufficient: true, count: 12, radius_mi: 0.5, comparable_use: "single family", median_price_per_sqft: 300 };
const RENTS: assumptions.RentCompsLike = { zori: { zip: "15000", latest_rent: 1500, latest_month: "2026-08-31" } };

const plan = (facts: Facts, extra: Partial<assumptions.PlanArgs> = {}) =>
  buildDevelopmentInputs({ strategy: "new_sf", facts, scheme: SCHEME, comps: COMPS, rents: RENTS, primeRate: 0.07, permitMonths: 4, tapFeesPerUnit: 1000, ...extra });

describe("cost config", () => {
  it("has a version stamp and the Good tier at $250 as the default", () => {
    expect(COST_CONFIG.version).toMatch(/^cost-assumptions\.v\d/);
    const def = assumptions.tierOf(COST_CONFIG, undefined);
    expect(def.label).toBe("Good (standard infill)");
    expect(def.costPerSf.value).toBe(250);
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

describe("site adders", () => {
  it("fires nothing on a flat lot", () => {
    const p = plan(FLAT);
    expect(p.adders).toEqual([]);
    expect(p.forSale.hardSiteLines).toEqual({ siteWork: 0 });
  });
  it("fires the steep adder with a plain reason", () => {
    const p = plan(STEEP);
    expect(p.adders.map((a) => a.id)).toEqual(["steep_slope"]);
    expect(p.adders[0]!.reason).toBe("Steep slope under 80% of the lot → +$60/SF");
    expect(p.adders[0]!.amount).toBe(60 * 1700);
  });
  it("fires the moderate adder from the average slope", () => {
    const p = plan(MINE);
    expect(p.adders[0]!.id).toBe("moderate_slope");
    expect(p.adders[0]!.reason).toBe("Moderate slope: the lot averages 15% (8–25%) → +$25/SF");
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
    expect(i.msiCoverage).toBe(250 * 1700);
    expect(i.msiPremium?.value).toBeCloseTo(3.75 + (0.25 * 250 * 1700) / 1000, 6);
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
    expect(plan(FLAT).shares).toMatchObject({ contingencyKind: "flat", contingency: 0.07 });
    expect(plan(STEEP).shares).toMatchObject({ contingencyKind: "hillside", contingency: 0.12 });
    expect(plan(UNDERMINED).shares).toMatchObject({ contingencyKind: "hillside", contingency: 0.12 });
    const r = buildDevelopmentInputs({ strategy: "rehab_existing", facts: { ...FLAT, assessment: { ...FLAT.assessment, use: "SINGLE FAMILY", living_area_sqft: 1200, fmv_total: 50000 } }, scheme: null, comps: COMPS, rents: RENTS, primeRate: 0.07, permitMonths: 3 });
    expect(r.shares).toMatchObject({ contingencyKind: "rehab", contingency: 0.15 });
    expect(r.land.sourceLabel).toBe("County assessed total value (not a price)");
  });
});

describe("items that apply but have no cost yet", () => {
  it("are listed as not included, never counted as zero", () => {
    const p = plan(MINE);
    expect(p.exclusions.map((e) => e.text)).toContain("Not included: Demolition of the existing building — cost not set yet");
    expect(p.forSale.hardSiteLines?.demolition).toBeUndefined();
    expect(p.evidence).toBe("partial");
    const s = plan(STEEP);
    expect(s.exclusions.map((e) => e.text)).toEqual([
      "Not included: Geotechnical report — cost not set yet",
      "Not included: Dumpsters and DOMI street permit — cost not set yet",
    ]);
    // The pro forma still computes with the known lines.
    const r = evaluateDevelopment(s);
    expect(r.tdc).not.toBeNull();
    expect(r.headline).toMatch(/Partial estimate: 2 cost items are not included yet/);
  });
  it("disappear from the list once the user enters a cost", () => {
    const p = plan(STEEP, { overrides: { geotech: 5000, dumpsters: 3000 } });
    expect(p.exclusions).toEqual([]);
    expect(p.evidence).toBe("complete");
    expect(p.forSale.softSiteLines?.geotechnical).toBe(5000);
  });
  it("flags missing tap fees for new homes where the tariff is not loaded", () => {
    expect(plan(FLAT, { tapFeesPerUnit: null }).exclusions.map((e) => e.id)).toEqual(["tap_fees"]);
  });
});

describe("pro forma", () => {
  it("adds up: TDC equals the sum of the budget lines (hand-checked flat lot)", () => {
    const r = evaluateDevelopment(plan(FLAT));
    const hard = 250 * 1700; // 425,000
    const soft = hard * (0.08 + 0.006 + 0.03) + 1000; // A&E + PLI $6/$1,000 + survey/legal + tap fees
    const contingency = hard * 0.07;
    const land = 10000;
    const before = land + hard + soft + contingency;
    const loan = 0.8 * before;
    const interest = (loan * 0.5 * 0.08 * 9) / 12; // prime 7% + 1%, 9 months, half drawn
    const fees = loan * 0.01;
    const holding = ((10000 * 24) / 1000 / 12) * (4 + 9);
    const tdc = before + interest + fees + holding;
    expect(r.tdc).toBeCloseTo(tdc, 6);
    const parts = r.budget.filter((b) => b.group !== "total").reduce((t, b) => t + (b.amount ?? 0), 0);
    expect(parts).toBeCloseTo(r.tdc!, 6);
    // Sale: $300/SF × 1,700 SF, selling costs 5% broker + half of 4% transfer tax.
    expect(r.sale.grossSales).toBe(510000);
    expect(r.sale.sellingCosts).toBeCloseTo(510000 * 0.07, 6);
    expect(r.sale.profit).toBeCloseTo(510000 * 0.93 - tdc, 6);
    expect(r.narrative).toMatchObject({ tenure: "sale", totalCost: r.tdc, value: r.sale.netSales });
    expect(r.sentences[0]).toMatch(/^Cost: land \$10,000 \+ construction \$425,000 \+ soft costs/);
  });
  it("says so plainly when there are not enough comps", () => {
    const p = plan(FLAT, { comps: { status: "insufficient comps", sufficient: false, count: 3, comparable_use: "single family", note: "Insufficient comps: only 3 comparable sale(s) within 3 mi in the last 5 years. No estimate is made.", median_price_per_sqft: 200 } });
    expect(p.revenue.sale.pricePerSf).toBeNull();
    expect(p.evidence).toBe("missing");
    const r = evaluateDevelopment(p);
    expect(r.sale.grossSales).toBeNull();
    expect(r.narrative).toEqual({ tenure: "sale", totalCost: r.tdc, value: null });
    expect(r.headline).toMatch(/^Can't tell yet: it costs about \$[\d,]+, but no sale value/);
  });
  it("prices rent from the ZIP index and reports NOI and yield on cost", () => {
    const r = evaluateDevelopment(plan(FLAT, { overrides: { tenure: "rent" } }));
    expect(r.rent.annualRent).toBe(1500 * 12);
    expect(r.rent.vacancy).toBeCloseTo(18000 * 0.05, 6);
    expect(r.rent.noi).toBeCloseTo(18000 - r.rent.vacancy! - r.rent.opex!, 6);
    expect(r.narrative).toMatchObject({ tenure: "rent", monthlyRent: 1500, noi: r.rent.noi });
  });
  it("applies overrides and marks them as the user's", () => {
    const p = plan(FLAT, { overrides: { tier: "better", land: 30000, aeShare: 0.13 } });
    expect(p.costPerSf).toBe(310);
    expect(p.land).toEqual({ value: 30000, sourceLabel: "Your input" });
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
