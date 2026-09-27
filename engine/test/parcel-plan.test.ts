// The Feasibility Study prices the same building as the parcel page for the same URL: the page's query
// becomes the report query (reportQueryFor), the report reads it back (pageStrategyFromReport /
// pageQueryFromReport) and both run lib/parcel-plan.ts on the same stored pane. Fixture: the public URA lot
// 0011A00151000000 (stored parcel_pane row + lot geometry).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromStored, type StoredPane } from "../../web/src/lib/pane-core";
import { pageQueryFromReport, pageStrategyFromReport, parcelPlan, planNeedsLot, reportQueryFor } from "../../web/src/lib/parcel-plan";
import { metricsOf } from "../../web/src/lib/quickfit-gen";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "pane-ura-0011A00151000000.json"), "utf8")) as { pane: StoredPane; qf: never };
const P = fromStored(FX.pane);
type SP = Record<string, string>;

function both(pageSp: SP, strategy: Parameters<typeof reportQueryFor>[1]) {
  const page = parcelPlan({ P, sp: pageSp, overrides: {}, strategy, qf: planNeedsLot(pageSp, strategy) ? FX.qf : null });
  const rsp = Object.fromEntries(new URLSearchParams(reportQueryFor(pageSp, strategy))) as SP;
  const rStrategy = pageStrategyFromReport(rsp);
  const report = parcelPlan({ P, sp: pageQueryFromReport(rsp), overrides: {}, strategy: rStrategy, qf: FX.qf });
  return { page, report, rStrategy };
}

describe("report pricing = page pricing (URA fixture)", () => {
  it("the page's default option: same scheme, stepping, budget lines, ranges and metrics", () => {
    for (const st of ["three_four_unit", "new_sf", "townhouse_row"] as const) {
      const { page, report, rStrategy } = both({ strategy: st }, st);
      expect(rStrategy).toBe(st);
      expect(page.pf, st).not.toBeNull();
      expect(report.scheme?.id).toBe(page.scheme?.id);
      expect(JSON.stringify(report.stepping)).toBe(JSON.stringify(page.stepping));
      expect(JSON.stringify(report.pf!.budget)).toBe(JSON.stringify(page.pf!.budget));
      expect(JSON.stringify(report.pf!.ranges)).toBe(JSON.stringify(page.pf!.ranges));
      expect(metricsOf(report.selected!, report.pf)).toEqual(metricsOf(page.selected!, page.pf));
    }
  });

  it("map controls (qf_*) in the URL: the report re-generates the same scheme, including hillside stepping", () => {
    const sp: SP = { strategy: "duplex", qf: "duplex", qf_st: "2", qf_pk: "none", qf_s: "5" };
    const { page, report } = both(sp, "duplex");
    expect(page.urlControls).not.toBeNull();
    expect(page.scheme).not.toBeNull();
    expect(report.scheme?.id).toBe(page.scheme?.id);
    expect(JSON.stringify(report.scheme?.footprints)).toBe(JSON.stringify(page.scheme?.footprints));
    expect(page.stepping?.applies).toBe(true);
    expect(page.pf!.plan.stepping).not.toBeNull();
    expect(JSON.stringify(report.pf!.plan.lines)).toBe(JSON.stringify(page.pf!.plan.lines));
    expect(JSON.stringify(report.pf!.ranges)).toBe(JSON.stringify(page.pf!.ranges));
  });

  it("the report query carries the page option even where the report has no strategy name for it", () => {
    const rsp = Object.fromEntries(new URLSearchParams(reportQueryFor({ strategy: "three_four_unit", pf_tier: "good" }, "three_four_unit")));
    expect(rsp.sel).toBe("three_four_unit");
    expect(rsp.strategy).toBeUndefined();
    expect(rsp.pf_tier).toBe("good");
    expect(pageQueryFromReport(rsp).strategy).toBe("three_four_unit");
  });
});
