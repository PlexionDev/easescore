import type { ParcelInput, Controls, Scheme, Typology, UnitTemplate, Approval, Constraint, Box, Use, Pt, Ring, EdgeKind } from "./types";
import { classify, buildable, Raster, area, multiArea, pointInRing } from "./geom";
import { planParking, planSegments, foundation, facade } from "./site";

export const SOLVER_VERSION = "quickfit-2.0.0";
export const DEFAULT_TEMPLATE: UnitTemplate = { floorToFloorFt: 10, roofFt: 5, minWidth: 14, maxWidth: 40, minDepth: 24, maxDepth: 60, plateMin: 700, plateMax: 1400, rowUnitMin: 14, rowUnitMax: 24, coreSqft: 200, efficiency: 0.85, garageSqftPerSpace: 250, aduMaxSqft: 800, aduSeparationFt: 10 };
const LABEL: Record<Typology, string> = { single_detached: "Single-family house", two_unit: "Duplex", three_four: "3–4 unit building", townhouse_row: "Townhouse row", adu: "Backyard cottage (ADU)" };
const COLORS = { u1: "#b9dccd", u2: "#8cc3ad", u3: "#6aa98f", core: "#c9c3b8", parking: "#9aa3a0", foundation: "#b9a58a", roof: "#8a8f8c" };
const USE_KEY: Record<Typology, keyof ParcelInput["zoning"]["uses"]> = { single_detached: "single_detached", two_unit: "two_unit", three_four: "three_unit", townhouse_row: "single_attached", adu: "adu" };
const PARK_KEY: Record<Typology, keyof ParcelInput["zoning"]["parkingPerUnit"]> = { single_detached: "single_detached", two_unit: "two_unit", three_four: "multi_unit", townhouse_row: "single_attached", adu: "single_detached" };
const RULE_WORDS: Record<string, string> = { front: "front setback", rear: "rear setback", side: "side setback", streetSide: "street-side setback", "lot line": "lot line", floodway: "floodway" };

interface Cand { x: number; y: number; w: number; d: number; stories: number; units: number; plate: number; layout: string; rowN?: number; rowUnitW?: number }

function useApproval(u: Use, what: string, code?: string): Approval | null {
  if (u === "S") return { kind: "special_exception", rule: "use", detail: `${what} needs a special exception here`, code };
  if (u === "C") return { kind: "conditional_use", rule: "use", detail: `${what} needs conditional use approval here`, code };
  return null;
}

function storiesAllowed(input: ParcelInput, t: UnitTemplate) {
  const z = input.zoning; const byHeight = Math.floor((z.maxHeightFt - t.roofFt) / t.floorToFloorFt);
  return Math.max(1, Math.min(z.maxStories, byHeight));
}

function searchRect(R: Raster, wMin: number, wMax: number, dMin: number, dMax: number, cap: number, fixedW?: number | null, fixedD?: number | null) {
  // footprint aligned to the frame; hug the front setback line, prefer centered on the buildable width
  const [xa, xb] = R.xRange; const cx = (xa + xb) / 2; const y0 = R.ymin;
  if (!isFinite(y0) || !isFinite(xa) || !isFinite(xb)) return null; // setbacks leave no buildable area
  let best: { x: number; y: number; w: number; d: number } | null = null; let bestA = -1;
  const ws: number[] = []; if (fixedW) ws.push(Math.round(fixedW)); else for (let w = wMin; w <= wMax; w += (w >= 30 ? 2 : 1)) ws.push(w);
  const ds: number[] = []; if (fixedD) ds.push(Math.round(fixedD)); else for (let d = dMin; d <= dMax; d += 2) ds.push(d);
  for (const w of ws) for (const d of ds) {
    const a0 = w * d; if (a0 > cap && !fixedD) continue; const ratio = d / w; const a = a0 * (ratio > 2.6 ? 1 - 0.12 * (ratio - 2.6) : 1) * (ratio < 0.8 ? 0.9 : 1); if (a <= bestA) continue;
    let found: { x: number; y: number } | null = null;
    for (let y = Math.floor(y0); y <= y0 + 30 && !found; y++) {
      const xc = Math.round(cx - w / 2);
      for (let off = 0; off <= Math.ceil(xb - xa); off++) {
        for (const x of off ? [xc - off, xc + off] : [xc]) if (R.fits(x, y, w, d)) { found = { x, y }; break; }
        if (found) break;
      }
    }
    if (found) { best = { ...found, w, d }; bestA = a; }
  }
  return best;
}

function ground(input: ParcelInput, toWorld: (p: Pt) => Pt, c: { x: number; y: number; w: number; d: number }) {
  if (!input.terrain) return null;
  const E = (x: number, y: number) => input.terrain!.elevAt(...(toWorld([x, y]) as [number, number]));
  const pts: { x: number; y: number; z: number }[] = [];
  for (let y = c.y; y <= c.y + c.d + 1e-6; y += 3) for (let x = c.x; x <= c.x + c.w + 1e-6; x += 3) pts.push({ x, y, z: E(x, y) });
  const n = pts.length; const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n, mz = pts.reduce((s, p) => s + p.z, 0) / n;
  let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0; for (const p of pts) { const dx = p.x - mx, dy = p.y - my, dz = p.z - mz; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz; }
  const det = sxx * syy - sxy * sxy || 1; const gx = (sxz * syy - syz * sxy) / det, gy = (syz * sxx - sxz * sxy) / det;
  const slopePct = Math.hypot(gx, gy) * 100;
  // local steepness share over 40%
  let steep = 0; for (const p of pts) { const g = Math.hypot(E(p.x + 1.5, p.y) - E(p.x - 1.5, p.y), E(p.x, p.y + 1.5) - E(p.x, p.y - 1.5)) / 3; if (g > 0.4) steep++; }
  // stepping along the local depth axis
  const steps: { y0: number; y1: number; elevFt: number }[] = [];
  const along = Math.abs(gy) >= Math.abs(gx);
  if (slopePct > 15 && along) {
    const drop = Math.abs(gy) * c.d; const nPlates = Math.max(1, Math.min(Math.floor(c.d / 10), Math.floor(drop / 2.5) + 1));
    const seg = c.d / nPlates;
    for (let k = 0; k < nPlates; k++) { const y0 = c.y + k * seg, y1 = y0 + seg; let s = 0, m = 0; for (let x = c.x; x <= c.x + c.w; x += 3) for (let y = y0; y <= y1; y += 3) { s += E(x, y); m++; } steps.push({ y0, y1, elevFt: Math.round((s / m) * 2) / 2 }); }
  } else steps.push({ y0: c.y, y1: c.y + c.d, elevFt: Math.round(mz * 2) / 2 });
  // foundation wall exposure and retaining along the perimeter
  const plateAt = (y: number) => (steps.find(s => y >= s.y0 - 1e-6 && y <= s.y1 + 1e-6) ?? steps[steps.length - 1]).elevFt;
  let wall = 0, retLen = 0, retMax = 0;
  const per: Pt[] = []; for (let x = c.x; x < c.x + c.w; x += 3) { per.push([x, c.y]); per.push([x, c.y + c.d]); } for (let y = c.y; y < c.y + c.d; y += 3) { per.push([c.x, y]); per.push([c.x + c.w, y]); }
  for (const p of per) { const g = E(p[0], p[1]); const pl = plateAt(p[1]); wall += (Math.abs(pl - g) + 1) * 3; const cut = g - pl; if (cut > 4) { retLen += 3; retMax = Math.max(retMax, cut); } }
  for (let k = 1; k < steps.length; k++) wall += Math.abs(steps[k].elevFt - steps[k - 1].elevFt) * c.w;
  return { avgGradeFt: Math.round(mz * 10) / 10, slopePct: Math.round(slopePct * 10) / 10, steps, foundationWallSqft: Math.round(wall), retainingWall: { lengthFt: retLen, maxHeightFt: Math.round(retMax * 10) / 10 }, steepShare: Math.round((steep / n) * 100) / 100 };
}

function candidateFor(typology: Typology, R: Raster, input: ParcelInput, t: UnitTemplate, stories: number, ctl: Controls, lotSqft: number): Cand | null {
  const fixedW = ctl.unitWidthFt ?? null; const fixedD = ctl.depthFt ?? null;
  if (typology === "single_detached") {
    const r = searchRect(R, t.minWidth, t.maxWidth, t.minDepth, t.maxDepth, Math.min(1100, 3300 / stories), fixedW, fixedD); return r && { ...r, stories, units: 1, plate: r.w * r.d, layout: "house" };
  }
  if (typology === "two_unit") {
    if (stories >= 2) { const r = searchRect(R, t.minWidth, t.maxWidth, t.minDepth, t.maxDepth, t.plateMax, fixedW, fixedD); if (r && r.w * r.d >= t.plateMin) return { ...r, stories, units: 2, plate: r.w * r.d, layout: "stacked (one home per floor group)" }; }
    for (let uw = t.rowUnitMax; uw >= t.rowUnitMin; uw--) { const r = searchRect(R, 2 * uw, 2 * uw, t.minDepth, 50, 2 * t.plateMax, null, fixedD); if (r) return { ...r, stories, units: 2, plate: r.w * r.d, layout: "side by side" }; }
    return null;
  }
  if (typology === "three_four") {
    const r = searchRect(R, t.minWidth, 60, t.minDepth, 70, 2 * t.plateMax + t.coreSqft, fixedW, fixedD); if (!r) return null;
    const plate = r.w * r.d - t.coreSqft; const perFloor = plate >= 2 * t.plateMin ? 2 : plate >= t.plateMin ? 1 : 0; if (!perFloor) return null;
    const maxU = input.zoning.uses.multi_unit === "N" ? 3 : 4;
    const units = Math.min(maxU, perFloor * stories); if (units < 3) return { ...r, stories, units, plate, layout: `${perFloor} per floor` };
    return { ...r, stories, units, plate, layout: `${perFloor} per floor` };
  }
  if (typology === "townhouse_row") {
    const [xa, xb] = R.xRange; if (!isFinite(xa) || !isFinite(xb)) return null; const maxW = xb - xa;
    const minRow = (input.zoning.parkingPerUnit.single_attached ?? 0) > 0 ? Math.max(t.rowUnitMin, 16) : t.rowUnitMin; const uws: number[] = fixedW ? [Math.round(fixedW)] : Array.from({ length: t.rowUnitMax - minRow + 1 }, (_, k) => t.rowUnitMax - k);
    for (let n = Math.floor(maxW / Math.min(...uws)); n >= 1; n--) for (const uw of uws.filter(u => n * u <= maxW).slice(0, 1).concat(uws.filter(u => n * u <= maxW).slice(1))) {
      if (n * uw > maxW) continue; const r = searchRect(R, n * uw, n * uw, 30, 50, 1e9, null, fixedD);
      if (r) return { ...r, stories, units: n, plate: uw * r.d, layout: n === 1 ? `attached house, ${uw} ft wide` : `${n} attached homes, ${uw} ft wide`, rowN: n, rowUnitW: uw };
    }
    return null;
  }
  return null;
}

export function solve(input: ParcelInput, ctl: Controls): Scheme {
  const t0 = (globalThis.performance ?? Date).now();
  const t: UnitTemplate = { ...DEFAULT_TEMPLATE, ...(ctl.unitTemplate ?? {}) };
  // Party walls on the lot's own side lines only for single narrow infill lots (attaching to neighbors' walls);
  // a row built on a wider lot keeps the side setbacks at its end units and uses party walls between its own units.
  const pre = classify(input, ctl);
  const partyWall = ctl.typology === "townhouse_row" && input.zoning.setbacksFt.sideAttachedPartyWall != null && ctl.setbackOverridesFt?.side == null && pre.frontageFt <= 30;
  const cls = partyWall ? classify(input, { ...ctl, setbackOverridesFt: { ...(ctl.setbackOverridesFt ?? {}), side: input.zoning.setbacksFt.sideAttachedPartyWall! } }) : pre;
  if (partyWall) cls.flags.push("Narrow infill lot: side walls attach to neighbors as party walls (0 ft side setback).");
  const cutsWorld = input.floodway ?? [];
  const cutsLocal: Ring[] = cutsWorld.map(r => r.map(cls.toLocal));
  const { buildable: B, strips } = buildable(cls.localRing, cls.edges, cutsLocal);
  const R = new Raster(B, cls.localRing, strips, cutsLocal.map(r => ({ label: "floodway", ring: r })));
  const lotSqft = Math.abs(area(cls.localRing));
  const z = input.zoning; const typology = ctl.typology; const flags = [...cls.flags];
  const approvals: Approval[] = []; const constraints: Constraint[] = [];
  const sec = z.codeSections ?? {};
  const zbaFor = (k: string) => input.zbaStats?.[k] ?? null;

  // 1. use permission
  let useCode: Use = z.uses[USE_KEY[typology]];
  const base = (status: Scheme["status"], sentence: string): Scheme => ({
    parcelId: input.parcelId, typology, typologyLabel: LABEL[typology], status, statusSentence: sentence, approvalsNeeded: approvals, bindingConstraint: null, unlock: null,
    units: [], footprintLocal: null, footprintWorld: null, widthFt: 0, depthFt: 0, stories: 0, grossSqft: 0, netSqft: 0, heightFt: 0,
    parking: { count: 0, type: "none", required: 0 }, lotSqft: Math.round(lotSqft), lotCoverage: 0, subdivisionNeeded: false, frontageFt: Math.round(cls.frontageFt),
    ground: null, flags, constraints, whatIfs: ctl.setbackOverridesFt, solveMs: 0, solverVersion: SOLVER_VERSION, massing: [], frame: cls.frame });
  if (useCode === "N") { const s = base("not_allowed", `${LABEL[typology]}s aren't allowed in ${z.district}. It would need a rezoning or a use variance.`); s.approvalsNeeded = [{ kind: "use_variance_or_rezoning", rule: "use", detail: `${LABEL[typology]} not permitted in ${z.district}`, code: sec.uses, zba: zbaFor("use_variance") }]; s.solveMs = (globalThis.performance ?? Date).now() - t0; return s; }
  if (ctl.goal === "by_right_only" && useCode !== "P") { const s = base("needs_approval", `${LABEL[typology]} needs zoning approval here, so it's hidden in by-right mode.`); return s; }
  const ua = useApproval(useCode, LABEL[typology], sec.uses); if (ua) approvals.push(ua);

  // 2. stories
  const maxSt = storiesAllowed(input, t); let stories = ctl.stories ?? (typology === "three_four" ? maxSt : Math.min(maxSt, 3));
  if (typology === "adu") stories = Math.min(stories, 2);
  if (stories > maxSt) approvals.push({ kind: "dimensional_variance", rule: "height", detail: `${stories} stories is above the ${maxSt}-story limit (${z.maxHeightFt} ft max height)`, code: sec.height, zba: zbaFor("dimensional_variance") });
  for (const k of Object.keys(ctl.setbackOverridesFt ?? {}).filter(k => !(partyWall && k === "side")) as EdgeKind[]) {
    const code = k === "front" ? z.setbacksFt.front : k === "rear" ? z.setbacksFt.rear : k === "streetSide" ? z.setbacksFt.streetSide : z.setbacksFt.side;
    const v = ctl.setbackOverridesFt![k]!; if (v < code) approvals.push({ kind: "dimensional_variance", rule: k, detail: `${RULE_WORDS[k]} ${code} ft → ${v} ft`, code: sec.setbacks, zba: zbaFor("dimensional_variance") });
  }

  // 3. geometry
  let cand: Cand | null = null; let aduMain: { x: number; y: number; w: number; d: number } | null = null;
  if (typology === "adu") {
    const main = input.existingBuildings?.[0]; let mainY1: number;
    if (main) { const ys = main.footprint.map(cls.toLocal).map(p => p[1]); mainY1 = Math.max(...ys); }
    else { const m = candidateFor("single_detached", R, input, t, Math.min(2, maxSt), { typology: "single_detached" }, lotSqft); if (!m) { const s = base("does_not_fit", "No room for a main house plus a backyard cottage."); return s; } aduMain = m; mainY1 = m.y + m.d; flags.push("No house on record; the cottage is placed behind a new single-family house."); }
    const cap = Math.min(t.aduMaxSqft, z.aduMaxSqft ?? t.aduMaxSqft) / stories;
    let best: Cand | null = null;
    for (let w = 16; w <= 30; w++) for (let d = 16; d <= 30; d += 2) { if (w * d > cap) continue; for (let y = Math.ceil(mainY1 + t.aduSeparationFt); y < R.y0 + R.H; y++) { const [xa, xb] = R.xRange; if (!isFinite(xa)) break; for (let x = Math.floor(xa); x + w <= xb; x++) if (R.fits(x, y, w, d)) { if (!best || w * d > best.w * best.d) best = { x, y, w, d, stories, units: 1, plate: w * d, layout: "detached rear cottage" }; x = 1e9; y = 1e9; } } }
    cand = best;
  } else cand = candidateFor(typology, R, input, t, stories, ctl, lotSqft);

  if (!cand) {
    const s = base("does_not_fit", `A ${LABEL[typology].toLowerCase()} doesn't fit inside the setbacks on this lot.`);
    // explain: largest rectangle that fits at all, and what blocks
    const any = searchRect(R, 8, 60, 8, 80, 1e9, null);
    s.bindingConstraint = { rule: "size", sentence: any ? `The largest footprint that fits is about ${any.w} × ${any.d} ft; too small for this building type.` : "After setbacks, no buildable area is left." };
    s.solveMs = (globalThis.performance ?? Date).now() - t0; return s;
  }
  if (typology === "three_four" && cand.units < 3) { const s = base("does_not_fit", `Only ${cand.units} home(s) fit at ${stories} stories; a 3–4 unit building needs more floor area or height.`); s.solveMs = (globalThis.performance ?? Date).now() - t0; return s; }
  if (typology === "three_four") { const k = cand.units >= 4 ? "multi_unit" : "three_unit"; const u2 = z.uses[k]; if (u2 === "N") { const s = base("not_allowed", `${cand.units} homes on one lot aren't allowed in ${z.district}.`); s.approvalsNeeded = [{ kind: "use_variance_or_rezoning", rule: "use", detail: `${cand.units}-unit building not permitted`, code: sec.uses }]; return s; } if (u2 !== useCode) { useCode = u2; approvals.splice(0, approvals.length, ...approvals.filter(a => a.rule !== "use")); const a2 = useApproval(u2, `A ${cand.units}-unit building`, sec.uses); if (a2) approvals.unshift(a2); } }

  // 4. lot-size and density checks
  const units = cand.units + (typology === "adu" ? 0 : 0);
  const totalHomes = typology === "adu" ? 1 + 1 : units;
  if (lotSqft < z.minLotSqft) { constraints.push({ rule: "lotSize", label: "minimum lot size", slack: lotSqft - z.minLotSqft, unit: "sq ft", blocking: true, code: sec.lotSize }); approvals.push({ kind: "dimensional_variance", rule: "lotSize", detail: `lot is ${Math.round(lotSqft)} sq ft; district minimum is ${z.minLotSqft}`, code: sec.lotSize, zba: zbaFor("dimensional_variance") }); flags.push("Lot is smaller than today's minimum. Lots of record may still be buildable; confirm with Zoning."); }
  let subdivisionNeeded = false;
  if (typology === "townhouse_row") { subdivisionNeeded = true; const per = lotSqft / units; const need = z.minLotSqftAttachedPerUnit ?? z.minLotSqft; if (per < need) approvals.push({ kind: "dimensional_variance", rule: "lotSize", detail: `each home's lot would be about ${Math.round(per)} sq ft; minimum ${need}`, code: sec.lotSize, zba: zbaFor("dimensional_variance") }); }
  if (z.lotAreaPerUnitSqft && lotSqft / totalHomes < z.lotAreaPerUnitSqft) approvals.push({ kind: "dimensional_variance", rule: "density", detail: `${totalHomes} homes need ${z.lotAreaPerUnitSqft * totalHomes} sq ft of lot; lot has ${Math.round(lotSqft)}`, code: sec.lotSize, zba: zbaFor("dimensional_variance") });

  // 5. parking — only layouts a car can actually use
  const rate = z.parkingPerUnit[PARK_KEY[typology]] ?? 0; const required = Math.ceil(rate * (typology === "adu" ? 1 : units));
  const alley = cls.edges.some(e => e.kind === "rear" && e.alley);
  const Eloc = (x: number, y: number) => input.terrain ? input.terrain.elevAt(...(cls.toWorld([x, y]) as [number, number])) : 0;
  const lotDepthAt = (x: number) => { let yy = 0; for (let y = 0; y < R.y0 + R.H; y++) if (pointInRing([x, y + 0.5], cls.localRing)) yy = y + 1; return yy; };
  const pk = typology === "adu" ? { type: "none" as const, count: 0, stalls: [], drives: [], curbCuts: [], garages: [], notes: ["Cottage parking not modeled; many codes waive it for ADUs."] } : planParking({ typology, required, cand, R, E: Eloc, alleyRear: alley, stories, forced: ctl.parking, frontSetback: z.setbacksFt.front, lotDepthAt });
  const ptype = pk.type; const count = pk.count;
  flags.push(...pk.notes);
  if (count < required) approvals.push({ kind: "dimensional_variance", rule: "parking", detail: `${required} space(s) required, ${count} workable (parking reductions under the code may apply)`, code: sec.parking, zba: zbaFor("dimensional_variance") });

  // 6. areas
  const gross = typology === "townhouse_row" ? cand.w * cand.d * stories : cand.w * cand.d * stories;
  const garage = pk.garages.length * t.garageSqftPerSpace;
  const core = typology === "three_four" ? t.coreSqft * stories : 0;
  const net = Math.round((gross - garage - core) * t.efficiency);
  const heightFt = stories * t.floorToFloorFt + t.roofFt;
  const perUnit = Math.round(net / Math.max(1, units));
  const bedrooms = (sf: number) => sf < 650 ? 1 : sf < 1000 ? 2 : sf < 1500 ? 3 : 4;
  const unitList = Array.from({ length: units }, (_, k) => ({ id: `U${k + 1}`, bedrooms: bedrooms(perUnit), netSqft: perUnit, floor: typology === "three_four" ? Math.floor(k / Math.max(1, Math.round(units / stories))) + 1 : 1 }));

  // 7. binding constraint: grow width / depth / height and see what blocks
  const tries: { rule: string; gain: number; detail: string }[] = [];
  const bDepth = R.blockerOf(cand.x, cand.y + cand.d, cand.w, 2); if (bDepth) tries.push({ rule: bDepth, gain: cand.w * 2, detail: "depth" });
  const bL = R.blockerOf(cand.x - 2, cand.y, 2, cand.d), bR = R.blockerOf(cand.x + cand.w, cand.y, 2, cand.d); const bW = bL && bR ? (bL === bR ? bL : bL) : (bL ?? bR); if (bW) tries.push({ rule: bW, gain: cand.d * 2, detail: "width" });
  if (stories >= maxSt && !ctl.stories && typology === "three_four") tries.push({ rule: storiesAllowed(input, t) < z.maxStories ? "height" : "stories", gain: cand.w * cand.d, detail: "height" });
  for (const tr of tries) constraints.push({ rule: tr.rule, label: RULE_WORDS[tr.rule] ?? tr.rule, slack: 0, unit: "ft", blocking: true });
  let bindingConstraint: Scheme["bindingConstraint"] = null, unlock: Scheme["unlock"] = null;
  const spatial = tries.filter(x => x.detail !== "height");
  if (!spatial.length && typology !== "townhouse_row") { tries.length = 0; bindingConstraint = { rule: "none", sentence: `Zoning isn't what limits this ${LABEL[typology].toLowerCase()}: it's sized as a typical home and the lot has room to spare.` }; }
  const edgeRules = tries.filter(x => ["front", "rear", "side", "streetSide"].includes(x.rule));
  const pickRule = (tries.find(x => x.detail === "depth") ?? tries[0]);
  if (pickRule && !bindingConstraint) {
    const r = pickRule.rule;
    const sbv = r === "front" ? z.setbacksFt.front : r === "rear" ? z.setbacksFt.rear : r === "streetSide" ? z.setbacksFt.streetSide : r === "side" ? z.setbacksFt.side : null;
    const words = r === "height" ? `The ${z.maxHeightFt} ft height limit` : r === "stories" ? `The ${z.maxStories}-story limit` : sbv != null ? `The ${ctl.setbackOverridesFt?.[r as EdgeKind] ?? sbv} ft ${RULE_WORDS[r]}` : r === "lot line" ? "The lot's width" : `The ${RULE_WORDS[r] ?? r}`;
    bindingConstraint = { rule: r, sentence: `${words} is the limit on this ${LABEL[typology].toLowerCase()}.` };
    if (sbv != null && !(ctl.setbackOverridesFt && r in ctl.setbackOverridesFt) && (sbv as number) > 5 && !(globalThis as any).__qfNoUnlock) {
      (globalThis as any).__qfNoUnlock = true;
      try { const half = Math.round((sbv as number) / 2); const alt = solve(input, { ...ctl, setbackOverridesFt: { ...(ctl.setbackOverridesFt ?? {}), [r]: half } });
        const dU = alt.units.length - units, dA = alt.grossSqft - gross;
        if (dU > 0 || dA > 0) unlock = { rule: r, sentence: `Cutting the ${RULE_WORDS[r]} to ${half} ft would add ${[dU > 0 ? `${dU} home${dU > 1 ? "s" : ""}` : "", dA > 0 ? `about ${Math.round(dA / 50) * 50} sq ft` : ""].filter(Boolean).join(" and ")} (needs a variance).` };
      } finally { (globalThis as any).__qfNoUnlock = false; }
    }
  }

  // 8. ground: level floors, slope taken in the foundation; massing + facade
  const gStats = ground(input, cls.toWorld, cand);
  const segs = planSegments({ typology, cand, E: Eloc, floorToFloor: t.floorToFloorFt, streetFirst: true, streetGrade: (pk as any).streetGrade ?? null });
  const fnd = foundation(segs, Eloc);
  const g = gStats ? { avgGradeFt: gStats.avgGradeFt, slopePct: gStats.slopePct, steps: segs.map(sg => ({ y0: sg.y0, y1: sg.y1, elevFt: sg.floorElev })), foundationWallSqft: fnd.foundationWallSqft, retainingWall: fnd.retainingWall, steepShare: gStats.steepShare } : null;
  if (g && g.steepShare > 0.25) flags.push(`${Math.round(g.steepShare * 100)}% of the footprint sits on ground steeper than 40%.`);
  if (fnd.walkoutFt > 10) flags.push("Downhill side becomes a walkout lower level (exposed foundation).");
  if (segs.length > 1 && typology !== "townhouse_row") flags.push("Building steps once, a full story, to follow the hill.");
  const massing: Box[] = [];
  const unitColor = (b: number) => b <= 1 ? COLORS.u1 : b === 2 ? COLORS.u2 : COLORS.u3;
  const unitsPerFloor = typology === "three_four" ? Math.max(1, Math.ceil(units / stories)) : typology === "two_unit" && cand.layout === "side by side" ? 2 : 1;
  for (const sg of segs) {
    const w = sg.x1 - sg.x0, d = sg.y1 - sg.y0;
    let gmin = Infinity; for (let x = sg.x0; x <= sg.x1; x += 3) for (let y = sg.y0; y <= sg.y1; y += 3) gmin = Math.min(gmin, Eloc(x, y));
    const fz = Math.min(gmin, sg.floorElev) - 1; massing.push({ x: sg.x0, y: sg.y0, w, d, z0: fz, h: sg.floorElev - fz, kind: "foundation", color: COLORS.foundation });
    for (let st = 0; st < stories; st++) {
      const z0 = sg.floorElev + st * t.floorToFloorFt;
      const tuckFloor = st === 0 && pk.garages.length > 0 && sg.y0 <= cand.y + 0.1;
      if (typology === "three_four") { const cw = Math.min(t.coreSqft / d, w * 0.3); const uw = (w - cw) / unitsPerFloor; massing.push({ x: sg.x0 + (w - cw) / 2, y: sg.y0, w: cw, d, z0, h: t.floorToFloorFt, kind: "core", color: COLORS.core }); for (let k = 0; k < unitsPerFloor; k++) massing.push({ x: k === 0 ? sg.x0 : sg.x0 + (w - cw) / 2 + cw, y: sg.y0, w: unitsPerFloor === 1 ? (w - cw) / 2 : uw, d, z0, h: t.floorToFloorFt, kind: tuckFloor ? "parking" : "unit", color: tuckFloor ? COLORS.parking : unitColor(unitList[0].bedrooms), label: `F${st + 1}U${k + 1}` }); if (unitsPerFloor === 1) massing.push({ x: sg.x0 + (w - cw) / 2 + cw, y: sg.y0, w: (w - cw) / 2, d, z0, h: t.floorToFloorFt, kind: tuckFloor ? "parking" : "unit", color: tuckFloor ? COLORS.parking : unitColor(unitList[0].bedrooms) }); }
      else if (unitsPerFloor === 2) { for (let k = 0; k < 2; k++) massing.push({ x: sg.x0 + k * w / 2, y: sg.y0, w: w / 2, d, z0, h: t.floorToFloorFt, kind: tuckFloor ? "parking" : "unit", color: k ? COLORS.u2 : COLORS.u3 }); }
      else massing.push({ x: sg.x0, y: sg.y0, w, d, z0, h: t.floorToFloorFt, kind: tuckFloor ? "parking" : "unit", color: tuckFloor ? COLORS.parking : typology === "two_unit" ? (st < stories / 2 ? COLORS.u2 : COLORS.u3) : unitColor(unitList[0].bedrooms), label: sg.unitIdx != null ? `U${sg.unitIdx + 1}` : undefined });
    }
    massing.push({ x: sg.x0, y: sg.y0, w, d, z0: sg.floorElev + stories * t.floorToFloorFt, h: t.roofFt, kind: "roof", color: COLORS.roof });
  }
  if (aduMain) massing.push({ x: aduMain.x, y: aduMain.y, w: aduMain.w, d: aduMain.d, z0: Eloc(aduMain.x, aduMain.y), h: 20, kind: "unit", color: "#d9dedb", label: "main house (new)" });
  const sideClear = (face: "left" | "right") => { let m = Infinity; for (let y = cand.y; y <= cand.y + cand.d; y += 2) { let dd = 0; const step = face === "left" ? -1 : 1; let x = face === "left" ? cand.x : cand.x + cand.w; while (dd < 40 && pointInRing([x + step * (dd + 0.5), y], cls.localRing)) dd++; m = Math.min(m, dd); } return m; };
  const openings = facade({ typology, segs, stories, floorToFloor: t.floorToFloorFt, unitsPerFloor: typology === "three_four" ? unitsPerFloor : 1, cand, garages: pk.garages, sideClear, tuck: pk.garages.length > 0 });
  const footprintLocal: Ring = [[cand.x, cand.y], [cand.x + cand.w, cand.y], [cand.x + cand.w, cand.y + cand.d], [cand.x, cand.y + cand.d]];
  const status: Scheme["status"] = approvals.length ? "needs_approval" : "allowed_by_right";
  const sentence = status === "allowed_by_right" ? `Allowed by right: ${units} home${units > 1 ? "s" : ""}, ${stories} stor${stories > 1 ? "ies" : "y"}.` : `Needs approval: ${approvals.map(a => a.detail).join("; ")}.`;
  const scheme: Scheme = {
    ...base(status, sentence), approvalsNeeded: approvals, bindingConstraint, unlock, units: unitList,
    footprintLocal, footprintWorld: footprintLocal.map(cls.toWorld), widthFt: cand.w, depthFt: cand.d, stories, grossSqft: Math.round(gross), netSqft: net, heightFt,
    parking: { count, type: ptype, required }, site: { parking: pk, segments: segs, openings, walkoutFt: fnd.walkoutFt }, lotCoverage: Math.round((cand.w * cand.d + (aduMain ? aduMain.w * aduMain.d : 0)) / lotSqft * 1000) / 10, subdivisionNeeded,
    ground: g, flags, constraints, massing
  };
  scheme.solveMs = Math.round(((globalThis.performance ?? Date).now() - t0) * 10) / 10;
  (scheme as any).debug = { buildable: B, buildableSqft: Math.round(multiArea(B)), edges: cls.edges, localRing: cls.localRing, layout: cand.layout };
  return scheme;
}

export const TYPOLOGIES: Typology[] = ["single_detached", "two_unit", "three_four", "townhouse_row", "adu"];
export function solveAll(input: ParcelInput, ctl: Omit<Controls, "typology"> = {}) {
  const t0 = (globalThis.performance ?? Date).now();
  const results = TYPOLOGIES.map(ty => solve(input, { ...ctl, typology: ty }));
  const rank = (s: Scheme) => ({ allowed_by_right: 0, needs_approval: 1, does_not_fit: 2, not_allowed: 3 }[s.status]);
  const ordered = results.slice().sort((a, b) => rank(a) - rank(b) || b.units.length - a.units.length || b.grossSqft - a.grossSqft);
  return { results, ordered, ms: Math.round(((globalThis.performance ?? Date).now() - t0) * 10) / 10 };
}
