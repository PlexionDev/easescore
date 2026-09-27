import "server-only";

// Samples the lidar terrain tiles (web/public/tiles/terrain/16/{x}/{y}.webp, Terrain-RGB encoding:
// h = -10000 + (R*65536 + G*256 + B) * 0.1 meters; z16 at 512 px is about 0.9 m per pixel) onto a
// regular grid in the report's local feet coordinates. Deterministic: bilinear interpolation only.
// Returns null when the tiles or the image decoder are not available (the site plan then says so).

import path from "node:path";
import { existsSync } from "node:fs";
import { remoteTilesBase } from "@/lib/tiles";

export interface LonLatAffine {
  lat0: number;
  lon0: number;
  lat_per_x: number;
  lat_per_y: number;
  lon_per_x: number;
  lon_per_y: number;
}

/** Elevations in FEET (NAVD88) at (x0 + i*step, y0 + j*step), row-major, NaN where no data. */
export interface DemGrid {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  z: Float64Array;
}

const Z = 16;
const TILE = 512;
const M_TO_FT = 3.280839895;
// turbopackIgnore keeps the build from tracing all ~20k terrain tiles into the report functions.
const DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "tiles", "terrain", String(Z));
// In production the tiles are hosted (NEXT_PUBLIC_TILES_BASE); the server fetches the few it needs.
const REMOTE = remoteTilesBase();

async function readTile(key: string): Promise<Buffer | string | null> {
  if (REMOTE) {
    try {
      const r = await fetch(`${REMOTE}/terrain/${Z}/${key}.webp`, { signal: AbortSignal.timeout(8000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
  const file = path.join(/* turbopackIgnore: true */ DIR, `${key}.webp`);
  return existsSync(file) ? file : null;
}

type Tile = { w: number; h: number; ch: number; data: Uint8Array } | null;

export async function sampleDem(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  step: number,
  A: LonLatAffine,
): Promise<DemGrid | null> {
  if (!REMOTE && !existsSync(DIR)) return null;
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return null;
  }
  const nx = Math.max(2, Math.floor((bounds.maxX - bounds.minX) / step) + 1);
  const ny = Math.max(2, Math.floor((bounds.maxY - bounds.minY) / step) + 1);
  if (nx * ny > 400_000) return null;

  const world = TILE * 2 ** Z;
  const px = new Float64Array(nx * ny);
  const py = new Float64Array(nx * ny);
  const need = new Set<string>();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * step;
      const y = bounds.minY + j * step;
      const lon = A.lon0 + A.lon_per_x * x + A.lon_per_y * y;
      const lat = A.lat0 + A.lat_per_x * x + A.lat_per_y * y;
      const u = ((lon + 180) / 360) * world - 0.5;
      const v = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * world - 0.5;
      px[j * nx + i] = u;
      py[j * nx + i] = v;
      for (const du of [0, 1]) for (const dv of [0, 1]) need.add(`${Math.floor((Math.floor(u) + du) / TILE)}/${Math.floor((Math.floor(v) + dv) / TILE)}`);
    }
  }
  if (need.size > 64) return null;

  const tiles = new Map<string, Tile>();
  for (const key of [...need].sort()) {
    const src = await readTile(key);
    if (!src) {
      tiles.set(key, null);
      continue;
    }
    try {
      const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
      tiles.set(key, { w: info.width, h: info.height, ch: info.channels, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
    } catch {
      tiles.set(key, null);
    }
  }

  const px1 = (gx: number, gy: number): number => {
    const t = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
    if (!t) return NaN;
    const lx = gx - Math.floor(gx / TILE) * TILE;
    const ly = gy - Math.floor(gy / TILE) * TILE;
    const k = (ly * t.w + lx) * t.ch;
    return -10000 + (t.data[k]! * 65536 + t.data[k + 1]! * 256 + t.data[k + 2]!) * 0.1;
  };

  const z = new Float64Array(nx * ny);
  let valid = 0;
  for (let n = 0; n < nx * ny; n++) {
    const u = px[n]!;
    const v = py[n]!;
    const u0 = Math.floor(u);
    const v0 = Math.floor(v);
    const fu = u - u0;
    const fv = v - v0;
    const h =
      px1(u0, v0) * (1 - fu) * (1 - fv) + px1(u0 + 1, v0) * fu * (1 - fv) + px1(u0, v0 + 1) * (1 - fu) * fv + px1(u0 + 1, v0 + 1) * fu * fv;
    // Terrain-RGB zero (h = -10000) marks no data.
    z[n] = Number.isFinite(h) && h > -1000 ? h * M_TO_FT : NaN;
    if (!Number.isNaN(z[n]!)) valid++;
  }
  if (valid < nx * ny * 0.2) return null;
  return { x0: bounds.minX, y0: bounds.minY, step, nx, ny, z };
}
