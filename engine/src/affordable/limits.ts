// Income and rent limits by household size from HUD Income Limits (the hud_income_limits row), and
// the 30% rule. Pure; every output carries the formula used, in plain words.

import raw from "../../config/capital-sources.v0.1.json";

export type CapitalConfig = typeof raw;
export const CAPITAL_CONFIG: CapitalConfig = raw;

/** One hud_income_limits row: il30_p1..p8, il50_p1..p8, il80_p1..p8 and the area median family income. */
export interface IncomeLimitsRow {
  year: number;
  area_code?: string | null;
  county_name?: string | null;
  median_income: number | string | null;
  [k: string]: unknown;
}

export interface IncomeLimits {
  year: number;
  areaName: string;
  /** Area median family income (4-person). */
  median: number;
  /** Published limits by household size 1..8 (index 0 = 1 person). */
  il30: number[];
  il50: number[];
  il80: number[];
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

/** Parse the database row; null when any published limit is missing. */
export function parseIncomeLimits(row: IncomeLimitsRow | null | undefined): IncomeLimits | null {
  if (!row) return null;
  const pick = (band: 30 | 50 | 80) => Array.from({ length: 8 }, (_, i) => n(row[`il${band}_p${i + 1}`]));
  const il30 = pick(30), il50 = pick(50), il80 = pick(80);
  const median = n(row.median_income);
  if (median == null || [...il30, ...il50, ...il80].some((x) => x == null)) return null;
  return { year: row.year, areaName: row.county_name ?? "HUD area", median, il30: il30 as number[], il50: il50 as number[], il80: il80 as number[] };
}

export const AMI_LEVELS = [30, 50, 60, 80] as const;
export type AmiPct = number;

/**
 * Income limit for a household size (1–8) at an AMI percentage.
 * 30 / 50 / 80: HUD's published limits. 60: 1.2 × the 50% limit (HUD MTSP convention).
 * Any other percentage: the 50% limit scaled by pct / 50 (labeled derived).
 */
export function incomeLimit(il: IncomeLimits, amiPct: AmiPct, householdSize: number, cfg: CapitalConfig = CAPITAL_CONFIG): { value: number; basis: string } {
  const size = Math.max(1, Math.round(householdSize));
  if (size > 8) {
    // HUD: each person above 8 adds 8% of the 4-person limit; rounded up to the next $50.
    const f = 1.32 + 0.08 * (size - 8);
    const scaled: IncomeLimits = { ...il, il30: [...il.il30], il50: [...il.il50], il80: [...il.il80] };
    for (const k of ["il30", "il50", "il80"] as const) scaled[k][7] = Math.ceil((il[k][3]! * f) / 50) * 50;
    const r = incomeLimit(scaled, amiPct, 8, cfg);
    return { value: r.value, basis: `${r.basis.replace("8-person", `${size}-person`)} (HUD: +8% of the 4-person limit per person above 8)` };
  }
  const i = size - 1;
  const hh = `${i + 1}-person household`;
  if (amiPct === 30) return { value: il.il30[i]!, basis: `HUD FY${il.year} extremely-low (30%) income limit, ${hh}` };
  if (amiPct === 50) return { value: il.il50[i]!, basis: `HUD FY${il.year} very-low (50%) income limit, ${hh}` };
  if (amiPct === 80) return { value: il.il80[i]!, basis: `HUD FY${il.year} low (80%) income limit, ${hh}` };
  if (amiPct === 60) {
    const f = cfg.rentRule.sixtyPctFactor.value;
    return { value: Math.round(il.il50[i]! * f), basis: `${f} × HUD FY${il.year} very-low (50%) income limit, ${hh} (HUD MTSP 60% convention)` };
  }
  return { value: Math.round((il.il50[i]! * amiPct) / 50), basis: `${amiPct}/50 × HUD FY${il.year} very-low (50%) income limit, ${hh} (derived)` };
}

/** Affordable monthly housing cost for a household at the 30% rule (rent plus utilities). */
export function affordableMonthly(income: number, cfg: CapitalConfig = CAPITAL_CONFIG): number {
  return Math.floor((income * cfg.rentRule.incomeShare.value) / 12);
}

export interface RentLimit {
  amiPct: number;
  bedrooms: number;
  /** Imputed household size (1.5 per bedroom; 1 for an efficiency). */
  persons: number;
  /** Income used (average of the two bracketing sizes for half persons). */
  income: number;
  /** Maximum gross rent: rent plus tenant-paid utilities. */
  grossRent: number;
  /** Tenant-paid utility allowance (placeholder, labeled). */
  utilityAllowance: number;
  utilitySource: string;
  /** Rent the owner collects: gross rent minus the utility allowance. */
  netRent: number;
  formula: string;
}

/**
 * LIHTC-style maximum rent by bedrooms: household size = 1.5 × bedrooms (1 for an efficiency), the
 * income limit for that size (averaging the two sizes around a half person), 30% of it, / 12, rounded
 * down to the dollar. Matches PHFA's published LIHTC rent limits for Allegheny County.
 */
export function rentLimit(il: IncomeLimits, amiPct: number, bedrooms: number, cfg: CapitalConfig = CAPITAL_CONFIG): RentLimit {
  const br = Math.max(0, Math.round(bedrooms));
  const persons = br === 0 ? 1 : cfg.rentRule.personsPerBedroom.value * br;
  const lo = Math.floor(persons), hi = Math.ceil(persons);
  const income = lo === hi ? incomeLimit(il, amiPct, lo, cfg).value : (incomeLimit(il, amiPct, lo, cfg).value + incomeLimit(il, amiPct, hi, cfg).value) / 2;
  const share = cfg.rentRule.incomeShare.value;
  const grossRent = Math.floor((income * share) / 12);
  const uaList = cfg.utilityAllowance.byBedrooms;
  const ua = uaList[Math.min(br, uaList.length - 1)]!;
  const sizeText = lo === hi ? `${lo}-person` : `average of ${lo}- and ${hi}-person`;
  return {
    amiPct, bedrooms: br, persons, income: Math.round(income), grossRent, utilityAllowance: ua, utilitySource: cfg.utilityAllowance.sourceLabel,
    netRent: Math.max(0, grossRent - ua),
    formula: `${amiPct}% AMI income, ${sizeText} household (${persons} persons for ${br === 0 ? "an efficiency" : `${br} bedroom${br > 1 ? "s" : ""}`}) = $${Math.round(income).toLocaleString("en-US")} × 30% ÷ 12 = $${grossRent.toLocaleString("en-US")} a month including utilities`,
  };
}

/** "A family of 3 at 60% AMI earns about $53,640; affordable rent is about $1,341 a month including utilities." */
export function householdSentence(il: IncomeLimits, amiPct: number, householdSize: number, cfg: CapitalConfig = CAPITAL_CONFIG): { income: number; monthly: number; text: string; basis: string } {
  const lim = incomeLimit(il, amiPct, householdSize, cfg);
  const monthly = affordableMonthly(lim.value, cfg);
  const who = householdSize === 1 ? "A single adult" : `A family of ${householdSize}`;
  return {
    income: lim.value, monthly,
    text: `${who} at ${amiPct}% of the area median earns up to about $${lim.value.toLocaleString("en-US")} a year; an affordable rent is about $${monthly.toLocaleString("en-US")} a month including utilities.`,
    basis: `${lim.basis}; 30% of income ÷ 12`,
  };
}

export interface LadderRung {
  id: string;
  label: string;
  /** Income range for the chosen household size. */
  incomeLow: number;
  incomeHigh: number | null;
  /** Most a household at the top of the band can pay (30% rule), per month. */
  affordableRent: number | null;
  basis: string;
}

/** Income bands (HAMFI-style) for one household size, with the rent a household at the top of each band can afford. */
export function incomeLadder(il: IncomeLimits, householdSize = 3, cfg: CapitalConfig = CAPITAL_CONFIG): LadderRung[] {
  const i = Math.min(8, Math.max(1, householdSize)) - 1;
  // 100% for this size: HUD's family-size adjustment (1 person 70%, 2 80%, 3 90%, 4 100%, +8% each above 4).
  const adj = [0.7, 0.8, 0.9, 1, 1.08, 1.16, 1.24, 1.32][i]!;
  const m100 = Math.round((il.median * adj) / 50) * 50;
  const a30 = il.il30[i]!, a50 = il.il50[i]!, a80 = il.il80[i]!;
  const rent = (x: number) => affordableMonthly(x, cfg);
  return [
    { id: "le30", label: "Under 30% AMI", incomeLow: 0, incomeHigh: a30, affordableRent: rent(a30), basis: `HUD FY${il.year} 30% limit, ${i + 1} persons` },
    { id: "30_50", label: "30–50% AMI", incomeLow: a30, incomeHigh: a50, affordableRent: rent(a50), basis: `HUD FY${il.year} 50% limit, ${i + 1} persons` },
    { id: "50_80", label: "50–80% AMI", incomeLow: a50, incomeHigh: a80, affordableRent: rent(a80), basis: `HUD FY${il.year} 80% limit, ${i + 1} persons` },
    { id: "80_100", label: "80–100% AMI", incomeLow: a80, incomeHigh: m100, affordableRent: rent(m100), basis: `HUD FY${il.year} median family income $${il.median.toLocaleString("en-US")} × ${adj} family-size adjustment` },
    { id: "gt100", label: "Over 100% AMI", incomeLow: m100, incomeHigh: null, affordableRent: null, basis: "Above the area median" },
  ];
}
