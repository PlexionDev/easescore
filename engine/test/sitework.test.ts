import { describe, expect, it } from "vitest";
import { assumptions } from "../src";

// Synthetic ground quantities (a 20 × 50 ft building on a 30% slope, one floor plate).
const Q: assumptions.GroundQuantitiesInput = {
  widthFt: 20, depthFt: 50,
  ground: { slopePct: 30, steps: [{ elevFt: 100 }], foundationWallSqft: 740, retainingWall: { lengthFt: 30, maxHeightFt: 6 } },
  garageCut: null,
};

describe("Site work & earthwork takeoff", () => {
  const q = assumptions.siteWorkQuantities(Q, { units: 1, isCity: true, demolition: false, stagingInStreet: true });
  const line = (id: string) => q.lines.find((l) => l.id === id)!;

  it("prices each quantity × its unit cost range", () => {
    const c = assumptions.SITE_WORK;
    expect(line("retaining_walls").quantity).toBe(180);
    expect(line("retaining_walls").amount.likely).toBe(Math.round((180 * c.retainingWallFace.likely) / 100) * 100);
    // 740 − perimeter 140 = 600 sq ft of extra wall
    expect(line("foundation_walls").quantity).toBe(600);
    // 20 × 0.30 × 50² ÷ 8 ÷ 27 ≈ 69 cu yd
    expect(line("excavation").quantity).toBe(69);
    for (const l of q.lines) expect(l.amount.low).toBeLessThanOrEqual(l.amount.likely), expect(l.amount.likely).toBeLessThanOrEqual(l.amount.high);
    expect(line("staging").amount.likely).toBe(Math.round((c.staging.periods * c.staging.domiPermitPeriod.likely) / 100) * 100);
  });

  it("labels the unverified foundation-wall figure", () => {
    expect(line("foundation_walls").sourceLabel).toMatch(/Unverified/);
  });

  it("reads a garage cut from QuickFit's parking note", () => {
    expect(assumptions.garageCutFromNotes({ type: "tuck", count: 2, notes: ["Garage floor set at street grade, cut about 8 ft into the hill (retaining walls, priced in the site adders)."] })).toEqual({ bays: 2, depthFt: 8 });
    expect(assumptions.garageCutFromNotes({ type: "side_drive_pad", notes: [] })).toBeNull();
  });
});
