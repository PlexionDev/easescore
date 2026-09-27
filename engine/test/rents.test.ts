import { describe, expect, it } from "vitest";
import { rents } from "../src";

// Synthetic listings (addresses and rents invented for the test).
const L = (i: number, price: number, d: number, sqft: number | null = 950, br = 2, seen = "2026-09-01"): rents.RentListing => ({
  address: `${400 + i * 2} Test St, Pittsburgh, PA 15219`, bedrooms: br, bathrooms: 1, squareFootage: sqft, propertyType: "Apartment",
  price, distanceMi: d, lastSeen: seen, yearBuilt: 1950,
});
const HUD = { year: 2026, zip: "15219", br1: 1140, br2: 1380, br3: 1760 };
const ZORI = { zip: "15219", latest_rent: 1852.15, latest_month: "2026-08-31" };
const base = { asOf: "2026-09-27", pulledOn: "2026-09-27", hud: HUD, zori: ZORI };

describe("rent rounding", () => {
  it("rounds to the nearest $50", () => {
    expect(rents.round50(1374)).toBe(1350);
    expect(rents.round50(1375)).toBe(1400);
    expect(rents.round50(1524.9)).toBe(1500);
  });
  it("likely = median, range = middle half, each rounded to $50", () => {
    const ls = [1300, 1400, 1450, 1500, 1520, 1600, 1700].map((p, i) => L(i, p, 0.2 + i * 0.03));
    const e = rents.rentForBedrooms(2, ls, base);
    expect(e.basis).toBe("rentcast_comps");
    expect(e.likely).toBe(1500);
    expect(e.low).toBe(1450); // p25 of 7 = 1425 → 1450
    expect(e.high).toBe(1550); // p75 = 1560 → 1550
    expect([e.likely! % 50, e.low! % 50, e.high! % 50]).toEqual([0, 0, 0]);
  });
});

describe("comp rules", () => {
  it("widens the radius until 5 comps, drops other bedrooms, stale and out-of-band sizes", () => {
    const ls = [
      L(0, 1400, 0.3), L(1, 1450, 0.4), L(2, 1500, 0.8), L(3, 1550, 0.9), L(4, 1600, 1.4), L(5, 1650, 2.5),
      L(6, 900, 0.1, 950, 1), // 1-bedroom
      L(7, 2500, 0.1, 950, 2, "2026-01-01"), // stale
      L(8, 3000, 0.1, 2400), // too big
    ];
    const e = rents.rentForBedrooms(2, ls, base);
    expect(e.radiusMi).toBe(1.5);
    expect(e.compCount).toBe(5);
    expect(e.comps.every((c) => c.price < 2000)).toBe(true);
  });
  it("size-adjusts a smaller unit up, capped at 15%", () => {
    const ls = Array.from({ length: 5 }, (_, i) => L(i, 1000, 0.1 * (i + 1), 650));
    const e = rents.rentForBedrooms(2, ls, base);
    expect(e.comps[0]!.adjusted).toBe(Math.round(1000 * Math.min(1.15, (950 / 650) ** 0.35)));
  });
});

describe("block-level addresses", () => {
  it("formats house numbers to the hundred block", () => {
    expect(rents.blockLevelAddress("412 Roberts St, Pittsburgh, PA 15219")).toBe("400 block of Roberts St");
    expect(rents.blockLevelAddress("1717 Centre Ave Apt 3, Pittsburgh, PA 15219")).toBe("1700 block of Centre Ave");
    expect(rents.blockLevelAddress("412-414 Roberts St Unit B, Pittsburgh, PA")).toBe("400 block of Roberts St");
    expect(rents.blockLevelAddress("57 Fifth Ave #2, Pittsburgh, PA")).toBe("1–99 block of Fifth Ave");
    expect(rents.blockLevelAddress("Roberts St, Pittsburgh, PA")).toBe("Roberts St");
  });
  it("never puts a house number on screen", () => {
    const e = rents.rentForBedrooms(2, Array.from({ length: 5 }, (_, i) => L(i, 1400, 0.2)), base);
    expect(e.comps.every((c) => /^\d+ block of |^1–99 block of /.test(c.block))).toBe(true);
    expect(e.comps.some((c) => /^4\d\d Test/.test(c.block))).toBe(false);
  });
});

describe("fallback when RentCast is unavailable", () => {
  it("uses HUD Small Area FMR, labeled as a benchmark", () => {
    const r = rents.rentsByBedroom({ ...base, listings: {} });
    const e = r.byBedroom[2]!;
    expect(e.basis).toBe("hud_safmr");
    expect(e.likely).toBe(1400);
    expect(e.low).toBe(1250); // 1242 → 1250
    expect(e.high).toBe(1500); // 1518 → 1500
    expect(e.basisLabel).toMatch(/HUD Small Area Fair Market Rent FY2026, ZIP 15219 \(benchmark, not listings\)/);
    expect(e.note).toMatch(/unavailable/);
    expect(rents.rentOneLiner(e)).toMatch(/^\$1,250–1,500\/month for a 2-bedroom · likely \$1,400\. HUD Small Area/);
    expect(r.sources.some((s) => /RentCast/.test(s.label))).toBe(false);
  });
  it("uses ZORI (all homes) when HUD is missing, and says so", () => {
    const e = rents.rentsByBedroom({ ...base, hud: null, listings: { 2: [] } }).byBedroom[2]!;
    expect(e.basis).toBe("zori");
    expect(e.likely).toBe(1850);
    expect(e.basisLabel).toMatch(/all home sizes, not by bedroom/);
    expect(e.note).toMatch(/Only 0 matching listings/);
  });
  it("returns nulls with no evidence at all", () => {
    const e = rents.rentsByBedroom({ ...base, hud: null, zori: null, listings: {} }).byBedroom[1]!;
    expect(e.basis).toBe("none");
    expect(e.likely).toBeNull();
  });
});

describe("one-liner", () => {
  it("matches the spec shape", () => {
    const ls = [1300, 1400, 1450, 1500, 1520, 1600, 1700, 1350, 1480, 1550, 1500, 1450, 1650, 1400].map((p, i) => L(i, p, 0.1 + i * 0.02));
    const e = rents.rentForBedrooms(2, ls, base);
    expect(rents.rentOneLiner(e)).toBe(`$${e.low!.toLocaleString("en-US")}–${e.high!.toLocaleString("en-US")}/month for a 2-bedroom · likely $${e.likely!.toLocaleString("en-US")}. Asking rents from 14 nearby listings (RentCast, Sep 2026), checked against HUD and Zillow.`);
  });
});
