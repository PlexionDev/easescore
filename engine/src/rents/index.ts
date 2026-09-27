// Rent by bedroom count: RentCast market statistics for the parcel's ZIP (median asking rent by
// bedroom count), or asking-rent comps (RentCast listings, no longer pulled by default), summarized
// into {likely, low, high}, cross-checked against HUD Small Area Fair Market Rents and ZORI.
// Deterministic: the same listings, benchmarks and date always give the same numbers.
// When there are not enough listings, falls back to HUD (then ZORI), labeled as a benchmark.

import type { ZipMarket } from "./market";
export * from "./market";

/** One rental listing, already stripped to listing facts (never owner, agent or contact fields). */
export interface RentListing {
  /** Full street address. Screen shows blockLevelAddress(); only the downloadable report shows this. */
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  propertyType: string | null;
  /** Asking rent, $/month. */
  price: number;
  /** Miles from the parcel. */
  distanceMi: number;
  /** ISO date the listing was last seen active (falls back to listed date). */
  lastSeen: string | null;
  yearBuilt: number | null;
}

/** HUD Small Area FMR row for the parcel's ZIP (parcel_rent_comps.hud_fmr). */
export interface HudBenchmark { year: number | null; zip: string | null; level?: string | null; br0?: number | null; br1?: number | null; br2?: number | null; br3?: number | null; br4?: number | null }
/** Zillow Observed Rent Index for the ZIP (all homes, not by bedroom). */
export interface ZoriBenchmark { zip: string | null; latest_rent: number | null; latest_month: string | null; rent_12m_ago?: number | null }

export interface RentsInput {
  /** YYYY-MM-DD; comps older than 6 months before this are dropped. */
  asOf: string;
  /** Bedroom counts to estimate (default 1, 2, 3). */
  bedrooms?: number[];
  /** Listings by bedroom count (the pull for that count). Missing key or null = RentCast unavailable for it. */
  listings: Record<number, RentListing[] | null>;
  /** When the listings were pulled (ISO date), for the source line. */
  pulledOn?: string | null;
  /** RentCast market statistics for the parcel's ZIP (used when there are no listing comps). */
  market?: ZipMarket | null;
  /** Why there are no market statistics (e.g. "RentCast limit reached; showing HUD Fair Market Rent."). */
  marketNote?: string | null;
  hud: HudBenchmark | null;
  zori: ZoriBenchmark | null;
  /** Target home size by bedroom count (sq ft); defaults to TARGET_SQFT. */
  targetSqft?: Record<number, number>;
}

export type RentBasis = "rentcast_comps" | "rentcast_market" | "hud_safmr" | "zori" | "none";

export interface RentCompRow {
  /** Block-level ("400 block of Roberts St") — safe for the screen. */
  block: string;
  /** Full address — for the downloadable report only. */
  address: string;
  price: number;
  /** Price after the size adjustment (equal to price when size is unknown). */
  adjusted: number;
  squareFootage: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  distanceMi: number;
  lastSeen: string | null;
}

export interface RentEstimate {
  bedrooms: number;
  /** $/month, rounded to the nearest $50. null = no evidence at all. */
  likely: number | null;
  low: number | null;
  high: number | null;
  basis: RentBasis;
  /** Plain label for the basis, e.g. "Asking rents from 14 nearby listings (RentCast, Sep 2026)". */
  basisLabel: string;
  comps: RentCompRow[];
  compCount: number;
  /** Radius the comps came from after widening, miles; null when not from comps. */
  radiusMi: number | null;
  /** Target size used by the size band and adjustment. */
  targetSqft: number;
  /** How the rules were applied, in words. */
  rules: string;
  /** How likely/low/high were computed, in words. */
  method: string;
  /** Benchmarks for this bedroom count, side by side. */
  hud: number | null;
  zori: number | null;
  /** Listings found but not enough (< MIN_COMPS) — why the fallback was used. */
  note: string | null;
  /** RentCast ZIP statistics behind this estimate (basis rentcast_market). */
  market?: { zip: string; retrievedOn: string; median: number; average: number | null; min: number | null; max: number | null; listings: number } | null;
  /** YYYY-MM-DD the RentCast data was retrieved (basis rentcast_market). */
  retrievedOn?: string | null;
}

export interface RentSource { label: string; asOf: string | null; url: string }

export interface RentsByBedroom {
  asOf: string;
  byBedroom: Record<number, RentEstimate>;
  hud: HudBenchmark | null;
  zori: ZoriBenchmark | null;
  sources: RentSource[];
  caveat: string;
}

export const MIN_COMPS = 5;
export const RADII_MI = [0.5, 1, 1.5, 2, 3] as const;
export const MAX_DAYS_OLD = 183;
/** Size band around the target size: comps with a known size outside ±35% are dropped. */
export const SIZE_BAND = 0.35;
/** Rent rises less than size: adjusted = price × (target / size)^0.35, capped at ±15%. Assumption. */
export const SIZE_ELASTICITY = 0.35;
export const SIZE_ADJ_CAP = 0.15;
/** Fallback range around a HUD/ZORI benchmark when there are no comps (labeled, not a market range). */
export const FALLBACK_BAND = 0.1;
/** Typical new-construction home size by bedroom count, sq ft (assumption, editable). */
export const TARGET_SQFT: Record<number, number> = { 0: 500, 1: 700, 2: 950, 3: 1250, 4: 1550 };
export const CAVEAT = "Asking rents often run above signed leases; no new-construction premium assumed unless the data shows one.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Nearest $50. */
export const round50 = (x: number): number => Math.round(x / 50) * 50;

/** "2026-09-27" → "Sep 2026". */
export function monthYear(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "date unknown";
}

/** Linear-interpolated percentile of a sorted array (p in 0..1). */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * Block-level address for the screen: "412 Roberts St, Pittsburgh, PA 15219" → "400 block of Roberts St".
 * Ranges ("412-414 Roberts St") use the first number; unit suffixes are dropped; numbers under 100
 * give "1–99 block of …". No house number → the street name alone.
 */
export function blockLevelAddress(address: string): string {
  const line1 = (address.split(",")[0] ?? "").trim();
  const noUnit = line1.replace(/\s+(?:apt|unit|ste|suite|#|fl|floor|rear)\b.*$/i, "").replace(/\s+#.*$/, "").trim();
  const m = /^(\d+)[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?\s+(.+)$/.exec(noUnit);
  if (!m) return noUnit || "Address withheld";
  const n = Number(m[1]);
  const street = m[2]!.trim();
  return n < 100 ? `1–99 block of ${street}` : `${Math.floor(n / 100) * 100} block of ${street}`;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000;
}

const hudFor = (h: HudBenchmark | null, br: number): number | null => {
  if (!h) return null;
  const v = (h as unknown as Record<string, number | null | undefined>)[`br${Math.min(4, Math.max(0, br))}`];
  return typeof v === "number" && v > 0 ? v : null;
};

/** One bedroom count. */
export function rentForBedrooms(br: number, listings: RentListing[] | null, input: Pick<RentsInput, "asOf" | "hud" | "zori" | "pulledOn" | "targetSqft" | "market" | "marketNote">): RentEstimate {
  const target = input.targetSqft?.[br] ?? TARGET_SQFT[br] ?? 1000;
  const hud = hudFor(input.hud, br);
  const zori = input.zori?.latest_rent != null ? Math.round(input.zori.latest_rent) : null;
  const brWord = br === 0 ? "studio" : `${br}-bedroom`;
  const rules = `Same bedrooms (${brWord}); listed or seen in the last 6 months (${MAX_DAYS_OLD} days); size within ±${Math.round(SIZE_BAND * 100)}% of ${target.toLocaleString("en-US")} sq ft when the size is known; radius starts at ${RADII_MI[0]} mi and widens (${RADII_MI.join(", ")} mi) until at least ${MIN_COMPS} listings.`;

  // Filter: bedrooms, recency, size band.
  const eligible = (listings ?? []).filter((l) =>
    l.bedrooms === br && l.price > 0 &&
    (l.lastSeen == null || daysBetween(l.lastSeen, input.asOf) <= MAX_DAYS_OLD) &&
    (l.squareFootage == null || Math.abs(l.squareFootage / target - 1) <= SIZE_BAND));

  // Widen the radius until MIN_COMPS.
  const MAX_R = RADII_MI[RADII_MI.length - 1]!;
  let radius: number = MAX_R;
  let picked = eligible.filter((l) => l.distanceMi <= radius);
  for (const r of RADII_MI) {
    const within = eligible.filter((l) => l.distanceMi <= r);
    if (within.length >= MIN_COMPS) { radius = r; picked = within; break; }
  }

  const comps: RentCompRow[] = picked
    .map((l) => {
      let adj = l.price;
      if (l.squareFootage != null && l.squareFootage > 0) {
        const f = Math.min(1 + SIZE_ADJ_CAP, Math.max(1 - SIZE_ADJ_CAP, (target / l.squareFootage) ** SIZE_ELASTICITY));
        adj = l.price * f;
      }
      return {
        block: blockLevelAddress(l.address), address: l.address, price: l.price, adjusted: Math.round(adj),
        squareFootage: l.squareFootage, bathrooms: l.bathrooms, propertyType: l.propertyType, distanceMi: Math.round(l.distanceMi * 100) / 100, lastSeen: l.lastSeen,
      };
    })
    .sort((a, b) => a.distanceMi - b.distanceMi);

  if (comps.length >= MIN_COMPS) {
    const s = comps.map((c) => c.adjusted).sort((a, b) => a - b);
    const sized = comps.filter((c) => c.squareFootage != null).length;
    return {
      bedrooms: br, likely: round50(pct(s, 0.5)), low: round50(pct(s, 0.25)), high: round50(pct(s, 0.75)),
      basis: "rentcast_comps",
      basisLabel: `Asking rents from ${comps.length} nearby listings (RentCast, ${monthYear(input.pulledOn ?? input.asOf)})`,
      comps, compCount: comps.length, radiusMi: radius, targetSqft: target, rules,
      method: `Likely = median of the ${comps.length} asking rents after a size adjustment (${sized} of ${comps.length} have a size: rent × (${target.toLocaleString("en-US")} ÷ size)^${SIZE_ELASTICITY}, capped at ±${Math.round(SIZE_ADJ_CAP * 100)}%). Range = middle half (25th to 75th percentile). All rounded to the nearest $50.`,
      hud, zori, note: null,
    };
  }

  // RentCast market statistics for the ZIP (median asking rent for this bedroom count).
  const ms = input.market?.byBedroom?.[br] ?? null;
  const msCount = ms?.totalListings ?? 0;
  if (input.market && ms && ms.medianRent != null && ms.medianRent > 0 && msCount >= MIN_COMPS) {
    const m = input.market;
    const med = ms.medianRent;
    const span = ms.minRent != null && ms.maxRent != null ? ` Listings ranged ${usd(Math.round(ms.minRent))}–${usdBare(Math.round(ms.maxRent))}${ms.averageRent != null ? `; average ${usd(Math.round(ms.averageRent))}` : ""}.` : "";
    return {
      bedrooms: br, likely: round50(med), low: round50(med * (1 - FALLBACK_BAND)), high: round50(med * (1 + FALLBACK_BAND)),
      basis: "rentcast_market",
      basisLabel: `RentCast market statistics for ZIP ${m.zip}, retrieved ${m.retrievedOn}`,
      comps: [], compCount: 0, radiusMi: null, targetSqft: target,
      rules: `All ${brWord} asking rents RentCast tracks in ZIP ${m.zip} (${msCount} listings). Not adjusted for size, age or condition.`,
      method: `Likely = RentCast's median asking rent for ${brWord} listings in ZIP ${m.zip}.${span} Range = ±${Math.round(FALLBACK_BAND * 100)}% around the median (an assumption, not a market range). All rounded to the nearest $50.`,
      hud, zori, note: null,
      market: { zip: m.zip, retrievedOn: m.retrievedOn, median: med, average: ms.averageRent, min: ms.minRent, max: ms.maxRent, listings: msCount },
      retrievedOn: m.retrievedOn,
    };
  }

  const why = input.market && ms
    ? `RentCast shows only ${msCount} ${brWord} listing${msCount === 1 ? "" : "s"} in ZIP ${input.market.zip} (need ${MIN_COMPS}); showing HUD Fair Market Rent.`
    : input.market
      ? `RentCast has no ${brWord} statistics for ZIP ${input.market.zip}; showing HUD Fair Market Rent.`
      : listings == null
        ? input.marketNote ?? "RentCast data unavailable; showing HUD Fair Market Rent."
        : `Only ${comps.length} matching listing${comps.length === 1 ? "" : "s"} within ${RADII_MI[RADII_MI.length - 1]!} mi (need ${MIN_COMPS}).`;
  const bench = hud != null
    ? { v: hud, basis: "hud_safmr" as const, label: `HUD Small Area Fair Market Rent FY${input.hud?.year ?? "?"}, ZIP ${input.hud?.zip ?? "?"} (benchmark, not listings)` }
    : zori != null
      ? { v: zori, basis: "zori" as const, label: `Zillow rent index, ZIP ${input.zori?.zip ?? "?"}, ${monthYear(input.zori?.latest_month)} (all home sizes, not by bedroom)` }
      : null;
  if (!bench) {
    return { bedrooms: br, likely: null, low: null, high: null, basis: "none", basisLabel: "No rent evidence for this location", comps, compCount: comps.length, radiusMi: null, targetSqft: target, rules, method: "No listings and no benchmark: enter a rent to test it.", hud, zori, note: why };
  }
  return {
    bedrooms: br, likely: round50(bench.v), low: round50(bench.v * (1 - FALLBACK_BAND)), high: round50(bench.v * (1 + FALLBACK_BAND)),
    basis: bench.basis, basisLabel: bench.label, comps, compCount: comps.length, radiusMi: null, targetSqft: target, rules,
    method: `Fallback: likely = the benchmark; range = ±${Math.round(FALLBACK_BAND * 100)}% around it (an assumption, not a market range). All rounded to the nearest $50.`,
    hud, zori, note: why,
  };
}

/** Rents for each bedroom count, with benchmarks, sources and the caveat. Interface for the pro forma. */
export function rentsByBedroom(input: RentsInput): RentsByBedroom {
  const brs = input.bedrooms ?? [1, 2, 3];
  const byBedroom: Record<number, RentEstimate> = {};
  for (const br of brs) byBedroom[br] = rentForBedrooms(br, input.listings[br] ?? null, input);
  const sources: RentSource[] = [];
  if (input.market && brs.some((b) => byBedroom[b]!.basis === "rentcast_market")) sources.push({ label: `RentCast market statistics for ZIP ${input.market.zip} (median asking rent by bedroom count)`, asOf: input.market.retrievedOn, url: "https://developers.rentcast.io/reference/market-statistics" });
  if (brs.some((b) => byBedroom[b]!.compCount > 0)) sources.push({ label: "RentCast rental listings (asking rents)", asOf: input.pulledOn ?? null, url: "https://www.rentcast.io/api" });
  if (input.hud) sources.push({ label: `HUD Small Area Fair Market Rents FY${input.hud.year ?? "?"}${input.hud.zip ? `, ZIP ${input.hud.zip}` : ""}`, asOf: input.hud.year != null ? `FY${input.hud.year}` : null, url: "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html" });
  if (input.zori) sources.push({ label: `Zillow Observed Rent Index (ZORI), ZIP ${input.zori.zip ?? "?"}`, asOf: input.zori.latest_month ?? null, url: "https://www.zillow.com/research/data/" });
  return { asOf: input.asOf, byBedroom, hud: input.hud, zori: input.zori, sources, caveat: CAVEAT };
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const usdBare = (n: number) => n.toLocaleString("en-US");

/**
 * The one-liner under the rent, e.g.
 * "$1,350–1,600/month for a 2-bedroom · likely $1,500. Asking rents from 14 nearby listings (RentCast, Sep 2026), checked against HUD and Zillow."
 */
export function rentOneLiner(e: RentEstimate): string {
  if (e.likely == null || e.low == null || e.high == null) return `No rent evidence for a ${e.bedrooms === 0 ? "studio" : `${e.bedrooms}-bedroom`} here. Enter a rent to test it.`;
  const what = e.bedrooms === 0 ? "a studio" : `a ${e.bedrooms}-bedroom`;
  const checks = [e.hud != null ? "HUD" : null, e.zori != null ? "Zillow" : null].filter(Boolean);
  const tail = e.basis === "rentcast_comps" || e.basis === "rentcast_market"
    ? `${e.basisLabel}${checks.length ? `, checked against ${checks.join(" and ")}` : ""}.`
    : `${e.basisLabel}. ${e.note ?? ""}`.trim();
  return `${usd(e.low)}–${usdBare(e.high)}/month for ${what} · likely ${usd(e.likely)}. ${tail}`;
}
