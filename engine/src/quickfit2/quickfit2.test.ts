// QuickFit v2 checks in the engine test run:
//  1. the module's own suite (test/run.ts, unchanged): synthetic lots, determinism, speed, Parks = not allowed;
//  2. the 15 exported public-lot fixtures (test fixtures/quickfit2) through the app's input adapter (app.ts):
//     property checks, determinism, speed, and the score / pro forma adapters.
import { describe, expect, it, vi } from "vitest";
import { solveAll } from "./app";
import type { Pt, Ring, Scheme } from "./src/types";
import { DEFAULT_CONTROLS, scoreFits, solveApp, steppingOf, toParcelInput, toV1Scheme, unknownUses, type AppSources } from "./app";
import type { QuickFitRules } from "../quickfit/types";

// Vite's import.meta.glob (no @types/node needed).
const files = (import.meta as unknown as { glob: (p: string, o: { eager: true; import: "default" }) => Record<string, Fixture> })
  .glob("../../test/fixtures/quickfit2/*.json", { eager: true, import: "default" });

interface Fixture {
  parcelId: string; district: string; parcel: { polygon: Ring };
  edges: { i: number; len: number; az: number; street_ft: number | null }[]; frontEdges: number[]; streetSideEdges: number[];
  existingBuildings: { footprint: Ring }[];
  hazards: { floodway: Ring[][]; landslideProne: Ring[][] };
  terrain: { gridFt: number; origin: Pt; cols: number; rows: number; elevFtNAVD88: (number | null)[] } | null;
  zoning: { district: string; uses: Record<string, string | null>; minLotSqft: number | null; lotAreaPerUnitSqft: number | null;
    setbacksFt: { front: number | null; rear: number | null; side: number | null; streetSide: number | null };
    maxHeightFt: number | null; maxStories: number | null; parkingPerUnit: number | null; contextualFront: boolean | null; codeSections?: { citation?: string } };
}

function sourcesOf(f: Fixture): AppSources {
  const z = f.zoning;
  const rules = {
    district_name: z.district, single_unit_detached: z.uses.single_detached, two_unit: z.uses.two_unit, three_unit: z.uses.three_unit, multi_unit: z.uses.multi_unit,
    min_lot_area_sqft: z.minLotSqft, min_lot_area_per_unit_sqft: z.lotAreaPerUnitSqft, min_front_setback_ft: z.setbacksFt.front, min_rear_setback_ft: z.setbacksFt.rear,
    min_side_setback_ft: z.setbacksFt.side, exterior_side_setback_ft: z.setbacksFt.streetSide, max_height_ft: z.maxHeightFt, max_height_stories: z.maxStories,
    parking_per_unit: z.parkingPerUnit, contextual_front_setback: z.contextualFront, citation: z.codeSections?.citation ?? null, confidence: "confirmed",
  } as unknown as QuickFitRules;
  const t = f.terrain;
  return {
    parid: f.parcelId, zoneCode: z.district, rules,
    qf: { parcel: f.parcel.polygon, edges: f.edges, frontEdges: f.frontEdges, streetSideEdges: f.streetSideEdges,
      masks: (f.hazards.floodway ?? []).map((p) => ({ label: "FEMA floodway", mode: "cut" as const, polygon: p })) },
    terrain: t ? { x0: t.origin[0], y0: t.origin[1], step: t.gridFt, nx: t.cols, ny: t.rows, z: t.elevFtNAVD88 } : null,
    existing: f.existingBuildings.map((b) => b.footprint),
  };
}

function inside(p: Pt, r: Ring) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

describe("QuickFit v2 module suite (test/run.ts)", () => {
  it("passes every check", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    try { await import("./test/run"); } finally { spy.mockRestore(); }
    expect(lines.filter((l) => l.includes("FAIL"))).toEqual([]);
    expect(lines.some((l) => l.includes("ALL CHECKS PASSED"))).toBe(true);
    // Module 1.0.0 adds a regression check: setbacks that consume the whole lot must return quickly.
    expect(lines.some((l) => l.includes("REGRESSION OK"))).toBe(true);
  });
});

const fixtures = Object.values(files);

describe("QuickFit v2 on the 15 exported public lots", () => {
  it("has the fixtures", () => expect(fixtures.length).toBe(15));

  for (const f of fixtures) {
    it(`${f.parcelId} (${f.district})`, () => {
      const src = sourcesOf(f);
      const input = toParcelInput(src)!;
      expect(input).not.toBeNull();
      const t0 = performance.now();
      const all = solveAll(input);
      expect(performance.now() - t0).toBeLessThan(1500);
      const unknown = unknownUses(src);
      for (const s of all.results) {
        const app = solveApp(input, DEFAULT_CONTROLS(s.typology), unknown);
        expect(app.status).toBe(s.status);
        if (!s.footprintWorld) continue;
        // footprint corners inside the lot (within the 1-ft raster: corners are tested 1.5 ft in)
        const cx = s.footprintWorld.reduce((a, p) => a + p[0], 0) / 4, cy = s.footprintWorld.reduce((a, p) => a + p[1], 0) / 4;
        for (const p of s.footprintWorld) { const d = Math.hypot(p[0] - cx, p[1] - cy) || 1; expect(inside([p[0] + ((cx - p[0]) / d) * 1.5, p[1] + ((cy - p[1]) / d) * 1.5], input.parcel)).toBe(true); }
        // stories within the limit unless a height approval is listed
        expect(s.stories <= input.zoning.maxStories || s.approvalsNeeded.some((a) => a.rule === "height")).toBe(true);
        // parking: short of the minimum only with a parking approval
        expect(s.parking.count >= s.parking.required || s.approvalsNeeded.some((a) => a.rule === "parking")).toBe(true);
        // adapters
        const v1 = toV1Scheme(s, input)!;
        expect(v1.units).toBe(s.units.length);
        expect(v1.footprints.length).toBeGreaterThanOrEqual(1);
        expect(v1.netFloorAreaSf).toBe(s.netSqft);
        const st = steppingOf(s);
        expect(st.steps).toBeGreaterThanOrEqual(0);
      }
      // determinism
      const again = solveAll(toParcelInput(src)!);
      expect(JSON.stringify(again.results.map((x: Scheme) => [x.status, x.widthFt, x.depthFt, x.units.length, x.stories])))
        .toBe(JSON.stringify(all.results.map((x: Scheme) => [x.status, x.widthFt, x.depthFt, x.units.length, x.stories])));
      // Parks district: multi-unit not allowed
      if (f.district === "P") expect(all.results.find((x) => x.typology === "three_four")!.status).toBe("not_allowed");
      // score fits for every new-build strategy
      const fits = scoreFits(src, { contextualFrontFt: 5, probeSetbacksFt: { front: 5, rear: 5, side: 3 } });
      expect(Object.keys(fits.fits).sort()).toEqual(["duplex", "new_sf", "three_four_unit", "townhouse_row"]);
      for (const [k, fit] of Object.entries(fits.fits)) if (fit.status !== "no_fit") expect(fits.schemes[k]?.id).toBe(fit.schemeId);
    });
  }
});
