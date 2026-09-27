import pc from "polygon-clipping";
import type { Pt, Ring, Edge, EdgeKind, ParcelInput, Controls } from "./types";

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const norm = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

export function openRing(r: Ring): Ring { const n = r.length; return n > 1 && r[0][0] === r[n - 1][0] && r[0][1] === r[n - 1][1] ? r.slice(0, -1) : r.slice(); }
export function area(r: Ring) { r = openRing(r); let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function ccw(r: Ring): Ring { r = openRing(r); return area(r) < 0 ? r.slice().reverse() : r; }
export function centroid(r: Ring): Pt { r = openRing(r); let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }

export function distPtSeg(p: Pt, a: Pt, b: Pt) { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return len(sub(p, add(a, mul(ab, t)))); }
export function distPtLine(p: Pt, line: Pt[]) { let m = Infinity, seg: [Pt, Pt] | null = null; for (let i = 0; i < line.length - 1; i++) { const d = distPtSeg(p, line[i], line[i + 1]); if (d < m) { m = d; seg = [line[i], line[i + 1]]; } } return { d: m, seg }; }
function angleBetween(u: Pt, v: Pt) { const c = Math.abs(dot(norm(u), norm(v))); return Math.acos(Math.min(1, c)) * 180 / Math.PI; }

export function pointInRing(p: Pt, r: Ring) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
export type MultiPoly = Pt[][][];
export function pointInMulti(p: Pt, mp: MultiPoly) { for (const poly of mp) { if (!pointInRing(p, poly[0])) continue; let hole = false; for (let k = 1; k < poly.length; k++) if (pointInRing(p, poly[k])) { hole = true; break; } if (!hole) return true; } return false; }
export function multiArea(mp: MultiPoly) { let s = 0; for (const poly of mp) { s += Math.abs(area(poly[0])); for (let k = 1; k < poly.length; k++) s -= Math.abs(area(poly[k])); } return s; }

/** Classify parcel edges and build the local frame (x along the front, +y into the lot). */
export function classify(input: ParcelInput, controls?: Controls) {
  const ring = ccw(input.parcel);
  const n = ring.length;
  const edges0 = ring.map((a, i) => { const b = ring[(i + 1) % n]; return { i, a, b, lengthFt: len(sub(b, a)) }; });
  // An edge fronts a street when at least ~20 ft (or 30%) of it lies within the right-of-way distance of an opened street
  // and runs roughly parallel. Sampling the edge (not just its midpoint) handles streets that end partway along a lot.
  const streetHits = edges0.map(e => {
    let best: { street: string; d: number } | null = null;
    if (e.lengthFt < 8) return null;
    for (const s of input.streets) {
      if (s.opened === false) continue; const row = s.rowWidthFt ?? 40; const lim = row / 2 + 12;
      const n = Math.max(4, Math.ceil(e.lengthFt / 5)); let near = 0, dsum = 0, parallel = false;
      for (let k = 0; k <= n; k++) { const p: Pt = add(e.a, mul(sub(e.b, e.a), k / n)); const { d, seg } = distPtLine(p, s.centerline); if (d <= lim) { near++; dsum += d; if (seg && angleBetween(sub(e.b, e.a), sub(seg[1], seg[0])) <= 25) parallel = true; } }
      const nearLen = (near / (n + 1)) * e.lengthFt;
      if (parallel && (nearLen >= 20 || near / (n + 1) >= 0.3)) { const d = dsum / Math.max(1, near); if (!best || d < best.d) best = { street: s.name, d }; }
    }
    return best;
  });
  const alleyHit = edges0.map(e => { const mid: Pt = mul(add(e.a, e.b), 0.5); return (input.alleys ?? []).some(al => { const { d, seg } = distPtLine(mid, al.centerline); return !!seg && d <= 15 && angleBetween(sub(e.b, e.a), sub(seg[1], seg[0])) <= 25; }); });

  let frontIdx: number[] = [];
  const flags: string[] = [];
  if (input.frontEdgeIndex != null) frontIdx = [input.frontEdgeIndex];
  else {
    const streetEdges = edges0.filter((_, i) => streetHits[i]);
    const byStreet = new Map<string, number[]>();
    for (const e of streetEdges) { const s = streetHits[e.i]!.street; byStreet.set(s, [...(byStreet.get(s) ?? []), e.i]); }
    if (byStreet.size === 0) { flags.push("No opened street found next to the lot. Pick the front edge to continue."); }
    else {
      let pick: string | undefined;
      if (input.addressStreet) for (const k of byStreet.keys()) if (k.toLowerCase().includes(input.addressStreet.toLowerCase()) || input.addressStreet.toLowerCase().includes(k.toLowerCase())) pick = k;
      if (!pick) { // shorter frontage is the front on a corner lot
        let bestLen = Infinity; for (const [k, ids] of byStreet) { const L = ids.reduce((s, i) => s + edges0[i].lengthFt, 0); if (L < bestLen) { bestLen = L; pick = k; } }
      }
      frontIdx = byStreet.get(pick!)!;
      if (byStreet.size > 1) flags.push("Corner lot: front is on " + pick + "; the other street side uses the street-side setback.");
    }
  }
  // frame from the longest front edge (or longest edge if none)
  const base = frontIdx.length ? frontIdx.map(i => edges0[i]).sort((p, q) => q.lengthFt - p.lengthFt)[0] : edges0.slice().sort((p, q) => q.lengthFt - p.lengthFt)[0];
  let ux = norm(sub(base.b, base.a)); let uy: Pt = [-ux[1], ux[0]];
  const c = centroid(ring); if (dot(sub(c, base.a), uy) < 0) { uy = mul(uy, -1); }
  const origin = base.a;
  const toLocal = (p: Pt): Pt => [dot(sub(p, origin), ux), dot(sub(p, origin), uy)];
  const toWorld = (p: Pt): Pt => add(origin, add(mul(ux, p[0]), mul(uy, p[1])));

  const z = input.zoning.setbacksFt; const ov = controls?.setbackOverridesFt ?? {};
  const edges: Edge[] = edges0.map(e => {
    let kind: EdgeKind;
    const la = toLocal(e.a), lb = toLocal(e.b); const dir = norm(sub(lb, la));
    const outward: Pt = [dir[1], -dir[0]]; // ring is CCW in world; local frame keeps handedness if uy = rot90(ux)
    if (frontIdx.includes(e.i)) kind = "front";
    else if (streetHits[e.i]) kind = "streetSide";
    else if (outward[1] > Math.cos(Math.PI / 4)) kind = "rear";
    else kind = "side";
    const sb = ov[kind] ?? (kind === "front" ? z.front : kind === "rear" ? z.rear : kind === "streetSide" ? z.streetSide : z.side);
    return { i: e.i, a: la, b: lb, kind, setbackFt: sb, alley: alleyHit[e.i] || undefined, lengthFt: e.lengthFt };
  });
  // handedness check: if local ring became CW, outward calc flips; fix by recomputing with area sign
  const localRing: Ring = ring.map(toLocal);
  if (area(localRing) < 0) { for (const e of edges) { if (e.kind === "rear" || e.kind === "side") { const dir = norm(sub(e.b, e.a)); const outward: Pt = [-dir[1], dir[0]]; e.kind = (outward[1] > Math.cos(Math.PI / 4)) ? "rear" : "side"; const sb = ov[e.kind] ?? (e.kind === "rear" ? z.rear : z.side); e.setbackFt = sb; } } }
  const frontageFt = edges.filter(e => e.kind === "front").reduce((s, e) => s + e.lengthFt, 0);
  return { edges, localRing: ccw(localRing), toLocal, toWorld, frame: { origin, ux, uy }, frontageFt, flags };
}

/** Band inside the lot along one edge, width = setback. Extended past the ends so corners are covered. */
function strip(e: Edge, inward: Pt): Ring {
  const d = e.setbackFt; const t = norm(sub(e.b, e.a)); const ext = d + 1;
  const a = sub(e.a, mul(t, ext)), b = add(e.b, mul(t, ext));
  return [a, b, add(b, mul(inward, d)), add(a, mul(inward, d)), a];
}

export function buildable(localRing: Ring, edges: Edge[], cuts: Ring[] = []) {
  const ringArea = area(localRing);
  const strips: { kind: EdgeKind; poly: Ring }[] = [];
  for (const e of edges) {
    if (e.setbackFt <= 0) continue;
    const t = norm(sub(e.b, e.a)); let inward: Pt = [-t[1], t[0]]; if (ringArea < 0) inward = mul(inward, -1);
    strips.push({ kind: e.kind, poly: strip(e, inward) });
  }
  const r3 = (r: Ring): Ring => r.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000] as Pt);
  const lot: any = [[...r3(localRing), r3(localRing)[0]]];
  let b: MultiPoly = [lot] as any;
  try {
    if (strips.length) b = pc.difference(b as any, ...strips.map(s => [r3(s.poly)] as any)) as any;
    if (cuts.length) b = pc.difference(b as any, ...cuts.map(c => [[...r3(c), r3(c)[0]]] as any)) as any;
  } catch { // fall back to one-at-a-time; skip a strip that the clipper can't handle (the raster still enforces it)
    b = [lot] as any;
    for (const s of strips) { try { b = pc.difference(b as any, [r3(s.poly)] as any) as any; } catch { /* raster enforces */ } }
    for (const c of cuts) { try { b = pc.difference(b as any, [[...r3(c), r3(c)[0]]] as any) as any; } catch { } }
  }
  return { buildable: b, strips };
}

/** 1-ft raster with a summed-area table for O(1) "does this rectangle fit" checks, plus per-cell reason labels. */
export class Raster {
  x0: number; y0: number; W: number; H: number; cell = 1; inside: Uint8Array; sat: Int32Array; reason: Int16Array; reasons: string[];
  constructor(b: MultiPoly, localRing: Ring, strips: { kind: EdgeKind; poly: Ring }[], cutsLabeled: { label: string; ring: Ring }[]) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of localRing) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
    this.x0 = Math.floor(minx); this.y0 = Math.floor(miny); this.W = Math.ceil(maxx) - this.x0 + 1; this.H = Math.ceil(maxy) - this.y0 + 1;
    this.inside = new Uint8Array(this.W * this.H); this.reason = new Int16Array(this.W * this.H).fill(-1); this.reasons = ["lot line"];
    const stripIdx = strips.map(s => { this.reasons.push(s.kind); return this.reasons.length - 1; });
    const cutIdx = cutsLabeled.map(c => { this.reasons.push(c.label); return this.reasons.length - 1; });
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const p: Pt = [this.x0 + i + 0.5, this.y0 + j + 0.5]; const k = j * this.W + i;
      if (!pointInRing(p, localRing)) { this.reason[k] = 0; continue; }
      let r = -1; for (let s = 0; s < strips.length; s++) if (pointInRing(p, strips[s].poly)) { r = stripIdx[s]; break; }
      if (r < 0) for (let s = 0; s < cutsLabeled.length; s++) if (pointInRing(p, cutsLabeled[s].ring)) { r = cutIdx[s]; break; }
      if (r < 0) { this.inside[k] = 1; continue; }
      this.reason[k] = r;
    }
    this.sat = new Int32Array((this.W + 1) * (this.H + 1));
    for (let j = 0; j < this.H; j++) { let row = 0; for (let i = 0; i < this.W; i++) { row += this.inside[j * this.W + i] ? 0 : 1; this.sat[(j + 1) * (this.W + 1) + (i + 1)] = this.sat[j * (this.W + 1) + (i + 1)] + row; } }
  }
  /** count of NOT-buildable cells in the rectangle [x, x+w) × [y, y+d) (local feet, integer-aligned) */
  blocked(x: number, y: number, w: number, d: number) {
    const i0 = Math.round(x - this.x0), j0 = Math.round(y - this.y0), i1 = i0 + Math.round(w), j1 = j0 + Math.round(d);
    if (i0 < 0 || j0 < 0 || i1 > this.W || j1 > this.H) return 1e9;
    const S = this.sat, W1 = this.W + 1; return S[j1 * W1 + i1] - S[j0 * W1 + i1] - S[j1 * W1 + i0] + S[j0 * W1 + i0];
  }
  fits(x: number, y: number, w: number, d: number) { return this.blocked(x, y, w, d) === 0; }
  /** true when every cell of the rectangle is inside the lot (setback bands allowed; used for drives and parking) */
  inLot(x: number, y: number, w: number, d: number) {
    const i0 = Math.round(x - this.x0), j0 = Math.round(y - this.y0), i1 = i0 + Math.round(w), j1 = j0 + Math.round(d);
    if (i0 < 0 || j0 < 0 || i1 > this.W || j1 > this.H) return false;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = j * this.W + i; if (!this.inside[k] && this.reason[k] === 0) return false; }
    return true;
  }
  /** Which rule blocks the strip of cells just beyond a rectangle edge. */
  blockerOf(x: number, y: number, w: number, d: number): string | null {
    const counts = new Map<string, number>();
    const i0 = Math.round(x - this.x0), j0 = Math.round(y - this.y0), i1 = i0 + Math.round(w), j1 = j0 + Math.round(d);
    for (let j = Math.max(0, j0); j < Math.min(this.H, j1); j++) for (let i = Math.max(0, i0); i < Math.min(this.W, i1); i++) { const k = j * this.W + i; if (!this.inside[k]) { const r = this.reasons[Math.max(0, this.reason[k])]; counts.set(r, (counts.get(r) ?? 0) + 1); } }
    let best: string | null = null, m = 0; for (const [r, c] of counts) if (c > m) { m = c; best = r; } return best;
  }
  get ymin() { for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) if (this.inside[j * this.W + i]) return this.y0 + j; return Infinity; }
  get xRange(): [number, number] { let a = Infinity, b = -Infinity; for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) if (this.inside[j * this.W + i]) { a = Math.min(a, this.x0 + i); b = Math.max(b, this.x0 + i + 1); } return [a, b]; }
}
