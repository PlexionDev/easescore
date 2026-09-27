import { describe, expect, it } from "vitest";
import { buildApprovalsRecord, reconcileRequirements, countNoun, schemePhrase } from "../src/narrative";

const base = { typologyLabel: "Townhouse row", units: 3, byRight: false, permission: { code: "P", use: "Townhouse row" }, approvals: [] as { kind: string; rule: string; label: string }[], parkingSpaces: 1, parkingRequired: 3 };
const req = (id: string, status: string) => ({ id, status, reasons: [{ status, reason: "catalog" }], citation: null as string | null });

describe("approvals record", () => {
  it("parking relief is a required variance, never 'Not needed'", () => {
    const rec = buildApprovalsRecord({ zoningLoaded: true, district: "R1A-H", scheme: { ...base, approvals: [{ kind: "variance", rule: "parking_per_unit", label: "3 space(s) required, 1 workable" }] } });
    expect(rec.path).toBe("variance");
    expect(rec.needsVariance).toBe(true);
    expect(rec.items[0]!.name).toBe("Variance for parking");
    expect(rec.items[0]!.citation).toMatch(/§914\.02\.A/);
    expect(rec.answers.approval).toMatch(/variance for parking/);
    expect(rec.answers.fit).toMatch(/^Not without relief/);
    const out = reconcileRequirements([req("variance", "NOT_NEEDED"), req("parking", "REQUIRED"), req("zoning_approval", "REQUIRED")], rec);
    expect(out.find((r) => r.id === "variance")!.status).toBe("REQUIRED");
    expect(out.find((r) => r.id === "variance")!.reasons[0]!.reason).toMatch(/parking/);
    expect(out.find((r) => r.id === "zoning_approval")!.status).toBe("REQUIRED");
  });

  it("by right: no approvals, variance not needed", () => {
    const rec = buildApprovalsRecord({ zoningLoaded: true, district: "R1D-M", scheme: { ...base, typologyLabel: "Single-family home", units: 1, byRight: true, permission: { code: "P", use: "Single-family home" } } });
    expect(rec.byRight).toBe(true);
    expect(rec.path).toBe("by_right");
    expect(rec.answers.use).toBe("Yes. Single-family home is allowed by right under R1D-M zoning.");
    expect(rec.answers.fit).toMatch(/^Yes\. The studied layout \(one single-family home\) fits/);
    expect(rec.answers.approval).toMatch(/^None for zoning/);
    const out = reconcileRequirements([req("variance", "LIKELY"), req("special_exception", "REQUIRED")], rec);
    expect(out.map((r) => r.status)).toEqual(["NOT_NEEDED", "NOT_NEEDED"]);
  });

  it("special exception use plus setback variance", () => {
    const rec = buildApprovalsRecord({ zoningLoaded: true, district: "R2-L", rulesCitation: "§903.03.C", scheme: { ...base, permission: { code: "S", use: "Three-unit building" }, approvals: [{ kind: "use", rule: "use", label: "x" }, { kind: "variance", rule: "front_setback", label: "front setback 25 ft → 10 ft" }] } });
    expect(rec.items.map((i) => i.type)).toEqual(["special_exception", "variance"]);
    expect(rec.path).toBe("variance");
    expect(rec.answers.use).toMatch(/^Only with a special exception/);
    expect(rec.answers.approval).toBe("A special exception for the use and a variance for setbacks, decided at a Zoning Board of Adjustment hearing.");
    const out = reconcileRequirements([req("special_exception", "NOT_NEEDED"), req("variance", "NOT_NEEDED")], rec);
    expect(out.map((r) => r.status)).toEqual(["REQUIRED", "REQUIRED"]);
  });

  it("zoning not loaded: says so, leaves the checklist alone", () => {
    const rec = buildApprovalsRecord({ zoningLoaded: false, municipality: "Wilkinsburg", scheme: base });
    expect(rec.path).toBe("unknown");
    expect(rec.answers.use).toBe("Not known: zoning rules for Wilkinsburg are not in our data.");
    const r = [req("variance", "POSSIBLE")];
    expect(reconcileRequirements(r, rec)).toBe(r);
  });
});

describe("count grammar", () => {
  it("one townhouse, not 'a row of 1 townhouses'", () => {
    expect(schemePhrase("Townhouse row", 1)).toBe("one townhouse");
    expect(schemePhrase("Townhouse row", 3)).toBe("a row of 3 townhouses");
    expect(countNoun(1, "home")).toBe("one home");
    expect(countNoun(2, "home")).toBe("2 homes");
    expect(schemePhrase("Single-family home", 1)).toBe("one single-family home");
  });
});
