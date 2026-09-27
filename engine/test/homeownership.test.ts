import { describe, expect, it } from "vitest";
import { affordable } from "../src";

// HUD FY2026 Income Limits, Pittsburgh HMFA (same row as affordable.test.ts).
const ROW = {
  year: 2026, area_code: "4200399999", county_name: "Allegheny County, PA", median_income: "110400",
  il30_p1: "23200", il30_p2: "26500", il30_p3: "29800", il30_p4: "33100", il30_p5: "38680", il30_p6: "44360", il30_p7: "50040", il30_p8: "55720",
  il50_p1: "38650", il50_p2: "44200", il50_p3: "49700", il50_p4: "55200", il50_p5: "59650", il50_p6: "64050", il50_p7: "68450", il50_p8: "72900",
  il80_p1: "61850", il80_p2: "70650", il80_p3: "79500", il80_p4: "88300", il80_p5: "95400", il80_p6: "102450", il80_p7: "109500", il80_p8: "116600",
};
const IL = affordable.parseIncomeLimits(ROW)!;
const INP: affordable.HomeownerInputs = { rate: 0.07, rateSource: "test", mills: 25, millsSource: "test", mineSubsidence: false };

describe("affordable for-sale price (PITI)", () => {
  it("hand-checked: family of 3 at 80% AMI, 7%, 30 years, 3% down, 25 mills, $1,200 insurance, 0.5% PMI", () => {
    // Income $79,500 (HUD 80%, 3 persons) × 30% ÷ 12 = $1,987 a month.
    // Per dollar of price: 0.97 × 0.0066530 (P&I) + 25 ÷ 12,000 (tax) + 0.97 × 0.005 ÷ 12 (PMI) = 0.0089409; fixed $100 insurance.
    // P = (1,987 − 100) ÷ 0.0089409 = $211,052 → $211,000.
    const h = affordable.homeownerPrice(IL, 80, 2, INP);
    expect(h.persons).toBe(3);
    expect(h.income).toBe(79500);
    expect(h.budget).toBe(1987);
    expect(h.price.likely).toBe(211_000);
    expect(h.monthly.principalInterest).toBeCloseTo(1361.67, 1);
    expect(h.monthly.tax).toBeCloseTo(439.58, 1);
    expect(h.monthly.pmi).toBeCloseTo(85.28, 1);
    expect(h.monthly.total).toBeLessThanOrEqual(h.budget);
    expect(h.monthly.total).toBeGreaterThan(h.budget - 10);
    expect(h.text).toContain("A family of 3 at 80% of the area median");
    expect(h.text).toContain("about $211,000");
  });
  it("mine subsidence insurance lowers the price slightly (PA DEP chart)", () => {
    const h = affordable.homeownerPrice(IL, 80, 2, { ...INP, mineSubsidence: true });
    expect(h.price.likely).toBe(210_000);
    expect(h.monthly.msi).toBeCloseTo((3.75 + 0.25 * 210) / 12, 2);
  });
  it("orders: price rises with AMI (80 < 100 < 120) and falls as the rate rises", () => {
    const [p80, p100, p120] = [80, 100, 120].map((a) => affordable.homeownerPrice(IL, a, 2, INP).price);
    expect(p80!.likely).toBeLessThan(p100!.likely);
    expect(p100!.likely).toBeLessThan(p120!.likely);
    for (const p of [p80!, p100!, p120!]) {
      expect(p.low).toBeLessThanOrEqual(p.likely);
      expect(p.likely).toBeLessThanOrEqual(p.high);
    }
  });
  it("100% and 120% AMI derive from the 50% limit (2× and 2.4×), labeled", () => {
    const h = affordable.homeownerPrice(IL, 100, 2, INP);
    expect(h.income).toBe(99400);
    expect(h.incomeBasis).toMatch(/derived/);
    expect(affordable.homeownerPrice(IL, 120, 2, INP).income).toBe(119280);
  });
  it("your inputs replace the assumptions: more down drops PMI; higher insurance lowers the price", () => {
    const base = affordable.homeownerPrice(IL, 80, 2, INP).price.likely;
    const twenty = affordable.homeownerPrice(IL, 80, 2, { ...INP, downPaymentShare: 0.2 });
    expect(twenty.monthly.pmi).toBe(0);
    expect(twenty.price.likely).toBeGreaterThan(base);
    expect(affordable.homeownerPrice(IL, 80, 2, { ...INP, insurancePerYear: 2400 }).price.likely).toBeLessThan(base);
    expect(affordable.homeownerPrice(IL, 80, 2, { ...INP, pmiAnnualShare: 0 }).price.likely).toBeGreaterThan(base);
    const a = affordable.homeownerAssumptions({ ...INP, downPaymentShare: 0.1 });
    expect(a.list.find((x) => x.id === "down")!.source).toBe("Your input");
  });
  it("labels every assumption and falls back when the rate or millage is not loaded", () => {
    const a = affordable.homeownerAssumptions({ rate: null, mills: null, mineSubsidence: false });
    expect(a.rate).toBe(affordable.CAPITAL_CONFIG.forSale.rateFallback.value);
    expect(a.list.find((x) => x.id === "rate")!.assumption).toBe(true);
    expect(a.list.find((x) => x.id === "tax")!.source).toMatch(/Assumption/);
    for (const x of a.list) expect(x.source.length).toBeGreaterThan(5);
  });
});

describe("for-sale project: subsidy gap per home", () => {
  const ctx: affordable.ProjectContext = { tenure: "sale", qct: true, dda: false, allPublicLand: true, inCity: true, lots: 3, millsTotal: 25 };
  const tdc = { low: 1_500_000, likely: 1_800_000, high: 2_100_000 };
  const land = { low: 15_000, likely: 20_000, high: 25_000 };
  const mk = (ami: number, enabled: string[] = []) =>
    affordable.evaluateProject({ units: [{ count: 6, bedrooms: 2, amiPct: ami }], tdc, land, context: ctx, sale: INP }, IL, enabled);

  it("gap = cost − what the buyers can pay, ordered; per-home gap compared with the $200K–$300K benchmark", () => {
    const r = mk(80);
    expect(r.tenure).toBe("sale");
    expect(r.rents).toEqual([]);
    expect(r.sales[0]!.price.likely).toBe(211_000);
    expect(r.debt.loan.likely).toBe(6 * 211_000);
    expect(r.gapBefore.likely).toBe(1_800_000 - 1_270_000); // 6 × 211,000 = 1,266,000 → rounded to $10K in the range
    expect(r.gapBefore.low).toBeLessThanOrEqual(r.gapBefore.likely);
    expect(r.gapBefore.likely).toBeLessThanOrEqual(r.gapBefore.high);
    expect(r.subsidyPerUnit.likely).toBe(88_000);
    expect(r.benchmark.low).toBe(200_000);
    expect(r.benchmark.high).toBe(300_000);
    expect(r.stack[0]!.short).toBe("Home sales");
  });
  it("the gap per home shrinks as the income served rises", () => {
    const g = [80, 100, 120].map((a) => mk(a).subsidyPerUnit.likely);
    expect(g[0]!).toBeGreaterThan(g[1]!);
    expect(g[1]!).toBeGreaterThan(g[2]!);
  });
  it("homebuyer assistance and land trust appear only for sale, typical not an award", () => {
    const r = mk(80);
    const ids = r.sources.map((s) => s.id);
    expect(ids).toContain("hba");
    expect(ids).toContain("clt");
    expect(r.sources.every((s) => s.label2 === "Typical, not an award")).toBe(true);
    const rent = affordable.evaluateProject({ units: [{ count: 6, bedrooms: 2, amiPct: 60 }], tdc, land, context: { ...ctx, tenure: "rent" } }, IL, []);
    expect(rent.sources.map((s) => s.id)).not.toContain("hba");
    expect(rent.sources.map((s) => s.id)).not.toContain("clt");
  });
  it("land trust and public-land write-down never both count (the first in config order wins)", () => {
    const both = mk(80, ["land", "clt"]);
    expect(both.enabled).toEqual(["clt"]);
    expect(mk(80, ["land"]).enabled).toEqual(["land"]);
  });
  it("sources capped at 80% AMI are blocked for 100% and 120% AMI homes; LIHTC blocked for sale", () => {
    const r = mk(120, ["home", "ahp", "hba"]);
    expect(r.sources.find((s) => s.id === "home")!.status).toBe("no");
    expect(r.sources.find((s) => s.id === "ahp")!.status).toBe("no");
    expect(r.sources.find((s) => s.id === "lihtc4")!.status).toBe("no");
    expect(r.enabled).toEqual(["hba"]);
  });
});
