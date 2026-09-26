// Packs rectangular unit footprints along the frontage inside the envelope (local coords:
// +x along the frontage, +y into the lot). Buildings are pulled as close to the front as the
// envelope allows, then as far left, then made as deep as the preset allows.

import { rectInside, rectRing, type EnvIndex } from "./geometry";
import type { Range, Ring, TypologyPreset } from "./types";

export interface Placement {
  units: number;
  buildings: number;
  unitWidth: number;
  depth: number;
  /** Building footprint area (all buildings). */
  footprintSf: number;
  /** One rectangle per unit (stacked units share one), local coords. */
  unitRects: Ring[];
  /** The block(s) that must sit inside the envelope, local coords. */
  blocks: [number, number, number, number][];
}

/** Values of a range in fixed steps, always including min and max. Rounded so sweeps are exact. */
export function steps(r: Range): number[] {
  const out: number[] = [];
  const n = Math.floor((r.max - r.min) / r.step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Math.round((r.min + i * r.step) * 1e6) / 1e6);
  if (out[out.length - 1]! < r.max - 1e-9) out.push(r.max);
  return out;
}

function candidates(lo: number, hi: number, grid: number): number[] {
  if (hi < lo - 1e-9) return [];
  const out = steps({ min: lo, max: Math.max(lo, hi), step: grid });
  return out;
}

/** Front-most, then left-most origin where a W x D block fits; null when none. */
export function findOrigin(env: EnvIndex, w: number, d: number, grid: number): [number, number] | null {
  for (const y of candidates(env.minY, env.maxY - d, grid))
    for (const x of candidates(env.minX, env.maxX - w, grid))
      if (rectInside(env, x, y, x + w, y + d)) return [x, y];
  return null;
}

function deepest(env: EnvIndex, x: number, y: number, w: number, depth: Range): number {
  const ds = steps(depth);
  for (let i = ds.length - 1; i >= 0; i--) if (rectInside(env, x, y, x + w, y + ds[i]!)) return ds[i]!;
  return depth.min;
}

/** Search stops here when a row preset has no maxUnits (not a design value). */
const ROW_SAFETY_CAP = 20;

/** Units in one building of this typology (row handled separately). */
export const unitsPerBuilding = (t: TypologyPreset) => (t.arrangement === "row" ? 1 : Math.max(1, t.unitsPerBuilding));

/** Place one typology at one unit width. Returns null when nothing fits. */
export function place(env: EnvIndex, t: TypologyPreset, unitWidth: number, grid: number): Placement | null {
  const dMin = t.unitDepthFt.min;
  const perBuilding = unitsPerBuilding(t);
  const sideBySide = t.arrangement === "side_by_side";
  const unitsAcross = (n: number) => (t.arrangement === "row" ? n : sideBySide ? perBuilding : 1);

  let best: { n: number; origin: [number, number] } | null = null;
  if (t.arrangement === "row") {
    // If n units fit, n-1 fit at the same origin, so count up until the first failure.
    const cap = t.maxUnits ?? ROW_SAFETY_CAP;
    for (let n = 1; n <= cap; n++) {
      const o = findOrigin(env, n * unitWidth, dMin, grid);
      if (!o) break;
      best = { n, origin: o };
    }
  } else {
    const o = findOrigin(env, unitsAcross(1) * unitWidth, dMin, grid);
    if (o) best = { n: 1, origin: o };
  }
  if (!best) return null;

  const across = unitsAcross(best.n);
  const W = across * unitWidth;
  const [x, y] = best.origin;
  const depth = deepest(env, x, y, W, t.unitDepthFt);
  const unitRects: Ring[] = [];
  if (t.arrangement === "stacked" || t.arrangement === "detached") unitRects.push(rectRing(x, y, x + W, y + depth));
  else for (let i = 0; i < across; i++) unitRects.push(rectRing(x + i * unitWidth, y, x + (i + 1) * unitWidth, y + depth));
  const units = t.arrangement === "row" ? best.n : perBuilding;
  return {
    units,
    buildings: 1,
    unitWidth,
    depth,
    footprintSf: W * depth,
    unitRects,
    blocks: [[x, y, x + W, y + depth]],
  };
}
