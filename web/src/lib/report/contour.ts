// Raster helpers for the site plan: smoothing, slope and marching-squares isolines on a regular grid.
// Pure and deterministic: same grid in, same lines out (fixed scan order, fixed saddle rule).

export type XY = [number, number];

/** Values at (x0 + i*step, y0 + j*step), row-major (j rows of nx). NaN = no data. */
export interface Grid {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  z: Float64Array;
}

/** Separable Gaussian blur that ignores NaN cells (they stay NaN). */
export function gaussian(g: Grid, sigmaCells: number): Grid {
  const r = Math.max(1, Math.ceil(sigmaCells * 2.5));
  const w: number[] = [];
  for (let d = -r; d <= r; d++) w.push(Math.exp(-(d * d) / (2 * sigmaCells * sigmaCells)));
  const { nx, ny } = g;
  const pass = (src: Float64Array, horiz: boolean): Float64Array => {
    const out = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = src[j * nx + i]!;
        if (Number.isNaN(c)) {
          out[j * nx + i] = NaN;
          continue;
        }
        let s = 0;
        let ws = 0;
        for (let d = -r; d <= r; d++) {
          const ii = horiz ? i + d : i;
          const jj = horiz ? j : j + d;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const v = src[jj * nx + ii]!;
          if (Number.isNaN(v)) continue;
          s += v * w[d + r]!;
          ws += w[d + r]!;
        }
        out[j * nx + i] = s / ws;
      }
    }
    return out;
  };
  return { ...g, z: pass(pass(g.z, true), false) };
}

/** Slope as rise/run (0.25 = 25%), central differences; NaN where a neighbor is missing. */
export function slopeGrid(g: Grid): Grid {
  const { nx, ny, step } = g;
  const z = g.z;
  const out = new Float64Array(nx * ny);
  const at = (i: number, j: number) => z[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nx - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(ny - 1, j + 1);
      const dx = (at(i1, j) - at(i0, j)) / ((i1 - i0) * step);
      const dy = (at(i, j1) - at(i, j0)) / ((j1 - j0) * step);
      out[j * nx + i] = Math.hypot(dx, dy);
    }
  }
  return { ...g, z: out };
}

/** Grid with a one-cell border of `value` (and NaN replaced by `value`) so every isoline closes. */
export function padGrid(g: Grid, value: number): Grid {
  const nx = g.nx + 2;
  const ny = g.ny + 2;
  const z = new Float64Array(nx * ny).fill(value);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const v = g.z[j * g.nx + i]!;
      z[(j + 1) * nx + i + 1] = Number.isNaN(v) ? value : v;
    }
  return { x0: g.x0 - g.step, y0: g.y0 - g.step, step: g.step, nx, ny, z };
}

/**
 * Marching-squares isolines at `level`, joined into polylines in grid coordinates (x, y).
 * A closed ring repeats its first point at the end. Cells touching NaN are skipped.
 */
export function isolines(g: Grid, level: number): XY[][] {
  const { nx, ny, z, x0, y0, step } = g;
  const H = (i: number, j: number) => (j * nx + i) * 2;
  const V = (i: number, j: number) => (j * nx + i) * 2 + 1;
  const segA: number[] = [];
  const segB: number[] = [];
  const add = (a: number, b: number) => {
    segA.push(a);
    segB.push(b);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const z00 = z[j * nx + i]!;
      const z10 = z[j * nx + i + 1]!;
      const z11 = z[(j + 1) * nx + i + 1]!;
      const z01 = z[(j + 1) * nx + i]!;
      if (Number.isNaN(z00) || Number.isNaN(z10) || Number.isNaN(z11) || Number.isNaN(z01)) continue;
      const b0 = z00 >= level ? 1 : 0;
      const b1 = z10 >= level ? 1 : 0;
      const b2 = z11 >= level ? 1 : 0;
      const b3 = z01 >= level ? 1 : 0;
      const c = b0 | (b1 << 1) | (b2 << 2) | (b3 << 3);
      if (c === 0 || c === 15) continue;
      const e0 = H(i, j);
      const e1 = V(i + 1, j);
      const e2 = H(i, j + 1);
      const e3 = V(i, j);
      if (c === 5 || c === 10) {
        const hi = (z00 + z10 + z11 + z01) / 4 >= level;
        if ((c === 5) === hi) {
          add(e0, e1);
          add(e2, e3);
        } else {
          add(e0, e3);
          add(e1, e2);
        }
        continue;
      }
      const cross: number[] = [];
      if (b0 !== b1) cross.push(e0);
      if (b1 !== b2) cross.push(e1);
      if (b3 !== b2) cross.push(e2);
      if (b0 !== b3) cross.push(e3);
      add(cross[0]!, cross[1]!);
    }
  }

  const point = (key: number): XY => {
    const idx = key >> 1;
    const vert = (key & 1) === 1;
    const i = idx % nx;
    const j = (idx - i) / nx;
    const a = z[j * nx + i]!;
    const b = vert ? z[(j + 1) * nx + i]! : z[j * nx + i + 1]!;
    const t = b === a ? 0.5 : (level - a) / (b - a);
    return [x0 + (i + (vert ? 0 : t)) * step, y0 + (j + (vert ? t : 0)) * step];
  };

  const adj = new Map<number, number[]>();
  for (let s = 0; s < segA.length; s++) {
    for (const k of [segA[s]!, segB[s]!]) {
      const l = adj.get(k);
      if (l) l.push(s);
      else adj.set(k, [s]);
    }
  }
  const used = new Uint8Array(segA.length);
  const out: XY[][] = [];
  const walk = (s0: number, startKey: number) => {
    const keys = [startKey];
    let s = s0;
    let cur = startKey;
    for (;;) {
      used[s] = 1;
      const next = segA[s] === cur ? segB[s]! : segA[s]!;
      keys.push(next);
      cur = next;
      const cand = (adj.get(cur) ?? []).find((t) => !used[t]);
      if (cand === undefined) break;
      s = cand;
    }
    out.push(keys.map(point));
  };
  // Open chains first (they start at a dead end), then closed rings.
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    const a = segA[s]!;
    const b = segB[s]!;
    if ((adj.get(a)?.length ?? 0) === 1) walk(s, a);
    else if ((adj.get(b)?.length ?? 0) === 1) walk(s, b);
  }
  for (let s = 0; s < segA.length; s++) if (!used[s]) walk(s, segA[s]!);
  return out;
}

/** Douglas–Peucker simplification (keeps the first and last points). */
export function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy);
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = L === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** One round of Chaikin corner cutting (closed rings stay closed). */
export function chaikin(pts: XY[], closed: boolean): XY[] {
  if (pts.length < 3) return pts;
  const src = closed ? pts.slice(0, -1) : pts;
  const n = src.length;
  const out: XY[] = closed ? [] : [src[0]!];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = src[i]!;
    const b = src[(i + 1) % n]!;
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  if (closed) out.push(out[0]!);
  else out.push(src[n - 1]!);
  return out;
}
