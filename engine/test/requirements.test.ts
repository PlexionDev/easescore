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

  it("requires a geotechnical report, flagged to confirm the code section", () => {
    const g = byId(rs, "geotech");
    expect(["REQUIRED", "LIKELY"]).toContain(g.status);
    expect(g.reasons.some((t) => /landslide-prone/.test(t.reason))).toBe(true);
    expect(g.confirm).toBe(true);
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
    expect(g.reasons.some((t) => /unknown, not absent/.test(t.reason))).toBe(true);
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
