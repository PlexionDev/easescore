// Policy levers for the Policy Analyst seat (/policy). A lever never edits the engine: it rewrites the
// zoning-rules row a parcel is scored with (facts.zoning.rules), and only for parcels it applies to.
// With every lever off the row is returned untouched, so the score equals the baseline exactly.
//
// Levers (see .planning DECISIONS for the modelling choices):
//  1. attached   — two attached homes (a side-by-side pair) by right on existing lots up to W ft wide in
//                  single-unit districts (R1D, R1A); in R1D the townhouse-row width limit also rises to W
//                  when W is above the current 35 ft.
//  2. minLot     — minimum lot size and lot area per unit set to a share of the current number (0 = none).
//  3. parking    — minimum parking: current, none within 1/4 mile of frequent transit, or none anywhere.
//  4. adu        — one accessory dwelling unit by right on a lot with a detached single-family house in a
//                  residential district. Our zoning table has no ADU rules, so this lever supplies them for
//                  the scenario (ADU_RULES below); the ADU is counted beside the house, not rescored.
//  5. contextual — front setback = the average of the neighbors, by right, in residential districts. We do
//                  not measure neighbors: the engine's own contextual-setback assumption stands in for it.
//  6. height     — one more story (and 10 ft more height) in residential districts.
//  7. matchBlock — "Match the block": a new building that matches its block face's prevailing pattern
//                  (measured street precedent, migration 130) within MATCH_BLOCK tolerances is approved
//                  administratively. Rules row: front setback down to the block's median minus the
//                  tolerance, side setback down to the block's median (never under 3 ft, §925.06.C's
//                  floor), minimum lot area down to 90% of the block's median lot. Needs 3+ measured
//                  buildings on the face; residential districts only.

import { DEFAULT_CONFIG } from "../score/adapter";
import { existingUseColumn, solverRules } from "../score/strategies";
import type { QuickFitRules } from "../quickfit/types";

export type ParkingMode = "current" | "transit" | "none";
export type LeverId = "attached" | "minLot" | "parking" | "adu" | "contextual" | "height" | "matchBlock";

export interface LeverState {
  attached: { on: boolean; maxWidthFt: number };
  minLot: { on: boolean; share: number };
  parking: ParkingMode;
  /** One ADU by right beside a detached single-family house (residential districts). */
  adu: boolean;
  /** Contextual front setback by right (residential districts). */
  contextual: boolean;
  /** +1 story and +10 ft height (residential districts). */
  height: boolean;
  /** "Match the block": the block face's prevailing pattern approved administratively (residential districts). */
  matchBlock?: boolean;
}

export const LEVER_LABEL: Record<LeverId, string> = {
  attached: "Attached homes by right on narrow lots",
  minLot: "Minimum lot size",
  parking: "Parking minimums",
  adu: "ADUs by right",
  contextual: "Contextual front setback",
  height: "One more story",
  matchBlock: "Match the block",
};

/** Frequent-transit distance for the parking lever: a quarter mile, the Ease Score's own transit test. */
export const TRANSIT_M = 400;
export const ATTACHED_DISTRICTS = /^(R1D|R1A)-/;
/** Residential districts for the ADU, contextual-setback and height levers (not H, mixed-use or special districts). */
export const RESIDENTIAL_DISTRICTS = /^(R1D|R1A|R2|R3|RM)-/;
/** Not housing districts, so no lever applies: P (parks and open space). */
export const EXCLUDED_DISTRICTS = new Set(["P"]);
export const WIDTH_MIN_FT = 25;
export const WIDTH_MAX_FT = 50;

/**
 * ADU rules this lever supplies (scenario settings, not code): our zoning table has no ADU rules.
 * Footprint sizes and the separation are the same placeholders as the parcel page's ADU preset
 * (web/src/lib/quickfit-gen.ts): 14-24 ft wide, 16-28 ft deep, 1-2 stories, 10 ft from the house.
 */
export const ADU_RULES = {
  /** Size cap: finished floor area of the ADU, gross sq ft. */
  maxFloorAreaSf: 800,
  /** Smallest ADU footprint the fit check requires, ft. */
  minWidthFt: 14,
  minDepthFt: 16,
  /** Clear distance from the main house, ft. */
  separationFt: 10,
  /** Net (livable) / gross floor area, for the sale-value side of the pencil test. */
  netShare: 0.85,
  /** Eligible: a detached single-family house on the lot (county use code), in a residential district. */
  eligibleUse: "SINGLE FAMILY (detached; not rowhouse or townhouse)",
} as const;

/** The engine's contextual front-setback assumption (Ease Score config f1.contextualFrontSetbackFt), ft. */
export const CONTEXTUAL_FRONT_FT: number = DEFAULT_CONFIG.f1.contextualFrontSetbackFt;
/** Match-the-block tolerances (scenario settings, not code). */
export const MATCH_BLOCK = {
  /** Fewest measured buildings on the block face for a pattern to count. */
  minBuildings: 3,
  /** Front setback may sit this much closer than the block's median, ft. */
  frontToleranceFt: 2,
  /** Side setback never below this, ft (§925.06.C's contextual floor). */
  sideFloorFt: 3,
  /** Minimum lot area falls to this share of the block's median lot. */
  lotAreaShare: 0.9,
} as const;

/** Height lever: stories and feet added to the district's limits. */
export const HEIGHT_ADD = { stories: 1, ft: 10 } as const;

export const OFF: LeverState = {
  attached: { on: false, maxWidthFt: 35 }, minLot: { on: false, share: 1 }, parking: "current", adu: false, contextual: false, height: false, matchBlock: false,
};

/** Clamp and snap a lever state so equal policies get equal keys. A lever that changes nothing is off. */
export function normalize(s: Partial<LeverState> | null | undefined): LeverState {
  // Snapped (5 ft, 25%) so nearby slider positions share one computed state.
  const w = Math.round(Math.min(WIDTH_MAX_FT, Math.max(WIDTH_MIN_FT, Number(s?.attached?.maxWidthFt ?? 35))) / 5) * 5;
  const share = Math.round(Math.min(1, Math.max(0, Number(s?.minLot?.share ?? 1))) * 4) / 4;
  const parking: ParkingMode = s?.parking === "transit" || s?.parking === "none" ? s.parking : "current";
  return {
    attached: { on: !!s?.attached?.on, maxWidthFt: w },
    minLot: { on: !!s?.minLot?.on && share < 1, share: s?.minLot?.on && share < 1 ? share : 1 },
    parking,
    adu: s?.adu === true,
    contextual: s?.contextual === true,
    height: s?.height === true,
    matchBlock: s?.matchBlock === true,
  };
}

/**
 * Stable key for a lever state ("base" when every lever is off), used as policy_results.lever_state_hash.
 * Readable on purpose: a37.m0.pn = attached up to 37 ft, no minimum lot size, no parking minimum;
 * then adu (ADUs by right), cs (contextual setback), h1 (+1 story), in that order.
 */
export function stateKey(s: LeverState): string {
  const n = normalize(s);
  const parts: string[] = [];
  if (n.attached.on) parts.push(`a${n.attached.maxWidthFt}`);
  if (n.minLot.on) parts.push(`m${Math.round(n.minLot.share * 100)}`);
  if (n.parking !== "current") parts.push(n.parking === "transit" ? "pt" : "pn");
  if (n.adu) parts.push("adu");
  if (n.contextual) parts.push("cs");
  if (n.height) parts.push("h1");
  if (n.matchBlock) parts.push("mb");
  return parts.length ? parts.join(".") : "base";
}

export function parseKey(key: string): LeverState {
  const s: LeverState = structuredClone(OFF);
  for (const p of key.split(".")) {
    if (/^a\d+$/.test(p)) s.attached = { on: true, maxWidthFt: Number(p.slice(1)) };
    else if (/^m\d+$/.test(p)) s.minLot = { on: true, share: Number(p.slice(1)) / 100 };
    else if (p === "pt") s.parking = "transit";
    else if (p === "pn") s.parking = "none";
    else if (p === "adu") s.adu = true;
    else if (p === "cs") s.contextual = true;
    else if (p === "h1") s.height = true;
    else if (p === "mb") s.matchBlock = true;
  }
  return normalize(s);
}

export const activeLevers = (s: LeverState): LeverId[] => {
  const n = normalize(s);
  return [
    ...(n.attached.on ? ["attached" as const] : []), ...(n.minLot.on ? ["minLot" as const] : []), ...(n.parking !== "current" ? ["parking" as const] : []),
    ...(n.adu ? ["adu" as const] : []), ...(n.contextual ? ["contextual" as const] : []), ...(n.height ? ["height" as const] : []),
    ...(n.matchBlock ? ["matchBlock" as const] : []),
  ];
};

/** What the lever needs to know about one parcel. All from the score inputs; nothing demographic. */
export interface LeverParcel {
  /** City of Pittsburgh parcel (zoning rules are loaded only there). */
  pgh: boolean;
  zoneCode: string | null;
  /** Raw public.zoning_rules row for the district, as parcel_facts carries it. */
  rules: QuickFitRules | null;
  /** Length of the lot's street-front edge(s), ft. Null when the lot has no usable outline. */
  frontageFt: number | null;
  /** Distance to the nearest frequent-transit stop, meters. */
  transitM: number | null;
  /** County assessment use (e.g. "SINGLE FAMILY"); the ADU lever needs a detached house on the lot. */
  use?: string | null;
  /** Lot area from the parcel outline, sq ft (ADU fit check). */
  lotAreaSf?: number | null;
  /** Existing building footprint on the lot, sq ft (ADU fit check). */
  footprintSf?: number | null;
  /** The lot's block face (public.block_faces): prevailing pattern for the match-the-block lever. */
  block?: BlockPattern | null;
}

/** Prevailing values on a block face (medians over measured primary buildings / lots). */
export interface BlockPattern {
  nBuildings: number;
  frontMedianFt: number | null;
  sideMinMedianFt: number | null;
  lotAreaMedianSf: number | null;
}

export interface LeverApplication {
  /** Rules row to score with. The same object as the input when no rules lever applies. */
  rules: QuickFitRules | null;
  /** Levers that apply to this parcel (its eligibility under this state). */
  touched: LeverId[];
}

const pos = (x: number | null | undefined) => x != null && x > 0;

/** Levers that change the zoning-rules row (the ADU is counted beside the house instead). */
export const RULES_LEVERS: LeverId[] = ["attached", "minLot", "parking", "contextual", "height", "matchBlock"];

/** Which levers of `s` apply to this parcel. Pure; used both for the batch filter and the rules rewrite. */
export function eligibility(p: LeverParcel, s: LeverState): LeverId[] {
  const n = normalize(s);
  if (!p.pgh || !p.zoneCode || !p.rules || EXCLUDED_DISTRICTS.has(p.zoneCode.toUpperCase())) return [];
  const zc = p.zoneCode.toUpperCase();
  const eff = solverRules(p.zoneCode, p.rules);
  const out: LeverId[] = [];
  if (n.attached.on) {
    const narrow = p.frontageFt != null && p.frontageFt <= n.attached.maxWidthFt + 1e-9;
    const pairAllowed = eff.two_unit === "P";
    const rowWider = /^R1D-/.test(zc) && (eff.attached_by_right_max_lot_width_ft ?? Infinity) < n.attached.maxWidthFt;
    if (ATTACHED_DISTRICTS.test(zc) && ((narrow && !pairAllowed) || rowWider)) out.push("attached");
  }
  if (n.minLot.on && (pos(eff.min_lot_area_sqft) || pos(eff.min_lot_area_per_unit_sqft))) out.push("minLot");
  if (n.parking !== "current" && (pos(eff.parking_per_unit) || pos(eff.attached_parking_per_unit))) {
    if (n.parking === "none" || (p.transitM != null && p.transitM <= TRANSIT_M)) out.push("parking");
  }
  const residential = RESIDENTIAL_DISTRICTS.test(zc);
  if (n.adu && residential && existingUseColumn(p.use) === "single_unit_detached") out.push("adu");
  if (n.contextual && residential && (eff.min_front_setback_ft ?? 0) > CONTEXTUAL_FRONT_FT) out.push("contextual");
  if (n.height && residential && (pos(eff.max_height_stories) || pos(eff.max_height_ft))) out.push("height");
  if (n.matchBlock && residential && matchBlockRules(eff, p.block) !== null) out.push("matchBlock");
  return out;
}

/** Rewrite one parcel's zoning-rules row for a lever state. Every lever off → the input row, untouched. */
export function applyLevers(p: LeverParcel, s: LeverState): LeverApplication {
  const touched = eligibility(p, s);
  if (!touched.length || !p.rules || !p.zoneCode) return { rules: p.rules, touched: [] };
  if (!touched.some((t) => RULES_LEVERS.includes(t))) return { rules: p.rules, touched };
  const n = normalize(s);
  const eff = solverRules(p.zoneCode, p.rules);
  const r: QuickFitRules = { ...p.rules };
  if (touched.includes("attached")) {
    if (p.frontageFt != null && p.frontageFt <= n.attached.maxWidthFt + 1e-9) r.two_unit = "P";
    if (/^R1D-/.test(p.zoneCode.toUpperCase()) && (eff.attached_by_right_max_lot_width_ft ?? Infinity) < n.attached.maxWidthFt)
      r.attached_by_right_max_lot_width_ft = n.attached.maxWidthFt;
  }
  if (touched.includes("minLot")) {
    const k = n.minLot.share;
    const scale = (v: number | null | undefined) => (pos(v) ? (k > 0 ? Math.round(v! * k) : null) : v ?? null);
    r.min_lot_area_sqft = scale(eff.min_lot_area_sqft);
    r.min_lot_area_per_unit_sqft = scale(eff.min_lot_area_per_unit_sqft);
  }
  if (touched.includes("parking")) {
    r.parking_per_unit = eff.parking_per_unit == null ? null : 0;
    r.attached_parking_per_unit = 0;
  }
  if (touched.includes("contextual")) r.min_front_setback_ft = CONTEXTUAL_FRONT_FT;
  if (touched.includes("matchBlock")) Object.assign(r, matchBlockRules(eff, p.block));
  if (touched.includes("height")) {
    if (pos(eff.max_height_stories)) r.max_height_stories = eff.max_height_stories! + HEIGHT_ADD.stories;
    if (pos(eff.max_height_ft)) r.max_height_ft = eff.max_height_ft! + HEIGHT_ADD.ft;
  }
  return { rules: r, touched };
}

/**
 * The rules the match-the-block lever relaxes for a block pattern, or null when the block has too few
 * measured buildings or matching it would relax nothing. Only ever lowers a requirement.
 */
export function matchBlockRules(eff: QuickFitRules, b: BlockPattern | null | undefined): Partial<QuickFitRules> | null {
  if (!b || b.nBuildings < MATCH_BLOCK.minBuildings) return null;
  const out: Partial<QuickFitRules> = {};
  if (b.frontMedianFt != null && pos(eff.min_front_setback_ft)) {
    const ft = Math.max(0, Math.floor(b.frontMedianFt - MATCH_BLOCK.frontToleranceFt));
    if (ft < eff.min_front_setback_ft!) out.min_front_setback_ft = ft;
  }
  if (b.sideMinMedianFt != null && pos(eff.min_side_setback_ft)) {
    const ft = Math.max(MATCH_BLOCK.sideFloorFt, Math.floor(b.sideMinMedianFt));
    if (ft < eff.min_side_setback_ft!) out.min_side_setback_ft = ft;
  }
  if (b.lotAreaMedianSf != null && pos(eff.min_lot_area_sqft)) {
    const sf = Math.round(b.lotAreaMedianSf * MATCH_BLOCK.lotAreaShare);
    if (sf < eff.min_lot_area_sqft!) out.min_lot_area_sqft = sf;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Whether the smallest ADU plausibly fits behind the house (the low end of the ADU range). An area proxy,
 * not a drawn fit: the engine's lot-fit test has no priced ADU path. The open area behind the front yard
 * (lot area - house footprint - frontage x front setback) must hold the smallest ADU with the district's
 * side yards on both sides and the 10 ft separation plus the rear yard in depth, and the lot must be wide
 * enough for that ADU between the side yards. Lots with no house footprint or no outline do not count.
 */
export function aduFits(p: LeverParcel, rules: QuickFitRules | null): boolean {
  if (!rules || !pos(p.footprintSf) || !pos(p.lotAreaSf) || !pos(p.frontageFt)) return false;
  const side = rules.min_side_setback_ft ?? 0, rear = rules.min_rear_setback_ft ?? 0, front = rules.min_front_setback_ft ?? 0;
  const w = ADU_RULES.minWidthFt + 2 * side;
  if (p.frontageFt! < w) return false;
  const open = p.lotAreaSf! - p.footprintSf! - p.frontageFt! * front;
  return open >= w * (ADU_RULES.minDepthFt + ADU_RULES.separationFt + rear);
}

/** Single levers and "all three on", the states the background job precomputes. */
export const PRECOMPUTE_KEYS = ["base", "a35", "m0", "pt", "pn", "a35.m0", "a35.m0.pn"] as const;

/** The state with every lever outside `keep` turned off: a parcel's result depends only on this. */
export function restrict(s: LeverState, keep: LeverId[]): LeverState {
  const n = normalize(s);
  return normalize({
    attached: keep.includes("attached") ? n.attached : { on: false, maxWidthFt: 35 },
    minLot: keep.includes("minLot") ? n.minLot : { on: false, share: 1 },
    parking: keep.includes("parking") ? n.parking : "current",
    adu: keep.includes("adu") && n.adu,
    contextual: keep.includes("contextual") && n.contextual,
    height: keep.includes("height") && n.height,
    matchBlock: keep.includes("matchBlock") && !!n.matchBlock,
  });
}

/**
 * Lot width along the street, ft: the extent of the lot outline measured along the (first) front edge's
 * direction. A rectangle gives its frontage; a through lot is not double counted; a front split into
 * several segments is measured whole. Null without an outline or a front edge.
 */
export function lotWidthFt(parcel: [number, number][] | null | undefined, frontEdge: number | null | undefined): number | null {
  if (!parcel || parcel.length < 3 || frontEdge == null || frontEdge < 0 || frontEdge >= parcel.length) return null;
  const a = parcel[frontEdge]!;
  const b = parcel[(frontEdge + 1) % parcel.length]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return null;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  let lo = Infinity, hi = -Infinity;
  for (const p of parcel) { const t = p[0] * ux + p[1] * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return Math.round((hi - lo) * 10) / 10;
}
