import "server-only";

// Lidar grid under a lot for the parcel pane (lib/terrain-grid.ts), decoding our own terrain tiles with
// sharp: from web/public/tiles/terrain/16 locally, or from the hosted tiles (NEXT_PUBLIC_TILES_BASE, as
// lib/report/terrain.ts does) in production. null when the tiles or the decoder are unavailable.

import path from "node:path";
import { existsSync } from "node:fs";
import { sampleTerrainGrid, type LonLatAffine, type TerrainGrid } from "./terrain-grid";

// turbopackIgnore keeps the build from tracing the ~20k terrain tiles into the page's server function.
const DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "tiles", "terrain", "16");
const BASE = (process.env.NEXT_PUBLIC_TILES_BASE ?? "").trim().replace(/\/+$/, "");
const REMOTE = /^https?:\/\//.test(BASE) ? BASE : null;

async function readTile(x: number, y: number): Promise<Buffer | string | null> {
  if (REMOTE) {
    try {
      const r = await fetch(`${REMOTE}/terrain/16/${x}/${y}.webp`, { signal: AbortSignal.timeout(8000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
  const file = path.join(/* turbopackIgnore: true */ DIR, String(x), `${y}.webp`);
  return existsSync(file) ? file : null;
}

export async function terrainGridFor(qf: { parcel?: [number, number][]; toLonLat?: LonLatAffine } | null | undefined): Promise<TerrainGrid | null> {
  if (!qf?.parcel || !qf.toLonLat || (!REMOTE && !existsSync(DIR))) return null;
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return null;
  }
  try {
    return await sampleTerrainGrid(qf.parcel, qf.toLonLat, async (x, y) => {
      const src = await readTile(x, y);
      if (!src) return null;
      const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
      return { w: info.width, h: info.height, ch: info.channels, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    });
  } catch {
    return null;
  }
}
