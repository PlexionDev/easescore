// Pillar 1A: development costs (CAPEX / TDC) and operating expenses (OPEX).

import { compute, divide, oneOf, sumLines, type Arg, type Num, type Receipt } from "./receipt";
import type { CapitalLayer, DevelopmentInputs, OperatingInputs } from "./types";

const wholeMonths = (label: string, v: number) =>
  Number.isInteger(v) && v >= 0 ? v : `${label} must be a whole number of months, zero or more`;

export interface ScheduleResult {
  approvalPeriod: Receipt;
  constructionPeriod: Receipt;
  developmentPeriod: Receipt;
}

/** Months spent approving and building, delays included. */
export function schedule(i: DevelopmentInputs): ScheduleResult {
  const approvalPeriod = compute(
    "Months to approval, including delay",
    "approval months + approval delay months",
    { approvalMonths: i.approvalMonths, approvalDelayMonths: i.approvalDelayMonths },
    (v) => wholeMonths("Approval time", v.approvalMonths + v.approvalDelayMonths),
  );
  const constructionPeriod = compute(
    "Months to build, including delay",
    "construction months + construction delay months",
    { constructionMonths: i.constructionMonths, constructionDelayMonths: i.constructionDelayMonths },
    (v) => wholeMonths("Construction time", v.constructionMonths + v.constructionDelayMonths),
  );
  const developmentPeriod = compute(
    "Months from purchase to finished building",
    "approval period + construction period",
    { approvalPeriod, constructionPeriod },
    (v) => v.approvalPeriod + v.constructionPeriod,
  );
  return { approvalPeriod, constructionPeriod, developmentPeriod };
}

/** Sum of named capital layers (grants, soft loans, ...). Missing list = missing; each null amount = missing. */
export function sumLayers(label: string, prefix: string, layers: CapitalLayer[] | undefined): Receipt {
  if (layers === undefined) {
    return compute(label, `sum of ${prefix}`, { [prefix]: undefined as Num }, () => 0);
  }
  const args: Record<string, Num> = {};
  layers.forEach((l, n) => {
    args[`${prefix}[${n}] ${l.name}`] = l.amount;
  });
  const formula = layers.length > 0 ? Object.keys(args).join(" + ") : `no ${prefix} (none entered)`;
  return compute(label, formula, args, (v) => Object.values(v).reduce((s, x) => s + x, 0));
}

export interface DevelopmentCosts extends ScheduleResult {
  land: Receipt;
  hardBase: Receipt;
  hardSiteLines: Receipt;
  hard: Receipt;
  softBase: Receipt;
  softSiteLines: Receipt;
  soft: Receipt;
  contingency: Receipt;
  costBeforeFinancing: Receipt;
  holdingCosts: Receipt;
  constructionLoan: Receipt;
  constructionInterest: Receipt;
  financing: Receipt;
  tdc: Receipt;
  capex: Receipt;
  costPerUnit: Receipt;
  costPerSqFt: Receipt;
  grants: Receipt;
}

export function developmentCosts(i: DevelopmentInputs): DevelopmentCosts {
  const sched = schedule(i);

  const land = compute("Land / purchase price", "purchase price", { land: i.land }, (v) => v.land);

  const hardBase = oneOf("Construction cost before site lines", [
    compute("Construction cost before site lines", "hard cost (entered as a total)", { hardCost: i.hardCost }, (v) => v.hardCost),
    compute(
      "Construction cost before site lines",
      "cost per sq ft × gross sq ft",
      { hardCostPerSqFt: i.hardCostPerSqFt, grossSqFt: i.grossSqFt },
      (v) => v.hardCostPerSqFt * v.grossSqFt,
    ),
  ]);
  const hardSiteLines = sumLines("Site work, demolition, grouting, retaining walls", "hardSiteLines", i.hardSiteLines);
  const hard = compute(
    "Construction cost (hard costs)",
    "construction cost before site lines + hard site lines",
    { hardBase, hardSiteLines },
    (v) => v.hardBase + v.hardSiteLines,
  );

  const softBase = oneOf("Design, permits, legal and other soft costs before site lines", [
    compute("Soft costs before site lines", "soft cost (entered as a total)", { softCost: i.softCost }, (v) => v.softCost),
    compute(
      "Soft costs before site lines",
      "soft-cost share × hard costs",
      { softCostShareOfHard: i.softCostShareOfHard, hard },
      (v) => v.softCostShareOfHard * v.hard,
    ),
  ]);
  const softSiteLines = sumLines("Geotechnical report and tap fees", "softSiteLines", i.softSiteLines);
  const soft = compute(
    "Soft costs (design, engineering, permits, fees)",
    "soft costs before site lines + soft site lines",
    { softBase, softSiteLines },
    (v) => v.softBase + v.softSiteLines,
  );

  const contingency = oneOf("Contingency (buffer for surprises)", [
    compute("Contingency (buffer for surprises)", "contingency (entered as a total)", { contingency: i.contingency }, (v) => v.contingency),
    compute(
      "Contingency (buffer for surprises)",
      "contingency share × hard costs",
      { contingencyShareOfHard: i.contingencyShareOfHard, hard },
      (v) => v.contingencyShareOfHard * v.hard,
    ),
  ]);

  const costBeforeFinancing = compute(
    "Cost before financing and holding",
    "land + hard + soft + contingency",
    { land, hard, soft, contingency },
    (v) => v.land + v.hard + v.soft + v.contingency,
  );

  const holdingCosts = compute(
    "Holding costs while approving and building",
    "monthly holding cost × months from purchase to finished building",
    { monthlyHoldingCost: i.monthlyHoldingCost, developmentPeriod: sched.developmentPeriod },
    (v) => v.monthlyHoldingCost * v.developmentPeriod,
  );

  const constructionLoan = oneOf("Construction loan", [
    compute("Construction loan", "loan amount (entered)", { constructionLoanAmount: i.constructionLoanAmount }, (v) => v.constructionLoanAmount),
    compute(
      "Construction loan",
      "loan-to-cost × cost before financing and holding",
      { constructionLoanLtc: i.constructionLoanLtc, costBeforeFinancing },
      (v) => v.constructionLoanLtc * v.costBeforeFinancing,
    ),
  ]);

  const constructionInterest = compute(
    "Interest paid while building (construction loan interest)",
    "loan × average share drawn × annual rate × construction months ÷ 12",
    {
      constructionLoan,
      averageDrawShare: i.averageDrawShare,
      constructionRate: i.constructionRate,
      constructionPeriod: sched.constructionPeriod,
    },
    (v) => (v.constructionLoan * v.averageDrawShare * v.constructionRate * v.constructionPeriod) / 12,
  );

  const financing = compute(
    "Financing and holding costs",
    "construction interest + lender fees + holding costs",
    { constructionInterest, loanFees: i.loanFees, holdingCosts },
    (v) => v.constructionInterest + v.loanFees + v.holdingCosts,
  );

  const tdcArgs: Record<string, Arg> = { land, hard, soft, financing, contingency };
  const tdcFn = (v: Record<string, number>) =>
    (v.land ?? 0) + (v.hard ?? 0) + (v.soft ?? 0) + (v.financing ?? 0) + (v.contingency ?? 0);
  const tdc = compute("Total development cost (TDC)", "land + hard + soft + financing + contingency", tdcArgs, tdcFn);
  const capex = compute(
    "One-time money to buy and build (CAPEX)",
    "land + hard + soft + financing + contingency (equals TDC)",
    tdcArgs,
    tdcFn,
  );

  const costPerUnit = compute("Cost per home (TDC per unit)", "TDC ÷ units", { tdc, units: i.units }, (v) =>
    divide(v.tdc, v.units, "Unit count"),
  );
  const costPerSqFt = compute("Cost per square foot (TDC per sq ft)", "TDC ÷ gross sq ft", { tdc, grossSqFt: i.grossSqFt }, (v) =>
    divide(v.tdc, v.grossSqFt, "Gross square footage"),
  );

  const grants = sumLayers("Grants and subsidy", "grants", i.grants);

  return {
    ...sched,
    land,
    hardBase,
    hardSiteLines,
    hard,
    softBase,
    softSiteLines,
    soft,
    contingency,
    costBeforeFinancing,
    holdingCosts,
    constructionLoan,
    constructionInterest,
    financing,
    tdc,
    capex,
    costPerUnit,
    costPerSqFt,
    grants,
  };
}

export interface OperatingExpenses {
  taxes: Receipt;
  insurance: Receipt;
  management: Receipt;
  optionalLines: Receipt;
  total: Receipt;
}

/** Yearly running costs. Management is a share of effective gross income, so EGI is passed in. */
export function operatingExpenses(i: OperatingInputs, egi: Receipt): OperatingExpenses {
  const taxes = compute(
    "Property taxes, yearly",
    "assessed value × total millage ÷ 1,000",
    { assessedValue: i.assessedValue, taxMills: i.taxMills },
    (v) => (v.assessedValue * v.taxMills) / 1000,
  );
  const { floodInsurance, mineSubsidenceInsurance, vacancyReserve } = i.opexLines ?? {};
  const extraInsurance = sumLines("Flood and mine subsidence insurance", "opexLines", {
    floodInsurance,
    mineSubsidenceInsurance,
  });
  const insurance = compute(
    "Insurance, yearly (incl. flood and mine subsidence)",
    "property insurance + flood insurance + mine subsidence insurance",
    { propertyInsurance: i.propertyInsurance, extraInsurance },
    (v) => v.propertyInsurance + v.extraInsurance,
  );
  const management = compute(
    "Property management fee, yearly",
    "management share × effective gross income",
    { managementShareOfEgi: i.managementShareOfEgi, egi },
    (v) => v.managementShareOfEgi * v.egi,
  );
  const optionalLines = sumLines("Vacancy reserve", "opexLines", { vacancyReserve });
  const total = compute(
    "Yearly operating costs (OPEX)",
    "taxes + insurance + maintenance + management + owner utilities + replacement reserves + vacancy reserve",
    {
      taxes,
      insurance,
      maintenance: i.maintenance,
      management,
      ownerUtilities: i.ownerUtilities,
      replacementReserves: i.replacementReserves,
      optionalLines,
    },
    (v) => v.taxes + v.insurance + v.maintenance + v.management + v.ownerUtilities + v.replacementReserves + v.optionalLines,
  );
  return { taxes, insurance, management, optionalLines, total };
}
