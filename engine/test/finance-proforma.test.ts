/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { finance } from "../src";

type RentalInputs = finance.RentalInputs;
type ForSaleInputs = finance.ForSaleInputs;
type Receipt = finance.Receipt;

// Test-only numbers chosen to be easy to check by hand. They are not defaults and not market data.
const DEV: finance.DevelopmentInputs = {
  units: 4,
  grossSqFt: 4000,
  land: 100_000,
  hardCostPerSqFt: 200, // 800,000
  hardSiteLines: { demolition: 20_000, grouting: 30_000 }, // hard = 850,000
  softCostShareOfHard: 0.2, // 170,000
  softSiteLines: { geotechnical: 5_000, tapFees: 10_000 }, // soft = 185,000
  contingencyShareOfHard: 0.1, // 85,000 → cost before financing 1,220,000
  approvalMonths: 3,
  approvalDelayMonths: 0,
  constructionMonths: 9,
  constructionDelayMonths: 0,
  monthlyHoldingCost: 1_000, // × 12 = 12,000
  constructionLoanLtc: 0.75, // 915,000
  constructionRate: 0.08,
  averageDrawShare: 0.5, // interest = 915,000 × 0.5 × 0.08 × 9 / 12 = 27,450
  loanFees: 9_150, // financing = 27,450 + 9,150 + 12,000 = 48,600 → TDC 1,268,600
  grants: [],
  discountRate: 0.1,
};

const RENTAL: RentalInputs = {
  ...DEV,
  unitMix: [{ label: "2BR", count: 4, monthlyRent: 2_500 }], // GPR 120,000
  vacancyShare: 0.05, // 6,000 → EGI 114,000
  otherIncomeAnnual: 0,
  taxMills: 20,
  assessedValue: 800_000, // taxes 16,000
  propertyInsurance: 3_000,
  opexLines: { floodInsurance: 1_000, mineSubsidenceInsurance: 128.75 }, // MSI on $500,000
  maintenance: 4_000,
  managementShareOfEgi: 0.08, // 9,120
  ownerUtilities: 2_000,
  replacementReserves: 1_200, // OPEX 36,448.75 → NOI 77,551.25
  marketCapRate: 0.06,
  permanentLoanAmount: 900_000,
  permanentRate: 0.06,
  amortizationYears: 30,
  holdYears: 5,
  annualNoiGrowth: 0.02,
  exitCapRate: 0.065,
  exitSellingCostShare: 0.03,
};

const FOR_SALE: ForSaleInputs = {
  ...DEV,
  unitMix: [{ label: "Townhouse", count: 4, salePrice: 400_000 }], // 1,600,000
  sellingCostShare: 0.06, // 96,000
  salesMonths: 4,
};

/** Every Receipt in a nested result object. */
function receipts(x: unknown, out: Receipt[] = []): Receipt[] {
  if (finance.isReceipt(x)) out.push(x);
  else if (x && typeof x === "object" && !Array.isArray(x)) for (const v of Object.values(x)) receipts(v, out);
  return out;
}

describe("costs (CAPEX / TDC)", () => {
  const c = finance.developmentCosts(DEV);

  it("adds land + hard + soft + financing + contingency", () => {
    expect(c.hard.value).toBe(850_000);
    expect(c.soft.value).toBe(185_000);
    expect(c.contingency.value).toBe(85_000);
    expect(c.costBeforeFinancing.value).toBe(1_220_000);
    expect(c.constructionLoan.value).toBe(915_000);
    expect(c.constructionInterest.value).toBeCloseTo(27_450, 6);
    expect(c.holdingCosts.value).toBe(12_000);
    expect(c.financing.value).toBeCloseTo(48_600, 6);
    expect(c.tdc.value).toBeCloseTo(1_268_600, 6);
    expect(c.capex.value).toBe(c.tdc.value);
    expect(c.costPerUnit.value).toBeCloseTo(317_150, 6);
    expect(c.costPerSqFt.value).toBeCloseTo(317.15, 6);
  });

  it("labels put plain language first and the acronym second", () => {
    expect(c.tdc.label).toBe("Total development cost (TDC)");
    expect(c.tdc.formula).toBe("land + hard + soft + financing + contingency");
    expect(Object.keys(c.tdc.inputs)).toEqual(["land", "hard", "soft", "financing", "contingency"]);
  });

  it("names Pittsburgh site lines in the receipt", () => {
    expect(c.hardSiteLines.inputs).toEqual({ "hardSiteLines.demolition": 20_000, "hardSiteLines.grouting": 30_000 });
    expect(c.softSiteLines.inputs).toEqual({ "softSiteLines.geotechnical": 5_000, "softSiteLines.tapFees": 10_000 });
  });

  it("a site line that applies but has no amount blocks TDC", () => {
    const r = finance.developmentCosts({ ...DEV, hardSiteLines: { ...DEV.hardSiteLines, retainingWalls: null } });
    expect(r.tdc).toMatchObject({ value: null, status: "insufficient evidence" });
    expect((r.tdc as finance.Insufficient).missing).toContain("hardSiteLines.retainingWalls");
  });

  it("time is money: delays raise holding costs and construction interest", () => {
    const delayed = finance.developmentCosts({ ...DEV, approvalDelayMonths: 6, constructionDelayMonths: 3 });
    // holding: +9 months × 1,000; interest: 915,000 × 0.5 × 0.08 × 3 / 12 = 9,150
    expect(delayed.holdingCosts.value).toBe(21_000);
    expect(delayed.constructionInterest.value).toBeCloseTo(36_600, 6);
    expect(delayed.tdc.value! - c.tdc.value!).toBeCloseTo(9_000 + 9_150, 6);
  });
});

describe("rental pro forma", () => {
  const p = finance.rentalProForma(RENTAL);

  it("income, OPEX, NOI and value", () => {
    expect(p.income.gpr.value).toBe(120_000);
    expect(p.income.egi.value).toBe(114_000);
    expect(p.opex.taxes.value).toBe(16_000);
    expect(p.opex.management.value).toBeCloseTo(9_120, 9);
    expect(p.opex.total.value).toBeCloseTo(36_448.75, 6);
    expect(p.noi.value).toBeCloseTo(77_551.25, 6);
    expect(p.stabilizedValue.value).toBeCloseTo(77_551.25 / 0.06, 6);
    expect(p.yieldOnCost.value).toBeCloseTo(77_551.25 / 1_268_600, 12);
    expect(p.developmentSpread.value).toBeCloseTo(77_551.25 / 1_268_600 - 0.06, 12);
  });

  it("financing ratios, DSCR, equity and cash-on-cash", () => {
    const pmt = 4.5 * 1199.1010503055138; // 900,000 is 4.5 × 200,000 at the same rate and term
    expect(p.financing.monthlyPayment.value).toBeCloseTo(pmt, 6);
    expect(p.financing.annualDebtService.value).toBeCloseTo(pmt * 12, 6);
    expect(p.financing.dscr.value).toBeCloseTo(77_551.25 / (pmt * 12), 9);
    expect(p.financing.ltc.value).toBeCloseTo(915_000 / 1_268_600, 12);
    expect(p.financing.equityRequired.value).toBeCloseTo(353_600, 6);
    expect(p.returns.cashOnCash.value).toBeCloseTo((77_551.25 - pmt * 12) / 353_600, 9);
  });

  it("exit: forward NOI ÷ exit cap − selling costs", () => {
    const fwd = 77_551.25 * Math.pow(1.02, 5);
    expect(p.exit.forwardNoi.value).toBeCloseTo(fwd, 6);
    expect(p.exit.netProceeds.value).toBeCloseTo((fwd / 0.065) * 0.97, 4);
  });

  it("cash flows are monthly: 12 development months + 60 operating months", () => {
    const u = p.cashFlows.unlevered.monthly!;
    const l = p.cashFlows.levered.monthly!;
    expect(u).toHaveLength(1 + 12 + 60);
    expect(l).toHaveLength(1 + 12 + 60);
    expect(u[0]).toBe(-100_000);
    expect(l[0]).toBeCloseTo(-353_600, 6);
    // Unlevered total outlay = land + build + holding (no loan interest or fees).
    const outlay = -u.slice(0, 13).reduce((s, x) => s + x, 0);
    expect(outlay).toBeCloseTo(1_220_000 + 12_000, 6);
  });

  it("IRR and NPV are consistent", () => {
    for (const [cf, rate] of [
      [p.cashFlows.unlevered, p.returns.unleveredIrr],
      [p.cashFlows.levered, p.returns.leveredIrr],
    ] as const) {
      expect(rate.status).toBe("ok");
      const monthly = Math.pow(1 + rate.value!, 1 / 12) - 1;
      expect(finance.npv(monthly, cf.monthly!)).toBeCloseTo(0, 4);
    }
    expect(p.returns.leveredIrr.label).toBe("Return per year on your cash (levered IRR)");
    expect(p.returns.equityMultiple.status).toBe("ok");
    expect(p.returns.payback.status).toBe("ok");
  });

  it("time is money: a construction delay lowers the levered IRR and NPV", () => {
    const d = finance.rentalProForma({ ...RENTAL, constructionDelayMonths: 6 });
    expect(d.returns.leveredIrr.value!).toBeLessThan(p.returns.leveredIrr.value!);
    expect(d.returns.leveredNpv.value!).toBeLessThan(p.returns.leveredNpv.value!);
    expect(d.cashFlows.levered.monthly!).toHaveLength(1 + 18 + 60);
  });
});

describe("for-sale pro forma", () => {
  const p = finance.forSaleProForma(FOR_SALE);

  it("gross sales, selling costs, profit and margin", () => {
    expect(p.sales.grossSales.value).toBe(1_600_000);
    expect(p.sales.sellingCosts.value).toBeCloseTo(96_000, 6);
    expect(p.sales.profit.value).toBeCloseTo(235_400, 6);
    expect(p.sales.profitMargin.value).toBeCloseTo(235_400 / 1_268_600, 12);
  });

  it("levered cash flows repay the construction loan from sales", () => {
    const l = p.cashFlows.levered.monthly!;
    expect(l).toHaveLength(1 + 12 + 4);
    expect(l.reduce((s, x) => s + x, 0)).toBeCloseTo(1_504_000 - 915_000 - 353_600, 6);
    expect(p.returns.leveredIrr.status).toBe("ok");
  });
});

describe("affordable mode", () => {
  it("funding gap = TDC − (supportable debt + required equity), then the capital stack", () => {
    const p = finance.affordableProForma({
      ...RENTAL,
      minDscr: 1.2,
      requiredEquity: 100_000,
      capitalStack: [
        { name: "Soft loan A", kind: "soft_loan", amount: 50_000 },
        { name: "Grant B", kind: "grant", amount: 25_000 },
      ],
    });
    const debt = finance.presentValueOfPayments(77_551.25 / 1.2 / 12, 0.005, 360);
    expect(p.supportableDebt.value).toBeCloseTo(debt, 4);
    expect(p.fundingGap.value).toBeCloseTo(1_268_600 - debt - 100_000, 4);
    expect(p.capitalStack.value).toBe(75_000);
    expect(p.remainingGap.value).toBeCloseTo(1_268_600 - debt - 100_000 - 75_000, 4);
    expect(p.fundingGap.label).toBe("Money still needed (funding gap)");
  });
});

describe("insufficient evidence", () => {
  it("empty inputs never produce a number from a default", () => {
    for (const r of receipts(finance.rentalProForma({}))) {
      if (r.status === "ok") {
        // The only computable things with no inputs are empty optional-line sums (nothing applies).
        expect(r.value).toBe(0);
        expect(r.formula.startsWith("no ")).toBe(true);
      } else {
        expect(r.status).toBe("insufficient evidence");
        expect(r.value).toBeNull();
      }
    }
    for (const r of receipts(finance.forSaleProForma({}))) if (r.status === "ok") expect(r.value).toBe(0);
    for (const r of receipts(finance.affordableProForma({}))) if (r.status === "ok") expect(r.value).toBe(0);
  });

  it("names exactly what is missing", () => {
    const { vacancyShare: _drop, ...noVacancy } = RENTAL;
    const p = finance.rentalProForma(noVacancy);
    expect(p.noi).toMatchObject({ value: null, status: "insufficient evidence", missing: ["vacancyShare"] });
    expect(p.returns.leveredIrr).toMatchObject({ value: null, missing: ["vacancyShare"] });
    expect(p.costs.tdc.status).toBe("ok");

    const noHard = finance.developmentCosts({ ...DEV, hardCostPerSqFt: undefined, grossSqFt: undefined });
    expect((noHard.tdc as finance.Insufficient).missing).toEqual(["hardCost (or hardCostPerSqFt and grossSqFt)"]);
  });

  it("a missing grants list is missing, not zero", () => {
    const { grants: _g, ...noGrants } = DEV;
    const c = finance.developmentCosts(noGrants);
    expect(c.grants).toMatchObject({ value: null, status: "insufficient evidence", missing: ["grants"] });
    expect(finance.rentalProForma({ ...RENTAL, grants: undefined }).financing.equityRequired.status).toBe(
      "insufficient evidence",
    );
  });

  it("null in a unit row is missing", () => {
    const p = finance.rentalProForma({ ...RENTAL, unitMix: [{ label: "2BR", count: 4, monthlyRent: null }] });
    expect(p.income.gpr).toMatchObject({ status: "insufficient evidence", missing: ["unitMix[0].monthlyRent"] });
  });
});

describe("determinism", () => {
  it("same inputs give identical outputs", () => {
    const a = JSON.stringify(finance.rentalProForma(RENTAL));
    const b = JSON.stringify(finance.rentalProForma(structuredClone(RENTAL)));
    expect(a).toBe(b);
    expect(JSON.stringify(finance.forSaleProForma(FOR_SALE))).toBe(JSON.stringify(finance.forSaleProForma(FOR_SALE)));
  });

  it("does not mutate its inputs", () => {
    const copy = structuredClone(RENTAL);
    finance.rentalProForma(RENTAL);
    finance.breakEvenRent(RENTAL, "unlevered");
    expect(RENTAL).toEqual(copy);
  });
});

describe("no invented numbers in the finance source", () => {
  // tvm.ts holds solver tolerances and msi.ts holds the cited DEP chart; everything else may only use
  // structural constants (0, 1, 2, 12 months, 1,000 for mills and "per $1,000", and the bracket-doubling cap).
  const ALLOWED = new Set(["0", "1", "2", "12", "1000", "60"]);
  const sources = import.meta.glob<string>("../src/finance/*.ts", { query: "?raw", import: "default", eager: true });
  const files = Object.keys(sources).filter((f) => !f.endsWith("/tvm.ts") && !f.endsWith("/msi.ts"));

  it("scans the module", () => expect(files.length).toBeGreaterThan(5));

  it.each(files)("%s has no numeric assumptions", (file: string) => {
    const code = (sources[file] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    const literals = code.match(/(?<![\w.$\]])\d[\d_]*(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
    const unexpected = literals.map((l: string) => l.replace(/_/g, "")).filter((l: string) => !ALLOWED.has(l));
    expect(unexpected).toEqual([]);
  });
});
