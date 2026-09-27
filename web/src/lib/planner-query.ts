// Planner seat ("Compare and rank sites"): the filter model and query builder for the precomputed
// parcel_scores table (supabase/migrations/090_parcel_scores.sql, filled by scripts/score_all.ts),
// plus text and CSV helpers. Pure (no I/O), so the engine's test runner can check it
// (engine/test/planner-query.test.ts). Data API reads are in ./planner.ts.
//
// The same filter semantics exist twice on purpose: filtersToDb() feeds planner_rows() in SQL, and
// matchRow() is its TypeScript mirror, used by the unit tests and to check exports against the table.

import { bandLabel, partialText, relabelBands } from "@easescore/engine/src/score/bands";

export type Band = "Easy" | "Moderate" | "Hard" | "Very hard";
export const BANDS: Band[] = ["Easy", "Moderate", "Hard", "Very hard"];
/** Stored band code → the words people see ("Few barriers" … "Major barriers"; "Partial" stays). */
export { bandLabel };
/** Band colors from the seat tokens (green to red). */
export const BAND_COLOR: Record<string, string> = {
  Easy: "#156b54",
  Moderate: "#8fbf9f",
  Hard: "#e0a84f",
  "Very hard": "#d9776a",
};
export const NO_BAND_COLOR = "#c9d1cd";
/** Partial screen (zoning not loaded, no numeric score): a hatched-looking slate, distinct from "No score". */
export const PARTIAL_COLOR = "#8e9aab";
BAND_COLOR.Partial = PARTIAL_COLOR;
export const FACTORS: { id: string; label: string; weight: number }[] = [
  { id: "F1", label: "Zoning permission", weight: 25 },
  { id: "F2", label: "Terrain", weight: 20 },
  { id: "F3", label: "Geohazards", weight: 15 },
  { id: "F4", label: "Access & utilities", weight: 15 },
  { id: "F5", label: "Approvals & time", weight: 15 },
  { id: "F6", label: "Lot readiness", weight: 5 },
  { id: "F7", label: "Market activity", weight: 5 },
];
export const STRATEGY_TEXT: Record<string, string> = {
  new_sf: "New single-family",
  duplex: "Duplex",
  three_four_unit: "3-4 units",
  townhouse_row: "Townhouse row",
  adu: "Backyard unit (ADU)",
  rehab_existing: "Rehab the existing building",
};
export const BADGE_NOTE = "Default weights, awaiting planning input";
export const PAGE_SIZE = 50;
/** Block-conformity filter steps, percent of a block face's buildings that don't meet today's code. */
export const BLOCK_NC = [50, 75];
export const MAP_LIMIT = 12000;
export const CITY = "PITTSBURGH";
export const FT_PER_M = 3.28084;

/** Owner types from parcel_owner_class (agency names for public owners only; never a private owner's name). */
export const OWNER_TYPES: { id: string; label: string; isPublic: boolean }[] = [
  { id: "city", label: "City of Pittsburgh", isPublic: true },
  { id: "ura", label: "URA / Land Bank", isPublic: true },
  { id: "hacp", label: "Housing Authority (HACP)", isPublic: true },
  { id: "county", label: "Allegheny County", isPublic: true },
  { id: "other_public", label: "Other public (PRT, schools, ALCOSAN, …)", isPublic: true },
  { id: "nonprofit", label: "Housing nonprofit (approx.)", isPublic: false },
  { id: "private", label: "Private", isPublic: false },
];

/** Blockers a planner can pick in "Only blocked by…" (labels written by scripts/score_all.ts). */
export const ONLY_BLOCKED_BY = [
  "Minimum lot size", "Lot area per unit", "Parking minimum", "Setbacks", "Use not permitted",
  "Special exception required", "Steep slope", "Small buildable area", "Lot too small for the building",
];

/**
 * Which Policy-seat lever relaxes a blocker, as the Policy seat's state key (/policy?s=<key>; see
 * engine/src/policy/levers.ts): m0 = no minimum lot size, pt = no parking minimum near frequent transit,
 * a35 = attached homes by right on lots up to 35 ft wide. Keys combine with "." in a, m, p order
 * (policyKey). Setbacks and slope have no lever yet, so they get no link.
 */
export const BLOCKER_LEVER: Record<string, { key: string; label: string } | undefined> = {
  "Minimum lot size": { key: "m0", label: "minimum lot size" },
  "Lot area per unit": { key: "m0", label: "lot area per unit" },
  "Lot too small for the building": { key: "a35", label: "attached-housing" },
  "Parking minimum": { key: "pt", label: "parking minimum near transit" },
  "Use not permitted": { key: "a35", label: "attached-housing" },
  "Special exception required": { key: "a35", label: "attached-housing" },
  "Conditional use required": { key: "a35", label: "attached-housing" },
};

/** Combined Policy state key for several levers, in the Policy seat's order (a, m, p). */
export function policyKey(keys: string[]): string {
  const order = (k: string) => "amp".indexOf(k[0]!);
  return [...new Set(keys)].sort((x, y) => order(x) - order(y)).join(".");
}

export interface PlannerRow {
  parid: string;
  address: string | null;
  score: number | null;
  /** "Partial": zoning not loaded for the municipality (no numeric score; migration 145). */
  band: Band | "Partial" | null;
  /** Why a Partial row has no score: zoning not loaded, or a built-on parcel the score treated as empty (migration 146). */
  partial_reason?: "zoning" | "use" | "footprint" | "not_lot" | null;
  /** The County land use behind partial_reason "use" / "not_lot". */
  partial_use?: string | null;
  range_lo: number | null;
  range_hi: number | null;
  preliminary: boolean;
  red_flag_count: number;
  red_flags: { id: string; title: string }[];
  top_blocker: string | null;
  blockers: string[];
  by_right_units: number | null;
  units_with_relief: number | null;
  months_to_permit: number | null;
  planning_badge: string | null;
  badge_score: number | null;
  badge_matches: Record<string, boolean | null> | null;
  factor_scores: Record<string, number | null> | null;
  best_strategy: string | null;
  vacant: boolean | null;
  /** public · nonprofit · private */
  owner_class: string | null;
  /** city · ura · hacp · county · other_public · nonprofit · private */
  owner_type: string | null;
  owner_agency: string | null;
  tax_delinquent: boolean | null;
  zoning: string | null;
  neighborhood: string | null;
  council_district: string | null;
  municipality: string | null;
  lot_sqft: number | null;
  lon: number | null;
  lat: number | null;
  transit_m: number | null;
  hz_floodway: boolean | null;
  hz_landslide: boolean | null;
  hz_undermined: boolean | null;
  steep_share: number | null;
  cap_label: string | null;
  rehab_score: number | null;
  rehab_band: Band | null;
  /** Set when the batch skipped the lot-fit test (unit counts empty). */
  note: string | null;
  config_version: string;
  data_dates: Record<string, string | null> | null;
  computed_at: string;
}

export interface PlannerSummary {
  total: number;
  bands: Record<string, number>;
  /** Share of parcels per blocker: n = parcels listing it, top = parcels where it is the top blocker. */
  blockers: { blocker: string; n: number; top: number }[];
  top_blockers: { blocker: string; n: number }[];
  no_blocker: number;
  capacity: { by_right: number; by_right_clean: number; relief: number; relief_clean: number; parcels_with_by_right: number; units_unknown: number };
  public_land: { count: number; acres: number; buildable_count: number; buildable_acres: number; by_agency: Record<string, number> };
  /**
   * Alleys/streets/right-of-way, parks and plazas, parking structures and lots, and utility and
   * transit land (§4.2): never ranked as housing sites (excluded in planner_rows by
   * public.planner_other_public_land, migration 141), shown here as a separate count instead.
   */
  other_public_land: { count: number; acres: number; by_reason: Record<string, number> };
}
export interface PlannerResult extends PlannerSummary { rows: PlannerRow[] }

export interface PlannerOptions {
  /** Municipalities with scored parcels. */
  municipalities: string[];
  /** All 130 county municipalities (name, type). */
  all_municipalities: { name: string; type: string }[];
  neighborhoods: string[];
  council_districts: string[];
  zoning: string[];
  blockers: { blocker: string; n: number }[];
  total: number;
  config_versions: string[];
  /** Rows per score config version (more than one while a rescore is running). */
  version_counts?: Record<string, number>;
  computed_at: string | null;
  data_dates: Record<string, string>;
}

/** [parid, lon, lat, score, band, top_blocker, address, by_right_units, units_with_relief] */
export type PlannerPoint = [string, number, number, number | null, string | null, string | null, string | null, number | null, number | null];

// ------------------------------------------------------------------------------ filters

export interface Filters {
  muni?: string;
  district?: string;
  hoods?: string[];
  zones?: string[];
  lotMin?: number;
  lotMax?: number;
  land?: "vacant" | "structure";
  owner?: "public" | "nonprofit" | "private";
  /** Owner types (OR): city, ura, hacp, county, other_public, nonprofit, private. */
  ownerTypes?: string[];
  delinquent?: boolean;
  bands?: Band[];
  clean?: boolean;
  xFloodway?: boolean;
  xLandslide?: boolean;
  xUndermined?: boolean;
  xSteep?: boolean;
  /** Within this many feet of a frequent-transit stop. */
  transitFt?: number;
  byRightMin?: number;
  /** The parcel lists this blocker (the share-of-parcels bars filter this way). */
  hasBlocker?: string;
  /** Every blocker the parcel has is one of these ("Only blocked by…"). */
  only?: string[];
  /** Specific parcels (compare tray, saved lists), max 25. */
  ids?: string[];
  /**
   * Block conformity (street precedent): lots on block faces with 3+ measured buildings where at least
   * this percent of the buildings would not meet today's code (front/side setback, lot size, stories).
   */
  blockNc?: number;
}
export type Sort = "score" | "months" | "by_right_units" | "units_with_relief" | "lot" | "transit" | "address" | "neighborhood" | "zoning";
export const SORTS: Sort[] = ["score", "months", "by_right_units", "units_with_relief", "lot", "transit", "address", "neighborhood", "zoning"];
export type Dir = "asc" | "desc";
/** Natural direction per sort (best first). */
export const DEFAULT_DIR: Record<Sort, Dir> = {
  score: "desc", months: "asc", by_right_units: "desc", units_with_relief: "desc", lot: "desc", transit: "asc",
  address: "asc", neighborhood: "asc", zoning: "asc",
};

const PARID = /^[0-9A-Z]{16}$/i;
const num = (v: string | null) => (v != null && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : undefined);
const str = (v: string | null) => (v != null && v.trim() !== "" ? v.trim().slice(0, 120) : undefined);
const list = (v: string | null, max = 40) => {
  const xs = (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 120)).slice(0, max);
  return xs.length ? [...new Set(xs)] : undefined;
};
const flag = (v: string | null) => (v === "1" ? true : undefined);

/** The tax-delinquent filter applies to publicly owned land only (never private owners in distress). */
export const DELINQUENT_PUBLIC_NOTE = "Tax-delinquent filter applies to publicly owned land only — to avoid targeting private owners in distress.";
/** With the tax-delinquent filter on, ownership is forced to public and non-public owner types are dropped. */
export function publicOnlyIfDelinquent(f: Filters): Filters {
  if (!f.delinquent) return f;
  const ownerTypes = f.ownerTypes?.filter((t) => OWNER_TYPES.find((o) => o.id === t)?.isPublic);
  return { ...f, owner: "public", ownerTypes: ownerTypes?.length ? ownerTypes : undefined };
}
/** A row's tax-delinquency as it may be shown or exported: publicly owned parcels only (null otherwise). */
export const shownDelinquent = (r: Pick<PlannerRow, "owner_class" | "tax_delinquent">): boolean | null =>
  (r.owner_class === "public" ? r.tax_delinquent : null);

export function parseFilters(q: URLSearchParams): Filters {
  const land = q.get("land");
  const owner = q.get("owner");
  const bands = list(q.get("bands"))?.filter((b): b is Band => BANDS.includes(b as Band));
  const ids = list(q.get("ids"), 25)?.filter((x) => PARID.test(x)).map((x) => x.toUpperCase());
  return clean(publicOnlyIfDelinquent({
    muni: str(q.get("muni")),
    district: str(q.get("district")),
    hoods: list(q.get("hoods")),
    zones: list(q.get("zones")),
    lotMin: num(q.get("lotMin")),
    lotMax: num(q.get("lotMax")),
    land: land === "vacant" || land === "structure" ? land : undefined,
    owner: owner === "public" || owner === "nonprofit" || owner === "private" ? owner : undefined,
    ownerTypes: list(q.get("ownerTypes"))?.filter((t) => OWNER_TYPES.some((o) => o.id === t)),
    delinquent: flag(q.get("delinquent")),
    bands,
    clean: flag(q.get("clean")),
    xFloodway: flag(q.get("xFloodway")),
    xLandslide: flag(q.get("xLandslide")),
    xUndermined: flag(q.get("xUndermined")),
    xSteep: flag(q.get("xSteep")),
    transitFt: num(q.get("transitFt")),
    byRightMin: num(q.get("byRightMin")),
    hasBlocker: str(q.get("hasBlocker")),
    only: list(q.get("only")),
    ids,
    blockNc: BLOCK_NC.includes(num(q.get("blockNc")) as number) ? num(q.get("blockNc")) : undefined,
  }));
}

/** Drop empty keys so equal filters serialize equally. */
export function clean(f: Filters): Filters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out as Filters;
}

export function filtersToQuery(f: Filters): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(clean(f))) {
    if (Array.isArray(v)) q.set(k, v.join(","));
    else if (v === true) q.set(k, "1");
    else q.set(k, String(v));
  }
  return q;
}

/** Filters in the shape planner_rows() reads. */
export function filtersToDb(input: Filters): Record<string, unknown> {
  const f = publicOnlyIfDelinquent(input);
  const o: Record<string, unknown> = {};
  if (f.muni) o.municipality = f.muni;
  if (f.district) o.council_district = f.district;
  if (f.hoods?.length) o.neighborhoods = f.hoods;
  if (f.zones?.length) o.zoning = f.zones;
  if (f.bands?.length) o.bands = f.bands;
  if (f.ids?.length) o.parids = f.ids;
  if (f.lotMin != null) o.lot_min = f.lotMin;
  if (f.lotMax != null) o.lot_max = f.lotMax;
  if (f.land) o.vacant = f.land === "vacant";
  if (f.owner) o.owner = f.owner;
  if (f.ownerTypes?.length) o.owner_types = f.ownerTypes;
  if (f.delinquent) o.tax_delinquent = true;
  if (f.clean) o.no_red_flags = true;
  if (f.xFloodway) o.exclude_floodway = true;
  if (f.xLandslide) o.exclude_landslide = true;
  if (f.xUndermined) o.exclude_undermined = true;
  if (f.xSteep) o.exclude_steep = true;
  if (f.transitFt != null) o.transit_max_m = Math.round((f.transitFt / FT_PER_M) * 10) / 10;
  if (f.byRightMin != null) o.by_right_min = Math.round(f.byRightMin);
  if (f.hasBlocker) o.has_blocker = f.hasBlocker;
  if (f.only?.length) o.only_blocked_by = f.only;
  if (f.blockNc != null) o.block_nonconform_min = f.blockNc / 100;
  return o;
}

/**
 * "Low market activity" costs two or more points on about 60% of parcels as a secondary item, so the
 * planner's blocker bars and blocker filters count it only where it is the parcel's top blocker
 * (migration 091). The parcel's own blocker list still shows it.
 */
export const SECONDARY_ONLY_BLOCKER = "Low market activity";
/** The blockers the planner's bars and filters count for a row (mirror of migration 091). */
export const effectiveBlockers = (r: Pick<PlannerRow, "blockers" | "top_blocker">): string[] =>
  r.blockers.filter((b) => b !== SECONDARY_ONLY_BLOCKER || r.top_blocker === b);

/** TypeScript mirror of planner_rows(): does this row pass the filters? */
export function matchRow(r: PlannerRow, f: Filters): boolean {
  const d = filtersToDb(f);
  const inList = (v: string | null, xs: unknown) => !Array.isArray(xs) || (v != null && (xs as string[]).includes(v));
  if (d.municipality != null && r.municipality !== d.municipality) return false;
  if (d.council_district != null && r.council_district !== d.council_district) return false;
  if (!inList(r.neighborhood, d.neighborhoods) || !inList(r.zoning, d.zoning) || !inList(r.band, d.bands)) return false;
  if (!inList(r.parid.trim(), d.parids)) return false;
  if (d.lot_min != null && !(r.lot_sqft != null && r.lot_sqft >= (d.lot_min as number))) return false;
  if (d.lot_max != null && !(r.lot_sqft != null && r.lot_sqft <= (d.lot_max as number))) return false;
  if (d.vacant != null && r.vacant !== d.vacant) return false;
  if (d.owner != null && r.owner_class !== d.owner) return false;
  if (!inList(r.owner_type, d.owner_types)) return false;
  if (d.tax_delinquent && !(r.tax_delinquent === true && r.owner_class === "public")) return false;
  if (d.no_red_flags && r.red_flag_count !== 0) return false;
  if (d.exclude_floodway && r.hz_floodway) return false;
  if (d.exclude_landslide && r.hz_landslide) return false;
  if (d.exclude_undermined && r.hz_undermined) return false;
  if (d.exclude_steep && (r.steep_share ?? 0) >= 0.25) return false;
  if (d.transit_max_m != null && !(r.transit_m != null && r.transit_m <= (d.transit_max_m as number))) return false;
  if (d.by_right_min != null && !(r.by_right_units != null && r.by_right_units >= (d.by_right_min as number))) return false;
  if (d.has_blocker != null && !effectiveBlockers(r).includes(d.has_blocker as string)) return false;
  // block_nonconform_min is SQL-only: parcel_scores rows carry no block-face data (migration 131).
  if (Array.isArray(d.only_blocked_by)) {
    const allowed = d.only_blocked_by as string[];
    const eff = effectiveBlockers(r);
    if (!eff.length || !eff.every((b) => allowed.includes(b))) return false;
  }
  return true;
}

export const parseSort = (v: string | null): Sort => (SORTS.includes(v as Sort) ? (v as Sort) : "score");
export const parseDir = (v: string | null, s: Sort): Dir => (v === "asc" || v === "desc" ? v : DEFAULT_DIR[s]);

/** Plain-English list of the active filters (staff memo cover, saved lists). */
export function describeFilters(f: Filters): string[] {
  const out: string[] = [f.muni ? titleCase(f.muni) : "All scored parcels"];
  if (f.district) out.push(`Council district ${f.district}`);
  if (f.hoods?.length) out.push(`Neighborhood: ${f.hoods.join(", ")}`);
  if (f.zones?.length) out.push(`Zoning: ${f.zones.join(", ")}`);
  if (f.land) out.push(f.land === "vacant" ? "Vacant land" : "Has a structure");
  if (f.owner) out.push(f.owner === "public" ? "Publicly owned" : f.owner === "nonprofit" ? "Nonprofit-owned (approximate)" : "Privately owned");
  if (f.ownerTypes?.length) out.push(`Owner: ${f.ownerTypes.map((t) => OWNER_TYPES.find((o) => o.id === t)?.label ?? t).join(" or ")}`);
  if (f.delinquent) out.push("Tax-delinquent (publicly owned only)");
  if (f.lotMin != null || f.lotMax != null)
    out.push(`Lot size ${f.lotMin != null ? `${f.lotMin.toLocaleString("en-US")} sq ft` : "any"} to ${f.lotMax != null ? `${f.lotMax.toLocaleString("en-US")} sq ft` : "any"}`);
  if (f.bands?.length) out.push(`Score band: ${f.bands.map((b) => bandLabel(b)).join(", ")}`);
  if (f.clean) out.push("No red flags");
  const x = [f.xFloodway && "floodway", f.xLandslide && "landslide-prone", f.xUndermined && "undermined", f.xSteep && "a quarter or more of the lot steeper than 25%"].filter(Boolean);
  if (x.length) out.push(`Excluding ${x.join(", ")}`);
  if (f.transitFt != null) out.push(`Within ${f.transitFt.toLocaleString("en-US")} ft of frequent transit`);
  if (f.byRightMin != null) out.push(`At least ${f.byRightMin} home${f.byRightMin === 1 ? "" : "s"} by right`);
  if (f.hasBlocker) out.push(`Blocked by: ${f.hasBlocker}`);
  if (f.only?.length) out.push(`Only blocked by: ${f.only.join(" or ")}`);
  if (f.ids?.length) out.push(`${f.ids.length} selected parcel${f.ids.length === 1 ? "" : "s"}`);
  if (f.blockNc != null) out.push(`On blocks where at least ${f.blockNc}% of existing buildings don't meet today's code`);
  return out;
}

// ------------------------------------------------------------------------------ best-option headline (§4.1)

/** Zoning-side blockers (mirrors scripts/score_all.ts's permission/dimensional labels) worth naming as "what approval is needed". */
const ZONING_APPROVAL_BLOCKERS = [
  "Administrator exception required", "Special exception required", "Conditional use required", "Use not permitted",
  "Nonconforming use", "Minimum lot size", "Lot area per unit", "Parking minimum", "Lot coverage limit", "Floor area limit",
  "Setbacks", "Height limit", "Lot too small for the building",
];

/**
 * "by right" / "needs administrator exception" / "needs variance", for the headline
 * "Best option: [type] ([...])" (§4.1). By right when at least one unit fits with no relief;
 * otherwise an administrator exception if that is listed among the parcel's blockers, else a variance
 * (special exception, conditional use, use variance or dimensional variance all collapse to "variance"
 * for this one-word headline; the full blocker list still names the specific approval).
 */
export function approvalTag(r: Pick<PlannerRow, "by_right_units" | "blockers">): "by right" | "needs administrator exception" | "needs variance" {
  if ((r.by_right_units ?? 0) > 0) return "by right";
  if (r.blockers.includes("Administrator exception required")) return "needs administrator exception";
  return "needs variance";
}

/** "Best option: [type] ([by right / needs administrator exception / needs variance])" (§4.1). */
/** The partial-screen headline for a row (one wording, engine/src/score/bands.ts). */
export const partialNote = (r: Pick<PlannerRow, "municipality"> & { partial_reason?: string | null; partial_use?: string | null }) =>
  partialText(r.partial_reason ?? "zoning", { municipality: r.municipality, use: r.partial_use });
/** "Best option" for a Partial row. */
export const partialBest = (r: { partial_reason?: string | null }) =>
  r.partial_reason && r.partial_reason !== "zoning" ? "Can't determine; the score did not see what is on this lot" : "Can't determine; zoning not loaded";

export function bestOptionHeadline(r: Pick<PlannerRow, "best_strategy" | "by_right_units" | "blockers"> & { band?: PlannerRow["band"]; partial_reason?: string | null }): string {
  if (r.band === "Partial") return `Best option: ${partialBest(r).replace(/^C/, "c")}`;
  if (!r.best_strategy) return "Best option: none scored";
  const type = STRATEGY_TEXT[r.best_strategy] ?? r.best_strategy;
  return `Best option: ${type} (${approvalTag(r)})`;
}

/** When homes by right = 0, name the specific approval the blockers point to (§4.1), or null if none is listed. */
export function approvalNeeded(r: Pick<PlannerRow, "by_right_units" | "blockers">): string | null {
  if ((r.by_right_units ?? 0) > 0) return null;
  return r.blockers.find((b) => ZONING_APPROVAL_BLOCKERS.includes(b)) ?? null;
}

// ------------------------------------------------------------------------------ months to permit range (§4.4)

/**
 * months_to_permit is stored as a single point estimate (the engine's median-based prediction,
 * see engine/src/score/factors.ts permitMonths); shown as a range to be honest about that
 * uncertainty: the estimate x0.75 to x1.25, rounded to whole months (at least 1 month wide).
 * With the typical ~2.8-month estimate this reads "2-4 months".
 */
export function monthsRange(m: number | null): [number, number] | null {
  if (m == null) return null;
  const lo = Math.max(1, Math.floor(m * 0.75));
  const hi = Math.max(lo + 1, Math.ceil(m * 1.25));
  return [lo, hi];
}
export const MONTHS_RANGE_NOTE = "Shown as a range (the estimate x0.75 to x1.25, rounded to whole months) to reflect the uncertainty in a single-point prediction.";
export const monthsRangeText = (m: number | null): string => {
  const r = monthsRange(m);
  return r ? `${r[0]}-${r[1]} months` : "—";
};

// ------------------------------------------------------------------------------ text helpers

const SMALL = new Set(["of", "and", "the", "on", "in"]);
/** "MOUNT WASHINGTON" -> "Mount Washington" (source values are upper case). */
export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

/**
 * Address, or the parcel ID for lots without a street number. Pass `disambiguate` (§4.3, several
 * parcels sharing one street address — e.g. a front and back lot) to append the parcel ID so the two
 * are never confused; callers compute it by checking whether the address repeats in the rows shown.
 */
export const parcelLabel = (r: Pick<PlannerRow, "address" | "parid">, disambiguate = false) => {
  const label = titleCase(r.address);
  if (!label) return r.parid.trim();
  return disambiguate ? `${label} (parcel ${r.parid.trim()})` : label;
};
/** Addresses that repeat among these rows (§4.3): pass to parcelLabel's `disambiguate` for those rows. */
export function duplicateAddresses(rows: Pick<PlannerRow, "address">[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const label = titleCase(r.address);
    if (label) seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([a]) => a));
}
export const ownerLabel = (r: Pick<PlannerRow, "owner_class" | "owner_agency">) =>
  r.owner_class === "public" || r.owner_class === "nonprofit" ? r.owner_agency ?? "Public" : "Private";
/** Short owner label for the table ("City", "URA / Land Bank", "HACP"). */
export const ownerShort = (r: Pick<PlannerRow, "owner_class" | "owner_agency">) =>
  ownerLabel(r).replace(/^City of Pittsburgh$/, "City").replace(/^Housing Authority \(HACP\)$/, "HACP").replace(/^Allegheny County$/, "County");

export function blockerSentence(r: Pick<PlannerSummary, "total" | "blockers">): string {
  if (!r.total) return "No parcels match these filters.";
  const top = r.blockers[0];
  const n = r.total.toLocaleString("en-US");
  if (!top) return `Across the ${n} matching parcels, no single factor costs more than a point.`;
  return `Across the ${n} matching parcels, the most common blocker is ${top.blocker.toLowerCase()} (${Math.round((100 * top.n) / r.total)}% of parcels).`;
}

// ------------------------------------------------------------------------------ CSV

export const CSV_DATE_SOURCES: [string, string][] = [
  ["assessment_as_of", "Allegheny County Property Assessments"],
  ["sales_as_of", "Allegheny County Property Sale Transactions"],
  ["permits_as_of", "City of Pittsburgh PLI permits"],
  ["zba_decisions_to", "Pittsburgh zoning decisions (ZBA / City Council)"],
  ["lidar", "USGS 3DEP 1 m lidar"],
];

export const CSV_COLUMNS = [
  "rank", "parid", "address", "municipality", "neighborhood", "council_district", "zoning", "lot_sqft", "vacant", "owner",
  "tax_delinquent", "score", "band", "range_lo", "range_hi", "preliminary", "band_cap", "red_flag_count", "red_flags",
  "top_blocker", "all_blockers", "best_new_housing_option", "by_right_units", "units_with_relief", "months_to_permit",
  "frequent_transit_ft", "floodway", "landslide_prone", "undermined", "share_steeper_than_25pct",
  "rehab_existing_score", "rehab_existing_band", "planning_badge", "planning_badge_status", "badge_points",
  ...FACTORS.map((f) => `${f.id}_${f.label.toLowerCase().replace(/[^a-z]+/g, "_").replace(/_$/, "")}`),
  ...CSV_DATE_SOURCES.map(([c]) => c), "config_version", "computed_at", "note", "parcel_url",
];

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(r: PlannerRow, rank: number, origin: string): string {
  const vals: unknown[] = [
    rank, r.parid.trim(), r.address, r.municipality, r.neighborhood, r.council_district, r.zoning, r.lot_sqft, r.vacant, ownerLabel(r),
    shownDelinquent(r), r.score, r.band ? bandLabel(r.band) : null, r.range_lo, r.range_hi, r.preliminary, r.cap_label ? relabelBands(r.cap_label) : null, r.red_flag_count, r.red_flags.map((f) => f.title).join("; "),
    r.top_blocker, r.blockers.join("; "), r.best_strategy ? STRATEGY_TEXT[r.best_strategy] ?? r.best_strategy : null,
    r.by_right_units, r.units_with_relief, r.months_to_permit,
    r.transit_m != null ? Math.round(r.transit_m * FT_PER_M) : null, r.hz_floodway, r.hz_landslide, r.hz_undermined, r.steep_share,
    r.rehab_score, r.rehab_band ? bandLabel(r.rehab_band) : null, r.planning_badge, BADGE_NOTE, r.badge_score,
    ...FACTORS.map((f) => r.factor_scores?.[f.id] ?? null),
    ...CSV_DATE_SOURCES.map(([, src]) => r.data_dates?.[src] ?? null), r.config_version, r.computed_at, r.note,
    `${origin}/parcel/${encodeURIComponent(r.parid.trim())}`,
  ];
  return vals.map(cell).join(",");
}

/** Sources and data dates for the second CSV. */
export const SOURCES: { name: string; used_for: string; key?: string; url?: string }[] = [
  { name: "Allegheny County Property Assessments", used_for: "Address, lot size, building present, use, condition", key: "Allegheny County Property Assessments", url: "https://data.wprdc.org/dataset/property-assessments" },
  { name: "Allegheny County parcel boundaries", used_for: "Lot outline, lot-fit test, map location", url: "https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1" },
  { name: "City of Pittsburgh Zoning Districts and Zoning Code", used_for: "Zoning permission (F1), unit counts" },
  { name: "Pittsburgh zoning decisions (ZBA / City Council)", used_for: "Variance grant odds", key: "Pittsburgh zoning decisions (ZBA / City Council)" },
  { name: "USGS 3DEP 1 m lidar", used_for: "Terrain (F2), steep-slope filter", key: "USGS 3DEP 1 m lidar" },
  { name: "City of Pittsburgh Landslide Prone and Undermined Areas; PA DEP mined-out areas", used_for: "Geohazards (F3), hazard filters" },
  { name: "FEMA National Flood Hazard Layer", used_for: "Floodway red flag, floodplain" },
  { name: "PA DEP Land Recycling; EPA ACRES", used_for: "Cleanup sites" },
  { name: "County and City street centerlines", used_for: "Street access (F4)" },
  { name: "Pittsburgh Regional Transit GTFS", used_for: "Frequent-transit distance filter" },
  { name: "City of Pittsburgh PLI permits", used_for: "Market activity (F7), months to permit", key: "City of Pittsburgh PLI permits" },
  { name: "Allegheny County Property Sale Transactions", used_for: "Market activity (F7)", key: "Allegheny County Property Sale Transactions" },
  { name: "City of Pittsburgh city-owned properties; Allegheny County tax liens", used_for: "Ownership and tax-delinquent filters" },
  { name: "HUD Qualified Census Tracts", used_for: "Planning badge (default weights)" },
];

export function sourcesCsv(dates: Record<string, string | null | undefined>, configVersions: string[], computedAt: string | null): string {
  const lines = [["source", "used_for", "data_date", "url"].join(",")];
  for (const s of SOURCES) lines.push([s.name, s.used_for, s.key ? dates[s.key] ?? "" : "", s.url ?? ""].map(cell).join(","));
  lines.push(["EaseScore.AI score config", "Weights, curves and caps", `v${configVersions.join(", v")}${computedAt ? `, computed ${computedAt.slice(0, 10)}` : ""}`, ""].map(cell).join(","));
  return lines.join("\n") + "\n";
}
