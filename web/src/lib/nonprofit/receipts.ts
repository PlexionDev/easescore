// Receipts (source, date, how computed) for every number the Nonprofit seat shows. Pure; used by the
// page and the advocacy brief so both cite the same way.

import type { Receipt } from "@/components/seats/ReceiptDrawer";
import type { ChasSummary, NeedSummary } from "./types";

export const acsVintage = (y: number | null) => (y ? `ACS 5-year ${y - 4}–${y}` : "ACS 5-year");
const ACS_URL = "https://data.census.gov/";
export const HUD_IL_URL = "https://www.huduser.gov/portal/datasets/il.html";
const QCT_URL = "https://www.huduser.gov/portal/datasets/qct.html";

export function rentBurdenReceipt(n: NeedSummary, hood: string, which: 30 | 50 = 30): Receipt {
  return {
    label: `Renters paying ${which}%+ of income on rent`,
    value: `${Math.round((which === 30 ? n.rb30 : n.rb50) ?? 0)}% of renter households`,
    source: `U.S. Census Bureau, American Community Survey, table B25070 (gross rent as a share of household income), by census tract`,
    url: ACS_URL,
    date: acsVintage(n.acsYear),
    method: `Renter households paying ${which}% or more of income on gross rent (rent plus utilities) ÷ renter households with the ratio computed. ${n.method}`,
    kind: "data",
    notes: "Survey estimates for small areas carry wide margins of error. Area context only; never used to score a parcel.",
  };
}

export function incomeReceipt(n: NeedSummary, median: number, ilYear: number): Receipt {
  return {
    label: "Median household income",
    value: n.income != null ? `$${Math.round(n.income).toLocaleString("en-US")}` : "—",
    source: "U.S. Census Bureau, ACS table B19013 (median household income), by census tract; HUD FY" + ilYear + " Income Limits (area median family income)",
    url: ACS_URL,
    date: `${acsVintage(n.acsYear)}; HUD FY${ilYear}`,
    method: `Tract median household income ÷ HUD's area median family income for the Pittsburgh HMFA ($${median.toLocaleString("en-US")}, 4-person). A household median and a family median are not the same measure, so the share is approximate. ${n.method}`,
    kind: "data",
    notes: "Area context only; never used to score a parcel.",
  };
}

export function ilReceipt(year: number, areaName: string, what: string, method: string): Receipt {
  return {
    label: what,
    source: `HUD FY${year} Income Limits, ${areaName} (Pittsburgh, PA HUD Metro FMR Area)`,
    url: HUD_IL_URL,
    date: `FY${year}`,
    method,
    kind: "data",
  };
}

export function qctReceipt(qct: boolean, dda: boolean): Receipt {
  return {
    label: "Qualified Census Tract / Difficult Development Area",
    value: `${qct ? "In a Qualified Census Tract" : "Not in a Qualified Census Tract"}${dda ? "; in a Difficult Development Area" : ""}`,
    source: "HUD Qualified Census Tracts and Difficult Development Areas (current year)",
    url: QCT_URL,
    date: "Current HUD designation year",
    method: "The census tract covering the area (or each lot) is checked against HUD's list. A QCT or DDA lets tax-credit projects claim a 130% basis boost.",
    kind: "data",
  };
}

export const EQUITY_NOTE =
  "Race and ethnicity are not used anywhere in this seat's calculations. Census income, rent and burden figures describe the area for context only and never feed a parcel's Ease Score.";

export function chasReceipt(c: ChasSummary, method: string): Receipt {
  return {
    label: "Households by income, and homes priced for them (HUD CHAS)",
    value: `${c.under50.toLocaleString("en-US")} households under 50% of area median; about ${c.afford50.toLocaleString("en-US")} rental homes priced for them; gap about ${c.gap.toLocaleString("en-US")}`,
    source: "HUD Comprehensive Housing Affordability Strategy (CHAS) data by census tract, HUD eGIS open data",
    url: "https://www.huduser.gov/portal/datasets/cp.html",
    date: c.vintage ?? "HUD CHAS",
    method: `Households under 50% of HUD area median family income (HAMFI) = households at or below 30% + households at 30–50%. Rental homes priced for them = rental units whose rent is affordable at 50% HAMFI. Gap = households − those homes. ${method}`,
    kind: "data",
    notes: "A rough gap: some of those affordable homes are rented by higher-income households, and some low-income households own, so the real shortfall differs. CHAS lags the ACS by several years. Area context only; never used to score a parcel.",
  };
}

export function lihtcReceipt(hood: string): Receipt {
  return {
    label: `Tax-credit (LIHTC) properties near ${hood}`,
    source: "HUD Low-Income Housing Tax Credit project database (HUD eGIS layer)",
    url: "https://www.huduser.gov/portal/datasets/lihtc.html",
    date: "Projects placed in service 1987–2019 (newer projects not in this release)",
    method: "Projects whose mapped location is inside the neighborhood or within half a mile of its boundary; income-restricted homes summed.",
    kind: "data",
    notes: "Street addresses of small properties are not shown.",
  };
}
