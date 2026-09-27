import { solveAll, solve } from "../src/index";
import { FIXTURES } from "./fixtures";
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log("  FAIL:", m); } };
for (const f of FIXTURES) {
  const r = solveAll(f.input);
  console.log(`\n${f.name}  (all types ${r.ms} ms)`);
  for (const s of r.ordered) {
    console.log(`  ${s.typologyLabel.padEnd(24)} ${s.status.padEnd(17)} homes ${String(s.units.length).padEnd(2)} ${s.widthFt}×${s.depthFt}×${s.stories}st gross ${s.grossSqft} park ${s.parking.count}/${s.parking.required}${s.ground && s.ground.steps.length > 1 ? " steps " + s.ground.steps.length : ""} | ${s.bindingConstraint?.sentence ?? ""} ${s.unlock?.sentence ?? ""}`);
    if (s.approvalsNeeded.length) console.log("      approvals: " + s.approvalsNeeded.map(a => a.detail).join(" | "));
    if (s.site) { console.log(`      parking: ${s.site.parking.type} ${s.site.parking.count}  segs ${s.site.segments.length}  openings ${s.site.openings.length}  | ${s.site.parking.notes.join(" ")}`);
      // coherence tests: every drive touches the curb (y<=0) and reaches a garage/stall
      for (const d of s.site.parking.drives) { ok(d.y <= -4.9, s.typology + " drive starts at curb"); ok(s.site.parking.stalls.some((st: any) => Math.abs(d.y + d.d - st.y) < 3 || (st.y <= d.y + d.d + 3 && st.y >= d.y)), s.typology + " drive reaches parking"); }
      // no window on a party wall: for rows, windows only on front/rear
      if (s.typology === "townhouse_row") ok(s.site.openings.every((o: any) => o.face === "front" || o.face === "rear"), "row windows only front/rear");
      // windows stay >= 2 ft clear of unit boundaries on front
      const bounds = s.typology === "townhouse_row" ? s.site.segments.flatMap((g: any) => [g.x0, g.x1]) : [];
      for (const o of s.site.openings.filter((o: any) => o.kind === "window" && o.face === "front")) ok(bounds.every((b: number) => o.x + o.w <= b - 1.9 || o.x >= b + 1.9), "window clear of party wall");
    }
    // property tests
    if (s.footprintLocal) {
      const d: any = (s as any).debug; ok(s.stories <= f.input.zoning.maxStories || s.approvalsNeeded.some(a => a.rule === "height"), s.typology + " stories");
      ok(s.solveMs < 80, s.typology + " speed " + s.solveMs);
    }
  }
  const again = solveAll(f.input); ok(JSON.stringify(again.results.map(x => [x.status, x.widthFt, x.depthFt, x.units.length])) === JSON.stringify(r.results.map(x => [x.status, x.widthFt, x.depthFt, x.units.length])), "deterministic");
  ok(r.ms < 400, "solveAll speed " + r.ms);
}
const parks = solve(FIXTURES.find(f => f.input.parcelId === "T-PARKS")!.input, { typology: "three_four" });
ok(parks.status === "not_allowed", "Parks multi-unit must be not_allowed");
console.log(`\n${fails ? fails + " FAILED" : "ALL CHECKS PASSED"}`);
// regression: setbacks that consume the whole lot must return "does_not_fit" quickly (no infinite loop)
{ const tiny = { ...FIXTURES[0].input, parcelId: "T-NOROOM", zoning: { ...FIXTURES[0].input.zoning, setbacksFt: { front: 80, rear: 80, side: 30, streetSide: 30 } } };
  const t0 = Date.now(); const r = solveAll(tiny); ok(Date.now() - t0 < 2000, "no-room lot solves fast"); ok(r.results.every(s => s.status === "does_not_fit" || s.status === "not_allowed"), "no-room lot: nothing fits");
  console.log(`No-room lot: ${r.results.map(s => s.status).join(", ")} in ${Date.now() - t0} ms`); }
console.log(fails ? `${fails} FAILED (incl. regression)` : "REGRESSION OK");
