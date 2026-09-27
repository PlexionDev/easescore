// Compact lidar elevation grid under a lot, in the lot's local feet (the parcel_quickfit_input
// coordinates), sampled from our Terrain-RGB tiles (web/public/tiles/terrain/16/{x}/{y}.webp:
// h = -10000 + (R*65536 + G*256 + B) * 0.1 m, about 0.9 m per pixel at z16). Same method as
// lib/report/terrain.ts (bilinear, NAVD88 feet). Pure: the caller supplies the tile decoder, so the
// live page (Next server), the pane batch (Node) and tests can all use it. Deterministic.

export interface LonLatAffine {
  lat0: number;
  lon0: number;
  lat_per_x: number;
  lat_per_y: number;
  lon_per_x: number;
  lon_per_y: number;
}

/** Ground elevations in FEET (NAVD88) at (x0 + i*step, y0 + j*step), row-major (j*nx + i); null = no data. */
export interface TerrainGrid {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  z: (number | null)[];
}

export type DecodedTile = { w: number; h: number; ch: number; data: Uint8Array } | null;
/** Decodes one z16 terrain tile (x, y) to raw RGB(A) pixels, or null when it is missing. */
export type TileDecoder = (x: number, y: number) => Promise<DecodedTile>;

const Z = 16;
const TILE = 512;
const M_TO_FT = 3.280839895;
/** At most this many cells along the longer side (step grows on big lots). */
const MAX_CELLS = 60;
/** Finest step in feet: about the lidar's 1 m resolution. */
const MIN_STEP_FT = 3;

/** Grid over the ring's bounding box (+ one step of margin). null when the tiles do not cover the lot. */
export async function sampleTerrainGrid(ring: [number, number][], A: LonLatAffine, decode: TileDecoder): Promise<TerrainGrid | null> {
  if (!Array.isArray(ring) || ring.length < 3 || !A) return null;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const step = Math.max(MIN_STEP_FT, Math.ceil(ext / MAX_CELLS));
  const x0 = Math.floor(Math.min(...xs) / step) * step - step, y0 = Math.floor(Math.min(...ys) / step) * step - step;
  const nx = Math.ceil((Math.max(...xs) - x0) / step) + 2, ny = Math.ceil((Math.max(...ys) - y0) / step) + 2;

  const world = TILE * 2 ** Z;
  const px = new Float64Array(nx * ny), py = new Float64Array(nx * ny);
  const need = new Set<string>();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, y = y0 + j * step;
      const lon = A.lon0 + A.lon_per_x * x + A.lon_per_y * y;
      const lat = A.lat0 + A.lat_per_x * x + A.lat_per_y * y;
      const u = ((lon + 180) / 360) * world - 0.5;
      const v = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * world - 0.5;
      px[j * nx + i] = u;
      py[j * nx + i] = v;
      for (const du of [0, 1]) for (const dv of [0, 1]) need.add(`${Math.floor((Math.floor(u) + du) / TILE)}/${Math.floor((Math.floor(v) + dv) / TILE)}`);
    }
  }
  if (need.size > 16) return null;
  const tiles = new Map<string, DecodedTile>();
  for (const key of [...need].sort()) {
    const [tx, ty] = key.split("/").map(Number) as [number, number];
    try {
      tiles.set(key, await decode(tx, ty));
    } catch {
      tiles.set(key, null);
    }
  }
  const px1 = (gx: number, gy: number): number => {
    const t = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
    if (!t) return NaN;
    const lx = gx - Math.floor(gx / TILE) * TILE, ly = gy - Math.floor(gy / TILE) * TILE;
    const k = (ly * t.w + lx) * t.ch;
    const h = -10000 + (t.data[k]! * 65536 + t.data[k + 1]! * 256 + t.data[k + 2]!) * 0.1;
    return h > -1000 ? h : NaN; // Terrain-RGB zero marks no data
  };
  const z: (number | null)[] = new Array(nx * ny);
  let valid = 0;
  for (let n = 0; n < nx * ny; n++) {
    const u = px[n]!, v = py[n]!;
    const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
    const h = px1(u0, v0) * (1 - fu) * (1 - fv) + px1(u0 + 1, v0) * fu * (1 - fv) + px1(u0, v0 + 1) * (1 - fu) * fv + px1(u0 + 1, v0 + 1) * fu * fv;
    z[n] = Number.isFinite(h) ? Math.round(h * M_TO_FT * 10) / 10 : null;
    if (z[n] != null) valid++;
  }
  if (valid < nx * ny * 0.5) return null;
  return { x0, y0, step, nx, ny, z };
}

/** Bilinear ground elevation (ft) at local (x, y); null outside the grid or where a corner has no data. */
export function groundAt(g: TerrainGrid, x: number, y: number): number | null {
  const fi = (x - g.x0) / g.step, fj = (y - g.y0) / g.step;
  if (fi < 0 || fj < 0 || fi > g.nx - 1 || fj > g.ny - 1) return null;
  const i0 = Math.min(Math.floor(fi), g.nx - 2), j0 = Math.min(Math.floor(fj), g.ny - 2);
  const u = fi - i0, v = fj - j0;
  const at = (i: number, j: number) => g.z[j * g.nx + i];
  const a = at(i0, j0), b = at(i0 + 1, j0), c = at(i0, j0 + 1), d = at(i0 + 1, j0 + 1);
  if (a == null || b == null || c == null || d == null) return null;
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
