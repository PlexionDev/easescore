// Where the map tiles live (basemap/easescore/slope .pmtiles and terrain/{z}/{x}/{y}.webp).
// Locally they sit in web/public/tiles (gitignored, ~1.3 GB). In production they are hosted on a
// storage bucket and NEXT_PUBLIC_TILES_BASE points at it (no trailing slash), e.g.
// https://<project>.supabase.co/storage/v1/object/public/tiles
// The host must allow CORS GET/HEAD with the Range header (PMTiles reads byte ranges).

const ENV_BASE = (process.env.NEXT_PUBLIC_TILES_BASE ?? "").trim().replace(/\/+$/, "");

/** Base URL for tiles in the browser: the hosted bucket if configured, otherwise this site's /tiles. */
export function tilesBase(): string {
  if (ENV_BASE) return ENV_BASE;
  return typeof window === "undefined" ? "/tiles" : `${window.location.origin}/tiles`;
}

/** Hosted tiles base for server code, or null when tiles are read from the local public/ folder. */
export function remoteTilesBase(): string | null {
  return /^https?:\/\//.test(ENV_BASE) ? ENV_BASE : null;
}
