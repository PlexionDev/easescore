import { describe, expect, it } from "vitest";
import { score, type ParcelFacts } from "../src";
import parksPublic from "./fixtures/score/parks-public-city-lot.json";
import flat from "./fixtures/score/flat-vacant-r2-h.json";
import ura from "./fixtures/score/ura-lot-rm-m.json";

type Fixture = { facts: unknown; quickfitInput: unknown; easeInputs: unknown; zba: unknown };
const run = (fx: Fixture) =>
  score.scoreParcel(fx.facts as ParcelFacts, {
    quickfitInput: fx.quickfitInput as score.QuickFitParcelInput,
    easeInputs: fx.easeInputs as score.EaseInputsRpc,
    zba: fx.zba as score.ScoreExtras["zba"],
    unlocks: false,
  });
const strat = (r: score.EaseScoreResult, id: score.StrategyId) => r.strategies.find((s) => s.strategy === id)!;
const f1 = (s: score.StrategyResult) => s.factors.find((f) => f.id === "F1")!;

/** A hand-made result: only the fields rankOptions reads. */
function fake(rows: { id: score.StrategyId; score: number | null; code?: string; fit?: string; applicable?: boolean }[]): score.EaseScoreResult {
  return {
    parid: "X", configVersion: "0.2", best: null, unlocks: [], notes: [],
    strategies: rows.map((r) => ({
      strategy: r.id, strategyLabel: r.id, applicable: r.applicable ?? true, score: r.score, band: null, labels: [], evidenceShare: 1,
      redFlags: [], reviewCallouts: [], predictedMonthsToPermit: null, unlocks: [], units: null, notes: [], configVersion: "0.2",
      planningBadge: { status: "", points: 0, evaluatedWeight: 0, tier: null, criteria: [] },
      factors: [{ id: "F1", label: "Zoning permission", weight: 25, subscore: 50, evidence: "complete", partialCoverage: false, sources: [], dates: {}, oneLiner: "",
        inputs: { permissionCode: r.code ?? "P", fitStatus: r.fit ?? "by_right", ...(r.code === "N" ? { status: "not_allowed" } : {}) } }],
    })) as score.StrategyResult[],
  };
}

describe("per-option F1 from the use table", () => {
  it("public P-district lot (City-owned 0005B00021000000): single-family allowed, every multi-unit option not allowed at 0", () => {
    const r = run(parksPublic as Fixture);
    const sf = f1(strat(r, "new_sf"));
    expect(sf.inputs.permissionCode).toBe("P");
    expect(sf.subscore!).toBeGreaterThan(0);
    for (const id of ["duplex", "three_four_unit", "townhouse_row"] as const) {
      const f = f1(strat(r, id));
      expect(f.inputs.permissionCode).toBe("N");
      expect(f.inputs.status).toBe("not_allowed");
      expect(f.subscore).toBe(0);
      expect(score.optionZoningPath(strat(r, id))).toEqual({ kind: "not_allowed", text: "Not allowed here: would need a rezoning or a use variance (hard to get)" });
    }
    // Scores differ by option: single-family scores above every not-allowed option.
    for (const id of ["duplex", "three_four_unit", "townhouse_row"] as const) expect(strat(r, "new_sf").score!).toBeGreaterThan(strat(r, id).score!);
    // Ranked: not-allowed options sit below single-family whatever the money says.
    const rows = score.rankOptions(r, { new_sf: "no", duplex: "yes", three_four_unit: "yes", townhouse_row: "yes" });
    expect(rows[0]!.strategy).toBe("new_sf");
    expect(rows[0]!.leadLabel).toBe(score.LEAD_SUBSIDY);
    expect(rows.filter((x) => x.zoning.kind === "not_allowed").map((x) => x.strategy).sort()).toEqual(["duplex", "three_four_unit", "townhouse_row"]);
    // Vacant lot: no renovation row among the applicable options.
    expect(rows.find((x) => x.strategy === "rehab_existing")!.applicable).toBe(false);
    expect(rows.at(-1)!.applicable).toBe(false);
  });

  it("R2 lot: single-family and duplex both allowed, so their F1 matches the use table (P = 100 when they fit)", () => {
    const r = run(flat as Fixture);
    expect(f1(strat(r, "duplex")).inputs.permissionCode).toBe("P");
    expect(score.optionZoningPath(strat(r, "duplex")).kind).toBe("allowed");
  });

  it("URA RM-M lot: every option gets its own zoning path in words", () => {
    const r = run(ura as Fixture);
    const rows = score.rankOptions(r, {});
    for (const x of rows) expect(x.zoning.text.length).toBeGreaterThan(5);
    expect(new Set(rows.filter((x) => x.applicable).map((x) => x.name)).size).toBe(rows.filter((x) => x.applicable).length);
  });

  it("renovation reads as the existing building, no new zoning approval for interior work", () => {
    const r = fake([{ id: "rehab_existing", score: 70 }]);
    expect(score.optionZoningPath(r.strategies[0]!).text).toMatch(/^Existing building: no new zoning approval for interior work/);
  });
});

describe("ordering", () => {
  it("easiest option that pencils comes first, even when an easier one does not pencil", () => {
    const r = fake([{ id: "new_sf", score: 80 }, { id: "duplex", score: 70 }, { id: "three_four_unit", score: 60 }]);
    const rows = score.rankOptions(r, { new_sf: "no", duplex: "thin", three_four_unit: "yes" });
    expect(rows.map((x) => x.strategy)).toEqual(["duplex", "three_four_unit", "new_sf"]);
    expect(rows[0]!.leadLabel).toBe(score.LEAD_PENCILS);
    expect(rows.slice(1).every((x) => x.leadLabel === null)).toBe(true);
  });

  it("none pencil: easiest first, labeled 'needs subsidy or lower costs'", () => {
    const r = fake([{ id: "new_sf", score: 60 }, { id: "duplex", score: 75 }]);
    const rows = score.rankOptions(r, { new_sf: "no", duplex: "no" });
    expect(rows.map((x) => x.strategy)).toEqual(["duplex", "new_sf"]);
    expect(rows[0]!.leadLabel).toBe(score.LEAD_SUBSIDY);
  });

  it("an option that cannot be priced yet is never the best: it ranks after the priced options", () => {
    const r = fake([{ id: "rehab_existing", score: 85 }, { id: "new_sf", score: 60 }]);
    const rows = score.rankOptions(r, { rehab_existing: "pricing", new_sf: "no" });
    expect(rows[0]!.strategy).toBe("new_sf");
    expect(rows[0]!.evaluable).toBe(true);
    expect(rows[0]!.leadLabel).toBe(score.LEAD_SUBSIDY);
    expect(rows[1]!.strategy).toBe("rehab_existing");
    expect(rows[1]!.evaluable).toBe(false);
  });

  it("zoning not in our data (e.g. the ADU row): not evaluable, no lead label, even when it scores highest", () => {
    const r = fake([{ id: "adu", score: 95, code: "" }, { id: "new_sf", score: 60 }]);
    r.strategies[0]!.factors[0]!.subscore = null;
    const rows = score.rankOptions(r, { adu: "unknown", new_sf: "yes" });
    expect(rows.map((x) => x.strategy)).toEqual(["new_sf", "adu"]);
    expect(rows[1]!.evaluable).toBe(false);
    const none = score.rankOptions(fake([{ id: "adu", score: 95, code: "" }]), {});
    expect(none.some((x) => x.evaluable)).toBe(false);
    expect(none[0]!.leadLabel).toBeNull();
  });

  it("not-allowed and no-fit options rank below allowed ones even when they pencil; not-applicable last", () => {
    const r = fake([
      { id: "new_sf", score: 50 }, { id: "duplex", score: 90, code: "N" }, { id: "townhouse_row", score: 88, fit: "no_fit" },
      { id: "rehab_existing", score: null, applicable: false },
    ]);
    const rows = score.rankOptions(r, { new_sf: "no", duplex: "yes", townhouse_row: "yes" });
    expect(rows.map((x) => x.strategy)).toEqual(["new_sf", "duplex", "townhouse_row", "rehab_existing"]);
    expect(rows[0]!.leadLabel).toBe(score.LEAD_SUBSIDY);
    expect(rows[3]!.pencils).toBe("none");
  });

  it("ease and money stay separate: the row's score is the Ease Score unchanged by the verdict", () => {
    const r = fake([{ id: "new_sf", score: 64 }, { id: "duplex", score: 71 }]);
    const a = score.rankOptions(r, { new_sf: "yes", duplex: "no" });
    const b = score.rankOptions(r, { new_sf: "no", duplex: "yes" });
    expect(a.find((x) => x.strategy === "new_sf")!.score).toBe(64);
    expect(b.find((x) => x.strategy === "new_sf")!.score).toBe(64);
  });

  it("ties break on the config's strategy order; deterministic", () => {
    const r = fake([{ id: "new_sf", score: 70 }, { id: "duplex", score: 70 }]);
    expect(score.rankOptions(r, {}).map((x) => x.strategy)).toEqual(["new_sf", "duplex"]);
    expect(score.rankOptions(r, {})).toEqual(score.rankOptions(r, {}));
  });
});
