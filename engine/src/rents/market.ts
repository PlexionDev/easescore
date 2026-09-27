// RentCast market statistics by ZIP (GET https://api.rentcast.io/v1/markets?zipCode=&dataType=Rental).
// One request returns rental stats for every bedroom count in the ZIP, so a ZIP costs one call.
//
// Quota rules (Paul's plan is 1,000 requests/month for everything):
// - A live call happens ONLY when the caller passes allowLive: true. The one on-demand user route
//   (web/src/app/api/rents/[parid]/route.ts) is the only place that does; reports, precompute,
//   batch scripts and tests never do (engine/test/rents-market.test.ts checks the repo for this).
// - Every live call first reserves a slot in the database (rentcast_reserve, migration 195:
//   50/day, 800/month, US Eastern). No slot → no call.
// - Any failure (limit, quota response, error, timeout) returns no data and an honest label; the
//   rent then falls back to HUD Small Area Fair Market Rent by ZIP.
// Deps are injected so this file has no database or network code of its own (and tests mock them).

export const RENTCAST_MARKETS_URL = "https://api.rentcast.io/v1/markets";
export const MARKET_ENDPOINT = "markets";
/** Server-side limits (enforced in SQL; mirrored here for labels and tests only). */
export const DAILY_LIMIT = 50;
export const MONTHLY_LIMIT = 800;
export const MAX_AGE_DAYS = 30;
export const TIMEOUT_MS = 4000;

export const LABEL_LIMIT = "RentCast limit reached; showing HUD Fair Market Rent.";
export const LABEL_ERROR = "RentCast did not answer (error or timeout); showing HUD Fair Market Rent.";
export const LABEL_NOT_CACHED = "RentCast market statistics not retrieved for this ZIP yet; showing HUD Fair Market Rent.";
export const LABEL_NO_ZIP = "No ZIP code for this parcel; showing HUD Fair Market Rent.";

export interface ZipBedroomStats {
  bedrooms: number;
  medianRent: number | null;
  averageRent: number | null;
  minRent: number | null;
  maxRent: number | null;
  totalListings: number | null;
}

export interface ZipMarket {
  zip: string;
  /** YYYY-MM-DD the statistics were retrieved from RentCast. */
  retrievedOn: string;
  byBedroom: Record<number, ZipBedroomStats>;
}

/** cache = from our cache; live = fetched now; limit = our limit or RentCast quota; error = failed; not_cached = no live call allowed here. */
export type MarketStatus = "cache" | "live" | "limit" | "error" | "not_cached" | "no_zip";

export interface Reservation { ok: boolean; id?: number | null; reason?: string | null }

export interface MarketDeps {
  cacheGet: (zip: string) => Promise<ZipMarket | null>;
  cachePut: (m: ZipMarket) => Promise<void>;
  /** Atomic DB reservation (rentcast_reserve). Must be called before every request. */
  reserve: (zip: string, caller: string) => Promise<Reservation>;
  record: (id: number, status: string) => Promise<void>;
  apiKey: string | null | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Wait (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Today, YYYY-MM-DD (tests). */
  today?: () => string;
}

export interface MarketOptions {
  /** Only the on-demand user route sets this. Default false: cache only, never a live call. */
  allowLive?: boolean;
  /** Who asked (route name), for the call log. */
  caller: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Whitelist the /markets response to per-bedroom rental numbers. Null if it has none. */
export function parseMarket(zip: string, json: unknown, retrievedOn: string): ZipMarket | null {
  const rows = (json as { rentalData?: { dataByBedrooms?: unknown } } | null)?.rentalData?.dataByBedrooms;
  if (!Array.isArray(rows)) return null;
  const byBedroom: Record<number, ZipBedroomStats> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const br = num(r.bedrooms);
    if (br == null) continue;
    byBedroom[br] = {
      bedrooms: br, medianRent: num(r.medianRent), averageRent: num(r.averageRent),
      minRent: num(r.minRent), maxRent: num(r.maxRent), totalListings: num(r.totalListings),
    };
  }
  return Object.keys(byBedroom).length ? { zip, retrievedOn, byBedroom } : null;
}

/** The fallback note for a status (null when there are RentCast statistics). */
export function marketNote(status: MarketStatus): string | null {
  switch (status) {
    case "limit": return LABEL_LIMIT;
    case "error": return LABEL_ERROR;
    case "not_cached": return LABEL_NOT_CACHED;
    case "no_zip": return LABEL_NO_ZIP;
    default: return null;
  }
}

/**
 * RentCast rental statistics for a ZIP: cache first; a live call only with allowLive and a DB
 * reservation. Never throws.
 */
export async function zipMarket(zip: string | null | undefined, opts: MarketOptions, deps: MarketDeps): Promise<{ market: ZipMarket | null; status: MarketStatus }> {
  if (!zip || !/^\d{5}$/.test(zip)) return { market: null, status: "no_zip" };
  try {
    const cached = await deps.cacheGet(zip);
    if (cached) return { market: cached, status: "cache" };
  } catch { /* cache unreachable: treat as a miss */ }
  if (opts.allowLive !== true || !deps.apiKey) return { market: null, status: "not_cached" };

  let res: Reservation;
  try { res = await deps.reserve(zip, opts.caller); } catch { return { market: null, status: "error" }; }
  // recent = this ZIP was just requested (another request is fetching it): wait briefly, re-read the cache.
  if (!res.ok && res.reason === "recent") {
    await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(1500);
    try { const again = await deps.cacheGet(zip); if (again) return { market: again, status: "cache" }; } catch { /* miss */ }
    return { market: null, status: "not_cached" };
  }
  // day/month = our limits; quota = RentCast already answered 429/402 today.
  if (!res.ok || res.id == null) return { market: null, status: res.reason === "day" || res.reason === "month" || res.reason === "quota" ? "limit" : "error" };
  const id = res.id;

  const f = deps.fetch ?? fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const qs = new URLSearchParams({ zipCode: zip, dataType: "Rental", historyRange: "1" });
    const r = await f(`${RENTCAST_MARKETS_URL}?${qs}`, { headers: { "X-Api-Key": deps.apiKey, Accept: "application/json" }, cache: "no-store", signal: ac.signal });
    await deps.record(id, String(r.status)).catch(() => {});
    // 429 (rate/quota) and 402 (plan limit) are quota responses; anything else not OK is an error.
    if (r.status === 429 || r.status === 402) return { market: null, status: "limit" };
    if (!r.ok) return { market: null, status: "error" };
    const today = deps.today?.() ?? new Date().toISOString().slice(0, 10);
    const m = parseMarket(zip, await r.json(), today);
    if (!m) return { market: null, status: "error" };
    await deps.cachePut(m).catch(() => {});
    return { market: m, status: "live" };
  } catch {
    await deps.record(id, "timeout/error").catch(() => {});
    return { market: null, status: "error" };
  } finally {
    clearTimeout(t);
  }
}
