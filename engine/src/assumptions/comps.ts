// Comparable sales for valuing a finished home. Pure and deterministic: the caller passes the sale
// records and the "as of" date, so the same inputs give the same comp set.
//
// New builds are valued only from new-construction sales (homes built no more than N years before
// the sale year); older-home sales are never the value of a new build, only a labeled floor.
// Rehab is valued from existing-home sales of the same use, matched on living area and year built.

import { COST_CONFIG, type CostConfig } from "./config";

/** One valid arm's-length sale with the sold building's facts and location. */
export interface SaleRecord {
  parid: string;
  address?: string | null;
  saleDate: string;
  price: number;
  livingAreaSqft: number;
  yearBuilt: number;
  use: string;
  lat: number;
  lon: number;
}

export interface CompRow {
  parid: string;
  address: string | null;
  saleDate: string;
  price: number;
  livingAreaSqft: number;
  pricePerSqft: number;
  yearBuilt: number | null;
  distanceMi: number;
  condition?: string | null;
}

export interface CompSet {
  kind: "new_construction" | "existing_matched";
  status: "ok" | "insufficient comps";
  sufficient: boolean;
  count: number;
  radius_mi: number;
  search_steps: string[];
  comparable_use: string;
  median_price: number | null;
  median_price_per_sqft: number | null;
  median_living_area_sqft: number | null;
  year_built_range: { from: number; to: number } | null;
  date_range: { from: string | null; to: string | null } | null;
  /** Plain note: widened search, insufficient comps, fallback. */
  note: string | null;
  rule: string;
  sourceLabel: string;
  /** Up to 25 nearest comps used. */
  comps: CompRow[];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

const R_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}

const byNearest = (a: CompRow, b: CompRow) => a.distanceMi - b.distanceMi || (a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0) || (a.parid < b.parid ? -1 : a.parid > b.parid ? 1 : 0);

function summarize(rows: CompRow[], base: Omit<CompSet, "count" | "median_price" | "median_price_per_sqft" | "median_living_area_sqft" | "year_built_range" | "date_range" | "comps">): CompSet {
  const years = rows.map((r) => r.yearBuilt).filter((y): y is number => y != null);
  const dates = rows.map((r) => r.saleDate).sort();
  return {
    ...base,
    count: rows.length,
    median_price: median(rows.map((r) => r.price)),
    median_price_per_sqft: median(rows.map((r) => r.pricePerSqft)),
    median_living_area_sqft: median(rows.map((r) => r.livingAreaSqft)),
    year_built_range: years.length ? { from: Math.min(...years), to: Math.max(...years) } : null,
    date_range: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    comps: [...rows].sort(byNearest).slice(0, 25),
  };
}

/**
 * New-construction comps around a point: sales in the last `years` years (before `asOf`), same use,
 * built no more than `maxAgeAtSaleYears` before the sale year. Widens ¼ → 3 miles until `minComps`.
 */
export function newConstructionComps(
  subject: { lat: number; lon: number; parid?: string | null },
  records: SaleRecord[],
  opts: { asOf: string; uses: string[]; useLabel: string; config?: CostConfig },
): CompSet {
  const r = (opts.config ?? COST_CONFIG).comps.newConstruction;
  const since = `${Number(opts.asOf.slice(0, 4)) - r.years}${opts.asOf.slice(4, 10)}`;
  const uses = new Set(opts.uses.map((u) => u.toUpperCase()));
  const radii = r.radiiMi;
  const maxR = radii[radii.length - 1]!;
  const pool: CompRow[] = [];
  for (const s of records) {
    if (s.parid === subject.parid) continue;
    if (!uses.has(s.use.toUpperCase())) continue;
    if (s.saleDate < since || s.saleDate > opts.asOf) continue;
    if (!(s.price >= r.minPrice) || !(s.livingAreaSqft >= r.minLivingAreaSqft)) continue;
    if (!(s.yearBuilt >= Number(s.saleDate.slice(0, 4)) - r.maxAgeAtSaleYears)) continue;
    const d = distanceMi(subject.lat, subject.lon, s.lat, s.lon);
    if (d > maxR) continue;
    pool.push({ parid: s.parid, address: s.address ?? null, saleDate: s.saleDate, price: s.price, livingAreaSqft: s.livingAreaSqft, pricePerSqft: s.price / s.livingAreaSqft, yearBuilt: s.yearBuilt, distanceMi: Math.round(d * 1000) / 1000 });
  }
  const steps: string[] = [];
  let used = radii[0]!;
  let inside: CompRow[] = [];
  for (const rr of radii) {
    inside = pool.filter((p) => p.distanceMi <= rr);
    steps.push(`${inside.length} within ${rr} mi`);
    used = rr;
    if (inside.length >= r.minComps) break;
  }
  const ok = inside.length >= r.minComps;
  const note = ok
    ? used > radii[0]! ? `Search widened to ${used} mi to reach ${r.minComps} new-construction comps (${steps.join("; ")}).` : null
    : `Insufficient new-construction comps: only ${inside.length} sale(s) of homes built within ${r.maxAgeAtSaleYears} years of the sale, within ${used} mi in the last ${r.years} years (${steps.join("; ")}). No new-home value is estimated.`;
  return summarize(inside, {
    kind: "new_construction",
    status: ok ? "ok" : "insufficient comps",
    sufficient: ok,
    radius_mi: used,
    search_steps: steps,
    comparable_use: `new ${opts.useLabel}`,
    note,
    rule: r.rule,
    sourceLabel: r.sourceLabel,
  });
}

/** Existing-home comps from the same-use search, kept when size and age are close to the building's. */
export function matchedExistingComps(
  subject: { livingAreaSqft: number | null; yearBuilt: number | null },
  base: {
    comparable_use?: string | null;
    radius_mi?: number | null;
    search_steps?: string[] | null;
    comps?: { parid: string; address?: string | null; sale_date: string; price: number; living_area_sqft?: number | null; year_built?: number | null; condition_desc?: string | null; distance_mi: number }[] | null;
  } | null,
  config: CostConfig = COST_CONFIG,
): CompSet {
  const r = config.comps.existingMatch;
  const good = new Set(r.afterRepairConditions.map((x) => x.toUpperCase()));
  // After-repair value: only homes in Good or better condition; as-is sales of older homes are never the value.
  const all: CompRow[] = (base?.comps ?? [])
    .filter((c) => (c.living_area_sqft ?? 0) > 0 && c.price > 0 && good.has(String(c.condition_desc ?? "").toUpperCase()))
    .map((c) => ({ parid: c.parid, address: c.address ?? null, saleDate: c.sale_date, price: c.price, livingAreaSqft: c.living_area_sqft!, pricePerSqft: c.price / c.living_area_sqft!, yearBuilt: c.year_built ?? null, distanceMi: c.distance_mi, condition: c.condition_desc ?? null }));
  const la = subject.livingAreaSqft;
  const matched = all.filter((c) => la == null || Math.abs(c.livingAreaSqft - la) <= la * r.livingAreaTolerance);
  const useMatched = matched.length >= r.minComps;
  const rows = useMatched ? matched : all;
  const ok = rows.length >= r.minComps;
  const note = !ok
    ? `Insufficient after-repair comps: only ${rows.length} nearby sale(s) of homes in Good or better condition. No after-repair value is estimated.`
    : useMatched
      ? `After-repair value from ${matched.length} nearby sales of homes in Good or better condition within ${Math.round(r.livingAreaTolerance * 100)}% of the building's size.`
      : `Fewer than ${r.minComps} Good-or-better sales match the building's size, so all ${all.length} nearby Good-or-better sales are used.`;
  return summarize(rows, {
    kind: "existing_matched",
    status: ok ? "ok" : "insufficient comps",
    sufficient: ok,
    radius_mi: base?.radius_mi ?? 0,
    search_steps: base?.search_steps ?? [],
    comparable_use: base?.comparable_use ?? "same use",
    note,
    rule: r.rule,
    sourceLabel: r.sourceLabel,
  });
}

/**
 * New-construction comps for a strategy. Townhouse rows look for new attached homes first and fall
 * back to new single-family homes (per sq ft) when there are too few; other new builds use
 * single-family sales.
 */
export function newConstructionCompsFor(
  strategy: string,
  subject: { lat: number; lon: number; parid?: string | null },
  records: SaleRecord[],
  asOf: string,
  config: CostConfig = COST_CONFIG,
): CompSet {
  const r = config.comps.newConstruction;
  const sf = () => newConstructionComps(subject, records, { asOf, uses: r.singleFamilyUses, useLabel: "single-family homes", config });
  if (strategy !== "townhouse_row") return sf();
  const attached = newConstructionComps(subject, records, { asOf, uses: r.attachedUses, useLabel: "townhouses and rowhouses", config });
  if (attached.sufficient) return attached;
  const s = sf();
  return { ...s, note: `Too few new townhouse or rowhouse sales nearby (${attached.search_steps.join("; ")}), so new single-family sales are used per sq ft.${s.note ? ` ${s.note}` : ""}` };
}
