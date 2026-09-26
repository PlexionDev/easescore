import { describe, expect, it } from "vitest";
import { CATALOG, evaluateRequirements, type ParcelFacts, type RequirementResult } from "../src";
import hillside from "./fixtures/hillside-r1d-h.json";
import floodplain from "./fixtures/floodplain.json";

const byId = (rs: RequirementResult[], id: string) => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
};

const HILLSIDE = hillside as unknown as ParcelFacts;
const FLOOD = floodplain as unknown as ParcelFacts;
const newHome = { type: "new_build", units: 1, stories: 2, financed: true } as const;

describe("catalog", () => {
  it("has unique ids and every item has an issuer and a phase", () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATALOG) {
      expect(c.issuer).toBeTruthy();
      expect(c.phase).toBeTruthy();
    }
  });

  it("never invents costs or durations", () => {
    for (const r of evaluateRequirements(HILLSIDE, newHome)) {
      expect(r.cost).toBeNull();
      expect(r.duration).toBeNull();
    }
  });

  it("is deterministic", () => {
    expect(evaluateRequirements(HILLSIDE, newHome)).toEqual(evaluateRequirements(HILLSIDE, newHome));
  });
});

describe("hillside R1D-H vacant lot (Mount Washington)", () => {
  const rs = evaluateRequirements(HILLSIDE, newHome);

  it("requires a full geotechnical report for new construction in the Landslide-Prone overlay (§906.04, City handout)", () => {
    const g = byId(rs, "geotech");
    expect(g.status).toBe("REQUIRED");
    expect(g.reasons[0]?.reason).toMatch(/full geotechnical report.*§906\.04\.B\.2/);
  });

  it("uses the handout's smaller-work tier for a deck, and the exemption list otherwise", () => {
    const deck = byId(evaluateRequirements(HILLSIDE, { type: "rehab", minor_work: "deck" }), "geotech");
    expect(deck.reasons[0]?.reason).toMatch(/certified geotechnical professional/);
    const interior = byId(evaluateRequirements(HILLSIDE, { type: "rehab" }), "geotech");
    expect(interior.reasons.some((t) => /may not need a report/.test(t.reason))).toBe(true);
  });

  it("asks about steep cut/fill instead of assuming (§915.02.A.1.c)", () => {
    expect(byId(rs, "geotech").reasons.some((t) => t.status === "ASK" && /§915\.02\.A\.1\.c/.test(t.reason))).toBe(true);
    const yes = byId(evaluateRequirements(HILLSIDE, { ...newHome, cut_fill_over_25: true }), "geotech");
    expect(yes.reasons.filter((t) => t.status === "REQUIRED").length).toBe(2);
  });

  it("requires a boundary survey", () => {
    expect(byId(rs, "survey_boundary").status).toBe("REQUIRED");
  });

  it("flags possible variance / contextual setback review", () => {
    expect(["LIKELY", "POSSIBLE"]).toContain(byId(rs, "variance").status);
    expect(["LIKELY", "POSSIBLE"]).toContain(byId(rs, "contextual_setback").status);
  });

  it("does not claim a flood determination on the hilltop", () => {
    expect(byId(rs, "flood_determination").status).toBe("NOT_NEEDED");
  });

  it("notes the RCO area", () => {
    const r = byId(rs, "rco_meeting");
    expect(r.status).toBe("POSSIBLE");
    expect(r.reasons[0]?.reason).toMatch(/Mount Washington/);
  });

  it("orders the checklist by phase", () => {
    const order = ["due_diligence", "design_engineering", "zoning", "permits", "construction", "closeout"];
    const phases = rs.map((r) => order.indexOf(r.phase));
    expect([...phases].sort((a, b) => a - b)).toEqual(phases);
  });
});

describe("floodplain parcel outside Pittsburgh", () => {
  const rs = evaluateRequirements(FLOOD, newHome);

  it("requires a flood determination", () => {
    expect(byId(rs, "flood_determination").status).toBe("REQUIRED");
  });

  it("tells the user to confirm with the municipality", () => {
    expect(byId(rs, "building_permit").notes[0]).toMatch(/confirm with Elizabeth Twp/);
  });

  it("treats unmapped landslide risk as unknown, not absent", () => {
    const g = byId(rs, "geotech");
    expect(g.status).not.toBe("NOT_NEEDED");
    expect(g.reasons.some((t) => /overlays in our data are Pittsburgh's/.test(t.reason))).toBe(true);
  });
});

describe("project answers and overrides", () => {
  it("asks when the project type is unknown", () => {
    expect(byId(evaluateRequirements(HILLSIDE, {}), "building_permit").status).toBe("ASK");
  });

  it("keeps the computed status when the user overrides", () => {
    const rs = evaluateRequirements(HILLSIDE, newHome, { geotech: { status: "NOT_NEEDED", note: "Engineer waived" } });
    const g = byId(rs, "geotech") as RequirementResult & { overridden?: { from: string } };
    expect(g.status).toBe("NOT_NEEDED");
    expect(["REQUIRED", "LIKELY"]).toContain(g.overridden?.from);
  });

  it("requires accessibility design at 4+ units", () => {
    expect(byId(evaluateRequirements(HILLSIDE, { ...newHome, units: 4 }), "accessibility").status).toBe("REQUIRED");
    expect(byId(evaluateRequirements(HILLSIDE, newHome), "accessibility").status).toBe("NOT_NEEDED");
  });
});

import floodway from "./fixtures/floodway.json";

describe("flood rules", () => {
  const FW = floodway as unknown as ParcelFacts;

  it("flags the floodway as a likely deal-breaker", () => {
    const r = byId(evaluateRequirements(FW, newHome), "flood_determination");
    expect(r.status).toBe("REQUIRED");
    expect(r.reasons[0]?.reason).toMatch(/floodway/);
  });

  it("requires flood insurance in the 100-year zone for a financed project", () => {
    expect(byId(evaluateRequirements(FLOOD, newHome), "flood_insurance").status).toBe("REQUIRED");
    expect(byId(evaluateRequirements(FLOOD, { ...newHome, financed: false }), "flood_insurance").status).toBe("LIKELY");
  });

  it("doesn't ask for flood insurance on the hilltop", () => {
    expect(byId(evaluateRequirements(HILLSIDE, newHome), "flood_insurance").status).toBe("NOT_NEEDED");
  });
});

describe("hidden costs", () => {
  it("always flags transfer tax; mine awareness is an advisory, not a requirement", () => {
    const rs = evaluateRequirements(HILLSIDE, newHome);
    expect(byId(rs, "realty_transfer_tax").status).toBe("REQUIRED");
    const m = byId(rs, "mine_subsidence_paths");
    // No mapped mine under or near this lot: not needed, but the incomplete-maps caveat and map link always show.
    expect(m.status).toBe("NOT_NEEDED");
    expect(m.advisories.join(" ")).toMatch(/not proof of no mine/);
    expect(m.advisories.join(" ")).toMatch(/minemaps\.psu\.edu/);
  });

  it("marks mines REQUIRED only where the City code requires it", () => {
    const over = { ...HILLSIDE, mines: { ...(HILLSIDE.mines ?? { in_mined_out: false, dist_mined_out_ft: null, in_coal_bearing: false }), in_mined_out: true, in_city_undermined: true } };
    const single = byId(evaluateRequirements(over, newHome), "mine_subsidence_paths");
    expect(single.status).toBe("REQUIRED"); // DEP mine records, §906.05
    expect(single.reasons.some((t) => /§906\.05/.test(t.reason))).toBe(true);
    expect(single.advisories.join(" ")).toMatch(/Mine Subsidence Insurance/);
    const suburb = { ...FLOOD, mines: { in_mined_out: true, dist_mined_out_ft: 0, in_coal_bearing: true } };
    const s2 = byId(evaluateRequirements(suburb, newHome), "mine_subsidence_paths");
    expect(s2.status).toBe("NOT_NEEDED");
    expect(s2.advisories.join(" ")).toMatch(/over a mapped underground mine/);
  });

  it("flags the post-construction tax jump for a new build", () => {
    expect(byId(evaluateRequirements(HILLSIDE, newHome), "tax_jump").status).toBe("REQUIRED");
  });
});

describe("municipal sale rules", () => {
  it("treats Pittsburgh's area-dependent lateral test as possible, not required", () => {
    const r = byId(evaluateRequirements(HILLSIDE, newHome), "sewer_lateral");
    expect(r.status).toBe("POSSIBLE");
  });
  it("uses the combined transfer tax rate", () => {
    expect(byId(evaluateRequirements(HILLSIDE, newHome), "realty_transfer_tax").reasons[0]?.reason).toMatch(/^5% of the price/);
  });
});
