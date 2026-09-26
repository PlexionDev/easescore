// Inputs to the finance module. There are no defaults anywhere: every number comes from the user
// (cost assumptions) or from the database (market references such as rents, rates, comps).
//
// Conventions
// - Rates and percentages are decimals: 0.065 = 6.5%.
// - Money is US dollars; "annual" amounts are per year; months are whole months.
// - Property tax millage is in mills: dollars of tax per $1,000 of assessed value.
// - A plain field left out (or null) is MISSING: outputs that need it become "insufficient evidence".
// - Inside a `...Lines` record, a line left out does NOT apply to this project; a line set to null
//   applies but its amount is unknown (also "insufficient evidence"). Enter 0 to say "applies, costs nothing".

import type { Num } from "./receipt";

/** One row of the unit mix. AMI-restricted rows carry the restricted rent as their monthlyRent. */
export interface UnitRow {
  label: string;
  count: Num;
  /** Monthly rent per unit (rental). For AMI-restricted units, the restricted rent (e.g. PHFA LIHTC limit). */
  monthlyRent?: Num;
  /** Sale price per unit (for-sale). */
  salePrice?: Num;
  /** Area median income tier this rent is restricted to, e.g. 0.6 for 60% AMI. Informational. */
  amiShare?: Num;
}

/** Hard-cost site lines (physical work). Pittsburgh-specific items are named. */
export const HARD_SITE_LINES = ["demolition", "grouting", "retainingWalls", "siteWork"] as const;
export type HardSiteLine = (typeof HARD_SITE_LINES)[number];

/** Soft-cost site lines (studies and fees). */
export const SOFT_SITE_LINES = ["geotechnical", "tapFees"] as const;
export type SoftSiteLine = (typeof SOFT_SITE_LINES)[number];

/** Operating lines that apply to some properties only. */
export const OPTIONAL_OPEX_LINES = ["floodInsurance", "mineSubsidenceInsurance", "vacancyReserve"] as const;
export type OptionalOpexLine = (typeof OPTIONAL_OPEX_LINES)[number];

export type CapitalLayerKind =
  | "grant"
  | "soft_loan"
  | "tax_credit_equity"
  | "land_write_down"
  | "deferred_fee"
  | "other";

/** A named source of funds, e.g. { name: "HOME", kind: "soft_loan", amount }. */
export interface CapitalLayer {
  name: string;
  kind: CapitalLayerKind;
  amount: Num;
}

/** Timing. Delays are separate so "time is money" can be shown on its own. */
export interface ScheduleInputs {
  approvalMonths?: Num;
  approvalDelayMonths?: Num;
  constructionMonths?: Num;
  constructionDelayMonths?: Num;
  /** Carry while approving and building (taxes, insurance, land-loan interest, security), per month. */
  monthlyHoldingCost?: Num;
}

export interface DevelopmentInputs extends ScheduleInputs {
  units?: Num;
  grossSqFt?: Num;

  /** Land / acquisition price. */
  land?: Num;

  /** Hard cost as a total, OR hardCostPerSqFt × grossSqFt. */
  hardCost?: Num;
  hardCostPerSqFt?: Num;
  hardSiteLines?: Partial<Record<HardSiteLine, Num>>;

  /** Soft cost as a total, OR softCostShareOfHard × hard costs. Soft site lines are added either way. */
  softCost?: Num;
  softCostShareOfHard?: Num;
  softSiteLines?: Partial<Record<SoftSiteLine, Num>>;

  /** Contingency as a total, OR contingencyShareOfHard × hard costs. */
  contingency?: Num;
  contingencyShareOfHard?: Num;

  /** Construction loan as an amount, OR loan-to-cost × (land + hard + soft + contingency). */
  constructionLoanAmount?: Num;
  constructionLoanLtc?: Num;
  constructionRate?: Num;
  /** Average share of the construction loan drawn over the build (drawn balance ÷ commitment). */
  averageDrawShare?: Num;
  /** Origination and other lender fees, dollars. */
  loanFees?: Num;

  /** Grants and subsidies that reduce the developer's equity. Enter [] when there are none. */
  grants?: CapitalLayer[];

  /** Annual discount rate for NPV. */
  discountRate?: Num;
}

export interface OperatingInputs {
  unitMix?: UnitRow[];
  vacancyShare?: Num;
  otherIncomeAnnual?: Num;

  // OPEX (annual)
  taxMills?: Num;
  assessedValue?: Num;
  propertyInsurance?: Num;
  maintenance?: Num;
  managementShareOfEgi?: Num;
  ownerUtilities?: Num;
  replacementReserves?: Num;
  /** Flood insurance, mine subsidence insurance (see msiAnnualPremium), vacancy reserve. */
  opexLines?: Partial<Record<OptionalOpexLine, Num>>;

  marketCapRate?: Num;
}

export interface RentalInputs extends DevelopmentInputs, OperatingInputs {
  /** Permanent loan as an amount, OR loan-to-value × stabilized value. */
  permanentLoanAmount?: Num;
  permanentLoanLtv?: Num;
  permanentRate?: Num;
  amortizationYears?: Num;

  holdYears?: Num;
  annualNoiGrowth?: Num;
  exitCapRate?: Num;
  exitSellingCostShare?: Num;
}

export interface ForSaleInputs extends DevelopmentInputs {
  unitMix?: UnitRow[];
  /** Broker, transfer tax and closing costs, as a share of gross sales. */
  sellingCostShare?: Num;
  /** Months over which units sell after construction ends. */
  salesMonths?: Num;
}

export interface AffordableInputs extends RentalInputs {
  /** Minimum DSCR the lender requires for the supportable (hard) debt. */
  minDscr?: Num;
  /** Equity the owner/investors commit, dollars. Do not repeat it in capitalStack. */
  requiredEquity?: Num;
  /** Layers that fill the gap: LIHTC equity, HOME/CDBG, PHARE, Housing Opportunity Fund, soft loans, grants... */
  capitalStack?: CapitalLayer[];
}
