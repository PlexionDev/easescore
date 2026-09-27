import { describe, expect, it } from "vitest";
import * as policy from "../src/policy";
import { score, type ParcelFacts } from "../src";
import narrow from "./fixtures/score/narrow-through-lot-r1d-h.json";
import flat from "./fixtures/score/flat-vacant-r2-h.json";
import ura from "./fixtures/score/ura-lot-rm-m.json";
import hillside from "./fixtures/score/hillside-r1d-h.json";

// Engine sources as text, for the "no demographic variable" check (Vite inlines them at test time).
const SOURCES = import.meta.glob(["../src/policy/*.ts", "../src/score/*.ts", "../src/quickfit/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// Acceptance tests for the Policy Analyst seat (SEATS-BUILD-PLAN §4). Fixtures are the redacted score
// fixtures; no private parcel is used.

type Fixture = { facts: any; quickfitInput: any; easeInputs: any; zba: any };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const FIXTURES: [string, Fixture][] = [["narrow R1D-H", narrow], ["flat R2-H", flat], ["URA RM-M", ura], ["hillside R1D-H", hillside]] as any;

function parcelOf(fx: Fixture, over: Partial<policy.PolicyParcel> = {}): policy.PolicyParcel {
  const q = fx.quickfitInput;
  return {
    facts: clone(fx.facts), quickfitInput: clone(q), easeInputs: fx.easeInputs, zba: fx.zba, permitTimes: undefined,
    frontageFt: policy.lotWidthFt(q.parcel, score.frontEdgesFor(q).front[0]),
    assessed: { land: 20000, building: 0, total: 20000 },
    value: { p25: 270, p50: 305, p75: 377, n: 12, radiusMi: 1 },
    assessmentRatio: 0.489,
    ...over,
  };
}
const lp = (p: policy.PolicyParcel): policy.LeverParcel => policy.leverParcel(p);
const ALL_ON = policy.parseKey("a50.m0.pn.adu.cs.h1");

describe("lever state keys", () => {
  it("round-trips and normalizes", () => {
    expect(policy.stateKey(policy.OFF)).toBe("base");
    for (const k of ["a35", "m0", "m50", "pt", "pn", "a35.m0", "a35.m0.pn", "a40.m25.pt", "adu", "cs", "h1", "adu.cs.h1", "a35.m0.pn.adu.cs.h1"]) expect(policy.stateKey(policy.parseKey(k))).toBe(k);
    // A lever set to "no change" is off.
    expect(policy.stateKey(policy.normalize({ minLot: { on: true, share: 1 } }))).toBe("base");
    expect(policy.stateKey(policy.normalize({ attached: { on: true, maxWidthFt: 99 } }))).toBe("a50");
    expect(policy.stateKey(policy.normalize({ attached: { on: true, maxWidthFt: 37 }, minLot: { on: true, share: 0.4 } }))).toBe("a35.m50");
    // New levers keep a fixed order whatever order the key lists them in.
    expect(policy.stateKey(policy.parseKey("h1.cs.adu.m0"))).toBe("m0.adu.cs.h1");
    expect(policy.activeLevers(policy.parseKey("adu.cs.h1"))).toEqual(["adu", "contextual", "height"]);
  });
});

describe("all levers off == baseline exactly", () => {
  for (const [name, fx] of FIXTURES) {
    it(name, () => {
      const p = parcelOf(fx);
      const app = policy.applyLevers(lp(p), policy.OFF);
      expect(app.touched).toEqual([]);
      expect(app.rules).toBe(p.facts.zoning!.rules); // the very same row, untouched
      const base = score.scoreParcel(clone(fx.facts) as ParcelFacts, { quickfitInput: fx.quickfitInput, easeInputs: fx.easeInputs, zba: fx.zba, unlocks: false });
      const viaPolicy = policy.scoreWith(p, app.rules);
      expect(JSON.stringify(viaPolicy)).toBe(JSON.stringify(base));
      const o = policy.evaluateParcel(p, policy.OFF, base);
      expect(o.unitsDelta).toBe(0);
      expect(o.after).toEqual(o.before);
      expect(o.before.units).toBe(policy.byRightCapacity(base).units);
    });
  }
});

describe("each lever only touches eligible parcels", () => {
  const n = parcelOf(narrow as Fixture);
  const f = parcelOf(flat as Fixture);

  it("attached: R1D/R1A lots no wider than the slider, where two units are not already permitted", () => {
    expect(n.frontageFt).toBeGreaterThan(18);
    expect(n.frontageFt).toBeLessThan(25); // through lot: width is not double counted
    expect(policy.eligibility(lp(n), policy.parseKey("a35"))).toEqual(["attached"]);
    expect(policy.eligibility({ ...lp(n), frontageFt: 40 }, policy.parseKey("a35"))).toEqual([]);
    expect(policy.eligibility({ ...lp(n), frontageFt: 40 }, policy.parseKey("a40"))).toEqual(["attached"]);
    // R2 already permits two units by right: not eligible.
    expect(policy.eligibility({ ...lp(f), frontageFt: 20 }, policy.parseKey("a35"))).toEqual([]);
    const r = policy.applyLevers(lp(n), policy.parseKey("a35")).rules!;
    expect(r.two_unit).toBe("P");
    // Nothing else in the row moves.
    const orig = n.facts.zoning!.rules as unknown as Record<string, unknown>;
    for (const k of Object.keys(orig)) if (k !== "two_unit") expect((r as any)[k]).toEqual(orig[k]);
  });

  it("minimum lot size: only districts that have one; the rest of the row is untouched", () => {
    expect(policy.eligibility(lp(n), policy.parseKey("m0"))).toEqual(["minLot"]);
    const r = policy.applyLevers(lp(n), policy.parseKey("m50")).rules!;
    expect(r.min_lot_area_sqft).toBe(Math.round((n.facts.zoning!.rules as any).min_lot_area_sqft * 0.5));
    expect(policy.applyLevers(lp(n), policy.parseKey("m0")).rules!.min_lot_area_sqft).toBeNull();
    const none = { ...lp(n), rules: { ...(n.facts.zoning!.rules as any), min_lot_area_sqft: null, min_lot_area_per_unit_sqft: null } };
    expect(policy.eligibility(none, policy.parseKey("m0"))).toEqual([]);
  });

  it("parking: near-transit option only within a quarter mile of frequent transit", () => {
    expect(policy.eligibility({ ...lp(n), transitM: 300 }, policy.parseKey("pt"))).toEqual(["parking"]);
    expect(policy.eligibility({ ...lp(n), transitM: 900 }, policy.parseKey("pt"))).toEqual([]);
    expect(policy.eligibility({ ...lp(n), transitM: null }, policy.parseKey("pt"))).toEqual([]);
    expect(policy.eligibility({ ...lp(n), transitM: 900 }, policy.parseKey("pn"))).toEqual(["parking"]);
    const r = policy.applyLevers({ ...lp(n), transitM: 300 }, policy.parseKey("pt")).rules!;
    expect(r.parking_per_unit).toBe(0);
  });

  it("no lever applies outside the City, in parks (P), or without rules", () => {
    expect(policy.eligibility({ ...lp(n), pgh: false }, ALL_ON)).toEqual([]);
    expect(policy.eligibility({ ...lp(n), zoneCode: "P" }, ALL_ON)).toEqual([]);
    expect(policy.eligibility({ ...lp(n), rules: null }, ALL_ON)).toEqual([]);
  });

  it("an ineligible parcel is not rescored and keeps its baseline", () => {
    const p = parcelOf(flat as Fixture);
    const base = policy.scoreWith(p);
    const o = policy.evaluateParcel(p, policy.parseKey("a35"), base);
    expect(o.touched).toEqual([]);
    expect(o.after).toEqual(o.before);
    expect(o.unitsDelta).toBe(0);
  });

  it("a parcel's outcome depends only on the levers that apply to it", () => {
    const p = parcelOf(flat as Fixture);
    const base = policy.scoreWith(p);
    const s = policy.parseKey("a35.m0");
    const touched = policy.eligibility(lp(p), s);
    expect(touched).toEqual(["minLot"]);
    const a = policy.evaluateParcel(p, s, base);
    const b = policy.evaluateParcel(p, policy.restrict(s, touched), base);
    expect(a).toEqual(b);
  });

  it("removing the minimum lot size never lowers by-right capacity on the fixtures", () => {
    for (const [, fx] of FIXTURES) {
      const p = parcelOf(fx);
      const o = policy.evaluateParcel(p, policy.parseKey("m0"), policy.scoreWith(p));
      expect(o.unitsDelta).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("ADUs by right, contextual front setback, +1 story", () => {
  const n = parcelOf(narrow as Fixture);
  const f = parcelOf(flat as Fixture);
  const u = parcelOf(ura as Fixture);
  // A detached house on the flat R2-H lot (synthetic use and footprint; the outline is the fixture's).
  const house = parcelOf(flat as Fixture);
  Object.assign(house.facts.assessment!, { use: "SINGLE FAMILY" });
  (house.facts as any).building_footprint_sqft = 1100;
  const orig = (p: policy.PolicyParcel) => p.facts.zoning!.rules as unknown as Record<string, unknown>;

  it("all three off == baseline: the same row object, nothing touched", () => {
    for (const p of [n, f, u, house]) {
      const app = policy.applyLevers(lp(p), policy.parseKey("a35.m0.pn"));
      const app2 = policy.applyLevers(lp(p), policy.OFF);
      expect(app2.rules).toBe(p.facts.zoning!.rules);
      expect(app.touched.some((t) => ["adu", "contextual", "height"].includes(t))).toBe(false);
    }
  });

  it("ADU: only a detached single-family house in a residential district", () => {
    expect(policy.eligibility(lp(n), policy.parseKey("adu"))).toEqual(["adu"]); // SINGLE FAMILY, R1D-H
    expect(policy.eligibility(lp(house), policy.parseKey("adu"))).toEqual(["adu"]);
    expect(policy.eligibility(lp(f), policy.parseKey("adu"))).toEqual([]); // vacant land
    expect(policy.eligibility(lp(u), policy.parseKey("adu"))).toEqual([]); // no house
    expect(policy.eligibility({ ...lp(house), use: "ROWHOUSE" }, policy.parseKey("adu"))).toEqual([]);
    expect(policy.eligibility({ ...lp(house), use: "TWO FAMILY" }, policy.parseKey("adu"))).toEqual([]);
    expect(policy.eligibility({ ...lp(house), zoneCode: "GT-A" }, policy.parseKey("adu"))).toEqual([]); // not residential
    expect(policy.eligibility({ ...lp(house), zoneCode: "H" }, policy.parseKey("adu"))).toEqual([]);
    // The ADU never rewrites the rules row.
    expect(policy.applyLevers(lp(house), policy.parseKey("adu")).rules).toBe(house.facts.zoning!.rules);
  });

  it("ADU: +1 home per eligible lot; the low end only where the footprint proxy fits", () => {
    expect(n.frontageFt!).toBeLessThan(24); // 14 ft ADU + two 5 ft side yards does not fit
    expect(policy.aduFits(lp(n), n.facts.zoning!.rules as any)).toBe(false);
    expect(policy.aduFits(lp(house), house.facts.zoning!.rules as any)).toBe(true);
    expect(policy.aduFits({ ...lp(house), footprintSf: null }, house.facts.zoning!.rules as any)).toBe(false); // no house on record
    for (const [p, fits] of [[n, false], [house, true]] as const) {
      const base = policy.scoreWith(p);
      const o = policy.evaluateParcel(p, policy.parseKey("adu"), base);
      expect(o.touched).toEqual(["adu"]);
      expect(o.unitsDelta).toBe(1);
      expect(o.after.units).toBe((o.before.units ?? 0) + 1);
      expect(o.after.strategy).toBe(fits ? "adu" : "adu_unsized");
      expect(o.after.score).toBe(o.before.score); // not rescored
      if (!fits) expect(o.pencils!.low).toBe(false);
      if (o.pencils!.low) expect(o.pencils!.likely).toBe(true);
      if (o.pencils!.likely) expect(o.pencils!.high).toBe(true);
      expect(o.avDelta.low).toBeLessThanOrEqual(o.avDelta.likely);
      expect(o.avDelta.likely).toBeLessThanOrEqual(o.avDelta.high);
    }
  });

  it("ADU with a rebuild lever: the path with more homes wins, never both", () => {
    const base = policy.scoreWith(house);
    const both = policy.evaluateParcel(house, policy.parseKey("m0.adu"), base);
    const m0 = policy.evaluateParcel(house, policy.parseKey("m0"), base);
    expect(both.unitsDelta).toBe(Math.max(1, m0.unitsDelta));
  });

  it("contextual setback: residential districts whose front setback is deeper than the assumption; only that field moves", () => {
    expect(policy.CONTEXTUAL_FRONT_FT).toBe(5);
    expect(policy.eligibility(lp(n), policy.parseKey("cs"))).toEqual(["contextual"]); // R1D-H: 15 ft
    expect(policy.eligibility({ ...lp(n), rules: { ...(orig(n) as any), min_front_setback_ft: 5 } }, policy.parseKey("cs"))).toEqual([]);
    expect(policy.eligibility({ ...lp(n), zoneCode: "LNC" }, policy.parseKey("cs"))).toEqual([]);
    const r = policy.applyLevers(lp(n), policy.parseKey("cs")).rules as unknown as Record<string, unknown>;
    expect(r.min_front_setback_ft).toBe(5);
    for (const k of Object.keys(orig(n))) if (k !== "min_front_setback_ft") expect(r[k]).toEqual(orig(n)[k]);
    const o = policy.evaluateParcel(n, policy.parseKey("cs"), policy.scoreWith(n));
    expect(o.unitsDelta).toBeGreaterThanOrEqual(0);
  });

  it("+1 story: residential districts with a height limit; stories +1 and height +10 ft, nothing else", () => {
    expect(policy.eligibility(lp(u), policy.parseKey("h1"))).toEqual(["height"]); // RM-M
    expect(policy.eligibility({ ...lp(u), zoneCode: "UPR-B" }, policy.parseKey("h1"))).toEqual([]);
    expect(policy.eligibility({ ...lp(u), rules: { ...(orig(u) as any), max_height_ft: null, max_height_stories: null } }, policy.parseKey("h1"))).toEqual([]);
    const r = policy.applyLevers(lp(u), policy.parseKey("h1")).rules as unknown as Record<string, unknown>;
    expect(r.max_height_stories).toBe((orig(u).max_height_stories as number) + 1);
    expect(r.max_height_ft).toBe((orig(u).max_height_ft as number) + 10);
    for (const k of Object.keys(orig(u))) if (k !== "max_height_stories" && k !== "max_height_ft") expect(r[k]).toEqual(orig(u)[k]);
    for (const [, fx] of FIXTURES) {
      const p = parcelOf(fx);
      expect(policy.evaluateParcel(p, policy.parseKey("h1"), policy.scoreWith(p)).unitsDelta).toBeGreaterThanOrEqual(0);
    }
  });

  it("an outcome depends only on the levers that apply (memo key used by the batch)", () => {
    const s = policy.parseKey("a35.adu.cs.h1");
    const base = policy.scoreWith(house);
    const touched = policy.eligibility(lp(house), s);
    expect(touched).toEqual(["adu", "contextual", "height"]); // R2-H is not an attached-lever district
    expect(policy.evaluateParcel(house, s, base)).toEqual(policy.evaluateParcel(house, policy.restrict(s, touched), base));
  });
});

describe("fiscal math reproduces by hand (3 sample parcels)", () => {
  // Millage 2026 as stored: County 6.43, City 9.67, Pittsburgh Public Schools 10.25.
  const bodies: policy.TaxBody[] = [
    { id: "county", name: "Allegheny County", mills: 6.43, year: 2026, sourceUrl: "x" },
    { id: "municipality", name: "City of Pittsburgh", mills: 9.67, year: 2026, sourceUrl: "x" },
    { id: "school", name: "Pittsburgh Public Schools", mills: 10.25, year: 2026, sourceUrl: "x" },
  ];
  const samples = [
    // [sale value, assessment ratio, building replaced, expected added AV]
    { sale: 300000, ratio: 0.489, replaced: 0, av: 146700 },
    { sale: 620000, ratio: 0.489, replaced: 40000, av: 263180 },
    { sale: 250000, ratio: 0.392, replaced: 120000, av: 0 }, // replaced building worth more than the new value: no negative AV
  ];
  it("added assessed value", () => {
    for (const s of samples) expect(policy.assessedValueDelta(s.sale, s.ratio, s.replaced)).toBeCloseTo(s.av, 6);
  });
  it("revenue per body = AV x mills / 1000", () => {
    const total = samples.reduce((t, s) => t + s.av, 0); // 409,880
    expect(total).toBe(409880);
    const rows = policy.ledger({ low: total, likely: total, high: total }, bodies);
    expect(rows[0]!.revenue.likely).toBeCloseTo(2635.5284, 4); // 409,880 x 6.43 / 1000
    expect(rows[1]!.revenue.likely).toBeCloseTo(3963.5396, 4); // x 9.67 / 1000
    expect(rows[2]!.revenue.likely).toBeCloseTo(4201.27, 4); // x 10.25 / 1000
    expect(policy.totalRevenue(rows, "likely")).toBeCloseTo(10800.338, 3); // x 26.35 / 1000
  });
  it("abatement: forgone tax and break-even", () => {
    const rows = policy.ledger({ low: 100000, likely: 100000, high: 100000 }, bodies, { share: 1, years: 10 });
    expect(rows[0]!.abatementPerYear.likely).toBeCloseTo(643, 6);
    // 100% abated for 10 years: nothing collected until year 11; cost 6,430 recovered after 10 more years.
    expect(rows[0]!.breakEvenYear).toBe(20);
    const half = policy.ledger({ low: 100000, likely: 100000, high: 100000 }, bodies, { share: 0.5, years: 10 });
    expect(half[0]!.breakEvenYear).toBe(10); // collect 321.5/yr, forgo 321.5/yr for 10 yr: even at year 10
  });
});

describe("ranges are ordered low <= likely <= high", () => {
  it("pencil test, over a grid of inputs", () => {
    const b = policy.costBasis();
    for (const units of [1, 2, 4]) for (const psf of [150, 250, 305, 400, 600]) for (const acq of [0, 30000, 200000]) {
      const r = policy.pencilTest({ units, netSf: 1500 * units, grossSf: 1700 * units, acquisition: acq, value: { p25: psf * 0.85, p50: psf, p75: psf * 1.2, n: 9, radiusMi: 1 } }, b);
      expect(r.saleValue.low).toBeLessThanOrEqual(r.saleValue.likely);
      expect(r.saleValue.likely).toBeLessThanOrEqual(r.saleValue.high);
      expect(r.totalCost.low).toBeGreaterThanOrEqual(r.totalCost.likely);
      expect(r.totalCost.likely).toBeGreaterThanOrEqual(r.totalCost.high);
      expect(r.margin.low).toBeLessThanOrEqual(r.margin.likely);
      expect(r.margin.likely).toBeLessThanOrEqual(r.margin.high);
      if (r.pencils.low) expect(r.pencils.likely).toBe(true);
      if (r.pencils.likely) expect(r.pencils.high).toBe(true);
    }
  });
  it("cost basis comes from the pro forma config", () => {
    const b = policy.costBasis();
    expect(b.costPsf.low).toBeGreaterThanOrEqual(b.costPsf.likely);
    expect(b.costPsf.likely).toBeGreaterThanOrEqual(b.costPsf.high);
    expect(b.softShare.low).toBeGreaterThanOrEqual(b.softShare.likely);
    expect(b.softShare.likely).toBeGreaterThanOrEqual(b.softShare.high);
  });
  it("ledger revenue", () => {
    const rows = policy.ledger({ low: 1e6, likely: 2e6, high: 3e6 }, [{ id: "county", name: "C", mills: 6.43, year: 2026, sourceUrl: "" }]);
    expect(rows[0]!.revenue.low).toBeLessThanOrEqual(rows[0]!.revenue.likely);
    expect(rows[0]!.revenue.likely).toBeLessThanOrEqual(rows[0]!.revenue.high);
  });
});

describe("no demographic variable is used in capacity or scoring", () => {
  it("evaluating a parcel never reads census / demographic fields", () => {
    const p = parcelOf(narrow as Fixture);
    const touched: string[] = [];
    const trap = (label: string) => new Proxy({}, { get: (_t, k) => { touched.push(`${label}.${String(k)}`); return undefined; } });
    // Plant demographic data where a careless reader might look; any read is recorded.
    Object.assign(p.facts, { acs: trap("acs"), census: trap("census"), demographics: trap("demographics") });
    (p.facts as any).tract_designations = { ...(p.facts as any).tract_designations, median_income: trap("median_income") };
    const base = policy.scoreWith(p);
    policy.evaluateParcel(p, ALL_ON, base);
    expect(touched.filter((k) => !k.endsWith(".toJSON") && !k.includes("Symbol"))).toEqual([]);
  });
  it("the policy and score engine sources name no census demographic variable", () => {
    const banned = /\b(acs|B19013|B25003|B25064|B25070|B17001|median_household_income|median_hh_income|race|ethnicity|hispanic|nh_white|nh_black|poverty|renter_share|rent_burden)\b/i;
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    for (const [f, text] of Object.entries(SOURCES)) {
      const code = text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(banned.test(code), f).toBe(false);
    }
  });
});
