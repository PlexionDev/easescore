// Small pure helpers shared by the Ease Score factors.

import type { Band, EaseScoreConfig } from "./types";

/**
 * Piecewise-linear curve through [x, y] breakpoints (x ascending). Below the first point it
 * returns the first y; above the last point it returns the last y.
 */
export function piecewise(points: readonly (readonly number[])[], x: number): number {
  const pts = points as readonly [number, number][];
  if (!pts.length) throw new Error("piecewise: no breakpoints");
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1]![1];
}

export function bandFor(score: number, cfg: EaseScoreConfig): Band {
  for (const b of cfg.bands) if (score >= b.min) return b.band as Band;
  return "Very hard";
}

export const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** Round to one decimal, avoiding -0. */
export const r1 = (x: number) => Math.round(x * 10) / 10 + 0;

export const pctText = (share: number) => `${Math.round(share * 100)}%`;
