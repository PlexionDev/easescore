// The building you entered: where zoning is not loaded (outside the City of Pittsburgh, or no district
// rules), the pro forma prices a building the user chooses instead of a site-fit layout. It is a size-only
// scheme (SchemeLike) passed through the same selectScheme -> buildDevelopmentInputs -> evaluateDevelopment
// path as every other option, so costs, comps, taxes and transfer tax are computed exactly as elsewhere.
// Zoning is never checked for it; every place that shows its numbers says so.

import type { SchemeLike } from "./selected";
import type { StrategyId } from "./types";

export type UserBuildingType = "single_family" | "duplex" | "townhouse";

export interface UserBuilding {
  type: UserBuildingType;
  /** Number of homes. */
  units: number;
  /** Finished (livable) sq ft per home. */
  sfPerHome: number;
}

export const USER_BUILDING_TYPES: { id: UserBuildingType; label: string; strategy: StrategyId; minUnits: number }[] = [
  { id: "single_family", label: "Single-family home", strategy: "new_sf", minUnits: 1 },
  { id: "duplex", label: "Duplex", strategy: "duplex", minUnits: 2 },
  { id: "townhouse", label: "Townhouses", strategy: "townhouse_row", minUnits: 2 },
];

/** Default: one single-family home, 1,800 sq ft finished. */
export const USER_BUILDING_DEFAULT: UserBuilding = { type: "single_family", units: 1, sfPerHome: 1800 };
export const USER_BUILDING_LIMITS = { units: [1, 12], sfPerHome: [400, 6000] } as const;
/** Query keys (parcel page and Feasibility study). */
export const USER_BUILDING_KEYS = { type: "ub_type", units: "ub_units", sfPerHome: "ub_sf" } as const;
/** Living floors assumed for the building you entered (only used to estimate its footprint for site costs). */
const STORIES = 2;
/** Net (finished) to gross floor area, the same placeholder share the site-fit solver uses. */
const EFFICIENCY = 0.85;

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Read ub_* keys; anything missing or invalid falls back to the default. Duplex is always 2 homes per building. */
export function readUserBuilding(sp: Record<string, string | string[] | undefined>): UserBuilding {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).replace(/[,\s]/g, "") : "");
  const t = USER_BUILDING_TYPES.find((x) => x.id === s(USER_BUILDING_KEYS.type)) ?? USER_BUILDING_TYPES[0]!;
  const u = Number(s(USER_BUILDING_KEYS.units));
  const sf = Number(s(USER_BUILDING_KEYS.sfPerHome));
  const units = s(USER_BUILDING_KEYS.units) && Number.isFinite(u) ? clamp(Math.round(u), USER_BUILDING_LIMITS.units) : t.id === USER_BUILDING_DEFAULT.type ? USER_BUILDING_DEFAULT.units : t.minUnits;
  const sfPerHome = s(USER_BUILDING_KEYS.sfPerHome) && Number.isFinite(sf) ? clamp(Math.round(sf), USER_BUILDING_LIMITS.sfPerHome) : USER_BUILDING_DEFAULT.sfPerHome;
  return { type: t.id, units: Math.max(t.minUnits, t.id === "duplex" ? 2 * Math.max(1, Math.round(units / 2)) : units), sfPerHome };
}

export function userBuildingStrategy(b: UserBuilding): StrategyId {
  return USER_BUILDING_TYPES.find((x) => x.id === b.type)!.strategy;
}

/** "1 single-family home, 1,800 sq ft" / "4 townhouses, 1,600 sq ft each". */
export function userBuildingText(b: UserBuilding): string {
  const sf = `${b.sfPerHome.toLocaleString("en-US")} sq ft`;
  if (b.type === "single_family") return b.units === 1 ? `1 single-family home, ${sf}` : `${b.units} single-family homes, ${sf} each`;
  if (b.type === "duplex") return b.units === 2 ? `1 duplex (2 homes), ${sf} each` : `${b.units / 2} duplexes (${b.units} homes), ${sf} each`;
  return `${b.units} townhouses, ${sf} each`;
}

/** The size-only scheme the pro forma prices (no footprint: site costs estimate it from finished area ÷ floors). */
export function userBuildingScheme(b: UserBuilding): SchemeLike {
  const net = b.units * b.sfPerHome;
  return { units: b.units, netFloorAreaSf: net, grossFloorAreaSf: Math.round(net / EFFICIENCY), stories: STORIES, typologyLabel: userBuildingText(b), userEntered: true };
}

/** Municipality in title case ("TURTLE CREEK" -> "Turtle Creek"). */
export function municipalityName(m: string | null | undefined): string {
  const s = (m ?? "").trim();
  return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s || "the municipality";
}

/** The banner on every number block priced on the building you entered. */
export function zoningNotCheckedBanner(municipality: string | null | undefined): string {
  return `Zoning not checked. This estimate assumes the building you entered is allowed; confirm with ${municipalityName(municipality)}.`;
}
