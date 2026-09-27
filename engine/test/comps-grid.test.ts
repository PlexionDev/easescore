import { describe, expect, it } from "vitest";
import { assumptions } from "../src";

// Synthetic sales (ids, streets and places are made up).
const AT = { lat: 40.44, lon: -79.98, parid: "SUBJ", area: "Hill A" };
const mi = (m: number) => m / 69;
const sale = (i: number, d: number, ppsf: number, use: string, date = "2025-06-01"): assumptions.SaleRecord => ({
  parid: `S${String(i).padStart(2, "0")}`, address: `${1200 + i * 7} TEST ST`, saleDate: date, price: ppsf * 2000, livingAreaSqft: 2000, yearBuilt: 2022,
  use, lat: AT.lat + mi(d), lon: AT.lon, area: "Hill A",
});
const opts = { asOf: "2026-09-26", uses: ["SINGLE FAMILY", "TOWNHOUSE"], useLabel: "single-family homes", tiers: null };

describe("comparable-sales grid", () => {
  const recs = [
    sale(1, 0.1, 300, "TOWNHOUSE"), sale(2, 0.2, 310, "SINGLE FAMILY"), sale(3, 0.3, 320, "SINGLE FAMILY"),
    sale(4, 0.4, 330, "SINGLE FAMILY"), sale(5, 0.5, 340, "SINGLE FAMILY"), sale(6, 0.6, 350, "SINGLE FAMILY"),
  ];
  const set = assumptions.newConstructionComps(AT, recs, opts);

  it("uses the value set's own median and middle half (single source with the pro forma)", () => {
    const g = assumptions.compsGrid(set, { strategy: "single_family", perHomeSf: 2000 });
    expect(g.medianPerSf).toBe(set.median_price_per_sqft);
    expect(g.p25PerSf).toBe(set.selection!.p25PerSqft);
    expect(g.p75PerSf).toBe(set.selection!.p75PerSqft);
    expect(g.inSet).toBe(set.count);
    expect(g.confidence).toBe("Moderate");
    expect(g.status).toBe("ok");
  });

  it("orders same type first, then nearest, and shows block-level addresses", () => {
    const g = assumptions.compsGrid(set, { strategy: "single_family" });
    expect(g.rows[0]!.type).toBe("detached");
    expect(g.rows[g.rows.length - 1]!.type).toBe("attached");
    expect(g.rows.slice(0, -1).map((r) => r.distanceMi)).toEqual([...g.rows.slice(0, -1).map((r) => r.distanceMi)].sort((a, b) => a - b));
    expect(g.rows[0]!.blockAddress).toMatch(/^1200 block of TEST ST$/);
    const t = assumptions.compsGrid(set, { strategy: "townhouse_row" });
    expect(t.rows[0]!.type).toBe("attached");
  });

  it("writes the reconciliation line from the numbers", () => {
    const g = assumptions.compsGrid(set, { strategy: "single_family", perHomeSf: 2000 });
    expect(g.reconciliation).toMatch(/^The most similar sales are .* at \$\d+–\$\d+\/SF\. Projected pricing of \$[\d,]+–\$[\d,]+ per home/);
  });

  it("fewer than 5 sales: says so, confidence Low, no older homes", () => {
    const few = assumptions.newConstructionComps(AT, recs.slice(1, 4), opts);
    const g = assumptions.compsGrid(few, { strategy: "single_family", perHomeSf: 2000 });
    expect(g.status).toBe("few");
    expect(g.confidence).toBe("Low");
    expect(g.fewNote).toMatch(/Only 3 new-construction sales qualify/);
    expect(g.fewNote).toMatch(/never used/);
  });
});
