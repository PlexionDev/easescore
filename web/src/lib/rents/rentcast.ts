import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { rents } from "@easescore/engine";

// RentCast rental listings near a location, one bedroom count per request.
// - Key RENTCAST_API_KEY is server-only (never NEXT_PUBLIC_, never logged).
// - Terms (rentcast.io/terms-api §1) allow storing and displaying API data; see .planning/DECISIONS.md.
// - Quota guard: every attempt is counted in data/raw/rentcast_calls.json (gitignored) BEFORE it is sent;
//   no live call when the month's count reaches the cap or the counter cannot be written (read-only
//   disks such as Vercel), so production serves the cache and then the labeled HUD/ZORI fallback.
// - Hard 3 s timeout; any failure returns null (the caller falls back).
// - Responses are whitelisted to listing facts: no ids, owner, agent, office or contact fields.
// - Cache order: memory → Supabase rent_cache_get (migration 120) → local file → live call.

const ENDPOINT = "https://api.rentcast.io/v1/avm/rent/long-term";
const TIMEOUT_MS = 3000;
const PULL_RADIUS_MI = 3;
const DAYS_OLD = 183;
const COMP_COUNT = 25;
const MAX_AGE_DAYS = 30;
// Repo root: the dev server may run from web/ or from the repo root.
const ROOT = existsSync(join(process.cwd(), "engine")) ? process.cwd() : resolve(process.cwd(), "..");
const RAW_DIR = join(ROOT, "data", "raw");
const COUNTER = join(RAW_DIR, "rentcast_calls.json");
const FILE_CACHE = join(RAW_DIR, "rentcast_cache.json");
const cap = () => Number(process.env.RENTCAST_MONTHLY_CAP) || 40;

export interface Pull { listings: rents.RentListing[]; fetchedAt: string }

/** ~100 m location key. */
export const locKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

const mem = new Map<string, { pull: Pull; at: number }>();
const MEM_MS = 6 * 3600_000;

interface Counter { month: string; calls: number; cap: number; log: { at: string; loc: string; br: number; status: number | string }[] }

function readCounter(): Counter {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const c = JSON.parse(readFileSync(COUNTER, "utf8")) as Counter;
    if (c.month === month) return c;
  } catch { /* first call this month */ }
  return { month, calls: 0, cap: cap(), log: [] };
}

/** Reserve one call (synchronous read-modify-write, so parallel requests cannot lose a count). Null at the cap or when the counter is not writable. */
function reserve(loc: string, br: number): string | null {
  const c = readCounter();
  c.cap = cap();
  if (c.calls >= c.cap) return null;
  const at = new Date().toISOString();
  c.calls += 1;
  c.log.push({ at, loc, br, status: "sent" });
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(COUNTER, JSON.stringify(c, null, 2));
    return `${at}|${loc}|${br}`;
  } catch {
    return null;
  }
}

/** Record the HTTP status of a reserved call (re-reads the file so other calls' counts are kept). */
function recordStatus(id: string, status: number | string) {
  const c = readCounter();
  const e = c.log.find((x) => `${x.at}|${x.loc}|${x.br}` === id);
  if (e && e.status === "sent") e.status = status;
  try { writeFileSync(COUNTER, JSON.stringify(c, null, 2)); } catch { /* best effort */ }
}

export function callCount(): { month: string; calls: number; cap: number } {
  const c = readCounter();
  return { month: c.month, calls: c.calls, cap: cap() };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Whitelist one comparable to listing facts. */
function clean(x: Record<string, unknown>): rents.RentListing | null {
  const price = num(x.price), address = str(x.formattedAddress) ?? str(x.addressLine1), d = num(x.distance);
  if (price == null || !address || d == null) return null;
  return {
    address, price, distanceMi: d,
    bedrooms: num(x.bedrooms), bathrooms: num(x.bathrooms), squareFootage: num(x.squareFootage),
    propertyType: str(x.propertyType), yearBuilt: num(x.yearBuilt),
    lastSeen: (str(x.lastSeenDate) ?? str(x.listedDate))?.slice(0, 10) ?? null,
  };
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await run(ac.signal); } catch { return null; } finally { clearTimeout(t); }
}

async function dbCacheGet(loc: string): Promise<Record<string, Pull>> {
  if (!SB_URL || !SB_PUB) return {};
  const j = await withTimeout(1500, async (signal) => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/rent_cache_get`, {
      method: "POST", headers: { apikey: SB_PUB, "Content-Type": "application/json" },
      body: JSON.stringify({ p_loc_key: loc, p_max_age_days: MAX_AGE_DAYS }), cache: "no-store", signal,
    });
    return r.ok ? ((await r.json()) as Record<string, { fetched_at: string; listings: rents.RentListing[] }>) : null;
  });
  const out: Record<string, Pull> = {};
  for (const [br, v] of Object.entries(j ?? {})) out[br] = { listings: v.listings, fetchedAt: v.fetched_at };
  return out;
}

async function dbCachePut(loc: string, br: number, lat: number, lon: number, pull: Pull) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !key) return;
  await withTimeout(3000, (signal) => fetch(`${SB_URL}/rest/v1/rentcast_cache?on_conflict=loc_key,bedrooms`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ loc_key: loc, bedrooms: br, lat, lon, fetched_at: pull.fetchedAt, listings: pull.listings }), signal,
  }));
}

type FileCache = Record<string, Pull>;
function fileCacheGet(k: string): Pull | null {
  try {
    const p = (JSON.parse(readFileSync(FILE_CACHE, "utf8")) as FileCache)[k];
    return p && Date.now() - Date.parse(p.fetchedAt) < MAX_AGE_DAYS * 86_400_000 ? p : null;
  } catch { return null; }
}
function fileCachePut(k: string, pull: Pull) {
  try {
    let all: FileCache = {};
    try { all = JSON.parse(readFileSync(FILE_CACHE, "utf8")) as FileCache; } catch { /* new file */ }
    all[k] = pull;
    writeFileSync(FILE_CACHE, JSON.stringify(all));
  } catch { /* read-only disk */ }
}

async function live(lat: number, lon: number, br: number, loc: string): Promise<Pull | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) return null;
  const id = reserve(loc, br);
  if (!id) return null;
  const qs = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), bedrooms: String(br),
    maxRadius: String(PULL_RADIUS_MI), daysOld: String(DAYS_OLD), compCount: String(COMP_COUNT), lookupSubjectAttributes: "false",
  });
  const res = await withTimeout(TIMEOUT_MS, async (signal) => {
    const r = await fetch(`${ENDPOINT}?${qs}`, { headers: { "X-Api-Key": apiKey, Accept: "application/json" }, cache: "no-store", signal });
    recordStatus(id, r.status);
    return r.ok ? ((await r.json()) as { comparables?: Record<string, unknown>[] }) : null;
  });
  if (!res) { recordStatus(id, "timeout/error"); return null; }
  const listings = (res.comparables ?? []).map(clean).filter((x): x is rents.RentListing => x != null);
  return { listings, fetchedAt: new Date().toISOString() };
}

/**
 * Listings per bedroom count near (lat, lon). A null entry = unavailable (quota, timeout, no key).
 * Never throws.
 */
export async function rentcastListings(lat: number, lon: number, bedrooms: number[]): Promise<Record<number, Pull | null>> {
  const loc = locKey(lat, lon);
  const out: Record<number, Pull | null> = {};
  const needDb = bedrooms.filter((br) => { const m = mem.get(`${loc}:${br}`); if (m && Date.now() - m.at < MEM_MS) { out[br] = m.pull; return false; } return true; });
  if (!needDb.length) return out;
  const db = await dbCacheGet(loc);
  await Promise.all(needDb.map(async (br) => {
    const k = `${loc}:${br}`;
    let pull: Pull | null = db[String(br)] ?? fileCacheGet(k);
    if (!pull) {
      pull = await live(lat, lon, br, loc);
      if (pull) { fileCachePut(k, pull); await dbCachePut(loc, br, lat, lon, pull); }
    }
    if (pull) mem.set(k, { pull, at: Date.now() });
    out[br] = pull;
  }));
  return out;
}
