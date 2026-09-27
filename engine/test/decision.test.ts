import { describe, expect, it } from "vitest";
import { assumptions, finance } from "../src";

const { decisionBox, unitSellout, taxesAfterCompletion, criteriaFromQuery, bedroomsFor, DEFAULT_CRITERIA } = assumptions;

// A hand-checkable project (synthetic, not a real parcel): land $50,000, hard $400,000, no soft or
// contingency, 2 homes of 1,000 sq ft, sold for $300,000 each, seller's closing share 2.5%.
function fake(o: { ltc: number; rate: number; feeShare: number; land?: number; gross?: number; contingency?: number }): assumptions.ProFormaResult {
  const land = o.land ?? 50000;
  const forSale: finance.ForSaleInputs = {
    units: 2, grossSqFt: 2000, land, hardCost: 400000, softCostShareOfHard: 0, contingencyShareOfHard: 0,
    approvalMonths: 0, approvalDelayMonths: 0, constructionMonths: 12, constructionDelayMonths: 0, monthlyHoldingCost: 0,
    constructionLoanLtc: o.ltc, constructionRate: o.rate, averageDrawShare: 0.5, loanFees: 0, grants: [],
    sellingCostShare: 0.025, unitMix: [{ label: "Home", count: 2, salePrice: (o.gross ?? 600000) / 2 }],
  };
  const first = finance.developmentCosts(forSale);
  if (first.constructionLoan.status === "ok") forSale.loanFees = first.constructionLoan.value * o.feeShare;
  const fs = finance.forSaleProForma(forSale);
  const tdc = fs.costs.tdc.status === "ok" ? fs.costs.tdc.value : null;
  const gross = o.gross ?? 600000;
  const selling = gross * 0.025;
  const interest = fs.costs.constructionInterest.status === "ok" ? fs.costs.constructionInterest.value : 0;
  return {
    plan: {
      units: 2, finishedSf: 2000, tenure: "sale", strategy: "townhouse_row", missing: [], forSale, loanFeeShare: o.feeShare,
      land: { value: land, sourceLabel: "test", estimate: null, flag: null }, sources: { land: { label: "Test land price", asOf: null, kind: "user" } },
      shares: { contingency: o.contingency ?? 0.1 }, assumptions: [], sizeBasis: "test layout",
      revenue: { sale: { pricePerSf: 300, pricePerUnit: 300000, grossSales: gross, basis: "test comps", sourceLabel: "test" } },
      scheme: { footprints: [], parking: { spaces: 3 } }, assessedAfter: null,
    } as unknown as assumptions.DevelopmentPlan,
    forSale: fs,
    sale: { grossSales: gross, sellingCosts: selling, netSales: gross - selling, profit: tdc != null ? gross - selling - tdc : null, margin: null },
    tdc,
    budget: [{ id: "interest", group: "financing", label: "", amount: interest, basis: "", sourceLabel: "" }, { id: "loan_fees", group: "financing", label: "", amount: forSale.loanFees ?? 0, basis: "", sourceLabel: "" }],
    ranges: { sale: { pricePerSf: { low: 270, likely: 300, high: 330 } } },
  } as unknown as assumptions.ProFormaResult;
}

describe("decision box: break-even and residual land value (hand-checked)", () => {
  it("no loan (unlevered): every $1 of land is $1 of cost", () => {
    const d = decisionBox(fake({ ltc: 0, rate: 0, feeShare: 0 }));
    // TDC = 50,000 + 400,000 = 450,000; net = 600,000 − 15,000 = 585,000; profit 135,000 = 30% of cost.
    expect(d.levered).toBe(false);
    expect(d.tdc).toBe(450000);
    expect(d.netProceeds).toBe(585000);
    expect(d.profit).toBe(135000);
    expect(d.profitOnCost).toBeCloseTo(0.3, 10);
    expect(d.profitOnRevenue).toBeCloseTo(135000 / 600000, 10);
    // Price for 15%: 450,000 × 1.15 ÷ 0.975 = 530,769.23 → 265,384.62 a home, $265.38/sf.
    expect(d.breakEven.targetGross).toBeCloseTo(530769.2308, 3);
    expect(d.breakEven.perUnit).toBeCloseTo(265384.6154, 3);
    expect(d.breakEven.perSf).toBeCloseTo(265.3846, 3);
    // Zero profit: 450,000 ÷ 0.975 = 461,538.46.
    expect(d.breakEven.zeroPerUnit! * 2).toBeCloseTo(461538.4615, 3);
    // Most it can cost: 585,000 ÷ 1.15 = 508,695.65; headroom 58,695.65.
    expect(d.maxCost).toBeCloseTo(508695.6522, 3);
    expect(d.costReduction).toBeCloseTo(-58695.6522, 3);
    // Residual land value = 50,000 + 58,695.65 = 108,695.65.
    expect(d.residual.tdcPerLandDollar).toBeCloseTo(1, 10);
    expect(d.residual.value).toBeCloseTo(108695.6522, 3);
    expect(d.sentence).toBe("At $300/sf the project earns 30.0% on cost, at or above the 15% target. It keeps the target down to about $265/sf, with $59,000 of cost headroom, or a land price up to $109,000.");
  });

  it("with a loan: land carries loan interest and fees, so the residual is lower", () => {
    const r = fake({ ltc: 0.8, rate: 0.06, feeShare: 0.01 });
    const d = decisionBox(r);
    // Loan 0.8 × 450,000 = 360,000; interest 360,000 × 0.5 × 6% × 12/12 = 10,800; fee 3,600 → TDC 464,400.
    expect(d.tdc).toBeCloseTo(464400, 6);
    expect(d.financingCost).toBeCloseTo(14400, 6);
    expect(d.unleveredProfit).toBeCloseTo(135000, 6);
    // TDC per $1 of land = 1 + 0.8 × (0.5 × 0.06 × 12/12 + 0.01) = 1.032.
    expect(d.residual.tdcPerLandDollar).toBeCloseTo(1.032, 9);
    // RLV = 50,000 + (508,695.65 − 464,400) ÷ 1.032 = 92,922.14.
    expect(d.residual.value).toBeCloseTo(92922.1437, 3);
    // Check: at that land price the project costs exactly 585,000 ÷ 1.15.
    const at = decisionBox(fake({ ltc: 0.8, rate: 0.06, feeShare: 0.01, land: d.residual.value! }));
    expect(at.tdc).toBeCloseTo(508695.6522, 3);
    expect(at.profitOnCost).toBeCloseTo(0.15, 9);
    // Waterfall identity: sellout − selling − cost excluding land − target profit = residual land value.
    expect(600000 - 15000 - d.residual.costExLand! - d.residual.targetProfit!).toBeCloseTo(d.residual.value!, 6);
    // 75% max LTC: loan 337,500, equity 464,400 − 337,500 = 126,900; the budget's 80% is above it.
    expect(d.ltc.loanAtMax).toBe(338000);
    expect(d.ltc.above).toBe(true);
  });

  it("below the target: the sentence gives the price, cost cut and land price; negative residual stays negative", () => {
    const d = decisionBox(fake({ ltc: 0, rate: 0, feeShare: 0, gross: 480000 }));
    // Net 468,000; profit 18,000 = 4.0% on 450,000. Max cost 406,956.52 → cut 43,043.48; RLV 6,956.52.
    expect(d.profitOnCost).toBeCloseTo(0.04, 10);
    expect(d.costReduction).toBeCloseTo(43043.4783, 3);
    expect(d.residual.value).toBeCloseTo(6956.5217, 3);
    expect(d.sentence).toBe("At $240/sf the project earns 4.0% on cost vs. the 15% target. It reaches the target at about $265/sf, $43,000 lower cost, or a land price of $7,000.");
    const worse = decisionBox(fake({ ltc: 0, rate: 0, feeShare: 0, gross: 400000 }));
    // Net 390,000; max cost 339,130.43; RLV = 50,000 − 110,869.57 = −60,869.57.
    expect(worse.residual.value).toBeCloseTo(-60869.5652, 3);
    expect(worse.sentence).toContain("no land price gets there (residual land value −$61,000)");
  });

  it("criteria come from the URL in whole percents; the contingency check uses them", () => {
    const c = criteriaFromQuery({ dc_margin: "20", dc_cont: "12", dc_ltc: "bad" });
    expect(c).toEqual({ targetMargin: 0.2, minContingency: 0.12, maxLtc: DEFAULT_CRITERIA.maxLtc });
    const d = decisionBox(fake({ ltc: 0, rate: 0, feeShare: 0 }), c);
    expect(d.edited).toBe(true);
    expect(d.contingency.meets).toBe(false);
    expect(d.breakEven.targetGross).toBeCloseTo((450000 * 1.2) / 0.975, 6);
  });

  it("missing sale value: no numbers, a plain reason", () => {
    const r = fake({ ltc: 0, rate: 0, feeShare: 0 });
    const d = decisionBox({ ...r, sale: { ...r.sale, grossSales: null } });
    expect(d.profit).toBeNull();
    expect(d.residual.value).toBeNull();
    expect(d.missing).toMatch(/No sale value/);
  });
});

describe("unit-by-unit sellout", () => {
  it("equal homes: pro forma price, bedrooms by band, parking split, closings and carry to the last one", () => {
    const r = fake({ ltc: 0.8, rate: 0.06, feeShare: 0.01 });
    const u = unitSellout(r, { closingIntervalMonths: 2 })!;
    expect(u.rows.map((x) => x.price)).toEqual([300000, 300000]);
    expect(u.rows.map((x) => x.finishedSf)).toEqual([1000, 1000]);
    expect(u.rows.map((x) => x.bedrooms)).toEqual([bedroomsFor(1000), bedroomsFor(1000)]);
    expect(u.rows.map((x) => x.parking)).toEqual([2, 1]);
    expect(u.rows.map((x) => x.priceLow)).toEqual([270000, 270000]);
    const first = assumptions.COST_CONFIG.sale.salesMonths.value;
    expect(u.rows.map((x) => x.closingMonth)).toEqual([first, first + 2]);
    // Carry: 180,000 × 6% × (first + first + 2) ÷ 12.
    expect(u.carry!.interest).toBeCloseTo((180000 * 0.06 * (2 * first + 2)) / 12, 6);
    expect(u.total).toBe(600000);
  });
  it("bands: under 900 = 1, 900–1,299 = 2, 1,300–1,899 = 3, 1,900+ = 4", () => {
    expect([899, 900, 1299, 1300, 1899, 1900].map(bedroomsFor)).toEqual([1, 2, 2, 3, 3, 4]);
  });
});

describe("taxes after construction", () => {
  it("City: today's assessment and the completed-project assessment × the 2026 City millage", () => {
    const est = assumptions.assessedAfterCompletion({ value: 600000, isCity: true, attached: true, valueBasis: "(test)" })!;
    const r = fake({ ltc: 0, rate: 0, feeShare: 0 });
    const t = taxesAfterCompletion({ plan: { ...r.plan, assessedAfter: est }, isCity: true, generalMills: 24, assessedToday: 10000 });
    const mills = assumptions.COST_CONFIG.propertyTax.cityMills.value;
    expect(t.mills).toBe(mills);
    expect(t.taxToday).toBeCloseTo((10000 * mills) / 1000, 6);
    expect(t.taxAfter).toBeCloseTo((est.assessed * mills) / 1000, 6);
    expect(t.taxAfterPerUnit).toBeCloseTo(t.taxAfter! / 2, 6);
    expect(t.abatement).toMatch(/not modeled; check eligibility/);
  });
  it("suburb: the parcel's own millage", () => {
    const r = fake({ ltc: 0, rate: 0, feeShare: 0 });
    const t = taxesAfterCompletion({ plan: r.plan, isCity: false, generalMills: 24, assessedToday: 10000 });
    expect(t.mills).toBe(24);
    expect(t.taxToday).toBe(240);
    expect(t.taxAfter).toBeNull();
  });
});
