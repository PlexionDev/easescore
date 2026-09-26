/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { finance } from "../src";
import msiChart from "../../data/seed/msi_rates.csv?raw";

const {
  npv,
  irr,
  bisect,
  payment,
  monthlyPayment,
  balanceAfter,
  amortizationSchedule,
  paybackPeriod,
  equityMultiple,
  presentValueOfPayments,
  msiAnnualPremium,
  dscr,
  monthlyDebtPayment,
  supportableDebt,
} = finance;

describe("NPV and IRR (textbook cases)", () => {
  const flows = [-1000, 300, 400, 500];

  it("NPV of −1000, 300, 400, 500 at 10% is −21.04", () => {
    // 300/1.1 + 400/1.21 + 500/1.331 − 1000 = −21.0368
    expect(npv(0.1, flows)).toBeCloseTo(-21.0368, 4);
  });

  it("IRR of −1000, 300, 400, 500 is 8.896%", () => {
    const r = irr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.088963, 6);
    expect(npv(r!, flows)).toBeCloseTo(0, 6);
  });

  it("IRR of −100, 110 is exactly 10%", () => {
    expect(irr([-100, 110])).toBeCloseTo(0.1, 10);
  });

  it("returns null when cash flows never change sign", () => {
    expect(irr([100, 50, 25])).toBeNull();
    expect(irr([-100, -50])).toBeNull();
    expect(irr([0, 0])).toBeNull();
  });

  it("falls back to bisection when Newton leaves the valid range (IRR = −99%)", () => {
    const r = irr([-100, 1]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.99, 8);
  });

  it("finds very high IRRs", () => {
    // −100 now, 1e8 in period 10 → (1e6)^(1/10) − 1
    const flows10 = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1e8];
    expect(irr(flows10)!).toBeCloseTo(Math.pow(1e6, 0.1) - 1, 8);
  });
});

describe("loan math", () => {
  it("$200,000 at 6% for 30 years is $1,199.10 a month", () => {
    expect(monthlyPayment(200_000, 0.06, 30)).toBeCloseTo(1199.1, 2);
  });

  it("zero-rate loans divide evenly", () => {
    expect(payment(1200, 0, 12)).toBe(100);
  });

  it("amortization schedule: first month split, balance after 5 years, paid off at the end", () => {
    const rows = amortizationSchedule(200_000, 0.06, 30);
    expect(rows).toHaveLength(360);
    expect(rows[0]!.interest).toBeCloseTo(1000, 6);
    expect(rows[0]!.principal).toBeCloseTo(199.1, 2);
    // Hand-checked by iterating balance = balance × 1.005 − payment 60 times.
    expect(rows[59]!.balance).toBeCloseTo(186_108.71, 2);
    expect(balanceAfter(200_000, 0.005, 360, 60)).toBeCloseTo(186_108.71, 2);
    expect(rows[359]!.balance).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBeCloseTo(200_000, 4);
  });

  it("present value of payments inverts the payment formula", () => {
    const pmt = monthlyPayment(200_000, 0.06, 30);
    expect(presentValueOfPayments(pmt, 0.005, 360)).toBeCloseTo(200_000, 6);
  });

  it("DSCR = NOI ÷ annual debt service", () => {
    const r = dscr(120_000, 100_000);
    expect(r.status).toBe("ok");
    expect(r.value).toBeCloseTo(1.2, 12);
    expect(r.label).toBe("Can the income pay the loan? (DSCR)");
    expect(r.formula).toBe("NOI ÷ annual debt service");
    expect(r.inputs).toEqual({ noi: 120_000, debtService: 100_000 });
    expect(dscr(120_000, 0).status).toBe("not computable");
  });

  it("monthly payment receipt matches the raw formula", () => {
    const r = monthlyDebtPayment(200_000, 0.06, 30);
    expect(r.value).toBeCloseTo(1199.1, 2);
  });

  it("supportable debt at a minimum DSCR pays back to exactly that DSCR", () => {
    const noi = 100_000;
    const loan = supportableDebt(noi, 1.25, 0.06, 30);
    expect(loan.status).toBe("ok");
    const ads = monthlyPayment(loan.value!, 0.06, 30) * 12;
    expect(noi / ads).toBeCloseTo(1.25, 9);
  });
});

describe("other primitives", () => {
  it("payback period is the first period cumulative cash turns non-negative", () => {
    expect(paybackPeriod([-100, 30, 30, 50])).toBe(3);
    expect(paybackPeriod([-100, 30, 30])).toBeNull();
  });

  it("equity multiple = cash back ÷ cash in", () => {
    expect(equityMultiple([-100, 50, 100])).toBe(1.5);
    expect(equityMultiple([10, 20])).toBeNull();
  });

  it("bisection finds √2 and refuses brackets without a sign change", () => {
    expect(bisect((x) => x * x - 2, 0, 2)!).toBeCloseTo(Math.SQRT2, 9);
    expect(bisect((x) => x * x + 1, -1, 1)).toBeNull();
  });
});

describe("mine subsidence insurance (PA DEP chart)", () => {
  it("is $3.75 + $0.25 per $1,000 of coverage", () => {
    expect(msiAnnualPremium(10_000).value).toBeCloseTo(6.25, 10);
    expect(msiAnnualPremium(150_000).value).toBeCloseTo(41.25, 10);
    expect(msiAnnualPremium(1_000_000).value).toBeCloseTo(253.75, 10);
  });

  it("matches every row of the seeded DEP rate chart", () => {
    const csv = msiChart.trim().split("\n");
    expect(csv.length).toBeGreaterThan(1);
    for (const line of csv.slice(1)) {
      const [coverage, premium] = line.split(",").map(Number);
      expect(msiAnnualPremium(coverage).value).toBeCloseTo(premium!, 10);
    }
  });

  it("is not computed outside the chart, and missing coverage is insufficient evidence", () => {
    expect(msiAnnualPremium(5_000).status).toBe("not computable");
    const r = msiAnnualPremium(undefined);
    expect(r).toMatchObject({ value: null, status: "insufficient evidence", missing: ["coverage"] });
  });
});
