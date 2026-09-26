import { describe, expect, it } from "vitest";
import { finance } from "../src";

type RentalInputs = finance.RentalInputs;
type ForSaleInputs = finance.ForSaleInputs;

// Test-only numbers (not defaults). Loan is a fixed amount so profit is linear in hard cost.
const FOR_SALE: ForSaleInputs = {
  units: 4,
  grossSqFt: 4000,
  land: 100_000,
  hardCost: 800_000,
  hardSiteLines: { grouting: 50_000 },
  softCostShareOfHard: 0.2,
  softSiteLines: { tapFees: 15_000 },
  contingencyShareOfHard: 0.1,
  approvalMonths: 3,
  approvalDelayMonths: 0,
  constructionMonths: 9,
  constructionDelayMonths: 0,
  monthlyHoldingCost: 1_000,
  constructionLoanAmount: 900_000,
  constructionRate: 0.08,
  averageDrawShare: 0.5,
  loanFees: 9_000,
  grants: [],
  discountRate: 0.1,
  unitMix: [{ label: "Townhouse", count: 4, salePrice: 400_000 }],
  sellingCostShare: 0.06,
  salesMonths: 4,
};

const RENTAL: RentalInputs = {
  ...FOR_SALE,
  unitMix: [
    { label: "Market 2BR", count: 3, monthlyRent: 2_500 },
    { label: "60% AMI 2BR", count: 1, monthlyRent: 1_200, amiShare: 0.6 },
  ],
  vacancyShare: 0.05,
  otherIncomeAnnual: 0,
  taxMills: 20,
  assessedValue: 800_000,
  propertyInsurance: 3_000,
  maintenance: 4_000,
  managementShareOfEgi: 0.08,
  ownerUtilities: 2_000,
  replacementReserves: 1_200,
  marketCapRate: 0.06,
  permanentLoanLtv: 0.7,
  permanentRate: 0.06,
  amortizationYears: 30,
  holdYears: 7,
  annualNoiGrowth: 0.02,
  exitCapRate: 0.065,
  exitSellingCostShare: 0.03,
};

const profit = (i: ForSaleInputs) => finance.forSaleProForma(i).sales.profit;
const leveredIrr = (i: RentalInputs) => finance.rentalProForma(i).returns.leveredIrr;

describe("scenarios", () => {
  it("resolve base plus overrides; missing scenarios resolve to null", () => {
    const set: finance.ScenarioSet<ForSaleInputs> = {
      base: { id: "base", name: finance.SCENARIO_LABELS.base, assumptions: FOR_SALE },
      conservative: { id: "conservative", name: "Conservative", assumptions: { constructionDelayMonths: 6 } },
    };
    const c = finance.resolveScenario(set, "conservative")!;
    expect(c.constructionDelayMonths).toBe(6);
    expect(c.land).toBe(FOR_SALE.land);
    expect(finance.resolveScenario(set, "optimistic")).toBeNull();
    expect(profit(c).value!).toBeLessThan(profit(FOR_SALE).value!);
  });

  it("ship with names only, no numeric assumptions", () => {
    expect(Object.values(finance.SCENARIO_LABELS)).toEqual(["Base", "Conservative", "Optimistic"]);
  });
});

describe("sensitivity", () => {
  it("one-variable sweep: profit falls as hard cost rises", () => {
    const pts = finance.sweep(FOR_SALE, finance.hardCostChange<ForSaleInputs>(), [-0.1, 0, 0.1, 0.2], profit);
    expect(pts.map((p) => p.status)).toEqual(["ok", "ok", "ok", "ok"]);
    for (let k = 1; k < pts.length; k++) expect(pts[k]!.value!).toBeLessThan(pts[k - 1]!.value!);
    expect(pts[1]!.value).toBeCloseTo(profit(FOR_SALE).value!, 9);
  });

  it("sweep of a missing input stays missing", () => {
    const pts = finance.sweep({ ...FOR_SALE, land: undefined }, finance.scaleField<ForSaleInputs>("land", "Land"), [0.1], profit);
    expect(pts[0]).toEqual({ x: 0.1, value: null, status: "insufficient evidence" });
  });

  it("tornado ranks the input that moves levered IRR most first", () => {
    const { base, rows } = finance.tornado(
      RENTAL,
      [
        { variable: finance.scaleField<RentalInputs>("monthlyHoldingCost", "Holding cost"), low: -0.1, high: 0.1 },
        { variable: finance.rentChange<RentalInputs>(), low: -0.1, high: 0.1 },
        { variable: finance.shiftField<RentalInputs>("exitCapRate", "Exit cap rate", "rate added"), low: -0.005, high: 0.005 },
      ],
      leveredIrr,
    );
    expect(base.status).toBe("ok");
    expect(rows.map((r) => r.id)).toEqual(["rent:scale", "exitCapRate:shift", "monthlyHoldingCost:scale"]);
    for (let k = 1; k < rows.length; k++) expect(rows[k]!.swing!).toBeLessThanOrEqual(rows[k - 1]!.swing!);
  });
});

describe("break-even solvers (bisection)", () => {
  it("hard-cost increase at which profit = 0 matches the closed form", () => {
    // Profit(x) = 1,504,000 − [land + H(1+x)(1 + 0.2 + 0.1) + 15,000 + fixed financing], H = 850,000
    // fixed financing = 900,000 × 0.5 × 0.08 × 9/12 + 9,000 + 12 × 1,000 = 48,000
    const H = 850_000;
    const expected = (1_504_000 - 100_000 - 15_000 - 48_000) / (H * 1.3) - 1;
    const r = finance.breakEvenCostIncrease(FOR_SALE);
    expect(r.status).toBe("ok");
    expect(r.value!).toBeCloseTo(expected, 8);
    const atBreakEven = finance.hardCostChange<ForSaleInputs>().apply(FOR_SALE, r.value!);
    expect(profit(atBreakEven).value!).toBeCloseTo(0, 3);
  });

  it("break-even rent makes NPV zero", () => {
    const r = finance.breakEvenRent(RENTAL, "unlevered");
    expect(r.status).toBe("ok");
    const avg = (3 * 2_500 + 1_200) / 4;
    const scale = r.value! / avg - 1;
    const atBreakEven = finance.rentChange<RentalInputs>().apply(RENTAL, scale);
    expect(finance.rentalProForma(atBreakEven).returns.unleveredNpv.value!).toBeCloseTo(0, 2);
  });

  it("break-even needs its inputs too", () => {
    const r = finance.breakEvenCostIncrease({ ...FOR_SALE, sellingCostShare: undefined });
    expect(r).toMatchObject({ value: null, status: "insufficient evidence", missing: ["sellingCostShare"] });
  });

  it("reports not computable when the metric never crosses zero", () => {
    const r = finance.breakEven(
      FOR_SALE,
      finance.scaleField<ForSaleInputs>("land", "Land"),
      () => ({ status: "ok", value: 1, label: "always positive", formula: "1", inputs: {} }),
      -1,
      1,
      "never",
    );
    expect(r.status).toBe("not computable");
  });
});
