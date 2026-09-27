import { describe, expect, it } from "vitest";
import { affordable, score, type ParcelFacts } from "../src";
import flat from "./fixtures/score/flat-vacant-r2-h.json";
import ura from "./fixtures/score/ura-lot-rm-m.json";

// HUD FY2026 Income Limits, Pittsburgh HMFA, Allegheny County (hud_income_limits row, area 4200399999).
const ROW = {
  year: 2026, area_code: "4200399999", county_name: "Allegheny County, PA", median_income: "110400",
  il30_p1: "23200", il30_p2: "26500", il30_p3: "29800", il30_p4: "33100", il30_p5: "38680", il30_p6: "44360", il30_p7: "50040", il30_p8: "55720",
  il50_p1: "38650", il50_p2: "44200", il50_p3: "49700", il50_p4: "55200", il50_p5: "59650", il50_p6: "64050", il50_p7: "68450", il50_p8: "72900",
  il80_p1: "61850", il80_p2: "70650", il80_p3: "79500", il80_p4: "88300", il80_p5: "95400", il80_p6: "102450", il80_p7: "109500", il80_p8: "116600",
};
const IL = affordable.parseIncomeLimits(ROW)!;

// PHFA's published 2026 LIHTC maximum gross rents, Allegheny County (affordable_rent_limits, source 'phfa_lihtc').
const PHFA: Record<number, number[]> = {
  50: [966, 1035, 1242, 1435, 1601, 1766, 1932],
  60: [1159, 1242, 1491, 1722, 1921, 2120, 2319],
};

describe("income limits by household size", () => {
  it("returns HUD's published 30/50/80% limits exactly", () => {
    expect(affordable.incomeLimit(IL, 30, 1).value).toBe(23200);
    expect(affordable.incomeLimit(IL, 50, 3).value).toBe(49700);
    expect(affordable.incomeLimit(IL, 80, 4).value).toBe(88300);
    expect(affordable.incomeLimit(IL, 50, 8).value).toBe(72900);
  });
  it("derives 60% as 1.2 × the 50% limit (HUD MTSP)", () => {
    expect(affordable.incomeLimit(IL, 60, 3).value).toBe(59640);
    expect(affordable.incomeLimit(IL, 60, 1).value).toBe(46380);
  });
  it("rejects a row with a missing limit", () => {
    expect(affordable.parseIncomeLimits({ ...ROW, il50_p3: null })).toBeNull();
  });
});

describe("rent limits match HUD / PHFA tables", () => {
  for (const ami of [50, 60]) {
    for (let br = 0; br <= 6; br++) {
      it(`${ami}% AMI, ${br} bedrooms = $${PHFA[ami]![br]}`, () => {
        expect(affordable.rentLimit(IL, ami, br).grossRent).toBe(PHFA[ami]![br]);
      });
    }
  }
  it("subtracts the (labeled placeholder) utility allowance for the collected rent", () => {
    const r = affordable.rentLimit(IL, 60, 2);
    expect(r.netRent).toBe(r.grossRent - r.utilityAllowance);
    expect(r.utilitySource).toBe("Assumption");
  });
  it("30% rule by household: a family of 3 at 60% AMI", () => {
    const s = affordable.householdSentence(IL, 60, 3);
    expect(s.income).toBe(59640);
    expect(s.monthly).toBe(1491);
    expect(s.text).toContain("$1,491 a month");
  });
  it("income ladder rents rise with each band", () => {
    const l = affordable.incomeLadder(IL, 3);
    expect(l.map((x) => x.id)).toEqual(["le30", "30_50", "50_80", "80_100", "gt100"]);
    expect(l[0]!.affordableRent).toBe(Math.floor((29800 * 0.3) / 12));
    expect(l[3]!.incomeHigh).toBe(99350); // 110,400 × 0.9, to the nearest $50
    for (let i = 1; i < 4; i++) expect(l[i]!.affordableRent!).toBeGreaterThan(l[i - 1]!.affordableRent!);
  });
});

const ctx: affordable.ProjectContext = { tenure: "rent", qct: true, dda: false, allPublicLand: true, inCity: true, lots: 3, millsTotal: 26.51 };
const units = [{ count: 3, bedrooms: 2, amiPct: 50 }, { count: 3, bedrooms: 2, amiPct: 60 }];
const project: affordable.ProjectInput = { units, tdc: { low: 2_000_000, likely: 2_300_000, high: 2_600_000 }, land: { low: 15_000, likely: 20_000, high: 25_000 }, context: ctx };
const src = (id: string) => affordable.CAPITAL_CONFIG.sources.find((s) => s.id === id)!;
const statusOf = (id: string, p: Pick<affordable.ProjectInput, "units" | "context"> = project) => {
  const c = affordable.eligibility(src(id), p);
  return c.some((x) => x.status === "no") ? "no" : c.some((x) => x.status === "caution") ? "caution" : "ok";
};

describe("capital stack eligibility rules", () => {
  it("LIHTC: 60% AMI or below passes; QCT noted; small projects flagged, not blocked", () => {
    const c4 = affordable.eligibility(src("lihtc4"), project);
    expect(c4.some((x) => x.status === "ok" && /Qualified census tract/.test(x.text))).toBe(true);
    expect(statusOf("lihtc4")).toBe("caution");
    const c9 = affordable.eligibility(src("lihtc9"), project);
    expect(c9.some((x) => /too small to compete/.test(x.text))).toBe(true);
    expect(statusOf("lihtc4", { ...project, units: [{ count: 50, bedrooms: 2, amiPct: 60 }] })).toBe("ok");
  });
  it("LIHTC: units above 60% AMI block the source; for-sale blocks it", () => {
    expect(statusOf("lihtc9", { ...project, units: [{ count: 6, bedrooms: 2, amiPct: 80 }] })).toBe("no");
    expect(statusOf("lihtc4", { ...project, context: { ...ctx, tenure: "sale" } })).toBe("no");
  });
  it("HOME: at or below 80% AMI", () => {
    expect(statusOf("home")).toBe("ok");
    expect(statusOf("home", { ...project, units: [{ count: 6, bedrooms: 2, amiPct: 100 }] })).toBe("no");
  });
  it("Housing Opportunity Fund: City of Pittsburgh only", () => {
    expect(statusOf("hof")).toBe("ok");
    expect(statusOf("hof", { ...project, context: { ...ctx, inCity: false } })).toBe("no");
  });
  it("AHP: rentals need 20% of homes at or below 50% AMI", () => {
    expect(statusOf("ahp")).toBe("ok");
    expect(statusOf("ahp", { ...project, units: [{ count: 6, bedrooms: 2, amiPct: 60 }] })).toBe("no");
  });
  it("Land write-down: public lots only", () => {
    expect(statusOf("land")).toBe("ok");
    expect(statusOf("land", { ...project, context: { ...ctx, allPublicLand: false } })).toBe("no");
  });
  it("CDBG is flagged for new construction; abatement needs a tax rate", () => {
    expect(statusOf("cdbg")).toBe("caution");
    expect(statusOf("lerta", { ...project, context: { ...ctx, millsTotal: null } })).toBe("no");
  });
});

describe("funding gap", () => {
  const r = affordable.evaluateProject(project, IL, []);
  it("gap before sources = cost − supportable loan, as an ordered range", () => {
    expect(r.gapBefore.low).toBeLessThanOrEqual(r.gapBefore.likely);
    expect(r.gapBefore.likely).toBeLessThanOrEqual(r.gapBefore.high);
    expect(Math.abs(r.gapBefore.likely - (r.tdc.likely - r.debt.loan.likely))).toBeLessThanOrEqual(10_000);
    expect(r.remaining).toEqual(r.gapBefore);
  });
  it("switching sources on lowers the remaining gap, never below zero", () => {
    const on = affordable.evaluateProject(project, IL, ["lihtc4", "home", "land"]);
    expect(on.remaining.likely).toBeLessThan(r.remaining.likely);
    expect(on.remaining.low).toBeGreaterThanOrEqual(0);
    expect(on.enabled).toEqual(["lihtc4", "home", "land"]);
    const all = affordable.evaluateProject(project, IL, affordable.CAPITAL_CONFIG.sources.map((s) => s.id));
    expect(all.remaining.low).toBeGreaterThanOrEqual(0);
  });
  it("a flagged (!) source never closes the headline gap on its own: the firm gap counts only ✓ sources", () => {
    const on = affordable.evaluateProject(project, IL, ["lihtc4", "home", "land"]);
    expect(on.flagged).toEqual(["lihtc4"]);
    expect(on.firm.likely).toBeGreaterThan(on.remaining.likely);
    const ok = affordable.evaluateProject(project, IL, ["home", "land"]);
    expect(ok.flagged).toEqual([]);
    expect(ok.firm).toEqual(ok.remaining);
  });
  it("a tax abatement is not capital: never in the stack or the remaining gap, shown on its own", () => {
    const on = affordable.evaluateProject(project, IL, ["lerta"]);
    expect(on.enabled).toEqual([]);
    expect(on.remaining).toEqual(on.gapBefore);
    expect(on.sources.some((s) => s.id === "lerta")).toBe(false);
    expect(on.taxSavings?.id).toBe("lerta");
    expect(on.taxSavings!.amount.likely).toBeGreaterThan(0);
  });
  it("benchmarks are like-for-like: rental cost per home vs. local rental cost; for-sale subsidy vs. for-sale subsidy", () => {
    const rent = affordable.evaluateProject(project, IL, []);
    expect(rent.benchmark.compareLabel).toMatch(/Development cost per home/);
    expect(rent.benchmark.label).toMatch(/rental/);
    expect(rent.benchmark.compare.likely).toBeCloseTo(rent.tdc.likely / rent.units, -3);
    const sale = affordable.evaluateProject({ ...project, context: { ...ctx, tenure: "sale" }, units: [{ count: 6, bedrooms: 2, amiPct: 80 }] }, IL, []);
    expect(sale.benchmark.label).toMatch(/for-sale/);
    expect(sale.benchmark.compare).toEqual(sale.subsidyPerUnit);
  });
  it("a blocked source cannot be switched on", () => {
    const p = { ...project, context: { ...ctx, allPublicLand: false } };
    expect(affordable.evaluateProject(p, IL, ["land"]).enabled).toEqual([]);
  });
  it("supportable debt follows the mortgage constant", () => {
    expect(affordable.mortgageConstant(0.065, 35) * 12).toBeCloseTo(0.0725, 3);
    expect(r.debt.loan.low).toBeLessThanOrEqual(r.debt.loan.high);
  });
  it("every source is labeled typical, not an award", () => {
    expect(r.sources.every((s) => s.label2 === "Typical, not an award")).toBe(true);
  });
});

describe("no demographic variable feeds any parcel score", () => {
  const DEMOGRAPHIC = /\b(race|racial|ethnic\w*|hispanic|latino|black|white_alone|poverty|median_income|median_household_income|rent_burden\w*|renter_share|households_with_children|B19013|B25003|B25064|B25070|B17001|B02001|B03002|chas|acs)\b/i;
  it("the score code and config never mention a census demographic field", () => {
    const sources = {
      ...import.meta.glob<string>("../src/score/**/*.ts", { eager: true, query: "?raw", import: "default" }),
      ...import.meta.glob<string>("../config/ease-score.v0.2.json", { eager: true, query: "?raw", import: "default" }),
    };
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const hits = Object.entries(sources).flatMap(([p, text]) => text.split("\n").map((line, i) => ({ p, i, line })).filter((x) => DEMOGRAPHIC.test(x.line)));
    expect(hits.map((h) => `${h.p}:${h.i + 1}: ${h.line.trim()}`)).toEqual([]);
  });
  it("adding census demographics to a parcel's facts changes nothing in its score", () => {
    for (const fx of [flat, ura] as { facts: unknown; quickfitInput: unknown; easeInputs: unknown; zba: unknown }[]) {
      const extras = { quickfitInput: fx.quickfitInput as score.QuickFitParcelInput, easeInputs: fx.easeInputs as score.EaseInputsRpc, zba: fx.zba as score.ScoreExtras["zba"] };
      const base = score.scoreParcel(fx.facts as ParcelFacts, extras);
      const withDemo = {
        ...(fx.facts as object),
        tract: { median_income: 12000, rent_burden_30_pct: 90, poverty_pct: 60, race: { black: 0.9 } },
        acs: { B19013: 12000, B25070_30: 0.9 }, chas: { le30: 900 },
        median_income: 12000, rent_burden_30_pct: 90, poverty: 0.6,
      };
      const after = score.scoreParcel(withDemo as unknown as ParcelFacts, extras);
      expect(after.strategies.map((s) => [s.strategy, s.score, s.band])).toEqual(base.strategies.map((s) => [s.strategy, s.score, s.band]));
    }
  });
});
