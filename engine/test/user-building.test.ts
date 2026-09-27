// Pro forma without zoning: where zoning is not loaded, the pro forma prices the building the user entered
// through the same SelectedScheme / financeFor path as every option (no new math). Fixture: the public URA
// lot 0011A00151000000 with its zoning removed, standing in for a parcel outside the City.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assumptions, score } from "../src";
import { fromStored, type PanePayload, type StoredPane } from "../../web/src/lib/pane-core";
import { userBuildingPlan } from "../../web/src/lib/parcel-plan";
import { financeFor } from "../../web/src/lib/quickfit-gen";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "pane-ura-0011A00151000000.json"), "utf8")) as { pane: StoredPane };
const CITY = fromStored(FX.pane);
const NO_ZONING: PanePayload = { ...CITY, facts: { ...(CITY.facts as Record<string, unknown>), zoning: null } as PanePayload["facts"] };

describe("the building you entered (zoning not loaded)", () => {
  it("reads ub_* keys with the default one 1,800 sq ft single-family home", () => {
    expect(score.readUserBuilding({})).toEqual({ type: "single_family", units: 1, sfPerHome: 1800 });
    expect(score.readUserBuilding({ ub_type: "duplex" })).toEqual({ type: "duplex", units: 2, sfPerHome: 1800 });
    expect(score.readUserBuilding({ ub_type: "townhouse", ub_units: "4", ub_sf: "1,600" })).toEqual({ type: "townhouse", units: 4, sfPerHome: 1600 });
    expect(score.readUserBuilding({ ub_type: "nope", ub_units: "-3", ub_sf: "99999" })).toEqual({ type: "single_family", units: 1, sfPerHome: 6000 });
    expect(score.readUserBuilding({ ub_type: "duplex", ub_units: "3" }).units % 2).toBe(0);
  });

  it("is only used where zoning is not loaded", () => {
    expect(userBuildingPlan({ P: CITY, sp: {}, overrides: {} })).toBeNull();
    expect(score.zoningLoaded(NO_ZONING.facts)).toBe(false);
  });

  it("prices the default building with the same pro forma as a size-only scheme", () => {
    const ub = userBuildingPlan({ P: NO_ZONING, sp: {}, overrides: {} })!;
    expect(ub.strategy).toBe("new_sf");
    expect(ub.selected?.source).toBe("user_entered");
    expect(ub.selected?.units).toBe(1);
    expect(ub.selected?.finishedSf).toBe(1800);
    expect(ub.selected?.path).toBeNull();
    expect(ub.selected?.sizeBasis).toMatch(/building you entered.*zoning not checked/);
    const pf = ub.pf!;
    expect(pf).not.toBeNull();
    expect(pf.plan.units).toBe(1);
    expect(pf.plan.finishedSf).toBe(1800);
    expect(pf.ranges.tdc?.likely).toBeGreaterThan(0);
    // Hard cost = the tier's $/SF × the entered finished area (the cost model, not new math).
    const hard = pf.budget.find((b) => b.id === "hard_base")!;
    expect(hard.amount).toBeCloseTo(pf.plan.costPerSf * 1800, -3);
    // Identical to calling the shared pricing path directly with the same size-only scheme.
    const direct = financeFor(ub.fin, "new_sf", score.userBuildingScheme(ub.building) as never, null).pf!;
    expect(JSON.stringify(direct.budget)).toBe(JSON.stringify(pf.budget));
    expect(JSON.stringify(direct.ranges)).toBe(JSON.stringify(pf.ranges));
    // The rows say where the size came from; never "site-fit".
    const row = pf.plan.assumptions.find((a) => a.key === "finishedSf")!;
    expect(row.sourceLabel).toMatch(/building you entered/);
  });

  it("follows the user's type, homes and size; edits (pf_*) still apply", () => {
    const ub = userBuildingPlan({ P: NO_ZONING, sp: { ub_type: "townhouse", ub_units: "3", ub_sf: "1500" }, overrides: {} })!;
    expect(ub.strategy).toBe("townhouse_row");
    expect(ub.pf!.plan.units).toBe(3);
    expect(ub.pf!.plan.finishedSf).toBe(4500);
    const tier = assumptions.COST_CONFIG.construction.tiers.find((t) => t.id !== assumptions.COST_CONFIG.construction.defaultTier)!;
    const edited = userBuildingPlan({ P: NO_ZONING, sp: { ub_type: "townhouse", ub_units: "3", ub_sf: "1500" }, overrides: { tier: tier.id } })!;
    expect(edited.pf!.plan.tier.id).toBe(tier.id);
    const dup = userBuildingPlan({ P: NO_ZONING, sp: { ub_type: "duplex" }, overrides: {} })!;
    expect(dup.strategy).toBe("duplex");
    expect(dup.pf!.plan.units).toBe(2);
  });

  it("banner names the municipality", () => {
    expect(score.zoningNotCheckedBanner("TURTLE CREEK")).toBe("Zoning not checked. This estimate assumes the building you entered is allowed; confirm with Turtle Creek.");
  });
});
