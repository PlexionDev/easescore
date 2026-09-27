// Policy levers for the Policy Analyst seat (/policy). A lever never edits the engine: it rewrites the
// zoning-rules row a parcel is scored with (facts.zoning.rules), and only for parcels it applies to.
// With every lever off the row is returned untouched, so the score equals the baseline exactly.
//
// Levers (see .planning DECISIONS for the modelling choices):
//  1. attached  — two attached homes (a side-by-side pair) by right on existing lots up to W ft wide in
//                 single-unit districts (R1D, R1A); in R1D the townhouse-row width limit also rises to W
//                 when W is above the current 35 ft.
//  2. minLot    — minimum lot size and lot area per unit set to a share of the current number (0 = none).
//  3. parking   — minimum parking: current, none within 1/4 mile of frequent transit, or none anywhere.

import { solverRules } from "../score/strategies";
import type { QuickFitRules } from "../quickfit/types";

export type ParkingMode = "current" | "transit" | "none";
export type LeverId = "attached" | "minLot" | "parking";

export interface LeverState {
  attached: { on: boolean; maxWidthFt: number };
  minLot: { on: boolean; share: number };
  parking: ParkingMode;
}

export const LEVER_LABEL: Record<LeverId, string> = {
  attached: "Attached homes by right on narrow lots",
  minLot: "Minimum lot size",
  parking: "Parking minimums",
};

/** Frequent-transit distance for the parking lever: a quarter mile, the Ease Score's own transit test. */
export const TRANSIT_M = 400;
export const ATTACHED_DISTRICTS = /^(R1D|R1A)-/;
/** Not housing districts, so no lever applies: P (parks and open space). */
export const EXCLUDED_DISTRICTS = new Set(["P"]);
export const WIDTH_MIN_FT = 25;
export const WIDTH_MAX_FT = 50;

export const OFF: LeverState = { attached: { on: false, maxWidthFt: 35 }, minLot: { on: false, share: 1 }, parking: "current" };

/** Clamp and snap a lever state so equal policies get equal keys. A lever that changes nothing is off. */
export function normalize(s: Partial<LeverState> | null | undefined): LeverState {
  const w = Math.round(Math.min(WIDTH_MAX_FT, Math.max(WIDTH_MIN_FT, Number(s?.attached?.maxWidthFt ?? 35))));
  const share = Math.round(Math.min(1, Math.max(0, Number(s?.minLot?.share ?? 1))) * 20) / 20; // 5% steps
  const parking: ParkingMode = s?.parking === "transit" || s?.parking === "none" ? s.parking : "current";
  return {
    attached: { on: !!s?.attached?.on, maxWidthFt: w },
    minLot: { on: !!s?.minLot?.on && share < 1, share: s?.minLot?.on && share < 1 ? share : 1 },
    parking,
  };
}

/**
 * Stable key for a lever state ("base" when every lever is off), used as policy_results.lever_state_hash.
 * Readable on purpose: a37.m0.pn = attached up to 37 ft, no minimum lot size, no parking minimum.
 */
export function stateKey(s: LeverState): string {
  const n = normalize(s);
  const parts: string[] = [];
  if (n.attached.on) parts.push(`a${n.attached.maxWidthFt}`);
  if (n.minLot.on) parts.push(`m${Math.round(n.minLot.share * 100)}`);
  if (n.parking !== "current") parts.push(n.parking === "transit" ? "pt" : "pn");
  return parts.length ? parts.join(".") : "base";
}

export function parseKey(key: string): LeverState {
  const s: LeverState = structuredClone(OFF);
  for (const p of key.split(".")) {
    if (/^a\d+$/.test(p)) s.attached = { on: true, maxWidthFt: Number(p.slice(1)) };
    else if (/^m\d+$/.test(p)) s.minLot = { on: true, share: Number(p.slice(1)) / 100 };
    else if (p === "pt") s.parking = "transit";
    else if (p === "pn") s.parking = "none";
  }
  return normalize(s);
}

export const activeLevers = (s: LeverState): LeverId[] => {
  const n = normalize(s);
  return [...(n.attached.on ? ["attached" as const] : []), ...(n.minLot.on ? ["minLot" as const] : []), ...(n.parking !== "current" ? ["parking" as const] : [])];
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
}

export interface LeverApplication {
  /** Rules row to score with. The same object as the input when nothing applies. */
  rules: QuickFitRules | null;
  /** Levers that changed this parcel's rules (its eligibility under this state). */
  touched: LeverId[];
}

const pos = (x: number | null | undefined) => x != null && x > 0;

/** Which levers of `s` apply to this parcel. Pure; used both for the batch filter and the rules rewrite. */
export function eligibility(p: LeverParcel, s: LeverState): LeverId[] {
  const n = normalize(s);
  if (!p.pgh || !p.zoneCode || !p.rules || EXCLUDED_DISTRICTS.has(p.zoneCode.toUpperCase())) return [];
  const eff = solverRules(p.zoneCode, p.rules);
  const out: LeverId[] = [];
  if (n.attached.on) {
    const narrow = p.frontageFt != null && p.frontageFt <= n.attached.maxWidthFt + 1e-9;
    const pairAllowed = eff.two_unit === "P";
    const rowWider = /^R1D-/.test(p.zoneCode.toUpperCase()) && (eff.attached_by_right_max_lot_width_ft ?? Infinity) < n.attached.maxWidthFt;
    if (ATTACHED_DISTRICTS.test(p.zoneCode.toUpperCase()) && ((narrow && !pairAllowed) || rowWider)) out.push("attached");
  }
  if (n.minLot.on && (pos(eff.min_lot_area_sqft) || pos(eff.min_lot_area_per_unit_sqft))) out.push("minLot");
  if (n.parking !== "current" && (pos(eff.parking_per_unit) || pos(eff.attached_parking_per_unit))) {
    if (n.parking === "none" || (p.transitM != null && p.transitM <= TRANSIT_M)) out.push("parking");
  }
  return out;
}

/** Rewrite one parcel's zoning-rules row for a lever state. Every lever off → the input row, untouched. */
export function applyLevers(p: LeverParcel, s: LeverState): LeverApplication {
  const touched = eligibility(p, s);
  if (!touched.length || !p.rules || !p.zoneCode) return { rules: p.rules, touched: [] };
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
  return { rules: r, touched };
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
