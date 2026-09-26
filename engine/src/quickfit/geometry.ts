// Planar polygon helpers. All inputs are in feet in a projected CRS.
// Boolean ops (difference, intersection) use @turf/difference and @turf/intersect (MIT, backed by
// polyclip-ts, MIT). Turf's area/buffer are NOT used: they assume lon/lat. Area is the shoelace formula.

import { difference } from "@turf/difference";
import { intersect } from "@turf/intersect";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Poly, Pt, Ring, SetbackClass } from "./types";

const EPS = 1e-6;

export function openRing(r: Ring): Ring {
  const n = r.length;
  if (n > 1 && r[0]![0] === r[n - 1]![0] && r[0]![1] === r[n - 1]![1]) return r.slice(0, -1);
  return r.slice();
}

const closeRing = (r: Ring): Ring => {
  const o = openRing(r);
  return [...o, o[0]!];
};

/** Signed shoelace area: positive = counter-clockwise. */
export function signedArea(r: Ring): number {
  const o = openRing(r);
  let s = 0;
  for (let i = 0; i < o.length; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % o.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function polyArea(p: Poly): number {
  if (!p.length) return 0;
  return p.reduce((s, ring, i) => s + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0);
}

export const multiArea = (m: Poly[]) => m.reduce((s, p) => s + polyArea(p), 0);

/** Local frame: origin at the start of the orienting front edge, +x along the frontage, +y into the lot. */
export interface Frame {
  origin: Pt;
  ux: Pt;
  uy: Pt;
}

export function frameFromEdge(parcel: Ring, edge: number): Frame {
  const r = openRing(parcel);
  const a = r[edge]!;
  const b = r[(edge + 1) % r.length]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let ux: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let origin = a;
  if (signedArea(r) < 0) {
    // Clockwise ring: interior is to the right of a->b, so run x the other way from b.
    ux = [-ux[0], -ux[1]];
    origin = b;
  }
  const uy: Pt = [-ux[1], ux[0]];
  return { origin, ux, uy };
}

export const toLocal = (f: Frame, p: Pt): Pt => {
  const dx = p[0] - f.origin[0];
  const dy = p[1] - f.origin[1];
  return [dx * f.ux[0] + dy * f.ux[1], dx * f.uy[0] + dy * f.uy[1]];
};

export const toWorld = (f: Frame, q: Pt): Pt => [
  f.origin[0] + q[0] * f.ux[0] + q[1] * f.uy[0],
  f.origin[1] + q[0] * f.ux[1] + q[1] * f.uy[1],
];

export const polyToLocal = (f: Frame, p: Poly): Poly => p.map((r) => openRing(r).map((q) => toLocal(f, q)));
export const polyToWorld = (f: Frame, p: Poly): Poly => p.map((r) => r.map((q) => toWorld(f, q)));

/** Setback class of each parcel edge. */
export function classifyEdges(
  parcel: Ring,
  frontEdges: number[],
  rearEdges: number[] | undefined,
  streetSideEdges: number[] | undefined,
): SetbackClass[] {
  const r = openRing(parcel);
  const n = r.length;
  const ccw = signedArea(r) > 0;
  const outward = (i: number): Pt => {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return ccw ? [t[1], -t[0]] : [-t[1], t[0]];
  };
  const front = new Set(frontEdges);
  const side = new Set(streetSideEdges ?? []);
  const f0 = outward(frontEdges[0]!);
  return Array.from({ length: n }, (_, i) => {
    if (front.has(i)) return "front";
    if (side.has(i)) return "exterior_side";
    if (rearEdges) return rearEdges.includes(i) ? "rear" : "side";
    const o = outward(i);
    return o[0] * f0[0] + o[1] * f0[1] < -0.5 ? "rear" : "side";
  });
}

/**
 * Strip along one edge (local coords): the band from 1 ft outside the lot line to `depth` inside it,
 * extended `depth` past each end so neighbouring strips overlap at corners.
 */
function edgeStrip(a: Pt, b: Pt, depth: number, ccw: boolean): Ring {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const inward: Pt = ccw ? [-t[1], t[0]] : [t[1], -t[0]];
  const p = (s: number, h: number): Pt => [a[0] + t[0] * s + inward[0] * h, a[1] + t[1] * s + inward[1] * h];
  return [p(-depth, -1), p(len + depth, -1), p(len + depth, depth), p(-depth, depth)];
}

const toFeature = (polys: Poly[]): Feature<MultiPolygon> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "MultiPolygon", coordinates: polys.map((p) => p.map(closeRing)) },
});

function fromFeature(f: Feature<Polygon | MultiPolygon> | null): Poly[] {
  if (!f) return [];
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys
    .map((p) => p.map((ring) => openRing(ring.map((c) => [c[0]!, c[1]!] as Pt))))
    .filter((p) => polyArea(p) > EPS);
}

export function subtract(base: Poly[], cut: Poly[]): Poly[] {
  if (!base.length) return [];
  if (!cut.length) return base;
  return fromFeature(
    difference({ type: "FeatureCollection", features: [toFeature(base), toFeature(cut)] }),
  );
}

export function overlapArea(a: Poly[], b: Poly[]): number {
  if (!a.length || !b.length) return 0;
  return multiArea(fromFeature(intersect({ type: "FeatureCollection", features: [toFeature(a), toFeature(b)] })));
}

/** Envelope (local coords) = parcel − per-edge setback strips − cut masks. */
export function buildEnvelope(
  parcelLocal: Ring,
  classes: SetbackClass[],
  setbacks: Record<SetbackClass, number>,
  cutMasksLocal: Poly[],
): Poly[] {
  const ccw = signedArea(parcelLocal) > 0;
  const strips: Poly[] = [];
  parcelLocal.forEach((a, i) => {
    const d = setbacks[classes[i]!];
    if (d > 0) strips.push([edgeStrip(a, parcelLocal[(i + 1) % parcelLocal.length]!, d, ccw)]);
  });
  return subtract([[parcelLocal]], [...strips, ...cutMasksLocal]);
}

/** Pre-indexed envelope for fast rectangle-containment tests. */
export interface EnvIndex {
  polys: Poly[];
  segs: [number, number, number, number][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function indexEnvelope(polys: Poly[]): EnvIndex {
  const segs: [number, number, number, number][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys)
    for (const r of p)
      r.forEach((a, i) => {
        const b = r[(i + 1) % r.length]!;
        segs.push([a[0], a[1], b[0], b[1]]);
        minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
        minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
      });
  return { polys, segs, minX, minY, maxX, maxY };
}

function pointInPoly(p: Poly, x: number, y: number): boolean {
  let inside = false;
  for (const r of p)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]!;
      const [xj, yj] = r[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Does segment (x1,y1)-(x2,y2) touch the open box? Liang–Barsky. */
function segHitsBox(x1: number, y1: number, x2: number, y2: number, bx0: number, by0: number, bx1: number, by1: number) {
  if (Math.max(x1, x2) <= bx0 || Math.min(x1, x2) >= bx1 || Math.max(y1, y2) <= by0 || Math.min(y1, y2) >= by1) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x1 - bx0) && clip(dx, bx1 - x1) && clip(-dy, y1 - by0) && clip(dy, by1 - y1) && t1 - t0 > 1e-12;
}

/** Is the axis-aligned rectangle (local coords) inside the envelope? Touching the boundary is allowed. */
export function rectInside(env: EnvIndex, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x0 < env.minX - EPS || y0 < env.minY - EPS || x1 > env.maxX + EPS || y1 > env.maxY + EPS) return false;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (!env.polys.some((p) => pointInPoly(p, cx, cy))) return false;
  const bx0 = x0 + EPS, by0 = y0 + EPS, bx1 = x1 - EPS, by1 = y1 - EPS;
  for (const s of env.segs) if (segHitsBox(s[0], s[1], s[2], s[3], bx0, by0, bx1, by1)) return false;
  return true;
}

export const rectRing = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0], [x1, y0], [x1, y1], [x0, y1],
];
