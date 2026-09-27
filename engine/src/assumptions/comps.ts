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
  /** City neighborhood (City parcels) or municipality (elsewhere); used to prefer same-area comps. */
  area?: string | null;
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
  area?: string | null;
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
  /** New construction: how the set was chosen, plain words (rule + resulting set). */
  selection?: {
    scope: "same_area" | "nearest";
    areas: string[];
    dropped: { row: CompRow; reason: string }[];
    p25PerSqft: number | null;
    p75PerSqft: number | null;
    receipt: string;
  } | null;
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
  subject: { lat: number; lon: number; parid?: string | null; area?: string | null },
  records: SaleRecord[],
  opts: { asOf: string; uses: string[]; useLabel: string; config?: CostConfig },
): CompSet {
  const r = (opts.config ?? COST_CONFIG).comps.newConstruction;
  const sel = r.selection;
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
    pool.push({ parid: s.parid, address: s.address ?? null, saleDate: s.saleDate, price: s.price, livingAreaSqft: s.livingAreaSqft, pricePerSqft: s.price / s.livingAreaSqft, yearBuilt: s.yearBuilt, distanceMi: Math.round(d * 1000) / 1000, area: s.area ?? null });
  }
  pool.sort(byNearest);

  // 1) Same neighborhood / municipality when it has enough sales; else nearest by distance.
  const area = subject.area?.trim() || null;
  const same = area ? pool.filter((p) => (p.area ?? "").toUpperCase() === area.toUpperCase()) : [];
  const scope: "same_area" | "nearest" = area && same.length >= sel.sameAreaMinComps ? "same_area" : "nearest";
  const cands = scope === "same_area" ? same : pool;

  // 2) Widen by radius until nearestMin sales, then keep the nearest nearestMax.
  const steps: string[] = [];
  let reach = radii[0]!;
  let inside: CompRow[] = [];
  for (const rr of radii) {
    inside = cands.filter((p) => p.distanceMi <= rr);
    steps.push(`${inside.length} within ${rr} mi`);
    reach = rr;
    if (inside.length >= sel.nearestMin) break;
  }
  let chosen = inside.slice(0, sel.nearestMax);

  // 3) Drop $/SF outliers beyond k × IQR from the quartiles.
  const dropped: { row: CompRow; reason: string }[] = [];
  const q = (xs: number[], f: number) => {
    const v = [...xs].sort((x, y) => x - y);
    const pos = (v.length - 1) * f;
    const i = Math.floor(pos);
    return v[i]! + (v[Math.min(i + 1, v.length - 1)]! - v[i]!) * (pos - i);
  };
  if (chosen.length >= 4) {
    const ps = chosen.map((c) => c.pricePerSqft);
    const q1 = q(ps, 0.25), q3 = q(ps, 0.75), k = sel.outlierIqrMultiplier * (q3 - q1);
    const lo = q1 - k, hi = q3 + k;
    const keep: CompRow[] = [];
    for (const c of chosen) {
      if (c.pricePerSqft < lo || c.pricePerSqft > hi)
        dropped.push({ row: c, reason: `$${Math.round(c.pricePerSqft)}/SF is ${c.pricePerSqft > hi ? "above" : "below"} the outlier limit ($${Math.round(Math.max(0, lo))}–$${Math.round(hi)}/SF, ${sel.outlierIqrMultiplier}× the middle-half spread)` });
      else keep.push(c);
    }
    chosen = keep;
  }
  const farthest = chosen.length ? Math.max(...chosen.map((c) => c.distanceMi)) : reach;
  const used = chosen.length ? radii.find((rr) => farthest <= rr) ?? maxR : reach;
  const shownSteps = steps.slice(0, Math.max(1, radii.indexOf(used) + 1));
  const ok = chosen.length >= r.minComps;
  const areas = [...new Set(chosen.map((c) => c.area).filter((x): x is string => !!x))].sort();
  const ps = chosen.map((c) => c.pricePerSqft);
  const p25 = ps.length ? Math.round(q(ps, 0.25)) : null, p75 = ps.length ? Math.round(q(ps, 0.75)) : null;
  const med = median(ps);
  const scopeText = scope === "same_area" ? `same ${area} area (${same.length} sales there)` : area ? `nearest sales by distance (${same.length ? `only ${same.length}` : "none"} in ${area})` : "nearest sales by distance";
  const receipt = `Rule: sales in the same neighborhood (or municipality) when it has ${sel.sameAreaMinComps}+, otherwise the nearest by distance; widen until ${sel.nearestMin}, keep the nearest ${sel.nearestMax}; drop sales beyond ${sel.outlierIqrMultiplier}× the middle-half spread of $/SF. Result: ${chosen.length} sale${chosen.length === 1 ? "" : "s"} from the ${scopeText}${areas.length ? `, in ${areas.join(", ")}` : ""}${med != null ? `; median $${Math.round(med)}/SF, middle half $${p25}–$${p75}/SF` : ""}${dropped.length ? `; ${dropped.length} dropped as outliers` : ""}.`;
  const note = ok
    ? used > radii[0]! && scope === "nearest" ? `Search widened to ${used} mi (${shownSteps.join("; ")}).` : null
    : `Insufficient new-construction comps: only ${chosen.length} sale(s) of homes built within ${r.maxAgeAtSaleYears} years of the sale, within ${reach} mi in the last ${r.years} years (${steps.join("; ")}). No new-home value is estimated.`;
  const set = summarize(chosen, {
    kind: "new_construction",
    status: ok ? "ok" : "insufficient comps",
    sufficient: ok,
    radius_mi: ok ? used : reach,
    search_steps: ok ? shownSteps : steps,
    comparable_use: `new ${opts.useLabel}`,
    note,
    rule: r.rule,
    sourceLabel: r.sourceLabel,
  });
  return { ...set, selection: { scope, areas, dropped, p25PerSqft: p25, p75PerSqft: p75, receipt } };
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
  subject: { lat: number; lon: number; parid?: string | null; area?: string | null },
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
