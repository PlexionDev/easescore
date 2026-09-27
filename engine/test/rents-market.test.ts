import { describe, expect, it, vi } from "vitest";
import { assumptions, rents } from "../src";

// RentCast quota protection: live calls only from the on-demand route, DB-reserved, honest fallbacks.
// All RentCast responses here are mocked (fetch is a vi.fn); no network.

const ZIP = "15219";
const BODY = {
  zipCode: ZIP,
  rentalData: {
    dataByBedrooms: [
      { bedrooms: 1, medianRent: 1195, averageRent: 1240, minRent: 800, maxRent: 2100, totalListings: 40, contactPhone: "x", id: "y" },
      { bedrooms: 2, medianRent: 1520, averageRent: 1580, minRent: 950, maxRent: 2900, totalListings: 22 },
      { bedrooms: 3, medianRent: 1800, averageRent: 1850, minRent: 1200, maxRent: 2600, totalListings: 3 },
    ],
  },
};
const HUD = { year: 2026, zip: ZIP, level: "small area (ZIP)", br1: 1140, br2: 1380, br3: 1760 };

function deps(over: Partial<rents.MarketDeps> = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
  const d = {
    cacheGet: vi.fn(async () => null),
    cachePut: vi.fn(async () => {}),
    reserve: vi.fn(async () => ({ ok: true, id: 7 })),
    record: vi.fn(async () => {}),
    apiKey: "test-key",
    fetch: fetchMock as unknown as typeof fetch,
    today: () => "2026-09-27",
    ...over,
  };
  return d;
}

describe("RentCast ZIP market statistics: when a live call may happen", () => {
  it("default (no allowLive): never reserves or fetches, labels the HUD fallback", async () => {
    const d = deps();
    const r = await rents.zipMarket(ZIP, { caller: "report" }, d);
    expect(r.status).toBe("not_cached");
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(rents.marketNote(r.status)).toBe("RentCast market statistics not retrieved for this ZIP yet; showing HUD Fair Market Rent.");
  });
  it("cache hit: no reservation, no fetch, even with allowLive", async () => {
    const cached: rents.ZipMarket = { zip: ZIP, retrievedOn: "2026-09-20", byBedroom: { 2: { bedrooms: 2, medianRent: 1500, averageRent: null, minRent: null, maxRent: null, totalListings: 10 } } };
    const d = deps({ cacheGet: vi.fn(async () => cached) });
    const r = await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d);
    expect(r).toEqual({ market: cached, status: "cache" });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("allowLive + miss: reserves first, calls /markets once, whitelists and caches", async () => {
    const d = deps();
    const r = await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d);
    expect(r.status).toBe("live");
    expect(d.reserve).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const url = String((d.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(url).toMatch(/^https:\/\/api\.rentcast\.io\/v1\/markets\?zipCode=15219&dataType=Rental/);
    expect(d.record).toHaveBeenCalledWith(7, "200");
    expect(d.cachePut).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.market)).not.toMatch(/contactPhone|"id"/);
    expect(r.market?.retrievedOn).toBe("2026-09-27");
  });
  it("same ZIP just requested elsewhere: no second call; uses the cache once it lands", async () => {
    const m = rents.parseMarket(ZIP, BODY, "2026-09-27")!;
    const cacheGet = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(m);
    const d = deps({ cacheGet, reserve: vi.fn(async () => ({ ok: false, reason: "recent" })), sleep: async () => {} });
    const r = await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d);
    expect(r.status).toBe("cache");
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("no ZIP or no key: no call", async () => {
    const d = deps({ apiKey: "" });
    expect((await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d)).status).toBe("not_cached");
    expect((await rents.zipMarket(null, { caller: "api/rents", allowLive: true }, deps())).status).toBe("no_zip");
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe("limits and fallbacks (mocked fetch)", () => {
  it("over the DB limit: no fetch, exact HUD label", async () => {
    for (const reason of ["day", "month", "quota"]) {
      const d = deps({ reserve: vi.fn(async () => ({ ok: false, reason })) });
      const r = await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d);
      expect(r.status).toBe("limit");
      expect(d.fetch).not.toHaveBeenCalled();
      expect(rents.marketNote(r.status)).toBe("RentCast limit reached; showing HUD Fair Market Rent.");
    }
  });
  it("RentCast quota response (429 / 402) counts as the limit", async () => {
    for (const status of [429, 402]) {
      const d = deps({ fetch: vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch });
      const r = await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, d);
      expect(r.status).toBe("limit");
      expect(d.record).toHaveBeenCalledWith(7, String(status));
      expect(d.cachePut).not.toHaveBeenCalled();
    }
  });
  it("errors, timeouts and a failed reservation give the error label", async () => {
    const e500 = deps({ fetch: vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch });
    expect((await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, e500)).status).toBe("error");
    const thrown = deps({ fetch: vi.fn(async () => { throw new Error("net"); }) as unknown as typeof fetch });
    expect((await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, thrown)).status).toBe("error");
    expect(thrown.record).toHaveBeenCalledWith(7, "timeout/error");
    const dbDown = deps({ reserve: vi.fn(async () => { throw new Error("db"); }) });
    expect((await rents.zipMarket(ZIP, { caller: "api/rents", allowLive: true }, dbDown)).status).toBe("error");
    expect(dbDown.fetch).not.toHaveBeenCalled();
    expect(rents.marketNote("error")).toBe("RentCast did not answer (error or timeout); showing HUD Fair Market Rent.");
  });
  it("the rent estimate uses ZIP stats with a dated receipt, else HUD with the label", async () => {
    const m = rents.parseMarket(ZIP, BODY, "2026-09-27")!;
    const r = rents.rentsByBedroom({ asOf: "2026-09-27", listings: {}, market: m, hud: HUD, zori: null });
    expect(r.byBedroom[2]!.basis).toBe("rentcast_market");
    expect(r.byBedroom[2]!.basisLabel).toBe("RentCast market statistics for ZIP 15219, retrieved 2026-09-27");
    expect(r.byBedroom[2]!.likely).toBe(1500);
    expect(r.byBedroom[2]!.retrievedOn).toBe("2026-09-27");
    // 3 BR has only 3 listings in the ZIP: HUD, said plainly.
    expect(r.byBedroom[3]!.basis).toBe("hud_safmr");
    expect(r.byBedroom[3]!.note).toMatch(/only 3 3-bedroom listings/);
    expect(r.sources.some((s) => /RentCast market statistics for ZIP 15219/.test(s.label) && s.asOf === "2026-09-27")).toBe(true);

    const over = rents.rentsByBedroom({ asOf: "2026-09-27", listings: {}, market: null, marketNote: rents.LABEL_LIMIT, hud: HUD, zori: null });
    expect(over.byBedroom[2]!.basis).toBe("hud_safmr");
    expect(over.byBedroom[2]!.likely).toBe(1400);
    expect(over.byBedroom[2]!.note).toBe("RentCast limit reached; showing HUD Fair Market Rent.");
    expect(rents.rentOneLiner(over.byBedroom[2]!)).toContain("RentCast limit reached; showing HUD Fair Market Rent.");
  });
});

describe("pro forma rent receipt", () => {
  const FACTS: assumptions.ProFormaFacts = {
    slope_1m: { mean_pct: 3, share_over_15: 0, share_over_25: 0 },
    overlays: [], mines: { in_city_undermined: false, in_mined_out: false, msi_risk: null }, site: { building_count: 0 },
    assessment: { use: "VACANT LAND", fmv_land: 10000, fmv_total: 10000, is_pittsburgh: true, lot_area_sqft: 3000 },
    property_tax: { general_mills: 24 }, transfer_tax: { total_pct: 4 }, owner_class: "private", area: "Larimer",
  };
  const pf = (rb: rents.RentsByBedroom) => assumptions.evaluateDevelopment(assumptions.buildDevelopmentInputs({
    strategy: "three_four_unit", facts: FACTS, scheme: { units: 3, grossFloorAreaSf: 3000, netFloorAreaSf: 2550, footprintSf: 1000, stories: 3 },
    comps: null, rents: { hud_fmr: HUD }, primeRate: 0.07, permitMonths: 4, tapFeesPerUnit: 1000, rentsByBedroom: rb, overrides: { tenure: "rent" },
  }));
  it("ZIP stats: the rent source names RentCast, the ZIP and the retrieval date", () => {
    const rb = rents.rentsByBedroom({ asOf: "2026-09-27", listings: {}, market: rents.parseMarket(ZIP, BODY, "2026-09-26"), hud: HUD, zori: null });
    const q = pf(rb);
    expect(q.plan.revenue.rent.perUnit).toBe(1500);
    expect(q.plan.sources.rent.label).toBe("RentCast market statistics for ZIP 15219, retrieved 2026-09-26, 2-bedroom");
    expect(q.plan.sources.rent.asOf).toBe("2026-09-26");
  });
  it("forced over-limit: HUD rent with the exact label", () => {
    const rb = rents.rentsByBedroom({ asOf: "2026-09-27", listings: {}, market: null, marketNote: rents.marketNote("limit"), hud: HUD, zori: null });
    const q = pf(rb);
    expect(q.plan.revenue.rent.perUnit).toBe(1400);
    expect(q.plan.sources.rent.label).toMatch(/^HUD Small Area Fair Market Rent FY2026, ZIP 15219/);
    expect(rb.byBedroom[2]!.note).toBe("RentCast limit reached; showing HUD Fair Market Rent.");
  });
});

// Batch/precompute paths must never trigger RentCast: only one file may hold the API URL, and only
// the on-demand user route may pass allowLive: true.
describe("no batch path can call RentCast", () => {
  const all: Record<string, string> = {
    ...import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob<string>(["../../web/src/**/*.{ts,tsx,js,mjs}"], { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob<string>(["../../scripts/**/*.{ts,js,mjs,cjs,py,sh}"], { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob<string>("../../supabase/**/*.sql", { query: "?raw", import: "default", eager: true }),
  };
  const rel = (p: string) => p.replace(/^\.\.\/\.\.\//, "").replace(/^\.\.\//, "engine/");
  const files = Object.entries(all).map(([p, src]) => [rel(p), src] as const);

  it("scans real code (engine, web, scripts, SQL)", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const d of ["engine/src/", "web/src/", "scripts/", "supabase/"]) expect(files.some(([p]) => p.startsWith(d))).toBe(true);
  });
  it("api.rentcast.io appears only in engine/src/rents/market.ts", () => {
    expect(files.filter(([, s]) => s.includes("api.rentcast.io")).map(([p]) => p)).toEqual(["engine/src/rents/market.ts"]);
  });
  it("allowLive: true appears only in the on-demand /api/rents route", () => {
    expect(files.filter(([, s]) => /allowLive:\s*true\s*[,}]/.test(s)).map(([p]) => p)).toEqual(["web/src/app/api/rents/[parid]/route.ts"]);
  });
  it("the report loader never requests a live call", () => {
    const load = files.find(([p]) => p === "web/src/lib/report/load.ts")?.[1] ?? "";
    expect(load).toMatch(/loadRents\(/);
    expect(load).not.toMatch(/allowLive/);
  });
});
