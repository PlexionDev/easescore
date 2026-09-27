import { describe, expect, it } from "vitest";
import { assumptions, score } from "../src";

const set = (count: number, med: number | null) => ({ count, median_price_per_sqft: med, radius_mi: 1 }) as unknown as assumptions.CompSet;

describe("band labels", () => {
  it("maps stored codes to the barrier words, in one place", () => {
    expect(score.BAND_CODES.map((b) => score.bandLabel(b))).toEqual(["Few barriers", "Some barriers", "Significant barriers", "Major barriers"]);
    expect(score.bandLabel("Partial")).toBe("Partial");
    expect(score.bandLabel(null)).toBe("No score");
    expect(score.relabelBands("Capped at Moderate: 60% of the lot is landslide-prone")).toBe("Capped at Some barriers: 60% of the lot is landslide-prone");
  });

  it("zoning is loaded only for City parcels with a district that has rules", () => {
    expect(score.zoningLoaded({ assessment: { municode: "110" }, zoning: { code: "R2-H", rules: {} } })).toBe(true);
    expect(score.zoningLoaded({ assessment: { municode: "110" }, zoning: { code: "R2-H", rules: null } })).toBe(false);
    expect(score.zoningLoaded({ assessment: { municode: "870" }, zoning: null })).toBe(false);
    expect(score.partialHeadline("TURTLE CREEK")).toBe("Partial screen: zoning not available for Turtle Creek");
  });
});

describe("market signal", () => {
  const cost = 190;
  it("Weak with fewer than 5 new-construction sales, whatever the price", () => {
    expect(assumptions.marketSignal(set(3, 400)).level).toBe("Weak");
    expect(assumptions.marketSignal(null).level).toBe("Weak");
  });
  it("Strong at 1.3x the default construction cost per sq ft, Moderate at cost, Weak below", () => {
    expect(assumptions.marketSignal(set(8, Math.round(cost * 1.3))).level).toBe("Strong");
    expect(assumptions.marketSignal(set(8, cost)).level).toBe("Moderate");
    expect(assumptions.marketSignal(set(8, cost - 1)).level).toBe("Weak");
  });
  it("the receipt states the numbers", () => {
    const m = assumptions.marketSignal(set(8, 300));
    expect(m.receipt).toMatch(/^8 new-construction sales within 1 mi, median \$300\/sq ft/);
    expect(m.rule).toMatch(/Strong: 5 or more/);
  });
});

describe("built-on parcels the score treated as empty", () => {
  it("flags a County building use with no building value, year or footprint", () => {
    expect(score.buildingUnscored({ assessment: { use: "OFFICE-ELEVATOR -3 + STORIES", fmv_building: 0, year_built: null } })).toBe("OFFICE-ELEVATOR -3 + STORIES");
    expect(score.buildingUnscored({ assessment: { use: "CONDOMINIUM UNIT", fmv_building: 0 } })).toBe("CONDOMINIUM UNIT");
    expect(score.buildingUnscored({ assessment: { use: "VACANT COMMERCIAL LAND", fmv_building: 0 } })).toBeNull();
    expect(score.buildingUnscored({ assessment: { use: "RES AUX BUILDING (NO HOUSE)", fmv_building: 0 } })).toBeNull();
    expect(score.buildingUnscored({ assessment: { use: "PARKING GARAGE/LOTS", fmv_building: 0 } })).toBeNull();
    expect(score.buildingUnscored({ assessment: { use: "SINGLE FAMILY", fmv_building: 90000 } })).toBeNull();
  });
  it("partial text by reason", () => {
    expect(score.partialText("zoning", { municipality: "WILKINSBURG" })).toBe("Partial screen: zoning not available for Wilkinsburg");
    expect(score.partialText("use", { use: "CONDOMINIUM UNIT" })).toMatch(/existing building \(condominium unit\)/);
    expect(score.partialText("not_lot", { use: "AIR RIGHTS" })).toMatch(/air rights, not a lot/);
  });
});
