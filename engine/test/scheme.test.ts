import { describe, expect, it } from "vitest";
import { assumptions, narrative, score, type ParcelFacts } from "../src";
import flat from "./fixtures/score/flat-vacant-r2-h.json";
import steep from "./fixtures/score/steep-landslide-r1d-h.json";
import ura from "./fixtures/score/ura-lot-rm-m.json";

// One scheme everywhere: the score's fit, the pro forma's units / floor area and the summary's
// by-right option must all describe the same QuickFit scheme.
type Fx = { facts: unknown; quickfitInput: unknown; easeInputs: unknown; zba: unknown; comps?: unknown; rent?: unknown };
const FIXTURES: [string, Fx][] = [["flat lot", flat as Fx], ["steep lot", steep as Fx], ["URA lot 0011A00151000000", ura as unknown as Fx]];

function run(fx: Fx) {
  const facts = fx.facts as ParcelFacts & Record<string, any>;
  const r = score.scoreParcel(facts, {
    quickfitInput: fx.quickfitInput as score.QuickFitParcelInput, easeInputs: fx.easeInputs as score.EaseInputsRpc,
    zba: fx.zba as score.ScoreExtras["zba"], unlocks: false,
  });
  return { facts, r };
}

function planFor(fx: Fx, facts: any, r: score.EaseScoreResult, s: score.StrategyResult, overrides: assumptions.CostOverrides = {}) {
  const selected = score.selectScheme({
    strategy: s.strategy, scheme: r.schemes?.[s.strategy] ?? null, result: s,
    existing: { livingAreaSqft: facts.assessment?.living_area_sqft ?? null, use: facts.assessment?.use ?? null }, overrides,
  });
  const plan = assumptions.buildDevelopmentInputs({
    strategy: s.strategy, facts, scheme: null, selected, comps: (fx.comps ?? null) as assumptions.SalesCompsLike | null,
    newComps: null, rents: (fx.rent ?? null) as assumptions.RentCompsLike | null, permitMonths: s.predictedMonthsToPermit?.months ?? null,
    overrides: { ...overrides, salePricePerSf: 300 },
  });
  return { selected, plan, pf: assumptions.evaluateDevelopment(plan) };
}

describe.each(FIXTURES)("one scheme everywhere: %s", (_name, fx) => {
  const { facts, r } = run(fx);
  const newBuilds = r.strategies.filter((s) => score.NEW_BUILD.includes(s.strategy) && s.applicable && s.units != null && s.units > 0);

  it("has at least one sized new-build option", () => expect(newBuilds.length).toBeGreaterThan(0));

  it.each(score.NEW_BUILD)("%s: score fit, SelectedScheme and pro forma name the same scheme", (id) => {
    const s = r.strategies.find((x) => x.strategy === id)!;
    if (!s.applicable || !s.units) return;
    const f1 = s.factors.find((f) => f.id === "F1")!.inputs as { fitStatus?: string; varianceRules?: string[]; units?: number };
    const { selected, plan } = planFor(fx, facts, r, s);
    expect(s.schemeId).toBeTruthy();
    expect(selected.schemeId).toBe(s.schemeId);
    expect(r.schemes?.[id]?.id).toBe(s.schemeId);
    expect(selected.units).toBe(s.units);
    expect(f1.units).toBe(s.units);
    expect(selected.path).toBe(f1.fitStatus);
    expect(selected.variancesNeeded).toEqual(f1.varianceRules ?? []);
    expect(selected.footprints.length).toBe(r.schemes![id]!.footprints.length);
    expect(plan.scheme).toBe(selected);
    expect(plan.units).toBe(selected.units);
    expect(plan.finishedSf).toBe(selected.finishedSf);
    // Older callers that pass the raw scheme get the same size.
    const legacy = assumptions.buildDevelopmentInputs({ strategy: id, facts, scheme: r.schemes![id]!, comps: null, rents: null });
    expect(legacy.units).toBe(plan.units);
    expect(legacy.finishedSf).toBe(plan.finishedSf);
    expect(legacy.scheme.schemeId).toBe(s.schemeId);
  });

  it("the summary's by-right option is the scored scheme and the priced scheme", () => {
    const zba = (fx.zba as { by_relief?: Record<string, score.ZbaReliefCounts> } | null)?.by_relief ?? null;
    const options = r.strategies.flatMap((s) => {
      const c = narrative.classifyPlan(s, zba);
      if (!c) return [];
      const { plan, pf } = planFor(fx, facts, r, s);
      return [{ ...c, strategy: s, plan, units: plan.units ?? s.units, value: pf.sale.profit }];
    });
    const { byRight, withApproval } = narrative.pickPlans(options);
    for (const o of [byRight, withApproval]) {
      if (!o) continue;
      expect(o.schemeId).toBe(o.strategy.schemeId);
      expect(o.plan.scheme.schemeId).toBe(o.strategy.schemeId);
      expect(o.units).toBe(o.strategy.units);
    }
    if (byRight) {
      const f1 = byRight.strategy.factors.find((f) => f.id === "F1")!.inputs as { fitStatus?: string };
      expect(["by_right", "contextual", "existing"]).toContain(f1.fitStatus);
      expect(byRight.plan.scheme.path).toBe(f1.fitStatus);
    }
  });

  it("user program edits change the one scheme, not a second copy", () => {
    const s = newBuilds[0]!;
    const { selected, plan } = planFor(fx, facts, r, s, { units: (s.units ?? 1) + 1 });
    expect(selected.schemeId).toBe(s.schemeId);
    expect(selected.overridden).toBe(true);
    expect(plan.units).toBe((s.units ?? 1) + 1);
    expect(plan.finishedSf).toBe(selected.finishedSf);
  });
});
