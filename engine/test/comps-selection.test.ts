import { describe, expect, it } from "vitest";
import { assumptions } from "../src";

// Synthetic bimodal market: modest new homes in the subject's neighborhood (~$300/SF) and a luxury
// cluster in another neighborhood (~$650/SF) that is actually closer. Ids and places are synthetic.
const AT = { lat: 40.44, lon: -79.98, parid: "SUBJ", area: "Hill A" };
const mi = (m: number) => m / 69;
const sale = (i: number, d: number, ppsf: number, area: string): assumptions.SaleRecord => ({
  parid: `S${String(i).padStart(2, "0")}`, saleDate: "2025-06-01", price: ppsf * 2000, livingAreaSqft: 2000, yearBuilt: 2022,
  use: "SINGLE FAMILY", lat: AT.lat + mi(d), lon: AT.lon, area,
});
const LOCAL = [0.3, 0.45, 0.6, 0.7, 0.85, 0.95].map((d, i) => sale(i, d, 290 + i * 5, "Hill A"));
const LUXURY = Array.from({ length: 10 }, (_, i) => sale(20 + i, 0.2 + i * 0.02, 620 + i * 10, "Riverfront B"));
const opts = { asOf: "2026-09-26", uses: ["SINGLE FAMILY"], useLabel: "single-family homes" };

describe("new-construction comp selection", () => {
  it("uses only same-neighborhood sales when there are 5 or more, excluding the closer luxury cluster", () => {
    const c = assumptions.newConstructionComps(AT, [...LOCAL, ...LUXURY], opts);
    expect(c.status).toBe("ok");
    expect(c.selection!.scope).toBe("same_area");
    expect(c.selection!.areas).toEqual(["Hill A"]);
    expect(c.comps.every((x) => x.area === "Hill A")).toBe(true);
    expect(c.count).toBe(6);
    expect(c.median_price_per_sqft).toBeLessThan(320);
    expect(c.selection!.receipt).toMatch(/^Rule: sales in the same neighborhood .* Result: 6 sales from the same Hill A area .* median \$\d+\/SF, middle half \$\d+–\$\d+\/SF/);
  });

  it("falls back to the nearest sales by distance, keeps at most 12, and drops $/SF outliers with a reason", () => {
    const few = LOCAL.slice(0, 3);
    const odd = sale(40, 0.21, 2500, "Hill A"); // a data-entry outlier
    const c = assumptions.newConstructionComps({ ...AT, area: "Nowhere C" }, [...few, ...LUXURY, odd], opts);
    expect(c.selection!.scope).toBe("nearest");
    expect(c.count + c.selection!.dropped.length).toBeLessThanOrEqual(12);
    expect(c.selection!.dropped.some((d) => d.row.parid === "S40" && /above the outlier limit/.test(d.reason))).toBe(true);
    expect(c.comps.some((x) => x.parid === "S40")).toBe(false);
  });

  it("is deterministic regardless of record order", () => {
    const a = assumptions.newConstructionComps(AT, [...LOCAL, ...LUXURY], opts);
    const b = assumptions.newConstructionComps(AT, [...LUXURY, ...LOCAL].reverse(), opts);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("keeps the thresholds in the cost config", () => {
    expect(assumptions.COST_CONFIG.comps.newConstruction.selection).toMatchObject({ sameAreaMinComps: 5, nearestMin: 8, nearestMax: 12, outlierIqrMultiplier: 1.5 });
  });
});

describe("market-tier matching (appraisal-style, never demographic)", () => {
  // Subject's own area has too few new sales; a modest area and a closer luxury area both have many.
  const TIERS: assumptions.AreaTiers = { asOf: "2026-09-27", years: 3, areas: { "Hill A": { medianPerSqft: 190, sales: 18 }, "Flats C": { medianPerSqft: 180, sales: 140 }, "Riverfront B": { medianPerSqft: 420, sales: 60 } } };
  const own = [sale(1, 0.4, 300, "Hill A"), sale(2, 0.5, 310, "Hill A")];
  const flats = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9].map((d, i) => sale(50 + i, d, 290 + i * 4, "Flats C"));
  const all = [...own, ...flats, ...LUXURY];
  const run = (recs: assumptions.SaleRecord[], tiers: assumptions.AreaTiers | null = TIERS) =>
    assumptions.newConstructionComps(AT, recs, { ...opts, tiers });

  it("keeps only areas within ±35% of the subject area's tier, excluding the closer high-tier cluster", () => {
    const c = run(all);
    expect(c.selection!.scope).toBe("tier_match");
    expect(c.comps.some((x) => x.area === "Riverfront B")).toBe(false);
    expect(c.selection!.tier).toMatchObject({ area: "Hill A", medianPerSqft: 190, qualified: ["Flats C", "Hill A"], fellBack: false });
    expect(c.selection!.receipt).toMatch(/Market tier: Hill A existing homes sell for a median \$190\/SF; comps were limited to areas within ±35% \(\$124–\$257\/SF; Assumption, edit me\): Flats C, Hill A\./);
    expect(c.median_price_per_sqft!).toBeLessThan(320);
  });

  it("falls back to the nearest rule, and says so, when the tier band leaves fewer than 5", () => {
    const c = run([...own, ...flats.slice(0, 2), ...LUXURY]);
    expect(c.selection!.scope).toBe("nearest");
    expect(c.selection!.tier!.fellBack).toBe(true);
    expect(c.selection!.receipt).toMatch(/That left fewer than 5 sales, so the nearest sales by distance were used instead\./);
  });

  it("says the tier is unknown when the subject area has too few existing-home sales", () => {
    const c = run(all, { ...TIERS, areas: { "Flats C": TIERS.areas["Flats C"]!, "Riverfront B": TIERS.areas["Riverfront B"]! } });
    expect(c.selection!.scope).toBe("nearest");
    expect(c.selection!.receipt).toMatch(/Market tier of Hill A is unknown/);
  });

  it("is deterministic regardless of record order", () => {
    expect(JSON.stringify(run([...all].reverse()))).toBe(JSON.stringify(run(all)));
  });

  it("the shipped tier file has no demographic fields", () => {
    const keys = new Set(Object.values(assumptions.AREA_TIERS.areas).flatMap((v) => Object.keys(v)));
    expect([...keys].sort()).toEqual(["medianPerSqft", "sales"]);
  });
});
