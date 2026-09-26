// Pillar 1C: financing ratios, equity, debt service, DSCR.

import { compute, divide, oneOf, type Arg, type Num, type Receipt } from "./receipt";
import { monthlyPayment, presentValueOfPayments } from "./tvm";

export const loanToCost = (loan: Arg, tdc: Arg) =>
  compute("Loan as a share of total cost (LTC)", "loan ÷ TDC", { loan, tdc }, (v) => divide(v.loan, v.tdc, "Total development cost"));

export const loanToValue = (loan: Arg, value: Arg) =>
  compute("Loan as a share of finished value (LTV)", "loan ÷ value", { loan, value }, (v) =>
    divide(v.loan, v.value, "Finished value"),
  );

export const equityRequired = (tdc: Arg, loan: Arg, grants: Arg) =>
  compute("Cash the developer puts in (equity required)", "TDC − loan − grants and subsidy", { tdc, loan, grants }, (v) =>
    v.tdc - v.loan - v.grants,
  );

const termCheck = (years: number) => (years > 0 && Number.isInteger(years * 12) ? null : "the loan term must be a positive whole number of months");

/** Standard amortizing payment: P·i ÷ (1 − (1 + i)^−n), i = annual rate ÷ 12, n = years × 12. */
export const monthlyDebtPayment = (loan: Arg, annualRate: Arg, amortizationYears: Arg) =>
  compute(
    "Monthly loan payment",
    "loan × (rate ÷ 12) ÷ (1 − (1 + rate ÷ 12)^−(years × 12))",
    { loan, annualRate, amortizationYears },
    (v) => termCheck(v.amortizationYears) ?? monthlyPayment(v.loan, v.annualRate, v.amortizationYears),
  );

export const annualDebtService = (monthly: Arg) =>
  compute("Yearly loan payments (debt service)", "monthly payment × 12", { monthly }, (v) => v.monthly * 12);

export const dscr = (noi: Arg, debtService: Arg) =>
  compute("Can the income pay the loan? (DSCR)", "NOI ÷ annual debt service", { noi, debtService }, (v) =>
    divide(v.noi, v.debtService, "Annual debt service"),
  );

/** Permanent loan as an entered amount, or LTV × stabilized value. */
export const permanentLoan = (amount: Num, ltv: Num, value: Receipt) =>
  oneOf("Permanent loan", [
    compute("Permanent loan", "loan amount (entered)", { permanentLoanAmount: amount }, (v) => v.permanentLoanAmount),
    compute("Permanent loan", "loan-to-value × stabilized value", { permanentLoanLtv: ltv, value }, (v) => v.permanentLoanLtv * v.value),
  ]);

/**
 * Largest loan the income supports at a minimum DSCR:
 * monthly payment allowed = NOI ÷ min DSCR ÷ 12; loan = PV of that payment over the amortization term.
 */
export const supportableDebt = (noi: Arg, minDscr: Arg, annualRate: Arg, amortizationYears: Arg) =>
  compute(
    "Loan the income can support (supportable debt)",
    "(NOI ÷ min DSCR ÷ 12) × (1 − (1 + rate ÷ 12)^−(years × 12)) ÷ (rate ÷ 12)",
    { noi, minDscr, annualRate, amortizationYears },
    (v) => {
      const bad = termCheck(v.amortizationYears);
      if (bad) return bad;
      if (v.minDscr <= 0) return "the minimum DSCR must be above zero";
      if (v.noi <= 0) return 0;
      return presentValueOfPayments(v.noi / v.minDscr / 12, v.annualRate / 12, v.amortizationYears * 12);
    },
  );
