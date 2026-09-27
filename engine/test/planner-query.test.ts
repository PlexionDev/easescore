// Planner seat query builder (web/src/lib/planner-query.ts): filters parse and serialize losslessly,
// map to the planner_rows() keys, and combine as AND. matchRow() is the TypeScript mirror of the SQL.
// Set PLANNER_LIVE=1 (with NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY in the environment) to also
// check the SQL against matchRow() on one neighborhood's rows.

import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS, policyKey, blockerSentence, csvLine, describeFilters, filtersToDb, filtersToQuery, matchRow, parseFilters,
  type Filters, type PlannerRow,
} from "../../web/src/lib/planner-query";

function row(p: Partial<PlannerRow>): PlannerRow {
  return {
    parid: "0000A00001000000", address: "1 TEST ST", score: 80, band: "Easy", range_lo: null, range_hi: null, preliminary: false,
    red_flag_count: 0, red_flags: [], top_blocker: null, blockers: [], by_right_units: 1, units_with_relief: 2, months_to_permit: 1.7,
    planning_badge: null, badge_score: 0, badge_matches: null, factor_scores: null, best_strategy: "new_sf", vacant: true,
    owner_class: "private", owner_type: "private", owner_agency: null, tax_delinquent: false, zoning: "R1D-M", neighborhood: "Garfield", council_district: null,
    municipality: "PITTSBURGH", lot_sqft: 3000, lon: -79.95, lat: 40.46, transit_m: 200, hz_floodway: false, hz_landslide: false,
    hz_undermined: false, steep_share: 0, cap_label: null, rehab_score: null, rehab_band: null, note: null, config_version: "0.2",
    data_dates: {}, computed_at: "2026-09-27T00:00:00Z", ...p,
  };
}

describe("filters: parse and serialize", () => {
  it("round-trips every filter through the URL", () => {
    const f: Filters = {
      muni: "PITTSBURGH", district: "7", hoods: ["Garfield", "Larimer"], zones: ["R1D-M"], lotMin: 1200, lotMax: 9000, land: "vacant",
      owner: "public", ownerTypes: ["ura", "city"], delinquent: true, bands: ["Easy", "Moderate"], clean: true, xFloodway: true, xLandslide: true, xUndermined: true,
      xSteep: true, transitFt: 1000, byRightMin: 2, hasBlocker: "Parking minimum", only: ["Setbacks", "Parking minimum"],
      ids: ["0000A00001000000"],
    };
    expect(parseFilters(filtersToQuery(f))).toEqual(f);
  });
  it("drops unknown and malformed values", () => {
    const f = parseFilters(new URLSearchParams("land=swamp&owner=aliens&bands=Easy,Great&lotMin=-5&lotMax=abc&clean=yes&ids=bad,0000A00001000000"));
    expect(f).toEqual({ bands: ["Easy"], lotMin: 0, ids: ["0000A00001000000"] });
  });
  it("maps to the planner_rows() keys, feet to meters", () => {
    expect(filtersToDb({ land: "structure", owner: "private", transitFt: 1000, clean: true, only: ["Setbacks"], hasBlocker: "Steep slope" })).toEqual({
      vacant: false, owner: "private", transit_max_m: 304.8, no_red_flags: true, only_blocked_by: ["Setbacks"], has_blocker: "Steep slope",
    });
    expect(filtersToDb({})).toEqual({});
  });
  it("describes the filters in plain words", () => {
    expect(describeFilters({ muni: "PITTSBURGH", land: "vacant", owner: "public", clean: true, transitFt: 1000 }))
      .toEqual(["Pittsburgh", "Vacant land", "Publicly owned", "No red flags", "Within 1,000 ft of frequent transit"]);
  });
});

describe("filters combine (matchRow mirrors planner_rows)", () => {
  const demo: Filters = { muni: "PITTSBURGH", land: "vacant", owner: "public", clean: true, transitFt: 1000 };
  it("core demo path: vacant + public + no red flags + within 1,000 ft of frequent transit", () => {
    expect(matchRow(row({ owner_class: "public" }), demo)).toBe(true);
    expect(matchRow(row({ owner_class: "public", vacant: false }), demo)).toBe(false);
    expect(matchRow(row({ owner_class: "private" }), demo)).toBe(false);
    expect(matchRow(row({ owner_class: "public", red_flag_count: 1 }), demo)).toBe(false);
    expect(matchRow(row({ owner_class: "public", transit_m: 305 }), demo)).toBe(false);
    expect(matchRow(row({ owner_class: "public", transit_m: null }), demo)).toBe(false);
    expect(matchRow(row({ owner_class: "public", municipality: "MT. LEBANON" }), demo)).toBe(false);
  });
  it("lists are OR within a filter, AND across filters", () => {
    const f: Filters = { hoods: ["Garfield", "Larimer"], bands: ["Easy", "Moderate"] };
    expect(matchRow(row({ neighborhood: "Larimer", band: "Moderate" }), f)).toBe(true);
    expect(matchRow(row({ neighborhood: "Larimer", band: "Hard" }), f)).toBe(false);
    expect(matchRow(row({ neighborhood: "Bloomfield", band: "Easy" }), f)).toBe(false);
  });
  it("lot size range is inclusive and excludes unknown lot sizes", () => {
    const f: Filters = { lotMin: 1200, lotMax: 3000 };
    expect(matchRow(row({ lot_sqft: 1200 }), f)).toBe(true);
    expect(matchRow(row({ lot_sqft: 3000 }), f)).toBe(true);
    expect(matchRow(row({ lot_sqft: 3001 }), f)).toBe(false);
    expect(matchRow(row({ lot_sqft: null }), f)).toBe(false);
  });
  it("hazard exclusions", () => {
    expect(matchRow(row({ hz_floodway: true }), { xFloodway: true })).toBe(false);
    expect(matchRow(row({ hz_landslide: true }), { xLandslide: true })).toBe(false);
    expect(matchRow(row({ hz_undermined: true }), { xUndermined: true })).toBe(false);
    expect(matchRow(row({ steep_share: 0.25 }), { xSteep: true })).toBe(false);
    expect(matchRow(row({ steep_share: 0.24 }), { xSteep: true })).toBe(true);
    expect(matchRow(row({ steep_share: null }), { xSteep: true })).toBe(true);
    expect(matchRow(row({ hz_landslide: true }), { xFloodway: true })).toBe(true);
  });
  it("homes by right at least N (unknown counts do not match)", () => {
    expect(matchRow(row({ by_right_units: 2 }), { byRightMin: 2 })).toBe(true);
    expect(matchRow(row({ by_right_units: 1 }), { byRightMin: 2 })).toBe(false);
    expect(matchRow(row({ by_right_units: null }), { byRightMin: 0 })).toBe(false);
  });
  it("'only blocked by' means every blocker is in the list, and there is at least one", () => {
    const f: Filters = { only: ["Parking minimum", "Setbacks"] };
    expect(matchRow(row({ blockers: ["Parking minimum"] }), f)).toBe(true);
    expect(matchRow(row({ blockers: ["Setbacks", "Parking minimum"] }), f)).toBe(true);
    expect(matchRow(row({ blockers: ["Parking minimum", "Steep slope"] }), f)).toBe(false);
    expect(matchRow(row({ blockers: [] }), f)).toBe(false);
  });
  it("'blocked by' (summary bars) matches any parcel listing the blocker", () => {
    expect(matchRow(row({ blockers: ["Steep slope", "Setbacks"], top_blocker: "Steep slope" }), { hasBlocker: "Setbacks" })).toBe(true);
    expect(matchRow(row({ blockers: ["Steep slope"] }), { hasBlocker: "Setbacks" })).toBe(false);
  });
  it("owner types are OR within the list", () => {
    expect(matchRow(row({ owner_class: "public", owner_type: "ura" }), { ownerTypes: ["city", "ura"] })).toBe(true);
    expect(matchRow(row({ owner_class: "public", owner_type: "hacp" }), { ownerTypes: ["city", "ura"] })).toBe(false);
  });
  it("tax-delinquent and parcel lists", () => {
    expect(matchRow(row({ tax_delinquent: null }), { delinquent: true })).toBe(false);
    expect(matchRow(row({ tax_delinquent: true }), { delinquent: true })).toBe(true);
    expect(matchRow(row({ parid: "0000A00001000000" }), { ids: ["0000A00002000000"] })).toBe(false);
  });
});

describe("policy links", () => {
  it("combines lever keys in the Policy seat's order", () => {
    expect(policyKey(["pt", "m0", "a35", "m0"])).toBe("a35.m0.pt");
    expect(policyKey(["m0"])).toBe("m0");
  });
});

describe("summary text and CSV", () => {
  it("blocker sentence reports share of parcels", () => {
    expect(blockerSentence({ total: 200, blockers: [{ blocker: "Minimum lot size", n: 76, top: 60 }] }))
      .toBe("Across the 200 matching parcels, the most common blocker is minimum lot size (38% of parcels).");
    expect(blockerSentence({ total: 0, blockers: [] })).toBe("No parcels match these filters.");
  });
  it("every CSV line has one value per column, quoted when needed", () => {
    const line = csvLine(row({ address: 'A "quoted", ADDRESS', blockers: ["Setbacks", "Parking minimum"] }), 1, "http://x");
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter((c, i, a) => i < a.length - 1 || c !== "");
    expect(cells.length).toBe(CSV_COLUMNS.length);
  });
});

// The engine has no Node typings; read the environment without them.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const live = env.PLANNER_LIVE === "1" && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
describe.skipIf(!live)("SQL planner_rows() agrees with matchRow() (live)", () => {
  const rpc = async (body: Record<string, unknown>) => {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/planner_query`, {
      method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return (await r.json()) as { total: number; rows: PlannerRow[] };
  };
  it("on every filter combination tried, the SQL set equals the TypeScript set", async () => {
    const hood = "Garfield";
    const all = (await rpc({ p_filters: filtersToDb({ hoods: [hood] }), p_limit: 10000 })).rows;
    expect(all.length).toBeGreaterThan(100);
    const combos: Filters[] = [
      { land: "vacant" }, { owner: "public", clean: true }, { land: "vacant", owner: "public", clean: true, transitFt: 1000 },
      { bands: ["Easy", "Moderate"], xSteep: true }, { lotMin: 2000, lotMax: 5000, xUndermined: true }, { byRightMin: 2 },
      { only: ["Steep slope", "Low market activity"] }, { hasBlocker: "Steep slope" }, { delinquent: true, land: "vacant" },
      { ownerTypes: ["ura", "hacp"] }, { owner: "public", xLandslide: true, xFloodway: true },
    ];
    for (const c of combos) {
      const f = { ...c, hoods: [hood] };
      const sql = (await rpc({ p_filters: filtersToDb(f), p_limit: 10000 })).rows.map((r) => r.parid).sort();
      const ts = all.filter((r) => matchRow(r, f)).map((r) => r.parid).sort();
      expect({ filter: c, ids: sql }).toEqual({ filter: c, ids: ts });
    }
  }, 120_000);
});
