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
export type PartialReason = "zoning" | "use" | "footprint" | "not_lot" | "no_outline" | "lot_mismatch" | "large_site" | "not_housing";

/** One meaning of "Pencils" everywhere (sale verdict at default assumptions vs the 15% target margin on cost). */
export const PENCIL_LABEL: Record<"yes" | "thin" | "no", string> = { yes: "Pencils", thin: "Thin margin", no: "Doesn't pencil" };
export const PENCIL_TIP: Record<"yes" | "thin" | "no", string> = {
  yes: "Pencils: meets the 15% target profit margin at default assumptions",
  thin: "Thin margin: profitable but below the 15% target",
  no: "Doesn't pencil: loses money at default assumptions",
};
/** Chip shown instead of a verdict when the lot itself is not verified (lotUnverifiable). */
export const LOT_REVIEW = "Review required";

/** County land use that is not a housing lot regardless of owner: a railroad in operation. */
export function notHousingUse(facts: unknown): string | null {
  const a = (facts as { assessment?: { use?: string | null; use_desc?: string | null } | null } | null)?.assessment;
  const use = a?.use ?? a?.use_desc ?? "";
  return /^(R\.R\.|RR-PP) - USED IN OPERATION$/i.test(use.trim()) ? "Railroad in operation" : null;
}

/** Lots over 2 acres are not modeled (EaseScore models 1–4 home buildings). */
export const LARGE_SITE_SQFT = 87_120;

/**
 * A lot we can't verify: no mapped outline, recorded (County) vs mapped lot area more than 2× apart, or a
 * mapped lot over 2 acres. Mirrored in SQL by migration 153 (planner_building_unscored); keep identical.
 */
export function lotUnverifiable(facts: unknown): "no_outline" | "lot_mismatch" | "large_site" | null {
  const f = facts as { lot_area_sqft_gis?: number | string | null; assessment?: { lot_area_sqft?: number | string | null } | null } | null;
  if (!f) return null;
  const mapped = Number(f.lot_area_sqft_gis) || 0, county = Number(f.assessment?.lot_area_sqft) || 0;
  if (mapped <= 0) return "no_outline";
  if (county > 0 && Math.max(county, mapped) > 2 * Math.min(county, mapped)) return "lot_mismatch";
  return mapped > LARGE_SITE_SQFT ? "large_site" : null;
}


/** The partial-screen headline for any reason (one wording everywhere). */
export function partialText(reason: PartialReason | string | null | undefined, opts: { municipality?: string | null; use?: string | null } = {}): string {
  switch (reason) {
    case "use": return buildingHeadline(opts.use ?? "a building");
    case "footprint": return "Partial screen: building footprints cover most of this lot, but the County records no building value on it, so our score treated it as an empty lot";
    case "not_lot": return `Partial screen: the County records this parcel as ${(opts.use ?? "air rights or a common area").toLowerCase()}, not a lot you can build on`;
    case "no_outline": return "No lot outline; fit not verified";
    case "lot_mismatch": return "Review required: lot size mismatch; survey first";
    case "large_site": return "Large site: not modeled (EaseScore models 1–4 home buildings)";
    // planner_other_public_land reason (street/right-of-way, park, parking, utility, transit, plaza, common area).
    case "not_housing": return `Not a housing lot: ${(opts.use ?? "public land").replace(/ \((lot shape|by name)\)$/, "").toLowerCase()}`;
    case "zoning": case null: case undefined: case "": return partialHeadline(opts.municipality);
    default: return "Partial screen: no Ease Score";
  }
}
