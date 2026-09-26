// Full pro formas: one call from inputs to every Pillar 1 output, each a Receipt.

import { developmentCosts, operatingExpenses, sumLayers, type DevelopmentCosts, type OperatingExpenses } from "./costs";
import {
  annualDebtService,
  dscr,
  equityRequired,
  loanToCost,
  loanToValue,
  monthlyDebtPayment,
  permanentLoan,
  supportableDebt,
} from "./financing";
import {
  developmentSpread,
  netOperatingIncome,
  rentalIncome,
  saleResult,
  stabilizedValue,
  yieldOnCost,
  type RentalIncome,
  type SaleResult,
} from "./income";
import { compute, type Receipt } from "./receipt";
import {
  cashFlows,
  cashOnCash,
  developmentFlows,
  equityMultipleOf,
  irrOf,
  npvOf,
  paybackOf,
  positiveWholeMonths,
  positiveWholeYears,
  type CashFlows,
} from "./returns";
import { balanceAfter } from "./tvm";
import type { AffordableInputs, ForSaleInputs, RentalInputs } from "./types";

/** Hard + soft + contingency: the build spend spread over the construction months. */
const buildCost = (c: DevelopmentCosts) =>
  compute("Build spend (hard + soft + contingency)", "hard + soft + contingency", { hard: c.hard, soft: c.soft, contingency: c.contingency }, (v) =>
    v.hard + v.soft + v.contingency,
  );

export interface RentalProForma {
  costs: DevelopmentCosts;
  income: RentalIncome;
  opex: OperatingExpenses;
  noi: Receipt;
  stabilizedValue: Receipt;
  yieldOnCost: Receipt;
  developmentSpread: Receipt;
  financing: {
    ltc: Receipt;
    permanentLoan: Receipt;
    ltv: Receipt;
    equityRequired: Receipt;
    monthlyPayment: Receipt;
    annualDebtService: Receipt;
    dscr: Receipt;
  };
  exit: {
    forwardNoi: Receipt;
    exitValue: Receipt;
    sellingCosts: Receipt;
    netProceeds: Receipt;
    loanBalance: Receipt;
  };
  returns: {
    unleveredNpv: Receipt;
    unleveredIrr: Receipt;
    leveredNpv: Receipt;
    leveredIrr: Receipt;
    cashOnCash: Receipt;
    equityMultiple: Receipt;
    payback: Receipt;
  };
  cashFlows: { unlevered: CashFlows; levered: CashFlows };
}

/** NOI in operating month k (1-based): NOI × (1 + growth)^(year − 1) ÷ 12. */
const monthlyNoi = (noi: number, growth: number, k: number) => (noi * Math.pow(1 + growth, Math.floor((k - 1) / 12))) / 12;

export function rentalProForma(i: RentalInputs): RentalProForma {
  const costs = developmentCosts(i);
  const income = rentalIncome(i.unitMix, i.vacancyShare, i.otherIncomeAnnual);
  const opex = operatingExpenses(i, income.egi);
  const noi = netOperatingIncome(income.egi, opex.total);
  const value = stabilizedValue(noi, i.marketCapRate);
  const yoc = yieldOnCost(noi, costs.tdc);
  const spread = developmentSpread(yoc, i.marketCapRate);

  const permLoan = permanentLoan(i.permanentLoanAmount, i.permanentLoanLtv, value);
  const payment = monthlyDebtPayment(permLoan, i.permanentRate, i.amortizationYears);
  const ads = annualDebtService(payment);
  const equity = equityRequired(costs.tdc, costs.constructionLoan, costs.grants);
  const financing = {
    ltc: loanToCost(costs.constructionLoan, costs.tdc),
    permanentLoan: permLoan,
    ltv: loanToValue(permLoan, value),
    equityRequired: equity,
    monthlyPayment: payment,
    annualDebtService: ads,
    dscr: dscr(noi, ads),
  };

  const forwardNoi = compute(
    "Income in the year after sale (forward NOI)",
    "NOI × (1 + yearly NOI growth)^hold years",
    { noi, annualNoiGrowth: i.annualNoiGrowth, holdYears: i.holdYears },
    (v) => positiveWholeYears(v.holdYears) ?? v.noi * Math.pow(1 + v.annualNoiGrowth, v.holdYears),
  );
  const exitValue = compute("Sale price at exit", "forward NOI ÷ exit cap rate", { forwardNoi, exitCapRate: i.exitCapRate }, (v) =>
    v.exitCapRate === 0 ? "Exit cap rate is zero, so the value is undefined" : v.forwardNoi / v.exitCapRate,
  );
  const exitSelling = compute("Selling costs at exit", "sale price × selling-cost share", { exitValue, exitSellingCostShare: i.exitSellingCostShare }, (v) =>
    v.exitValue * v.exitSellingCostShare,
  );
  const netProceeds = compute("Sale proceeds after selling costs", "sale price − selling costs", { exitValue, exitSelling }, (v) =>
    v.exitValue - v.exitSelling,
  );
  const loanBalance = compute(
    "Loan still owed at sale",
    "P(1 + i)^k − payment × ((1 + i)^k − 1) ÷ i, i = rate ÷ 12, k = hold years × 12",
    { permLoan, permanentRate: i.permanentRate, amortizationYears: i.amortizationYears, holdYears: i.holdYears, payment },
    (v) => positiveWholeYears(v.holdYears) ?? balanceAfter(v.permLoan, v.permanentRate / 12, v.amortizationYears * 12, v.holdYears * 12),
  );

  const unlevered = cashFlows(
    "Project cash flows without a loan (unlevered)",
    "month 0 land; holding spread over approval + construction; hard + soft + contingency spread over construction; then NOI ÷ 12 each month (growing yearly); sale proceeds in the last month",
    {
      land: costs.land,
      buildCost: buildCost(costs),
      holdingCosts: costs.holdingCosts,
      approvalPeriod: costs.approvalPeriod,
      constructionPeriod: costs.constructionPeriod,
      noi,
      annualNoiGrowth: i.annualNoiGrowth,
      holdYears: i.holdYears,
      netProceeds,
    },
    (v) => {
      const bad = positiveWholeYears(v.holdYears);
      if (bad) return bad;
      const D = v.approvalPeriod + v.constructionPeriod;
      const ops = v.holdYears * 12;
      const flows = developmentFlows(D + ops, v);
      for (let k = 1; k <= ops; k++) flows[D + k] = (flows[D + k] ?? 0) + monthlyNoi(v.noi, v.annualNoiGrowth, k);
      flows[D + ops] = (flows[D + ops] ?? 0) + v.netProceeds;
      return flows;
    },
  );

  const levered = cashFlows(
    "Developer cash flows with the loans (levered)",
    "month 0 equity in; at completion the permanent loan repays the construction loan (difference to/from equity); then NOI ÷ 12 − loan payment each month; sale proceeds − loan balance in the last month",
    {
      equity,
      constructionLoan: costs.constructionLoan,
      permLoan,
      payment,
      approvalPeriod: costs.approvalPeriod,
      constructionPeriod: costs.constructionPeriod,
      noi,
      annualNoiGrowth: i.annualNoiGrowth,
      holdYears: i.holdYears,
      netProceeds,
      loanBalance,
    },
    (v) => {
      const bad = positiveWholeYears(v.holdYears);
      if (bad) return bad;
      const D = v.approvalPeriod + v.constructionPeriod;
      const ops = v.holdYears * 12;
      const flows = new Array<number>(D + ops + 1).fill(0);
      flows[0] = -v.equity;
      flows[D] = (flows[D] ?? 0) + v.permLoan - v.constructionLoan;
      for (let k = 1; k <= ops; k++) flows[D + k] = (flows[D + k] ?? 0) + monthlyNoi(v.noi, v.annualNoiGrowth, k) - v.payment;
      flows[D + ops] = (flows[D + ops] ?? 0) + v.netProceeds - v.loanBalance;
      return flows;
    },
  );

  return {
    costs,
    income,
    opex,
    noi,
    stabilizedValue: value,
    yieldOnCost: yoc,
    developmentSpread: spread,
    financing,
    exit: { forwardNoi, exitValue, sellingCosts: exitSelling, netProceeds, loanBalance },
    returns: {
      unleveredNpv: npvOf(unlevered, i.discountRate, "Today's value of the project, no loan (unlevered NPV)"),
      unleveredIrr: irrOf(unlevered, "Return per year, no loan (unlevered IRR)"),
      leveredNpv: npvOf(levered, i.discountRate, "Today's value of your cash (levered NPV)"),
      leveredIrr: irrOf(levered, "Return per year on your cash (levered IRR)"),
      cashOnCash: cashOnCash(noi, ads, equity),
      equityMultiple: equityMultipleOf(levered),
      payback: paybackOf(levered),
    },
    cashFlows: { unlevered, levered },
  };
}

export interface ForSaleProForma {
  costs: DevelopmentCosts;
  sales: SaleResult;
  financing: { ltc: Receipt; equityRequired: Receipt };
  returns: {
    unleveredNpv: Receipt;
    unleveredIrr: Receipt;
    leveredNpv: Receipt;
    leveredIrr: Receipt;
    equityMultiple: Receipt;
    payback: Receipt;
  };
  cashFlows: { unlevered: CashFlows; levered: CashFlows };
}

export function forSaleProForma(i: ForSaleInputs): ForSaleProForma {
  const costs = developmentCosts(i);
  const sales = saleResult(i.unitMix, i.sellingCostShare, costs.tdc);
  const equity = equityRequired(costs.tdc, costs.constructionLoan, costs.grants);

  const unlevered = cashFlows(
    "Project cash flows without a loan (unlevered)",
    "month 0 land; holding spread over approval + construction; hard + soft + contingency spread over construction; then sales after selling costs spread evenly over the sales months",
    {
      land: costs.land,
      buildCost: buildCost(costs),
      holdingCosts: costs.holdingCosts,
      approvalPeriod: costs.approvalPeriod,
      constructionPeriod: costs.constructionPeriod,
      netSales: sales.netSales,
      salesMonths: i.salesMonths,
    },
    (v) => {
      const bad = positiveWholeMonths(v.salesMonths, "The sales period");
      if (bad) return bad;
      const D = v.approvalPeriod + v.constructionPeriod;
      const flows = developmentFlows(D + v.salesMonths, v);
      for (let k = 1; k <= v.salesMonths; k++) flows[D + k] = (flows[D + k] ?? 0) + v.netSales / v.salesMonths;
      return flows;
    },
  );

  const levered = cashFlows(
    "Developer cash flows with the construction loan (levered)",
    "month 0 equity in; then (sales after selling costs − construction loan repayment) spread evenly over the sales months",
    {
      equity,
      constructionLoan: costs.constructionLoan,
      approvalPeriod: costs.approvalPeriod,
      constructionPeriod: costs.constructionPeriod,
      netSales: sales.netSales,
      salesMonths: i.salesMonths,
    },
    (v) => {
      const bad = positiveWholeMonths(v.salesMonths, "The sales period");
      if (bad) return bad;
      const D = v.approvalPeriod + v.constructionPeriod;
      const flows = new Array<number>(D + v.salesMonths + 1).fill(0);
      flows[0] = -v.equity;
      for (let k = 1; k <= v.salesMonths; k++) flows[D + k] = (v.netSales - v.constructionLoan) / v.salesMonths;
      return flows;
    },
  );

  return {
    costs,
    sales,
    financing: { ltc: loanToCost(costs.constructionLoan, costs.tdc), equityRequired: equity },
    returns: {
      unleveredNpv: npvOf(unlevered, i.discountRate, "Today's value of the project, no loan (unlevered NPV)"),
      unleveredIrr: irrOf(unlevered, "Return per year, no loan (unlevered IRR)"),
      leveredNpv: npvOf(levered, i.discountRate, "Today's value of your cash (levered NPV)"),
      leveredIrr: irrOf(levered, "Return per year on your cash (levered IRR)"),
      equityMultiple: equityMultipleOf(levered),
      payback: paybackOf(levered),
    },
    cashFlows: { unlevered, levered },
  };
}

export interface AffordableProForma {
  costs: DevelopmentCosts;
  income: RentalIncome;
  opex: OperatingExpenses;
  noi: Receipt;
  supportableDebt: Receipt;
  fundingGap: Receipt;
  capitalStack: Receipt;
  remainingGap: Receipt;
}

/** Pillar 1E: affordable / mission mode. AMI-restricted rents enter through the unit mix. */
export function affordableProForma(i: AffordableInputs): AffordableProForma {
  const costs = developmentCosts(i);
  const income = rentalIncome(i.unitMix, i.vacancyShare, i.otherIncomeAnnual);
  const opex = operatingExpenses(i, income.egi);
  const noi = netOperatingIncome(income.egi, opex.total);
  const debt = supportableDebt(noi, i.minDscr, i.permanentRate, i.amortizationYears);
  const fundingGap = compute(
    "Money still needed (funding gap)",
    "TDC − (supportable debt + required equity); below zero means a surplus",
    { tdc: costs.tdc, supportableDebt: debt, requiredEquity: i.requiredEquity },
    (v) => v.tdc - (v.supportableDebt + v.requiredEquity),
  );
  const capitalStack = sumLayers("Capital stack layers (subsidy, soft loans, tax credit equity)", "capitalStack", i.capitalStack);
  const remainingGap = compute(
    "Gap left after the capital stack",
    "funding gap − capital stack layers; below zero means a surplus",
    { fundingGap, capitalStack },
    (v) => v.fundingGap - v.capitalStack,
  );
  return { costs, income, opex, noi, supportableDebt: debt, fundingGap, capitalStack, remainingGap };
}
