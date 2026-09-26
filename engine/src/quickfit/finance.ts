// Cost and revenue for one scheme. Every dollar input comes from the caller's cost table and
// revenue inputs; this module contains no dollar figures. Missing inputs give null outputs.

import type { CostTable, Finance, ParkingOption, RevenueInputs, TypologyId } from "./types";

export interface FinanceBasis {
  typology: TypologyId;
  units: number;
  grossFloorAreaSf: number;
  netFloorAreaSf: number;
  parking: ParkingOption;
  parkingSpaces: number;
  needsSubdivision: boolean;
}

const has = (x: number | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function schemeFinance(b: FinanceBasis, costs?: CostTable, revenue?: RevenueInputs): Finance {
  const notes: string[] = [];
  let hardCost: number | null = null;
  const psf = costs?.hardCostPerGsf?.[b.typology];
  if (!has(psf)) notes.push(`No hard cost per gross sf for "${b.typology}" in the cost table.`);
  else {
    hardCost = psf * b.grossFloorAreaSf;
    if (b.parking === "surface" && b.parkingSpaces > 0) {
      if (has(costs?.surfaceParkingCostPerSpace)) hardCost += costs.surfaceParkingCostPerSpace * b.parkingSpaces;
      else {
        hardCost = null;
        notes.push("No surface parking cost per space in the cost table.");
      }
    }
    if (hardCost !== null && b.parking === "garage" && has(costs?.garagePremiumPerSpace))
      hardCost += costs.garagePremiumPerSpace * b.parkingSpaces;
  }

  let softCost: number | null = null;
  if (hardCost !== null) {
    if (has(costs?.softCostPctOfHard)) softCost = hardCost * costs.softCostPctOfHard;
    else notes.push("No soft cost percentage in the cost table.");
  }

  let totalCost: number | null = null;
  if (hardCost !== null && softCost !== null) {
    totalCost = hardCost + softCost;
    if (has(costs?.landCost)) totalCost += costs.landCost;
    else notes.push("Total cost excludes land (no land cost given).");
    if (b.needsSubdivision) {
      if (has(costs?.subdivisionCost)) totalCost += costs.subdivisionCost;
      else notes.push("Total cost excludes the subdivision plan (no subdivision cost given).");
    }
  }

  const tenure = revenue?.tenure ?? "sale";
  const capitalized = (monthly: number | undefined): number | null => {
    if (!has(monthly) || !has(revenue?.operatingExpenseRatio) || !has(revenue?.capRate) || revenue.capRate <= 0) return null;
    return (monthly * 12 * b.units * (1 - revenue.operatingExpenseRatio)) / revenue.capRate;
  };

  let rev: number | null = null;
  if (tenure === "sale") {
    if (has(revenue?.salePricePerNsf)) rev = revenue.salePricePerNsf * b.netFloorAreaSf;
    else notes.push("No sale price per net sf given.");
  } else {
    rev = capitalized(revenue?.monthlyRentPerUnit);
    if (rev === null) notes.push("Rent value needs monthly rent, operating expense ratio and cap rate.");
  }

  const profit = rev !== null && totalCost !== null ? rev - totalCost : null;
  const returnOnCost = profit !== null && totalCost ? profit / totalCost : null;
  const affordableValue = capitalized(revenue?.affordableMonthlyRentPerUnit);
  const affordableGap = affordableValue !== null && totalCost !== null ? totalCost - affordableValue : null;

  return { hardCost, softCost, totalCost, revenue: rev, profit, returnOnCost, affordableGap, notes };
}
