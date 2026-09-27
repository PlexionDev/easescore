// Site plan sheet (EA-101) for the Feasibility Study: a true-scale, engineering-style drawing emitted as
// one SVG string. Pure and deterministic: the same inputs give byte-identical SVG (fixed iteration order,
// fixed number formatting, no clocks, no randomness).
//
// Sheet units are PostScript points (1/72 in). The sheet is sized for US Letter landscape with 0.4 in
// margins, so 1 in on the sheet is 72 units and the stated engineering scale holds at print size.

import { quickfit } from "@easescore/engine";
import sitePlanConfig from "@easescore/engine/config/site-plan.v0.1.json";
import { describeSitePlan } from "./describe";
import { chaikin, gaussian, isolines, padGrid, simplify, slopeGrid, type Grid, type XY } from "./contour";

type Ring = XY[];
type Poly = Ring[];
type SetbackClass = "front" | "rear" | "side" | "exterior_side";

export const SITE_PLAN_CONFIG = sitePlanConfig;

export interface LonLatAffine {
  lat0: number;
  lon0: number;
  lat_per_x: number;
  lat_per_y: number;
  lon_per_x: number;
  lon_per_y: number;
}

interface GeoFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: { kind?: string; id?: string; label?: string | null; height_m?: number | null; height_source?: string | null } | null;
}
export interface ParcelMapFC {
  type: "FeatureCollection";
  bbox?: [number, number, number, number];
  features: GeoFeature[];
}

export interface SitePlanInput {
  parid: string;
  address: string;
  zoningCode: string | null;
  zoningName: string | null;
  lotAreaSf: number | null;
  generatedDate: string;
  engineVersion: string;
  affine: LonLatAffine;
  parcel: Ring;
  frontEdges: number[];
  streetSideEdges: number[];
  frontInferred: boolean;
  setbacks: Record<SetbackClass, number> | null;
  contextualFront: boolean;
  setbackCitation: string | null;
  envelope: Poly[];
  envelopeAreaSf: number | null;
  scheme: { label: string; units: number; stories: number; footprints: Ring[]; byRight: boolean } | null;
  noFootprintReason: string | null;
  steepShareOfLot: number | null;
  map: ParcelMapFC | null;
}

export interface SitePlanLayout {
  angleRad: number;
  scaleFt: number;
  extended: boolean;
  k: number;
  ox: number;
  oy: number;
  /** World (feet) bounds covering the drawing viewport, for terrain sampling. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// ---------------------------------------------------------------------------------------------
// Sheet geometry (points)

const SW = 734;
const SH = 536;
const TB = 562; // title block left edge
const VX0 = 10;
const VX1 = TB - 3;
const VY0 = 40;
const VY1 = 456;
const VW = VX1 - VX0;
const VH = VY1 - VY0;
const MARGIN = 32; // paper room around the lot for dimension strings

const STANDARD = [10, 20, 30, 40];
const EXTENDED = [50, 60];
const BEYOND = [100, 200, 300, 400, 500, 600];

const FONT = "var(--font-narrow), 'Archivo Narrow', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";

// ---------------------------------------------------------------------------------------------
// Small geometry helpers

const f2 = (n: number) => (Math.abs(n) < 0.005 ? "0" : n.toFixed(2));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const open = (r: Ring): Ring => (r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r);
const signedArea = (r: Ring) => {
  const o = open(r);
  let s = 0;
  for (let i = 0; i < o.length; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % o.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
const centroid = (r: Ring): XY => {
  const o = open(r);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i]!;
    const q = o[(i + 1) % o.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length];
  return [cx / (3 * a), cy / (3 * a)];
};
function inRing(p: XY, r: Ring): boolean {
  const o = open(r);
  let inside = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const a = o[i]!;
    const b = o[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inPoly = (p: XY, poly: Poly) => poly.length > 0 && inRing(p, poly[0]!) && !poly.slice(1).some((h) => inRing(p, h));
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const upright = (deg: number) => (deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg);
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Outward unit normal of edge i of a ring (world coords). */
function outward(r: Ring, i: number): XY {
  const o = open(r);
  const a = o[i]!;
  const b = o[(i + 1) % o.length]!;
  const L = dist(a, b) || 1;
  const t: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return signedArea(o) > 0 ? [t[1], -t[0]] : [-t[1], t[0]];
}

/** Feet → 12'-6" */
function ftIn(ft: number): string {
  let f = Math.floor(ft + 1e-9);
  let i = Math.round((ft - f) * 12);
  if (i === 12) {
    f += 1;
    i = 0;
  }
  return `${f}'-${i}"`;
}

/** "§903.03.C.2 Site Development Standards table (...); §911.02 use table" → " (§903.03.C.2, §911.02)" */
function citeCodes(c: string | null): string {
  const codes = [...new Set((c ?? "").match(/§\s*[0-9][0-9A-Za-z.()]*/g) ?? [])].map((x) => x.replace(/\s+/g, "").replace(/\.$/, ""));
  return codes.length ? ` (PITTSBURGH ZONING CODE ${codes.join(", ")})` : "";
}

/** Word wrap for sheet notes (condensed font; width in characters). */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** Approximate text width for the condensed face, uppercase, with letter spacing. */
const textW = (s: string, size: number) => s.length * size * 0.54;

/** Parallel hatch lines covering a paper rectangle (drawn inside a clip path, so they stay vector). */
function hatch(x0: number, y0: number, x1: number, y1: number, spacing: number, up: boolean): string {
  const h = y1 - y0;
  const parts: string[] = [];
  const stepX = spacing * Math.SQRT2;
  for (let c = -h; c <= x1 - x0; c += stepX) {
    const xa = x0 + c;
    parts.push(up ? `M${f2(xa)},${f2(y1)}L${f2(xa + h)},${f2(y0)}` : `M${f2(xa)},${f2(y0)}L${f2(xa + h)},${f2(y1)}`);
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------------------------
// Map features → feet

function fromLonLat(A: LonLatAffine): (c: [number, number]) => XY {
  const a = A.lon_per_x;
  const b = A.lon_per_y;
  const c = A.lat_per_x;
  const d = A.lat_per_y;
  const det = a * d - b * c;
  return ([lon, lat]) => {
    const dl = lon - A.lon0;
    const dt = lat - A.lat0;
    return [(d * dl - b * dt) / det, (-c * dl + a * dt) / det];
  };
}

function polysOf(g: GeoFeature["geometry"], conv: (c: [number, number]) => XY): Poly[] {
  if (!g) return [];
  if (g.type === "Polygon") return [(g.coordinates as [number, number][][]).map((r) => r.map(conv))];
  if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][]).map((p) => p.map((r) => r.map(conv)));
  return [];
}
function linesOf(g: GeoFeature["geometry"], conv: (c: [number, number]) => XY): Ring[] {
  if (!g) return [];
  if (g.type === "LineString") return [(g.coordinates as [number, number][]).map(conv)];
  if (g.type === "MultiLineString") return (g.coordinates as [number, number][][]).map((l) => l.map(conv));
  return [];
}

const HAZARDS: { kind: string; name: string; note: string }[] = [
  { kind: "floodway", name: "FEMA FLOODWAY LIMIT", note: "FEMA REGULATORY FLOODWAY LIMIT (NFHL)." },
  { kind: "flood_100", name: "FEMA 1% ANNUAL CHANCE FLOOD LIMIT", note: "FEMA 1% ANNUAL CHANCE (100-YEAR) FLOOD HAZARD LIMIT (NFHL)." },
  { kind: "flood_500", name: "FEMA 0.2% ANNUAL CHANCE FLOOD LIMIT", note: "FEMA 0.2% ANNUAL CHANCE (500-YEAR) FLOOD HAZARD LIMIT (NFHL)." },
  { kind: "landslide_prone_pgh", name: "LANDSLIDE-PRONE OVERLAY LIMIT", note: "LANDSLIDE-PRONE OVERLAY LIMIT, PITTSBURGH ZONING CODE §906.04." },
  { kind: "landslide_recorded", name: "MAPPED SLOPE-MOVEMENT LIMIT (1982)", note: "MAPPED SLOPE-MOVEMENT AREA, 1982 INVENTORY (HISTORIC MAP, NOT A RECORD OF RECENT LANDSLIDES)." },
  { kind: "undermined_pgh", name: "UNDERMINED AREA OVERLAY LIMIT", note: "UNDERMINED AREA OVERLAY LIMIT, PITTSBURGH ZONING CODE §906.05." },
  { kind: "mined_out_dep", name: "MINED-OUT AREA LIMIT (PA DEP)", note: "MAPPED MINED-OUT AREA LIMIT (PA DEP). MINE MAPS ARE INCOMPLETE." },
  { kind: "historic_district_pgh", name: "HISTORIC DISTRICT LIMIT", note: "CITY HISTORIC DISTRICT LIMIT; EXTERIOR WORK NEEDS HRC REVIEW." },
  { kind: "wetland_nwi", name: "MAPPED WETLAND LIMIT (NWI)", note: "MAPPED WETLAND LIMIT (NATIONAL WETLANDS INVENTORY)." },
];

// ---------------------------------------------------------------------------------------------
// Layout: rotation and engineering scale

function streetClass(name: string | null | undefined) {
  const cfg = sitePlanConfig.streets;
  const suffix = (name ?? "").trim().toUpperCase().split(/\s+/).at(-1) ?? "";
  if (cfg.alley.suffixes.includes(suffix)) return cfg.alley;
  if (cfg.major.suffixes.includes(suffix)) return cfg.major;
  return cfg.local;
}

function longestFront(parcel: Ring, fronts: number[]): number | null {
  const o = open(parcel);
  let best: number | null = null;
  let bl = -1;
  for (const i of fronts) {
    if (i < 0 || i >= o.length) continue;
    const l = dist(o[i]!, o[(i + 1) % o.length]!);
    if (l > bl) {
      bl = l;
      best = i;
    }
  }
  return best;
}

export function layoutSitePlan(input: SitePlanInput): SitePlanLayout {
  const lot = open(input.parcel);
  const fe = longestFront(lot, input.frontEdges);
  const candidates: number[] = [];
  if (fe !== null) {
    const n = outward(lot, fe);
    let phi = -Math.PI / 2 - Math.atan2(n[1], n[0]);
    while (phi <= -Math.PI) phi += 2 * Math.PI;
    while (phi > Math.PI) phi -= 2 * Math.PI;
    candidates.push(phi);
  }
  candidates.push(0);
  const rowHalf = sitePlanConfig.streets.local.rightOfWayFt / 2;

  let pick: { phi: number; s: number; ext: boolean; b: [number, number, number, number]; mb: number } | null = null;
  for (const phi of candidates) {
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const us = lot.map((p) => p[0] * c - p[1] * sn);
    const vs = lot.map((p) => p[0] * sn + p[1] * c);
    const b: [number, number, number, number] = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    for (const s of [...STANDARD, ...EXTENDED, ...BEYOND]) {
      const k = 72 / s;
      const mb = Math.max(MARGIN, (rowHalf + 10) * k + 8);
      if (w * k + 2 * MARGIN <= VW && h * k + MARGIN + mb <= VH) {
        if (!pick || s < pick.s) pick = { phi, s, ext: !STANDARD.includes(s), b, mb };
        break;
      }
    }
  }
  if (!pick) {
    const phi = candidates[0]!;
    pick = { phi, s: BEYOND.at(-1)!, ext: true, b: [0, 0, 0, 0], mb: MARGIN };
  }
  const k = 72 / pick.s;
  const [umin, vmin, umax, vmax] = pick.b;
  const extraV = VH - ((vmax - vmin) * k + MARGIN + pick.mb);
  const ox = VX0 + (VW - (umax - umin) * k) / 2 - umin * k;
  const oy = VY1 - pick.mb - Math.max(0, extraV) / 2 + vmin * k;

  // Viewport corners back to world feet.
  const c = Math.cos(pick.phi);
  const sn = Math.sin(pick.phi);
  const toWorld = (X: number, Y: number): XY => {
    const u = (X - ox) / k;
    const v = (oy - Y) / k;
    return [u * c + v * sn, -u * sn + v * c];
  };
  const corners = [toWorld(VX0, VY0), toWorld(VX1, VY0), toWorld(VX0, VY1), toWorld(VX1, VY1)];
  const pad = 12;
  const bounds = {
    minX: Math.floor(Math.min(...corners.map((p) => p[0])) - pad),
    minY: Math.floor(Math.min(...corners.map((p) => p[1])) - pad),
    maxX: Math.ceil(Math.max(...corners.map((p) => p[0])) + pad),
    maxY: Math.ceil(Math.max(...corners.map((p) => p[1])) + pad),
  };
  return { angleRad: pick.phi, scaleFt: pick.s, extended: pick.ext, k, ox, oy, bounds };
}

// ---------------------------------------------------------------------------------------------
// Rendering

interface Keynote {
  text: string;
  anchor: XY | null; // paper
}

export function renderSitePlan(input: SitePlanInput, L: SitePlanLayout, dem: Grid | null): string {
  const cosA = Math.cos(L.angleRad);
  const sinA = Math.sin(L.angleRad);
  const P = (p: XY): XY => {
    const u = p[0] * cosA - p[1] * sinA;
    const v = p[0] * sinA + p[1] * cosA;
    return [L.ox + u * L.k, L.oy - v * L.k];
  };
  const angDeg = (a: XY, b: XY) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; // paper
  const inView = (q: XY, inset = 0) => q[0] >= VX0 + inset && q[0] <= VX1 - inset && q[1] >= VY0 + inset && q[1] <= VY1 - inset;
  const d = (pts: XY[], close: boolean) => (pts.length ? "M" + pts.map((q) => `${f2(q[0])},${f2(q[1])}`).join("L") + (close ? "Z" : "") : "");
  const dW = (pts: Ring, close: boolean) => d(pts.map(P), close);
  const conv = fromLonLat(input.affine);
  const lot = open(input.parcel);
  const lotP = lot.map(P);
  const lotC = P(centroid(lot));

  const o: string[] = [];
  const a = (s: string) => o.push(s);
  const occupied: [number, number, number, number][] = [];
  const free = (x0: number, y0: number, x1: number, y1: number) => !occupied.some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
  const occupy = (x0: number, y0: number, x1: number, y1: number) => occupied.push([x0, y0, x1, y1]);
  const occupyRot = (cx: number, cy: number, w: number, h: number, deg: number) => {
    const r = (deg * Math.PI) / 180;
    const ex = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2;
    const ey = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2;
    occupy(cx - ex, cy - ey, cx + ex, cy + ey);
  };
  const fps = input.scheme?.footprints.map(open).filter((r) => r.length >= 3) ?? [];
  const fpsPaper = fps.map((r) => d(r.map(P), true)).join("");
  let fpBox: [number, number, number, number] | null = null;
  if (fps.length) {
    const bx = fps.flat().map(P);
    fpBox = [Math.min(...bx.map((q) => q[0])), Math.min(...bx.map((q) => q[1])), Math.max(...bx.map((q) => q[0])), Math.max(...bx.map((q) => q[1]))];
    occupy(...fpBox);
  }
  const text = (x: number, y: number, s: string, cls: string, anchor: "start" | "middle" | "end" = "middle", rot = 0, extra = "") =>
    a(
      `<text x="${f2(x)}" y="${f2(y)}" class="${cls}" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot.toFixed(1)} ${f2(x)} ${f2(y)})"` : ""}${extra}>${esc(s)}</text>`,
    );

  // --- map layers
  const feats = input.map?.features ?? [];
  const bbox = input.map?.bbox ?? null;
  const onBbox = (c: [number, number]) =>
    !!bbox && (Math.abs(c[0] - bbox[0]) < 2e-6 || Math.abs(c[0] - bbox[2]) < 2e-6 || Math.abs(c[1] - bbox[1]) < 2e-6 || Math.abs(c[1] - bbox[3]) < 2e-6);
  const byKind = (k: string) => feats.filter((f) => f.properties?.kind === k && f.geometry);
  const W = L.bounds;
  const nearView = (pts: Ring, pad = 60) => pts.some((p) => p[0] >= W.minX - pad && p[0] <= W.maxX + pad && p[1] >= W.minY - pad && p[1] <= W.maxY + pad);

  const subjectPolys = byKind("parcel").flatMap((f) => polysOf(f.geometry, conv));
  const lotRings: Ring[] = subjectPolys.length ? subjectPolys.map((p) => open(p[0]!)) : [lot];

  // --- terrain
  let contoursMinor = "";
  let contoursIndex = "";
  const contourLabels: string[] = [];
  let steepPath = "";
  let steepAnchor: XY | null = null;
  let steepInLot = 0;
  let steepInView = false;
  let ffe: number | null = null;
  const iv = sitePlanConfig.contours.intervalFt;
  const idx = sitePlanConfig.contours.indexEveryFt;
  const steep = sitePlanConfig.steepSlopePct / 100;
  if (dem) {
    const sm = gaussian(dem, 1.2);
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const v of sm.z) if (!Number.isNaN(v)) (zmin = Math.min(zmin, v)), (zmax = Math.max(zmax, v));
    const minorParts: string[] = [];
    const indexParts: string[] = [];
    for (let lev = Math.ceil(zmin / iv) * iv; lev <= zmax; lev += iv) {
      const isIndex = Math.abs(lev / idx - Math.round(lev / idx)) < 1e-6;
      for (const line of isolines(sm, lev)) {
        let pts = line.map(P);
        if (!pts.some((q) => inView(q, -20))) continue;
        const closed = line.length > 2 && dist(line[0]!, line.at(-1)!) < 1e-6;
        pts = simplify(pts, 0.3);
        if (pts.length < 2) continue;
        pts = chaikin(chaikin(pts, closed), closed);
        (isIndex ? indexParts : minorParts).push(d(pts, false));
        if (isIndex) {
          // Label at evenly spaced points along the visible part.
          const segs: number[] = [0];
          for (let i = 1; i < pts.length; i++) segs.push(segs[i - 1]! + dist(pts[i - 1]!, pts[i]!));
          const total = segs.at(-1)!;
          const every = 190;
          const n = Math.max(1, Math.floor(total / every));
          for (let m = 0; m < n; m++) {
            const at = (total * (m + 0.5)) / n;
            let i = 1;
            while (i < segs.length - 1 && segs[i]! < at) i++;
            const t = (at - segs[i - 1]!) / Math.max(1e-9, segs[i]! - segs[i - 1]!);
            const q = lerp(pts[i - 1]!, pts[i]!, t);
            if (!inView(q, 14)) continue;
            const s = String(Math.round(lev));
            const w = textW(s, 4.6) / 2 + 1.5;
            if (!free(q[0] - w, q[1] - w, q[0] + w, q[1] + w)) continue;
            occupy(q[0] - w, q[1] - w, q[0] + w, q[1] + w);
            contourLabels.push(
              `<text x="${f2(q[0])}" y="${f2(q[1] + 1.6)}" class="ctrt" text-anchor="middle" transform="rotate(${upright(angDeg(pts[i - 1]!, pts[i]!)).toFixed(1)} ${f2(q[0])} ${f2(q[1])})">${s}</text>`,
            );
          }
        }
      }
    }
    contoursMinor = minorParts.join("");
    contoursIndex = indexParts.join("");

    // Steep ground (≥ 25%) as closed rings on a padded slope grid, filled even-odd.
    const sl = slopeGrid(gaussian(dem, 1.0));
    const rings = isolines(padGrid(sl, 0), steep)
      .filter((r) => Math.abs(signedArea(r)) >= 60)
      .map((r) => simplify(r.map(P), 0.25))
      .filter((r) => r.length >= 4 && r.some((q) => inView(q, -10)));
    steepPath = rings.map((r) => d(r, true)).join("");
    steepInView = rings.length > 0;
    // Share of lot cells ≥ 25% and an anchor point near the lot centroid.
    let inLot = 0;
    let best = Infinity;
    const lc = centroid(lot);
    for (let j = 0; j < sl.ny; j++)
      for (let i = 0; i < sl.nx; i++) {
        const p: XY = [sl.x0 + i * sl.step, sl.y0 + j * sl.step];
        if (!inRing(p, lot)) continue;
        const v = sl.z[j * sl.nx + i]!;
        if (Number.isNaN(v)) continue;
        inLot++;
        if (v >= steep) {
          steepInLot++;
          if (fps.some((r) => inRing(p, r) || inRing([p[0] + 8, p[1]], r) || inRing([p[0] - 8, p[1]], r) || inRing([p[0], p[1] + 8], r) || inRing([p[0], p[1] - 8], r))) continue;
          // Prefer a point with steep neighbors all around (inside the hatch, not on its edge).
          const around = [-2, 2].every((di) => (sl.z[j * sl.nx + Math.min(sl.nx - 1, Math.max(0, i + di))] ?? 0) >= steep);
          const dd = dist(p, lc) + (around ? 0 : 1000);
          if (dd < best) {
            best = dd;
            steepAnchor = P(p);
          }
        }
      }
    steepInLot = inLot ? steepInLot / inLot : 0;

    if (input.scheme?.footprints.length) {
      let s = 0;
      let n = 0;
      for (let j = 0; j < dem.ny; j++)
        for (let i = 0; i < dem.nx; i++) {
          const p: XY = [dem.x0 + i * dem.step, dem.y0 + j * dem.step];
          const v = dem.z[j * dem.nx + i]!;
          if (!Number.isNaN(v) && input.scheme.footprints.some((r) => inRing(p, r))) {
            s += v;
            n++;
          }
        }
      if (n) ffe = Math.round((s / n) * 2) / 2;
    }
  }

  // --- streets: curb, walk and right-of-way from buffered centerlines
  const streetFeats = byKind("street")
    .flatMap((f) => linesOf(f.geometry, conv).map((line) => ({ name: f.properties?.label ?? null, line })))
    .filter((s) => s.line.length >= 2 && nearView(s.line, 120));
  // Offset lines as zero-isolines of a distance field: f(p) = min over centerline segments of
  // (distance to segment − half width). Robust at intersections and deterministic.
  const streetOutlines = (): { curb: Poly[]; row: Poly[]; walk: Poly[] } => {
    const segs: { a: XY; b: XY; wc: number; wr: number; ww: number }[] = [];
    for (const s0 of streetFeats) {
      const c = streetClass(s0.name);
      for (let i = 1; i < s0.line.length; i++) {
        if (dist(s0.line[i - 1]!, s0.line[i]!) < 0.05) continue;
        segs.push({ a: s0.line[i - 1]!, b: s0.line[i]!, wc: c.curbToCurbFt / 2, wr: c.rightOfWayFt / 2, ww: c.sidewalkFt > 0 ? c.rightOfWayFt / 2 - c.sidewalkFt : -1 });
      }
    }
    if (!segs.length) return { curb: [], row: [], walk: [] };
    const step = Math.max(1, L.scaleFt / 40);
    const nx = Math.floor((W.maxX - W.minX) / step) + 1;
    const ny = Math.floor((W.maxY - W.minY) / step) + 1;
    const B = 40;
    const reach = 30;
    const buckets = new Map<number, number[]>();
    const bk = (ix: number, iy: number) => ix * 100003 + iy;
    segs.forEach((sg, n) => {
      const x0 = Math.floor((Math.min(sg.a[0], sg.b[0]) - reach - W.minX) / B);
      const x1 = Math.floor((Math.max(sg.a[0], sg.b[0]) + reach - W.minX) / B);
      const y0 = Math.floor((Math.min(sg.a[1], sg.b[1]) - reach - W.minY) / B);
      const y1 = Math.floor((Math.max(sg.a[1], sg.b[1]) + reach - W.minY) / B);
      for (let ix = Math.max(-1, x0); ix <= Math.min(Math.ceil(nx * step / B) + 1, x1); ix++)
        for (let iy = Math.max(-1, y0); iy <= Math.min(Math.ceil(ny * step / B) + 1, y1); iy++) {
          const k = bk(ix, iy);
          const l = buckets.get(k);
          if (l) l.push(n);
          else buckets.set(k, [n]);
        }
    });
    const FAR = 1000;
    const fc = new Float64Array(nx * ny).fill(FAR);
    const fr = new Float64Array(nx * ny).fill(FAR);
    const fw = new Float64Array(nx * ny).fill(FAR);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p: XY = [W.minX + i * step, W.minY + j * step];
        const list = buckets.get(bk(Math.floor((p[0] - W.minX) / B), Math.floor((p[1] - W.minY) / B)));
        if (!list) continue;
        const n = j * nx + i;
        for (const si of list) {
          const sg = segs[si]!;
          const dd = segDist(p, sg.a, sg.b);
          if (dd - sg.wc < fc[n]!) fc[n] = dd - sg.wc;
          if (dd - sg.wr < fr[n]!) fr[n] = dd - sg.wr;
          if (sg.ww > 0 && dd - sg.ww < fw[n]!) fw[n] = dd - sg.ww;
        }
      }
    const rings = (z: Float64Array): Poly[] =>
      isolines(padGrid({ x0: W.minX, y0: W.minY, step, nx, ny, z }, FAR), 0)
        .filter((r) => r.length > 3)
        .map((r) => [r]);
    return { curb: rings(fc), row: rings(fr), walk: rings(fw) };
  };
  const { curb, row, walk } = streetOutlines();
  const polyPath = (ps: Poly[]) => ps.map((p) => p.map((r) => d(simplify(open(r).map(P), 0.15), true)).join("")).join("");

  // --- neighbors, buildings, overlays
  const neighborPaths = byKind("neighbor")
    .flatMap((f) => polysOf(f.geometry, conv))
    .filter((p) => nearView(p[0]!))
    .map((p) => dW(open(p[0]!), true))
    .join("");

  const cfgB = sitePlanConfig.buildingStories;
  const buildings = byKind("building")
    .flatMap((f) =>
      polysOf(f.geometry, conv).map((p) => ({
        ring: open(p[0]!),
        h: typeof f.properties?.height_m === "number" ? f.properties.height_m : null,
        est: f.properties?.height_source !== "lidar",
        id: f.properties?.id ?? "",
      })),
    )
    .filter((b) => b.ring.length >= 3 && nearView(b.ring));
  const onLot = (r: Ring) => lotRings.some((lr) => inRing(centroid(r), lr));

  // --- setbacks and envelope
  let setbackRing: Poly[] = [];
  let classes: SetbackClass[] = [];
  if (input.setbacks && input.frontEdges.length) {
    classes = quickfit.classifyEdges(lot, input.frontEdges, undefined, input.streetSideEdges) as SetbackClass[];
    try {
      setbackRing = quickfit.buildEnvelope(lot, classes, input.setbacks, []) as Poly[];
    } catch {
      setbackRing = [];
    }
  }

  // ------------------------------------------------------------------------------------------
  // Emit SVG

  a(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${(SW / 72).toFixed(3)}in" height="${(SH / 72).toFixed(3)}in" class="ea101" role="img" aria-labelledby="ea101-title ea101-desc">`,
  );
  // Alt text (tagged PDF and screen readers): generated from the same inputs as the drawing.
  a(`<title id="ea101-title">Site plan, sheet EA-101, parcel ${esc(input.parid)}</title><desc id="ea101-desc">${esc(describeSitePlan({ ...input, scaleFt: L.scaleFt, scheme: input.scheme && { ...input.scheme, footprints: input.scheme.footprints } }))}</desc>`);
  a(`<defs>
<pattern id="ea-env" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".38" fill="#000"/></pattern>
${steepPath ? `<clipPath id="ea-steep-clip"><path d="${steepPath}" clip-rule="evenodd"/></clipPath>` : ""}
${fpsPaper ? `<clipPath id="ea-fp-clip"><path d="${fpsPaper}"/></clipPath>` : ""}
<clipPath id="ea-lg-steep"><rect x="0" y="-3" width="26" height="6"/></clipPath>
<clipPath id="ea-lg-fp"><rect x="0" y="-3" width="26" height="6"/></clipPath>
<clipPath id="ea-vp"><rect x="${VX0}" y="${VY0}" width="${VW}" height="${VH}"/></clipPath>
</defs>
<style>
.ea101 text{font-family:${FONT};fill:#000;letter-spacing:.04em}
.ea101 .bd{fill:none;stroke:#000;stroke-width:1.4}.ea101 .bd2{fill:none;stroke:#000;stroke-width:.45}
.ea101 .pl{fill:none;stroke:#000;stroke-width:1.35;stroke-dasharray:16 2.6 2.4 2.6;stroke-linejoin:round}
.ea101 .plx{fill:none;stroke:#000;stroke-width:.8;stroke-dasharray:16 2.6 2.4 2.6}
.ea101 .adj{fill:none;stroke:#707070;stroke-width:.35;stroke-dasharray:9 1.8 1.4 1.8}
.ea101 .sb{fill:none;stroke:#000;stroke-width:.55;stroke-dasharray:4.5 2.5}
.ea101 .env{fill:url(#ea-env);stroke:none}
.ea101 .curb{fill:none;stroke:#000;stroke-width:.8}
.ea101 .row{fill:none;stroke:#000;stroke-width:.3}
.ea101 .walk{fill:none;stroke:#000;stroke-width:.3}
.ea101 .cl{fill:none;stroke:#000;stroke-width:.35;stroke-dasharray:20 3 2.5 3}
.ea101 .ctr{fill:none;stroke:#9a9a9a;stroke-width:.28}
.ea101 .ctrI{fill:none;stroke:#555;stroke-width:.55}
.ea101 .ctrt{font-size:4.6px;fill:#444;stroke:#fff;stroke-width:2.2px;paint-order:stroke;stroke-linejoin:round}
.ea101 .steepL{fill:none;stroke:#333;stroke-width:.22}.ea101 .steepE{fill:none;stroke:#333;stroke-width:.18}
.ea101 .haz{fill:none;stroke:#000;stroke-width:.75;stroke-dasharray:8 1.8 1.2 1.8 1.2 1.8}
.ea101 .exb{fill:#eeeeee;stroke:#333;stroke-width:.45;stroke-dasharray:3 1.4}
.ea101 .bldg{fill:none;stroke:#000;stroke-width:1.5;stroke-linejoin:miter}.ea101 .pocheL{fill:none;stroke:#000;stroke-width:.5}
.ea101 .party{stroke:#000;stroke-width:1.1}
.ea101 .dim{fill:none;stroke:#000;stroke-width:.3}
.ea101 .tick{stroke:#000;stroke-width:.9}
.ea101 .ldr{fill:none;stroke:#000;stroke-width:.35}
.ea101 .halo{stroke:#fff;stroke-width:2.4px;paint-order:stroke;stroke-linejoin:round}
.ea101 .dimt{font-size:5.4px}
.ea101 .lbl{font-size:5.6px;font-weight:600}.ea101 .lblS{font-size:4.8px}.ea101 .exl{font-size:4.4px;fill:#333}
.ea101 .st{font-size:7px;font-weight:600;letter-spacing:.14em}.ea101 .stS{font-size:4.6px;letter-spacing:.08em}
.ea101 .hz{font-size:4.6px;letter-spacing:.06em}
.ea101 .kn{font-size:5.6px;font-weight:600}
.ea101 .t{font-size:6.6px}.ea101 .tS{font-size:5.2px}.ea101 .tL{font-size:4.6px;fill:#444;letter-spacing:.08em}
.ea101 .tN{font-size:5.1px}.ea101 .tB{font-size:6.2px;font-weight:700;letter-spacing:.12em}
.ea101 .tH{font-size:9.5px;font-weight:700;letter-spacing:.1em}.ea101 .tXL{font-size:16px;font-weight:700;letter-spacing:.02em}
.ea101 .tSh{font-size:22px;font-weight:700;letter-spacing:.02em}
</style>`);

  // Sheet border and title-block divider
  a(`<rect x="4" y="4" width="${SW - 8}" height="${SH - 8}" class="bd"/>`);
  a(`<rect x="7" y="7" width="${SW - 14}" height="${SH - 14}" class="bd2"/>`);
  a(`<line x1="${TB}" y1="7" x2="${TB}" y2="${SH - 7}" class="bd"/>`);
  a(`<line x1="7" y1="${VY1 + 3}" x2="${TB}" y2="${VY1 + 3}" class="bd2"/>`);

  // ---- drawing (clipped to the viewport)
  a(`<g clip-path="url(#ea-vp)">`);
  if (steepPath) {
    a(`<path d="${hatch(VX0, VY0, VX1, VY1, 4.2, true)}" class="steepL" clip-path="url(#ea-steep-clip)"/>`);
    a(`<path d="${steepPath}" class="steepE"/>`);
  }
  if (contoursMinor) a(`<path d="${contoursMinor}" class="ctr"/>`);
  if (contoursIndex) a(`<path d="${contoursIndex}" class="ctrI"/>`);

  // Streets: right-of-way (thin), sidewalk (thin + dot screen), curb (medium), centerline.
  if (row.length) a(`<path d="${polyPath(row)}" class="row"/>`);
  if (walk.length) a(`<path d="${polyPath(walk)}" class="walk"/>`);
  if (curb.length) a(`<path d="${polyPath(curb)}" fill="#fff" fill-rule="evenodd" stroke="none"/><path d="${polyPath(curb)}" class="curb"/>`);
  a(`<path d="${streetFeats.map((s) => dW(s.line, false)).join("")}" class="cl"/>`);

  // Streams
  const streams = byKind("stream").flatMap((f) => linesOf(f.geometry, conv)).filter((l) => nearView(l));
  if (streams.length) a(`<path d="${streams.map((l) => dW(l, false)).join("")}" fill="none" stroke="#000" stroke-width=".5" stroke-dasharray="6 1.5 1 1.5 1 1.5"/>`);

  // Adjacent lot lines
  a(`<path d="${neighborPaths}" class="adj"/>`);

  // Existing buildings
  const exLabels: string[] = [];
  let exAnchor: XY | null = null;
  let exOnLot = 0;
  let exBest = Infinity;
  for (const b of buildings) {
    const pr = b.ring.map(P);
    if (!pr.some((q) => inView(q, -5))) continue;
    a(`<path d="${d(pr, true)}" class="exb"/>`);
    const cW = centroid(b.ring);
    const cp = P(cW);
    const xs0 = pr.map((q) => q[0]);
    const ys0 = pr.map((q) => q[1]);
    const lotHit = onLot(b.ring);
    if (lotHit) exOnLot++;
    const dd = dist(cp, lotC);
    if (!lotHit && inView(cp, 30) && dd < exBest) {
      exBest = dd;
      exAnchor = cp;
    }
    const xs = pr.map((q) => q[0]);
    const ys = pr.map((q) => q[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const stories = b.h ? Math.max(1, Math.round((b.h - cfgB.roofAllowanceM) / cfgB.storyHeightM)) : null;
    const l1 = lotHit ? "EX. BLDG ON LOT" : stories ? `EX. ${stories}-STY` : "EX. BLDG";
    const l2 = lotHit ? (stories ? `${stories}-STY` : "") : "BLDG";
    let lp: XY = cp;
    if (!inView(cp, 12) || !inRing(cp, pr)) {
      // Visible part only: the sample point inside the footprint nearest the clamped centroid.
      const tgt: XY = [Math.min(VX1 - 14, Math.max(VX0 + 14, cp[0])), Math.min(VY1 - 10, Math.max(VY0 + 10, cp[1]))];
      let bd = Infinity;
      const gx0 = Math.max(VX0 + 14, Math.min(...xs0));
      const gx1 = Math.min(VX1 - 14, Math.max(...xs0));
      const gy0 = Math.max(VY0 + 10, Math.min(...ys0));
      const gy1 = Math.min(VY1 - 10, Math.max(...ys0));
      for (let gi = 0; gi <= 8; gi++)
        for (let gj = 0; gj <= 8; gj++) {
          const q: XY = [gx0 + ((gx1 - gx0) * gi) / 8, gy0 + ((gy1 - gy0) * gj) / 8];
          if (gx1 <= gx0 || gy1 <= gy0 || !inRing(q, pr)) continue;
          const dq = dist(q, tgt);
          if (dq < bd) {
            bd = dq;
            lp = q;
          }
        }
    }
    if (Math.min(bw, bh) >= 15 && Math.max(bw, bh) >= textW(l1, 4.4) + 4 && inRing(lp, pr)) {
      cp[0] = lp[0];
      cp[1] = lp[1];
      const w = textW(l1, 4.4) / 2;
      if (free(cp[0] - w, cp[1] - 5, cp[0] + w, cp[1] + 5)) {
        occupy(cp[0] - w, cp[1] - 5, cp[0] + w, cp[1] + 5);
        exLabels.push(`<text x="${f2(cp[0])}" y="${f2(cp[1] - 0.6)}" class="exl" text-anchor="middle">${esc(l1)}</text>`);
        if (l2) exLabels.push(`<text x="${f2(cp[0])}" y="${f2(cp[1] + 4.6)}" class="exl" text-anchor="middle">${esc(l2)}</text>`);
      }
    }
  }
  o.push(...exLabels);

  // Hazard overlays: boundary lines only (dash-dot-dot), with the clip-edge segments of the 250 m
  // map window removed so no false limits are drawn.
  const hazardsShown: { name: string; note: string; anchor: XY | null; within: boolean }[] = [];
  for (const hz of HAZARDS) {
    const fs = byKind(hz.kind);
    if (!fs.length) continue;
    const runs: XY[][] = [];
    let within = false;
    for (const f of fs) {
      const g = f.geometry!;
      const polys: [number, number][][][] =
        g.type === "Polygon" ? [g.coordinates as [number, number][][]] : g.type === "MultiPolygon" ? (g.coordinates as [number, number][][][]) : [];
      for (const p of polys) {
        const polyFt: Poly = p.map((r) => r.map(conv));
        if (inPoly(centroid(lot), polyFt)) within = true;
        for (const r of p) {
          let run: XY[] = [];
          for (let i = 1; i < r.length; i++) {
            const c0 = r[i - 1]!;
            const c1 = r[i]!;
            if (onBbox(c0) && onBbox(c1)) {
              if (run.length > 1) runs.push(run);
              run = [];
              continue;
            }
            if (!run.length) run.push(P(conv(c0)));
            run.push(P(conv(c1)));
          }
          if (run.length > 1) runs.push(run);
        }
      }
    }
    const vis = runs.filter((r) => r.some((q) => inView(q, -5)));
    if (!vis.length && !within) continue;
    if (vis.length) a(`<path d="${vis.map((r) => d(r, false)).join("")}" class="haz"/>`);
    // Label along the longest visible straight-ish segment, nearest the lot.
    let anchor: XY | null = null;
    let bestScore = -Infinity;
    let lbl: { q: XY; ang: number } | null = null;
    for (const r of vis) {
      for (let i = 1; i < r.length; i++) {
        const p0 = r[i - 1]!;
        const p1 = r[i]!;
        const m = lerp(p0, p1, 0.5);
        if (!inView(m, 18)) continue;
        const len = dist(p0, p1);
        const score = Math.min(len, 120) - dist(m, lotC) * 0.4;
        if (score > bestScore) {
          bestScore = score;
          anchor = m;
          lbl = len >= textW(hz.name, 4.6) + 6 ? { q: m, ang: upright(angDeg(p0, p1)) } : null;
        }
      }
    }
    if (lbl) {
      const rad = (lbl.ang * Math.PI) / 180;
      const nx = -Math.sin(rad) * 3.4;
      const ny = Math.cos(rad) * 3.4;
      text(lbl.q[0] - nx, lbl.q[1] - ny, hz.name, "hz halo", "middle", lbl.ang);
      occupyRot(lbl.q[0] - nx, lbl.q[1] - ny - 1.6, textW(hz.name, 4.6), 6, lbl.ang);
    }
    hazardsShown.push({ name: hz.name, note: hz.note, anchor, within });
  }

  // Setback lines and buildable envelope
  if (input.envelope.length) a(`<path d="${input.envelope.map((p) => p.map((r) => dW(open(r), true)).join("")).join("")}" class="env" fill-rule="evenodd"/>`);
  if (setbackRing.length) a(`<path d="${polyPath(setbackRing)}" class="sb"/>`);

  // Property line (all pieces of the subject parcel)
  for (const r of lotRings) a(`<path d="${dW(r, true)}" class="pl"/>`);

  // Proposed footprint: poché with party walls between attached units
  let bldgAnchor: XY | null = null;
  if (fps.length) {
    for (const r of fps) a(`<path d="${dW(r, true)}" fill="#fff" stroke="none"/>`);
    const [bx0, by0, bx1, by1] = fpBox!;
    a(`<path d="${hatch(bx0 - 2, by0 - 2, bx1 + 2, by1 + 2, 2.3, false)}" class="pocheL" clip-path="url(#ea-fp-clip)"/>`);
    for (const r of fps) a(`<path d="${dW(r, true)}" class="bldg"/>`);
    // Party walls: collinear, overlapping edges of two different units.
    for (let i = 0; i < fps.length; i++)
      for (let j = i + 1; j < fps.length; j++) {
        const A0 = fps[i]!;
        const B0 = fps[j]!;
        for (let e = 0; e < A0.length; e++) {
          const p = A0[e]!;
          const q = A0[(e + 1) % A0.length]!;
          for (let f = 0; f < B0.length; f++) {
            const r0 = B0[f]!;
            const r1 = B0[(f + 1) % B0.length]!;
            if (segDist(r0, p, q) < 0.3 && segDist(r1, p, q) < 0.3) a(`<path d="${d([P(r0), P(r1)], false)}" class="party"/>`);
            else if (segDist(p, r0, r1) < 0.3 && segDist(q, r0, r1) < 0.3) a(`<path d="${d([P(p), P(q)], false)}" class="party"/>`);
          }
        }
      }
  }
  a(`</g>`);

  // ---- dimensions (inside the viewport clip too)
  a(`<g clip-path="url(#ea-vp)">`);
  const dimLine = (pa: XY, pb: XY, off: number, label: string, ext = true) => {
    const L0 = dist(pa, pb);
    if (L0 < 6) return;
    const t: XY = [(pb[0] - pa[0]) / L0, (pb[1] - pa[1]) / L0];
    const n: XY = [-t[1], t[0]];
    const A1: XY = [pa[0] + n[0] * off, pa[1] + n[1] * off];
    const B1: XY = [pb[0] + n[0] * off, pb[1] + n[1] * off];
    const sg = Math.sign(off) || 1;
    if (ext && Math.abs(off) > 2) {
      a(`<path d="${d([[pa[0] + n[0] * 2 * sg, pa[1] + n[1] * 2 * sg], [A1[0] + n[0] * 2.5 * sg, A1[1] + n[1] * 2.5 * sg]], false)}${d([[pb[0] + n[0] * 2 * sg, pb[1] + n[1] * 2 * sg], [B1[0] + n[0] * 2.5 * sg, B1[1] + n[1] * 2.5 * sg]], false)}" class="dim"/>`);
    }
    a(`<path d="${d([A1, B1], false)}" class="dim"/>`);
    const tk = 2.2;
    const dd: XY = [(t[0] + n[0]) * tk * 0.7071, (t[1] + n[1]) * tk * 0.7071];
    a(`<path d="${d([[A1[0] - dd[0], A1[1] - dd[1]], [A1[0] + dd[0], A1[1] + dd[1]]], false)}${d([[B1[0] - dd[0], B1[1] - dd[1]], [B1[0] + dd[0], B1[1] + dd[1]]], false)}" class="tick"/>`);
    const ang = upright(angDeg(A1, B1));
    const rad = (ang * Math.PI) / 180;
    // Text sits on the side of the dimension line away from the object.
    const up: XY = [Math.sin(rad), -Math.cos(rad)];
    const side = up[0] * n[0] * sg + up[1] * n[1] * sg >= 0 ? 1 : -1;
    const m = lerp(A1, B1, 0.5);
    const tw = textW(label, 5.4);
    const q: XY = side > 0 ? [m[0] + up[0] * 1.6, m[1] + up[1] * 1.6] : [m[0] - up[0] * 5.6, m[1] - up[1] * 5.6];
    if (tw + 6 > L0) {
      // Label does not fit between the ticks: put it past the end of the line.
      const e: XY = [B1[0] + t[0] * (tw / 2 + 4), B1[1] + t[1] * (tw / 2 + 4)];
      text(e[0] + up[0] * 1.6, e[1] + up[1] * 1.6, label, "dimt halo", "middle", ang);
      occupyRot(e[0] + up[0] * 3, e[1] + up[1] * 3, tw, 6, ang);
    } else {
      text(q[0], q[1], label, "dimt halo", "middle", ang);
      occupyRot(q[0] + up[0] * 1.6, q[1] + up[1] * 1.6, tw, 6, ang);
    }
  };

  // Lot sides (decimal feet), outside the lot
  for (let i = 0; i < lot.length; i++) {
    const pa = lot[i]!;
    const pb = lot[(i + 1) % lot.length]!;
    const len = dist(pa, pb);
    const pA = P(pa);
    const pB = P(pb);
    if (dist(pA, pB) < 26) continue;
    // dimLine offsets along n = [-t1, t0] (paper); pick the sign that points out of the lot.
    const t: XY = [(pB[0] - pA[0]) / dist(pA, pB), (pB[1] - pA[1]) / dist(pA, pB)];
    const m = lerp(pA, pB, 0.5);
    const off = inRing([m[0] - t[1] * 1.5, m[1] + t[0] * 1.5], lotP) ? -11 : 11;
    dimLine(pA, pB, off, `${len.toFixed(2)}'`);
  }

  // Setbacks: one perpendicular dimension per class, at the longest edge of that class
  let setbackAnchor: XY | null = null;
  if (input.setbacks && classes.length) {
    const done = new Set<string>();
    const order = lot
      .map((_, i) => i)
      .sort((x, y) => dist(lot[y]!, lot[(y + 1) % lot.length]!) - dist(lot[x]!, lot[(x + 1) % lot.length]!) || x - y);
    for (const i of order) {
      const cls = classes[i]!;
      if (done.has(cls)) continue;
      const dft = input.setbacks[cls];
      const pa = lot[i]!;
      const pb = lot[(i + 1) % lot.length]!;
      if (!(dft > 0) || dist(P(pa), P(pb)) < 30) continue;
      done.add(cls);
      const nOut = outward(lot, i);
      const base = lerp(pa, pb, cls === "front" ? 0.3 : 0.7);
      const inner: XY = [base[0] - nOut[0] * dft, base[1] - nOut[1] * dft];
      const name = cls === "exterior_side" ? "STREET SIDE" : cls.toUpperCase();
      dimLine(P(base), P(inner), 0, `${ftIn(dft)} ${name}`, false);
      if (cls === "front" || !setbackAnchor) setbackAnchor = P(lerp(base, inner, 1));
    }
  }

  // Building overall dimensions + label plate
  if (fps.length) {
    const r0 = fps[0]!;
    const e0: XY = [r0[1]![0] - r0[0]![0], r0[1]![1] - r0[0]![1]];
    const L0 = Math.hypot(e0[0], e0[1]) || 1;
    const ax: XY = [e0[0] / L0, e0[1] / L0];
    const ay: XY = [-ax[1], ax[0]];
    const all = fps.flat();
    const us = all.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const vs = all.map((p) => p[0] * ay[0] + p[1] * ay[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const W2 = (u: number, v: number): XY => [u * ax[0] + v * ay[0], u * ax[1] + v * ay[1]];
    const corners = [W2(u0, v0), W2(u1, v0), W2(u1, v1), W2(u0, v1)];
    // Dimension the side farthest from the street and one flank.
    const lotCW = centroid(lot);
    const fe = longestFront(lot, input.frontEdges);
    const fmid = fe !== null ? lerp(lot[fe]!, lot[(fe + 1) % lot.length]!, 0.5) : lotCW;
    const sides = [0, 1, 2, 3].map((i) => ({ i, a: corners[i]!, b: corners[(i + 1) % 4]!, m: lerp(corners[i]!, corners[(i + 1) % 4]!, 0.5) }));
    // Dimension one long and one short side, preferring sides that face open lot (not a lot line).
    const bcW = W2((u0 + u1) / 2, (v0 + v1) / 2);
    const faceScore = (sd: (typeof sides)[number]) => {
      const out: XY = [sd.m[0] - bcW[0], sd.m[1] - bcW[1]];
      const L1 = Math.hypot(out[0], out[1]) || 1;
      const probe: XY = [sd.m[0] + (out[0] / L1) * (16 / L.k), sd.m[1] + (out[1] / L1) * (16 / L.k)];
      return (inRing(probe, lot) ? 0 : 1000) - dist(sd.m, fmid) / 1000;
    };
    const pickSide = (a0: number, b0: number) => [sides[a0]!, sides[b0]!].sort((x, y) => faceScore(x) - faceScore(y) || x.i - y.i)[0]!;
    const rear = pickSide(0, 2);
    const flank = pickSide(1, 3);
    const bc = P(bcW);
    for (const s of [rear, flank]) {
      const pA = P(s.a);
      const pB = P(s.b);
      const t: XY = [(pB[0] - pA[0]) / dist(pA, pB), (pB[1] - pA[1]) / dist(pA, pB)];
      const n: XY = [-t[1], t[0]];
      const m = lerp(pA, pB, 0.5);
      const outSign = (m[0] - bc[0]) * n[0] + (m[1] - bc[1]) * n[1] >= 0 ? 1 : -1;
      dimLine(pA, pB, 8 * outSign, ftIn(dist(s.a, s.b)));
    }
    bldgAnchor = bc;

    // Label plate: type, units and stories, estimated FFE. Inside the footprint when it fits (along the
    // long side), otherwise beside it with a leader.
    const bw = (u1 - u0) * L.k;
    const bh = (v1 - v0) * L.k;
    const along = Math.max(bw, bh);
    const across = Math.min(bw, bh);
    const l2 = `${input.scheme!.units} UNIT${input.scheme!.units === 1 ? "" : "S"}, ${input.scheme!.stories} ${input.scheme!.stories === 1 ? "STORY" : "STORIES"}`;
    const l3 = ffe !== null ? `FFE ${ffe.toFixed(1)}' (EST.)` : "FFE: NO LIDAR";
    const full = `PROPOSED ${input.scheme!.label.toUpperCase()}`;
    const oneLine = textW(full, 5.4) + 8 <= along - 4;
    const titles = oneLine ? [full] : ["PROPOSED", input.scheme!.label.toUpperCase()];
    const pw = Math.max(...titles.map((t) => textW(t, 5.4)), textW(l2, 4.6), textW(l3, 4.6)) + 8;
    const ph = titles.length * 6.2 + 2 * 5.6 + 5;
    const angB = upright(angDeg(P(W2(u0, v0)), P(W2(u1, v0))));
    const fitsInside = across > ph + 4 && along > pw + 4;
    let px = bc[0];
    let py = bc[1];
    let rot = 0;
    if (fitsInside) {
      rot = bw >= bh ? angB : upright(angB + 90);
    } else {
      const [bx0, by0, bx1, by1] = fpBox!;
      const cands: XY[] = [
        [bx1 + pw / 2 + 14, by0 - ph / 2 - 6],
        [bx0 - pw / 2 - 14, by0 - ph / 2 - 6],
        [bx1 + pw / 2 + 14, by1 + ph / 2 + 6],
        [bx0 - pw / 2 - 14, by1 + ph / 2 + 6],
        [(bx0 + bx1) / 2, by0 - ph / 2 - 16],
        [(bx0 + bx1) / 2, by1 + ph / 2 + 16],
      ];
      const ok = (q: XY) => inView([q[0] - pw / 2, q[1] - ph / 2], 3) && inView([q[0] + pw / 2, q[1] + ph / 2], 3);
      const pick = cands.find((q) => ok(q) && free(q[0] - pw / 2, q[1] - ph / 2, q[0] + pw / 2, q[1] + ph / 2)) ?? cands.find(ok) ?? cands[0]!;
      [px, py] = pick;
      const edgeX = Math.max(px - pw / 2, Math.min(px + pw / 2, bc[0]));
      const edgeY = Math.max(py - ph / 2, Math.min(py + ph / 2, bc[1]));
      a(`<path d="${d([bc, [edgeX, edgeY]], false)}" class="ldr"/><circle cx="${f2(bc[0])}" cy="${f2(bc[1])}" r=".8" fill="#000"/>`);
    }
    const tr = rot ? ` transform="rotate(${rot.toFixed(1)} ${f2(px)} ${f2(py)})"` : "";
    a(`<g${tr}><rect x="${f2(px - pw / 2)}" y="${f2(py - ph / 2)}" width="${f2(pw)}" height="${f2(ph)}" fill="#fff" stroke="#000" stroke-width=".4"/>`);
    let ty = py - ph / 2 + 7.4;
    for (const t of titles) {
      text(px, ty, t, "lbl");
      ty += 6.2;
    }
    text(px, ty + 0.4, l2, "lblS");
    text(px, ty + 6, l3, "lblS");
    a(`</g>`);
    const rr = Math.max(pw, ph) / 2;
    occupy(px - (rot ? rr : pw / 2), py - (rot ? rr : ph / 2), px + (rot ? rr : pw / 2), py + (rot ? rr : ph / 2));
  }

  // Street names (once per name, longest straight visible run)
  const names = new Map<string, { q: XY; ang: number; len: number; d: number }>();
  for (const s of streetFeats) {
    if (!s.name) continue;
    const pts = s.line.map(P);
    for (let i = 0; i < pts.length - 1; i++) {
      // grow a nearly straight run from i
      let j = i + 1;
      let len = dist(pts[i]!, pts[j]!);
      const a0 = angDeg(pts[i]!, pts[j]!);
      while (j + 1 < pts.length && Math.abs(((angDeg(pts[j]!, pts[j + 1]!) - a0 + 540) % 360) - 180) < 12) {
        len += dist(pts[j]!, pts[j + 1]!);
        j++;
      }
      const m = lerp(pts[i]!, pts[j]!, 0.5);
      if (!inView(m, 30)) continue;
      const cand = { q: m, ang: upright(angDeg(pts[i]!, pts[j]!)), len, d: dist(m, lotC) };
      const cur = names.get(s.name);
      const score = (c: typeof cand) => Math.min(c.len, 220) - c.d * 0.25;
      if (!cur || score(cand) > score(cur)) names.set(s.name, cand);
    }
  }
  let streetAnchor: XY | null = null;
  let streetBest = Infinity;
  for (const [name, c] of [...names.entries()].sort((x, y) => x[1].d - y[1].d || x[0].localeCompare(y[0])).slice(0, 5)) {
    const cls = streetClass(name);
    const label = name.toUpperCase();
    if (c.len < textW(label, 7) + 10) continue;
    const rad = (c.ang * Math.PI) / 180;
    const at = (off: number): XY => [c.q[0] - Math.sin(rad) * off, c.q[1] + Math.cos(rad) * off];
    const [n1x, n1y] = at(-0.6);
    const [n2x, n2y] = at(6.4);
    text(n1x, n1y, label, "st halo", "middle", c.ang);
    text(n2x, n2y, `(${cls.rightOfWayFt}' R.O.W. ASSUMED)`, "stS halo", "middle", c.ang);
    const w = textW(label, 7) / 2;
    occupy(c.q[0] - w, c.q[1] - w * Math.abs(Math.sin(rad)) - 8, c.q[0] + w, c.q[1] + w * Math.abs(Math.sin(rad)) + 8);
    if (c.d < streetBest && curb.length) {
      streetBest = c.d;
      // anchor on the curb line on the lot side: step from the centerline toward the lot
      const toLot: XY = [lotC[0] - c.q[0], lotC[1] - c.q[1]];
      const L1 = Math.hypot(...toLot) || 1;
      const hw = (cls.curbToCurbFt / 2) * L.k;
      streetAnchor = [c.q[0] + (toLot[0] / L1) * hw, c.q[1] + (toLot[1] / L1) * hw];
    }
  }
  o.push(...contourLabels);
  a(`</g>`);

  // ---- keynotes
  const notes: Keynote[] = [];
  // 1 property line: anchor on the rear-most edge midpoint (paper, smallest Y)
  let rearMid: XY = lotP[0]!;
  for (let i = 0; i < lotP.length; i++) {
    const m = lerp(lotP[i]!, lotP[(i + 1) % lotP.length]!, 0.5);
    if (m[1] < rearMid[1] - 0.01 || (Math.abs(m[1] - rearMid[1]) < 0.01 && m[0] < rearMid[0])) rearMid = m;
  }
  notes.push({
    text: `PROPERTY LINE FROM ALLEGHENY COUNTY PARCEL GIS${input.lotAreaSf ? ` (${Math.round(input.lotAreaSf).toLocaleString("en-US")} SF)` : ""}. NOT A SURVEY; VERIFY BY SURVEY.`,
    anchor: rearMid,
  });
  if (input.setbacks) {
    const sb = input.setbacks;
    notes.push({
      text: `ZONING SETBACKS (${input.zoningCode ?? "DISTRICT"}): FRONT ${ftIn(sb.front)}, REAR ${ftIn(sb.rear)}, SIDE ${ftIn(sb.side)}${classes.includes("exterior_side") ? `, STREET SIDE ${ftIn(sb.exterior_side)}` : ""}${citeCodes(input.setbackCitation)}.${input.contextualFront ? " CONTEXTUAL FRONT SETBACK MAY APPLY." : ""}${input.frontInferred ? " FRONT INFERRED FROM NEAREST STREET." : ""}`,
      anchor: setbackAnchor,
    });
  } else {
    notes.push({ text: `SETBACKS NOT DRAWN: ZONING RULES FOR ${input.zoningCode ?? "THIS DISTRICT"} ARE NOT LOADED IN THE ENGINE.`, anchor: null });
  }
  if (input.envelope.length) {
    let envA: XY | null = null;
    const env0 = input.envelope[0]![0];
    if (env0) {
      const ec = centroid(env0);
      envA = inPoly(ec, input.envelope[0]!) ? P(ec) : P(env0[0]!);
      if (fps.length) {
        // point inside the envelope but outside the footprint: the vertex-midpoint nearest the rear
        const cand = open(env0).map((p, i, r) => lerp(lerp(p, r[(i + 1) % r.length]!, 0.5), ec, 0.15)).filter((p) => !fps.some((f) => inRing(p, f)));
        if (cand.length) envA = P(cand.sort((x, y) => P(x)[1] - P(y)[1] || P(x)[0] - P(y)[0])[0]!);
      }
    }
    notes.push({
      text: `BUILDABLE AREA AFTER SETBACKS${input.envelopeAreaSf ? `: ${Math.round(input.envelopeAreaSf).toLocaleString("en-US")} SF` : ""} (DOT SCREEN), FROM THE QUICKFIT SITE-FIT SOLVER.`,
      anchor: envA,
    });
  }
  if (fps.length) {
    notes.push({
      text: `STUDIED FOOTPRINT: ${input.scheme!.label.toUpperCase()}${input.scheme!.byRight ? ", ALLOWED BY RIGHT" : ", NEEDS APPROVALS"} (QUICKFIT). MASSING ONLY, NOT A DESIGN.${fps.length > 1 ? " HEAVY LINES BETWEEN UNITS ARE PARTY WALLS." : ""}`,
      anchor: bldgAnchor,
    });
  } else {
    notes.push({
      text: `NO BUILDING FOOTPRINT SHOWN: ${(input.noFootprintReason ?? "THE SITE-FIT SOLVER DID NOT PLACE A BUILDING.").toUpperCase()}`,
      anchor: P(centroid(lot)),
    });
  }
  if (dem) {
    const share = input.steepShareOfLot ?? steepInLot;
    notes.push({
      text: steepInView
        ? `SLOPE 25% OR STEEPER (HATCHED), FROM USGS 3DEP 1 M LIDAR: ${Math.round(share * 100)}% OF THE LOT.`
        : "NO GROUND OF 25% SLOPE OR STEEPER IN THE AREA SHOWN (USGS 3DEP 1 M LIDAR).",
      anchor: steepInView && share > 0 ? steepAnchor : null,
    });
  }
  for (const h of hazardsShown) {
    notes.push({ text: `${h.note}${h.within ? " THE LOT IS INSIDE THIS AREA." : ""} SEE REPORT SECTION 3.4.`, anchor: h.anchor });
  }
  if (streetFeats.length) {
    const c = sitePlanConfig.streets.local;
    notes.push({
      text: `CURB, SIDEWALK AND R.O.W. OFFSET FROM THE STREET CENTERLINE AT TYPICAL WIDTHS (LOCAL: ${c.rightOfWayFt}' R.O.W., ${c.curbToCurbFt}' CURB TO CURB, ${c.sidewalkFt}' WALK). ASSUMPTION, NOT SURVEYED.`,
      anchor: streetAnchor,
    });
  }
  if (buildings.length) {
    notes.push({
      text: `EXISTING BUILDINGS FROM COUNTY FOOTPRINTS; STORIES ESTIMATED FROM HEIGHT.${exOnLot ? ` ${exOnLot} EXISTING BUILDING${exOnLot > 1 ? "S" : ""} ON THE LOT.` : ""}`,
      anchor: exAnchor,
    });
  }

  // Bubbles: step outward from the lot center; rotate until clear of other bubbles and labels.
  const bubbles: XY[] = [];
  notes.forEach((n, i) => {
    if (!n.anchor || !inView(n.anchor, 2)) return;
    const base = Math.atan2(n.anchor[1] - lotC[1], n.anchor[0] - lotC[0]);
    let placed: XY | null = null;
    for (let tries = 0; tries < 72 && !placed; tries++) {
      const k2 = tries % 18;
      const dAng = (k2 % 2 ? -1 : 1) * Math.ceil(k2 / 2) * (Math.PI / 9);
      const len = [22, 34, 50, 70][Math.floor(tries / 18)]!;
      const q: XY = [n.anchor[0] + Math.cos(base + dAng) * len, n.anchor[1] + Math.sin(base + dAng) * len];
      if (!inView(q, 9)) continue;
      if (bubbles.some((b) => dist(b, q) < 15)) continue;
      if (!free(q[0] - 6, q[1] - 6, q[0] + 6, q[1] + 6)) continue;
      placed = q;
    }
    if (!placed) return;
    bubbles.push(placed);
    occupy(placed[0] - 6, placed[1] - 6, placed[0] + 6, placed[1] + 6);
    const L0 = dist(placed, n.anchor);
    const edge: XY = [placed[0] + ((n.anchor[0] - placed[0]) / L0) * 5.2, placed[1] + ((n.anchor[1] - placed[1]) / L0) * 5.2];
    a(`<path d="${d([n.anchor, edge], false)}" class="ldr"/><circle cx="${f2(n.anchor[0])}" cy="${f2(n.anchor[1])}" r=".8" fill="#000"/>`);
    a(`<circle cx="${f2(placed[0])}" cy="${f2(placed[1])}" r="5.2" fill="#fff" stroke="#000" stroke-width=".5"/>`);
    text(placed[0], placed[1] + 2, String(i + 1), "kn");
  });

  // ---- drawing title, legend, north arrow, graphic scale
  const scaleText = `1" = ${L.scaleFt}'-0"`;
  text(14, 22, "SITE PLAN — FEASIBILITY SCREENING", "tH", "start");
  text(14, 31, `PARCEL ${input.parid} · ${input.address.toUpperCase()} · SCALE ${scaleText} · NOT A SURVEY`, "tS", "start");

  const ly = VY1 + 13;
  text(14, ly, "LEGEND", "tB", "start");
  const items: [string, string][] = [
    [`<line x1="0" y1="0" x2="26" y2="0" class="pl"/>`, "PROPERTY LINE"],
    [`<line x1="0" y1="0" x2="26" y2="0" class="adj"/>`, "ADJACENT LOT LINE"],
    [`<line x1="0" y1="0" x2="26" y2="0" class="sb"/>`, "ZONING SETBACK LINE"],
    [`<rect x="0" y="-3" width="26" height="6" class="env" stroke="#000" stroke-width=".2"/>`, "BUILDABLE AREA (QUICKFIT)"],
    [`<path d="${hatch(0, -3, 26, 3, 2.3, false)}" class="pocheL" clip-path="url(#ea-lg-fp)"/><rect x="0" y="-3" width="26" height="6" class="bldg" style="stroke-width:1"/>`, "PROPOSED FOOTPRINT (POCHÉ)"],
    [`<rect x="0" y="-3" width="26" height="6" class="exb"/>`, "EXISTING BUILDING"],
    [`<line x1="0" y1="0" x2="26" y2="0" class="haz"/>`, "HAZARD / OVERLAY LIMIT"],
    [`<path d="${hatch(0, -3, 26, 3, 4.2, true)}" class="steepL" clip-path="url(#ea-lg-steep)"/><rect x="0" y="-3" width="26" height="6" class="steepE"/>`, "SLOPE 25% OR STEEPER"],
    [`<line x1="0" y1="-1.5" x2="26" y2="-1.5" class="ctrI"/><line x1="0" y1="2" x2="26" y2="2" class="ctr"/>`, "CONTOUR: INDEX 10', MINOR 2'"],
    [`<line x1="0" y1="0" x2="26" y2="0" class="cl"/>`, "STREET CENTERLINE"],
    [`<line x1="0" y1="-2" x2="26" y2="-2" class="curb"/><line x1="0" y1="2.5" x2="26" y2="2.5" class="walk"/>`, "CURB / WALK (ASSUMED)"],
    [`<circle cx="13" cy="0" r="4.2" fill="#fff" stroke="#000" stroke-width=".5"/><text x="13" y="1.8" class="kn" text-anchor="middle">1</text>`, "KEYNOTE (SEE TITLE BLOCK)"],
  ];
  items.forEach(([sym, label], i) => {
    const col = Math.floor(i / 4);
    const rowI = i % 4;
    const x = 14 + col * 122;
    const y = ly + 11 + rowI * 12;
    a(`<g transform="translate(${x} ${y - 1.8})">${sym}</g>`);
    text(x + 32, y, label, "tN", "start");
  });

  // Graphic scale: four half-inch segments
  const sx = 385;
  const sy = ly + 20;
  const seg = 36;
  for (let i = 0; i < 4; i++) a(`<rect x="${sx + i * seg}" y="${sy}" width="${seg}" height="3.6" fill="${i % 2 ? "#fff" : "#000"}" stroke="#000" stroke-width=".5"/>`);
  for (let i = 0; i <= 4; i++) text(sx + i * seg, sy - 3, i === 0 ? "0" : `${(L.scaleFt / 2) * i}'`, "tN");
  text(sx, sy + 13, `GRAPHIC SCALE: ${scaleText}`, "tS", "start");
  if (L.extended) text(sx, sy + 20, `SCALE ENLARGED BEYOND 1" = 40' TO FIT THE LOT`, "tL", "start");

  // North arrow
  const nxp = 540;
  const nyp = ly + 30;
  const rotN = (-L.angleRad * 180) / Math.PI;
  a(`<g transform="translate(${nxp} ${nyp}) rotate(${rotN.toFixed(1)})"><circle r="12" fill="none" stroke="#000" stroke-width=".5"/><path d="M0,-16 L5,6 L0,2.5 L-5,6 Z" fill="#000"/><path d="M0,-16 L0,2.5 L-5,6 Z" fill="#fff" stroke="#000" stroke-width=".4"/><text y="-19" class="tB" text-anchor="middle" transform="rotate(${(-rotN).toFixed(1)} 0 -21)">N</text></g>`);

  // ---- title block
  const X = TB + 9;
  const XR = SW - 7;
  const hr = (y: number) => a(`<line x1="${TB}" y1="${f2(y)}" x2="${XR}" y2="${f2(y)}" class="bd2"/>`);
  text(X, 28, "EaseScore.AI", "tXL", "start");
  text(X, 38, "FEASIBILITY SCREENING SET", "tS", "start");
  hr(46);
  let y = 56;
  text(X, y, "PROJECT", "tL", "start");
  y += 9;
  for (const l of wrap(input.address.toUpperCase(), 38)) {
    text(X, y, l, "t", "start");
    y += 8;
  }
  const scen = input.scheme ? `${input.scheme.label.toUpperCase()}, ${input.scheme.units} UNIT${input.scheme.units === 1 ? "" : "S"} (STUDIED)` : "NO BUILDING PLACED (SEE KEYNOTES)";
  for (const l of wrap(scen, 44)) {
    text(X, y, l, "tS", "start");
    y += 7;
  }
  y += 2;
  hr(y);
  y += 10;
  text(X, y, "PARCEL", "tL", "start");
  text(X + 78, y, "ZONING", "tL", "start");
  y += 9;
  text(X, y, input.parid, "t", "start");
  text(X + 78, y, input.zoningCode ?? "NOT LOADED", "t", "start");
  y += 7;
  if (input.lotAreaSf) text(X, y, `LOT ${Math.round(input.lotAreaSf).toLocaleString("en-US")} SF (GIS)`, "tS", "start");
  for (const l of wrap((input.zoningName ?? "").toUpperCase(), 22).slice(0, 2)) {
    text(X + 78, y, l, "tS", "start");
    y += 6.5;
  }
  y = Math.max(y, 0) + 3;
  hr(y);

  // Keynotes + general notes, sized to fit above the fixed bottom block.
  const general = [
    "SCREENING DRAWING FROM PUBLIC DATA. NOT A SURVEY, ZONING DETERMINATION OR ENGINEERED PLAN. DECISION SUPPORT ONLY.",
    dem
      ? `ELEVATIONS IN FEET, NAVD88, FROM USGS 3DEP 1 M LIDAR (2019), SMOOTHED FOR CONTOURING. CONTOUR INTERVAL ${iv}'; INDEX ${idx}'.`
      : "LIDAR TERRAIN NOT AVAILABLE FOR THIS VIEW; CONTOURS AND SLOPE HATCH NOT DRAWN.",
    ...(fps.length ? ["FFE (EST.) = AVERAGE LIDAR GRADE UNDER THE STUDIED FOOTPRINT, TO 0.5'. SET BY SURVEY AND DESIGN."] : []),
    "LOT DIMENSIONS IN DECIMAL FEET FROM GIS; SETBACKS AND BUILDING IN FEET-INCHES. VERIFY IN FIELD.",
    `STREET WIDTHS: ${sitePlanConfig.sourceLabel.toUpperCase()} (${sitePlanConfig.version.toUpperCase()}).`,
    ...(L.extended ? [`SCALE ${scaleText}: THE LOT DOES NOT FIT THIS SHEET AT 1" = 40' OR LARGER.`] : []),
    "SOURCES AND DATES: SEE REPORT APPENDIX A.",
  ];
  const bottom = SH - 7 - 116;
  const layoutNotes = (size: number, lh: number, chars: number) => {
    let h = 44;
    const kn = notes.map((n) => wrap(n.text, chars));
    for (const k of kn) h += k.length * lh + 1.5;
    const gn = general.map((g) => wrap(g, chars));
    for (const g of gn) h += g.length * lh + 1.5;
    return { size, lh, kn, gn, h };
  };
  let NL = layoutNotes(5.1, 6.3, 50);
  if (y + NL.h > bottom) NL = layoutNotes(4.6, 5.6, 56);
  if (y + NL.h > bottom) NL = layoutNotes(4.2, 5.1, 62);
  const fs = ` style="font-size:${NL.size}px"`;
  y += 11;
  text(X, y, "KEYNOTES", "tB", "start");
  y += 9;
  NL.kn.forEach((lines, i) => {
    a(`<circle cx="${X + 3.6}" cy="${f2(y - 1.8)}" r="3.6" fill="#fff" stroke="#000" stroke-width=".45"/>`);
    text(X + 3.6, y - 0.2, String(i + 1), "tN", "middle", 0, ` style="font-size:4.4px;font-weight:600"`);
    for (const l of lines) {
      text(X + 11, y, l, "tN", "start", 0, fs);
      y += NL.lh;
    }
    y += 1.5;
  });
  y += 2;
  hr(y);
  y += 11;
  text(X, y, "GENERAL NOTES", "tB", "start");
  y += 9;
  NL.gn.forEach((lines, i) => {
    text(X, y, `${i + 1}.`, "tN", "start", 0, fs);
    for (const l of lines) {
      text(X + 8, y, l, "tN", "start", 0, fs);
      y += NL.lh;
    }
    y += 1.5;
  });

  // Fixed bottom block: scale / date / prepared by / sheet
  hr(bottom);
  let by = bottom + 11;
  text(X, by, "SCALE", "tL", "start");
  text(X + 78, by, "DATE", "tL", "start");
  by += 9;
  text(X, by, scaleText, "t", "start");
  const [yy, mm, dd] = input.generatedDate.split("-");
  text(X + 78, by, `${mm}.${dd}.${yy}`, "t", "start");
  by += 13;
  text(X, by, "PREPARED BY", "tL", "start");
  by += 9;
  text(X, by, `EASESCORE ENGINE ${input.engineVersion.toUpperCase()}`, "t", "start");
  by += 7;
  text(X, by, `QUICKFIT + ${sitePlanConfig.version.toUpperCase()}`, "tS", "start");
  hr(bottom + 54);
  text(X, bottom + 66, "SHEET", "tL", "start");
  text(X, bottom + 92, "EA-101", "tSh", "start");
  text(X, bottom + 103, "1 OF 1", "tS", "start");
  const bx = XR - 66;
  a(`<rect x="${bx}" y="${bottom + 62}" width="58" height="40" fill="none" stroke="#000" stroke-width="1"/>`);
  text(bx + 29, bottom + 79, "NOT FOR", "tB");
  text(bx + 29, bottom + 89, "CONSTRUCTION", "tB");

  a(`</svg>`);
  return o.join("\n");
}
