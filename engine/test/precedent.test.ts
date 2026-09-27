import { describe, expect, it } from "vitest";
import { score, type ParcelFacts } from "../src";
import * as policy from "../src/policy";
import ura from "./fixtures/score/ura-lot-rm-m.json";

type Lot = score.PrecedentLot;
const lot = (parid: string, pos: number, front: number | null, extra: Partial<Lot> = {}): Lot => ({
  parid, pos, building: front != null, front, sideMin: 3, width: 25, area: 2500, stories: 2, units: 1, nonconform: [], ...extra,
});
const face = (n: number): score.BlockFaceRow => ({
  face_id: "pgh:1:L", street_name: "TEST ST", side: "L", zone_code: "R1D-M", district_front_ft: 30, n_lots: n, n_buildings: n,
  front_median_ft: null, n_nonconform: 0, nonconform_share: null, top_rules: null,
});
const R1D_M: score.PrecedentRules = { zoneCode: "R1D-M", min_front_setback_ft: 30, contextual_front_setback: true };

describe("block-face math", () => {
  it("quantiles match Postgres percentile_cont (linear interpolation)", () => {
    expect(score.median([4, 8, 6, 5])).toBe(5.5);
    expect(score.quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(score.quantile([10, 20], 0.75)).toBe(17.5);
    expect(score.median([])).toBeNull();
    expect(score.spread([7, 3, 5])).toEqual({ n: 3, median: 5, p25: 4, p75: 6, min: 3, max: 7 });
  });

  it("build-to line = smallest setback at least half the structures sit at or in front of", () => {
    expect(score.buildToLine([4, 5, 6, 30])).toBe(5); // 2 of 4 at <= 5
    expect(score.buildToLine([4, 5, 6, 30, 31])).toBe(6); // 3 of 5 at <= 6
    expect(score.buildToLine([12])).toBeNull(); // one building is not a block pattern
  });

  it("headline counts buildings closer than the code and leaves the subject lot out", () => {
    const lots = [lot("A", 0, 4), lot("B", 30, 5), lot("S", 60, 40), lot("C", 90, 8), lot("D", 120, 6), lot("E", 150, 35)];
    const p = score.streetPrecedent({ parid: "S", face: face(6), lots, zba: [] }, R1D_M)!;
    expect(p.nBuildings).toBe(5);
    expect(p.closerThanCode).toBe(4);
    expect(p.front).toMatchObject({ median: 6, p25: 5, p75: 8, min: 4, max: 35 });
    expect(p.headline).toBe("4 of 5 buildings on this block sit closer to the street than the 30 ft the code requires (most 5–8 ft from the front lot line).");
  });

  it("conformity share and top violated rules", () => {
    const lots = [lot("A", 0, 4, { nonconform: ["front_setback", "lot_area"] }), lot("B", 30, 5, { nonconform: ["front_setback"] }), lot("S", 60, null), lot("C", 90, 31)];
    const p = score.streetPrecedent({ parid: "S", face: face(4), lots, zba: [] }, R1D_M)!;
    expect(p.conformity).toEqual({ nonconforming: 2, withBuilding: 3, share: 0.667, topRules: [{ rule: "front_setback", n: 2 }, { rule: "lot_area", n: 1 }] });
  });
});

describe("§925.06.B contextual front setback", () => {
  it("adjacent lot sets the line when it is shallower than the block's build-to line", () => {
    const lots = [lot("A", 0, 12), lot("S", 30, null), lot("B", 60, 3.2), lot("C", 90, 10), lot("D", 120, 11)];
    const c = score.contextualFront("S", lots, R1D_M);
    expect(c.applies).toBe(true);
    expect(c.basis).toBe("adjacent");
    expect(c.ft).toBe(4); // 3.2 rounded UP to a whole foot
    expect(c.adjacentFt).toEqual([12, 3.2]);
  });

  it("block build-to line (50% of structures) when no adjacent building", () => {
    const lots = [lot("S", 0, null), lot("V", 30, null), lot("B", 60, 6), lot("C", 90, 7), lot("D", 120, 40)];
    const c = score.contextualFront("S", lots, R1D_M);
    expect(c).toMatchObject({ applies: true, basis: "block", ft: 7, buildToFt: 7 });
  });

  it("never more than the district setback; not when neighbors sit as far back as the code", () => {
    const lots = [lot("A", 0, 32), lot("S", 30, null), lot("B", 60, 45)];
    expect(score.contextualFront("S", lots, R1D_M)).toMatchObject({ applies: false, ft: null });
  });

  it("not in RIV districts, not where the district has no front setback, not without the district flag", () => {
    const lots = [lot("A", 0, 2), lot("S", 30, null), lot("B", 60, 2)];
    expect(score.contextualFront("S", lots, { ...R1D_M, zoneCode: "RIV-RM" }).applies).toBe(false);
    expect(score.contextualFront("S", lots, { ...R1D_M, min_front_setback_ft: 0 }).applies).toBe(false);
    expect(score.contextualFront("S", lots, { ...R1D_M, contextual_front_setback: false }).applies).toBe(false);
  });

  it("the lot's own building is not its own precedent", () => {
    const lots = [lot("S", 0, 1), lot("V", 30, null)];
    expect(score.contextualFront("S", lots, R1D_M).applies).toBe(false);
  });

  it("fit-test input: measured when it applies, district setback when it does not, undefined without data", () => {
    const yes = score.streetPrecedent({ parid: "S", face: face(3), lots: [lot("A", 0, 4), lot("S", 30, null), lot("B", 60, 5)], zba: [] }, R1D_M);
    const no = score.streetPrecedent({ parid: "S", face: face(3), lots: [lot("A", 0, 34), lot("S", 30, null), lot("B", 60, 35)], zba: [] }, R1D_M);
    expect(score.contextualInputFt(yes)).toBe(4);
    expect(score.contextualInputFt(no)).toBe(30);
    expect(score.contextualInputFt(null)).toBeUndefined();
  });
});

describe("§925.06 flip in the Ease Score (URA RM-M lot, 25 ft district front setback)", () => {
  type Fx = { facts: unknown; quickfitInput: unknown; easeInputs: unknown; zba: unknown };
  const fx = ura as Fx;
  const facts = fx.facts as ParcelFacts & { parid: string };
  const rules: score.PrecedentRules = { zoneCode: "RM-M", min_front_setback_ft: 25, contextual_front_setback: true };
  const run = (precedent: score.StreetPrecedent | null) => score.scoreParcel(fx.facts as ParcelFacts, {
    quickfitInput: fx.quickfitInput as score.QuickFitParcelInput, easeInputs: fx.easeInputs as score.EaseInputsRpc,
    zba: fx.zba as score.ScoreExtras["zba"], unlocks: false, precedent,
  });
  const fit = (r: score.EaseScoreResult, id: score.StrategyId) => (r.strategies.find((s) => s.strategy === id)!.factors.find((f) => f.id === "F1")!.inputs as Record<string, unknown>);
  const shallow = score.streetPrecedent({ parid: facts.parid, face: face(3), lots: [lot("A", 0, 4), lot(facts.parid, 30, null), lot("B", 60, 5), lot("C", 90, 6)], zba: [] }, rules);
  const deep = score.streetPrecedent({ parid: facts.parid, face: face(3), lots: [lot("A", 0, 27), lot(facts.parid, 30, null), lot("B", 60, 28)], zba: [] }, rules);

  it("neighbors at 4-5 ft: duplex flips from needs-variance to allowed by matching neighbors", () => {
    const withDeep = run(deep);
    const withShallow = run(shallow);
    expect(fit(withDeep, "duplex").fitStatus).toBe("variance");
    expect(fit(withShallow, "duplex").fitStatus).toBe("contextual");
    expect(fit(withShallow, "duplex")).toMatchObject({ contextualBasis: "measured", contextualFrontSetbackFt: 4 });
    const row = score.optionZoningPath(withShallow.strategies.find((s) => s.strategy === "duplex")!);
    expect(row.text).toContain("matching neighbors");
  });

  it("no block data keeps the config assumption, labeled assumed", () => {
    const r = run(null);
    expect(fit(r, "duplex")).toMatchObject({ fitStatus: "contextual", contextualBasis: "assumed" });
    expect(score.optionZoningPath(r.strategies.find((s) => s.strategy === "duplex")!).text).not.toContain("matching neighbors");
  });

  it("planning badge input: matches block pattern", () => {
    const r = run(shallow);
    const c = r.strategies.find((s) => s.strategy === "new_sf")!.planningBadge.criteria.find((x) => x.id === "matches_block_pattern")!;
    expect(c.matched).toBe(true);
    const tri = r.strategies.find((s) => s.strategy === "three_four_unit")!.planningBadge.criteria.find((x) => x.id === "matches_block_pattern")!;
    expect(tri.matched).toBe(false); // more units than any building on the block (all single-family)
    const none = run(null).strategies[0]!.planningBadge.criteria.find((x) => x.id === "matches_block_pattern")!;
    expect(none.matched).toBeNull();
  });
});

describe("Match the block lever (policy)", () => {
  const rules = { zone_code: "R1D-M", min_front_setback_ft: 30, min_side_setback_ft: 5, min_lot_area_sqft: 2400, single_unit_detached: "P" } as never;
  const block: policy.BlockPattern = { nBuildings: 8, frontMedianFt: 9.4, sideMinMedianFt: 2, lotAreaMedianSf: 2000 };
  const parcel = (over: Partial<policy.LeverParcel> = {}): policy.LeverParcel => ({ pgh: true, zoneCode: "R1D-M", rules, frontageFt: 25, transitM: null, block, ...over });
  const on = policy.normalize({ matchBlock: true });

  it("off by default; key mb round-trips", () => {
    expect(policy.eligibility(parcel(), policy.OFF)).toEqual([]);
    expect(policy.stateKey(on)).toBe("mb");
    expect(policy.parseKey("mb").matchBlock).toBe(true);
    expect(policy.applyLevers(parcel(), policy.OFF).rules).toBe(rules);
  });

  it("eligible on a residential lot with a measured block; rules relax to the block within tolerance", () => {
    expect(policy.eligibility(parcel(), on)).toEqual(["matchBlock"]);
    const r = policy.applyLevers(parcel(), on).rules!;
    expect(r.min_front_setback_ft).toBe(7); // floor(9.4 - 2)
    expect(r.min_side_setback_ft).toBe(3); // never under the 3 ft floor
    expect(r.min_lot_area_sqft).toBe(1800); // 90% of the block's median lot
  });

  it("not eligible: too few buildings, no block data, P district, non-residential, or nothing to relax", () => {
    expect(policy.eligibility(parcel({ block: { ...block, nBuildings: 2 } }), on)).toEqual([]);
    expect(policy.eligibility(parcel({ block: null }), on)).toEqual([]);
    expect(policy.eligibility(parcel({ zoneCode: "P" }), on)).toEqual([]);
    expect(policy.eligibility(parcel({ zoneCode: "LNC" }), on)).toEqual([]);
    expect(policy.eligibility(parcel({ block: { nBuildings: 8, frontMedianFt: 40, sideMinMedianFt: 8, lotAreaMedianSf: 9000 } }), on)).toEqual([]);
  });
});
