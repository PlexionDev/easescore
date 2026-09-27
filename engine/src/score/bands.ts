// Ease Score band words shown to people. Stored data (parcel_scores, parcel_pane, the config) keeps the
// short band codes ("Easy", "Moderate", "Hard", "Very hard"); every screen, export and report maps a code
// to its label here, so the words live in one place.

import type { Band } from "./types";
import { isCityParcel } from "./adapter";

export const BAND_LABEL: Record<Band, string> = {
  Easy: "Few barriers",
  Moderate: "Some barriers",
  Hard: "Significant barriers",
  "Very hard": "Major barriers",
};

/** Band codes in order, fewest barriers first. */
export const BAND_CODES: Band[] = ["Easy", "Moderate", "Hard", "Very hard"];

/** Label for parcels whose municipality's zoning is not loaded (no numeric score). */
export const PARTIAL = "Partial";

/** Caption under every displayed score. */
export const SCORE_CAPTION = "Measures barriers to building, not whether it's a good investment.";

/** "Easy" → "Few barriers"; "Partial" stays; null/unknown → fallback. */
export function bandLabel(band: string | null | undefined, fallback = "No score"): string {
  if (!band) return fallback;
  return (BAND_LABEL as Record<string, string>)[band] ?? band;
}

/** Replace band codes inside stored text ("Capped at Hard: …") with the labels. */
export function relabelBands(text: string): string {
  return text.replace(/\b(Capped at |at )(Very hard|Easy|Moderate|Hard)\b/g, (_m, pre: string, b: Band) => `${pre}${BAND_LABEL[b]}`);
}

/**
 * Is the parcel's zoning loaded? The same test the score's zoning factor uses: a City of Pittsburgh
 * parcel with a zoning district whose rules are transcribed. Elsewhere there is no numeric Ease Score.
 */
export function zoningLoaded(facts: unknown): boolean {
  const f = facts as { zoning?: { code?: string | null; rules?: unknown } | null } & Parameters<typeof isCityParcel>[0];
  return !!f && isCityParcel(f) && !!f.zoning?.code && f.zoning.rules != null;
}

/** "Partial screen: zoning not available for Turtle Creek" (municipality in title case). */
export function partialHeadline(municipality: string | null | undefined): string {
  const m = (municipality ?? "").trim();
  const name = m && m === m.toUpperCase() ? m.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : m;
  return `Partial screen: zoning not available for ${name || "this municipality"}`;
}

/**
 * County land uses that mean a building stands on the lot. Mirrored in SQL by
 * public.score_building_unscored() (migration 146); keep the two patterns identical.
 */
export const BUILDING_USE_RE = /OFFICE|CONDOMINIUM (UNIT|OFFICE)|RETL|RETAIL|RESTAURANT|WAREHOUSE|MANUFACTURING|GARAGE|APART|APT|HOTEL|MOTEL|STORE|BANK|HOSPITAL|CHURCH|BUILDING|FAMILY|ROWHOUSE|TOWNHOUSE|DWELLING|NURSING|THEAT|CLUB|BOWLING|SCHOOL|MIXED|SERVICE STATION|DAY CARE|FUNERAL|INDUSTRIAL|MEDICAL|CLINIC/i;
/** Uses that match the pattern above but are not a building worth scoring (a shed on a vacant lot, land). */
export const BUILDING_USE_EXCLUDE_RE = /NO HOUSE|VACANT|LAND\b|LOTS/i;

/**
 * The score treated the lot as empty (no building value, year built or footprint on record) but the
 * County's land use says a building stands there (e.g. an office tower or a condominium unit whose
 * building value is recorded elsewhere). Its new-build score is not trustworthy: shown as a partial screen.
 */
export function buildingUnscored(facts: unknown): string | null {
  const a = (facts as { assessment?: { use?: string | null; use_desc?: string | null; fmv_building?: number | string | null; year_built?: number | null } | null; building_footprint_sqft?: number | null } | null);
  const use = a?.assessment?.use ?? a?.assessment?.use_desc ?? null;
  const present = Number(a?.assessment?.fmv_building ?? 0) > 0 || !!a?.assessment?.year_built || Number(a?.building_footprint_sqft ?? 0) > 0;
  if (present || !use) return null;
  return BUILDING_USE_RE.test(use) && !BUILDING_USE_EXCLUDE_RE.test(use) ? use : null;
}

/** "Partial screen: the County records an existing building (office-elevator -3 + stories) that the score treated as an empty lot". */
export function buildingHeadline(use: string): string {
  return `Partial screen: the County records an existing building (${use.toLowerCase()}) that our score treated as an empty lot`;
}

/** Why a parcel has no numeric score: its zoning is not loaded, or the score treated a built-on parcel as an empty lot. */
export type PartialReason = "zoning" | "use" | "footprint" | "not_lot";

/** The partial-screen headline for any reason (one wording everywhere). */
export function partialText(reason: PartialReason | string | null | undefined, opts: { municipality?: string | null; use?: string | null } = {}): string {
  switch (reason) {
    case "use": return buildingHeadline(opts.use ?? "a building");
    case "footprint": return "Partial screen: building footprints cover most of this lot, but the County records no building value on it, so our score treated it as an empty lot";
    case "not_lot": return `Partial screen: the County records this parcel as ${(opts.use ?? "air rights or a common area").toLowerCase()}, not a lot you can build on`;
    default: return partialHeadline(opts.municipality);
  }
}
