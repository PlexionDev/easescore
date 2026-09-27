import "server-only";
import { rents } from "@easescore/engine";

// RentCast market statistics by ZIP (engine rents.zipMarket) wired to Supabase (migration 195).
// - Key RENTCAST_API_KEY is server-only (never NEXT_PUBLIC_, never logged).
// - Live calls only when the caller passes allowLive: true — only the on-demand /api/rents route.
//   Reports, precompute, batch scripts and tests read the cache only.
// - Every live call first reserves a slot with rentcast_reserve (atomic; 50/day, 800/month ET),
//   which also logs it in rentcast_calls. No secret key or DB → no call.
// - Cache: rent_market_cache (one row per ZIP, retrieval time), read for up to 30 days.
// - Terms: RentCast API Terms §1 allow storing and displaying API data; see .planning/DECISIONS.md.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const mem = new Map<string, { m: rents.ZipMarket; at: number }>();
const MEM_MS = 6 * 3600_000;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await run(ac.signal); } catch { return null; } finally { clearTimeout(t); }
}

async function rpc<T>(fn: string, body: unknown, key: string, ms = 2000): Promise<T | null> {
  if (!SB_URL) return null;
  return withTimeout(ms, async (signal) => {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: key, ...(key === SB_PUB ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal,
    });
    if (!r.ok) throw new Error(String(r.status));
    const txt = await r.text();
    return (txt ? JSON.parse(txt) : null) as T;
  });
}

const deps = (): rents.MarketDeps => {
  const secret = process.env.SUPABASE_SECRET_KEY;
  return {
    async cacheGet(zip) {
      const hit = mem.get(zip);
      if (hit && Date.now() - hit.at < MEM_MS) return hit.m;
      const key = SB_PUB ?? secret;
      if (!key) return null;
      const j = await rpc<{ zip: string; retrieved_at: string; by_bedroom: Record<number, rents.ZipBedroomStats> } | null>("rent_market_get", { p_zip: zip, p_max_age_days: rents.MAX_AGE_DAYS }, key, 1500);
      if (!j?.by_bedroom) return null;
      const m: rents.ZipMarket = { zip: j.zip, retrievedOn: j.retrieved_at.slice(0, 10), byBedroom: j.by_bedroom };
      mem.set(zip, { m, at: Date.now() });
      return m;
    },
    async cachePut(m) {
      mem.set(m.zip, { m, at: Date.now() });
      if (!SB_URL || !secret) return;
      await withTimeout(3000, (signal) => fetch(`${SB_URL}/rest/v1/rent_market_cache?on_conflict=zip`, {
        method: "POST",
        headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ zip: m.zip, retrieved_at: new Date().toISOString(), by_bedroom: m.byBedroom }), signal,
      }));
    },
    async reserve(zip, caller) {
      if (!secret) return { ok: false, reason: "no_db" };
      // RENTCAST_DAILY_CAP can only lower the SQL daily limit (50).
      const cap = Number(process.env.RENTCAST_DAILY_CAP);
      const r = await rpc<rents.Reservation>("rentcast_reserve", { p_endpoint: rents.MARKET_ENDPOINT, p_caller: caller, p_zip: zip, p_day_cap: Number.isFinite(cap) && process.env.RENTCAST_DAILY_CAP ? cap : null }, secret, 2000);
      return r ?? { ok: false, reason: "db_error" };
    },
    async record(id, status) {
      if (!secret) return;
      await rpc("rentcast_record", { p_id: id, p_status: status }, secret, 2000);
    },
    apiKey: process.env.RENTCAST_API_KEY ?? null,
  };
};

/** RentCast ZIP rental statistics. allowLive only from the on-demand user route. Never throws. */
export function rentcastZipMarket(zip: string | null | undefined, opts: rents.MarketOptions) {
  return rents.zipMarket(zip, opts, deps());
}
