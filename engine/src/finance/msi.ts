import { compute, type Num, type Receipt } from "./receipt";

/**
 * Pennsylvania Mine Subsidence Insurance (MSI) annual premium.
 *
 * Source: PA DEP, "Mine Subsidence Insurance Annual Premiums Rate Chart" (effective 2021-07-01),
 * https://www.depgreenport.state.pa.us/elibrary/GetDocument?docId=4892808&DocName=MINE%20SUBSIDENCE%20INSURANCE%20ANNUAL%20PREMIUMS%20RATE%20CHART.PDF
 * transcribed in data/seed/msi_rates.csv. Every row of that chart equals $3.75 + $0.25 per $1,000 of coverage,
 * for coverage from $10,000 to $1,000,000.
 */
export const MSI_CHART = {
  baseFee: 3.75,
  perThousand: 0.25,
  minCoverage: 10_000,
  maxCoverage: 1_000_000,
  effectiveDate: "2021-07-01",
  source:
    "PA DEP Mine Subsidence Insurance Annual Premiums Rate Chart (effective 2021-07-01); data/seed/msi_rates.csv",
} as const;

/** Annual MSI premium for a coverage amount, per the DEP chart: $3.75 + $0.25 × coverage ÷ $1,000. */
export function msiAnnualPremium(coverage: Num): Receipt {
  return compute(
    "Mine subsidence insurance, yearly premium (MSI)",
    "$3.75 + $0.25 × coverage ÷ $1,000 (PA DEP rate chart, effective 2021-07-01)",
    { coverage },
    ({ coverage: c }) => {
      if (c < MSI_CHART.minCoverage || c > MSI_CHART.maxCoverage) {
        return `the DEP chart covers $${MSI_CHART.minCoverage.toLocaleString("en-US")} to $${MSI_CHART.maxCoverage.toLocaleString("en-US")} of coverage`;
      }
      return MSI_CHART.baseFee + (MSI_CHART.perThousand * c) / 1000;
    },
  );
}
