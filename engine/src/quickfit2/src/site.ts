// Site planning: parking that a car can actually use, hillside segments, and facade openings.
import type { Pt } from "./types";
import type { Raster } from "./geom";

export interface Rect { x: number; y: number; w: number; d: number }
export interface Segment { x0: number; x1: number; y0: number; y1: number; floorElev: number; unitIdx?: number }
export interface Opening { kind: "window" | "door" | "garage"; face: "front" | "rear" | "left" | "right"; x: number; y: number; z: number; w: number; h: number }
export interface ParkingPlan { type: "tuck" | "alley_pad" | "side_drive_pad" | "none"; count: number; stalls: Rect[]; drives: Rect[]; curbCuts: [number, number][]; notes: string[]; garages: Rect[] }

type E = (x: number, y: number) => number;
const grade = (E: E, pts: Pt[]) => { let mx = 0; for (let i = 1; i < pts.length; i++) { const run = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (run > 0) mx = Math.max(mx, Math.abs(E(pts[i][0], pts[i][1]) - E(pts[i - 1][0], pts[i - 1][1])) / run); } return mx; };

export function planParking(o: { typology: string; required: number; cand: { x: number; y: number; w: number; d: number; rowN?: number; rowUnitW?: number }; R: Raster; E: E; alleyRear: boolean; stories: number; forced?: string; frontSetback: number; lotDepthAt: (x: number) => number }): ParkingPlan {
  const { cand: c, R, E } = o; const none: ParkingPlan = { type: "none", count: 0, stalls: [], drives: [], curbCuts: [], notes: [], garages: [] };
  const want = o.required; const tries: string[] = o.forced && o.forced !== "auto" ? [o.forced === "pad" ? (o.alleyRear ? "alley_pad" : "side_drive_pad") : o.forced] : o.alleyRear ? ["alley_pad", "tuck", "side_drive_pad"] : ["tuck", "side_drive_pad"];
  if (!o.forced || o.forced === "auto") { if (want === 0) return { ...none, notes: ["No parking required here."] }; }
  const rejected: string[] = [];
  for (const t of tries) {
    if (t === "none") return none;
    if (t === "tuck") {
      // garages in the ground floor facing the street; apron straight from the curb
      const bays: Rect[] = [];
      if (o.typology === "townhouse_row") { const n = c.rowN ?? 1, uw = c.rowUnitW ?? c.w; if (uw < 12) { rejected.push("units too narrow for a garage"); continue; } for (let k = 0; k < n; k++) bays.push({ x: c.x + k * uw + (uw - 10) / 2, y: c.y, w: 10, d: 20 }); }
      else { const nMax = Math.floor((c.w - 2) / 11); const n = Math.min(Math.max(1, want), nMax, o.typology === "three_four" ? 2 : 2); if (n < 1 || c.w < 12) { rejected.push("building too narrow for a garage"); continue; } const span = n * 11 - 1; const x0 = c.w - span >= 5.5 ? c.x + c.w - span - 1 : c.x + (c.w - span) / 2; for (let k = 0; k < n; k++) bays.push({ x: x0 + k * 11, y: c.y, w: 10, d: 20 }); }
      if (o.stories < 2) { rejected.push("one-story building can't give up its ground floor to a garage"); continue; }
      // adjacent garages share one continuous apron
      const drives: Rect[] = []; for (const b of bays) { const last = drives[drives.length - 1]; if (last && b.x - (last.x + last.w) < 4) last.w = b.x + b.w - last.x; else drives.push({ x: b.x, y: -5, w: b.w, d: c.y + 5 }); }
      // Pittsburgh pattern: set the garage floor at street grade and cut into the hill if needed.
      const street = Math.min(...bays.map(b => E(b.x + 5, 0)));
      const cutBack = Math.max(...bays.map(b => E(b.x + 5, c.y + 20) - street));
      const fill = Math.max(...bays.map(b => street - E(b.x + 5, c.y)));
      if (cutBack > 14) { rejected.push(`garage at street level would need a ${Math.round(cutBack)} ft cut into the hill`); continue; }
      if (fill > 8) { rejected.push(`lot drops ${Math.round(fill)} ft below the street at the building; a garage would need a bridge or tall fill`); continue; }
      const notes = [`${bays.length} tuck-under garage${bays.length > 1 ? "s" : ""} at street level; ${drives.length > 1 ? `${drives.length} driveways` : "one driveway"} straight from the curb.`];
      if (cutBack > 4) notes.push(`Garage floor set at street grade, cut about ${Math.round(cutBack)} ft into the hill (retaining walls, priced in the site adders).`);
      return { type: "tuck", count: bays.length, stalls: bays, garages: bays, drives, curbCuts: drives.map(d => [d.x - 1, d.x + d.w + 1] as [number, number]), notes, streetGrade: street } as any;
    }
    if (t === "alley_pad") {
      const depth = o.lotDepthAt(c.x + c.w / 2); const n = Math.max(1, Math.min(want || 1, Math.floor(c.w / 9)));
      const stalls: Rect[] = []; const y = depth - 18; if (y < c.y + c.d + 4) { rejected.push("no room between the building and the alley"); continue; }
      for (let k = 0; k < n; k++) stalls.push({ x: c.x + k * 9, y, w: 9, d: 18 });
      if (!stalls.every(s => R.inLot(s.x, s.y, s.w, s.d - 1))) { rejected.push("pad would leave the lot"); continue; }
      const zs = stalls.flatMap(s => [E(s.x, s.y), E(s.x + s.w, s.y + s.d)]); if (Math.max(...zs) - Math.min(...zs) > 4) { rejected.push("rear pad would need over 4 ft of leveling"); continue; }
      return { type: "alley_pad", count: n, stalls, drives: [], curbCuts: [], garages: [], notes: [`${n} space${n > 1 ? "s" : ""} off the alley behind the building.`] };
    }
    if (t === "side_drive_pad") {
      const [xa, xb] = R.xRange; const n = Math.max(1, Math.min(want || 1, 2));
      for (const side of ["left", "right"]) {
        const dx = side === "left" ? c.x - 10.5 : c.x + c.w + 0.5; if (dx < xa - 12 || dx + 10 > xb + 12) continue;
        const padY = c.y + c.d + 3; const padW = n * 9; const padX = side === "left" ? Math.max(dx, c.x - 10.5) : Math.min(dx, c.x + c.w + 0.5 - padW + 10);
        const drive: Rect = { x: dx, y: -5, w: 10, d: padY + 2 + 5 }; const pad: Rect = { x: side === "left" ? dx : dx + 10 - padW, y: padY, w: padW, d: 18 };
        if (!R.inLot(drive.x, 0, drive.w, drive.d - 5) || !R.inLot(pad.x, pad.y, pad.w, pad.d)) continue;
        const g = grade(E, Array.from({ length: Math.ceil(drive.d / 5) + 1 }, (_, k) => [drive.x + 5, Math.min(drive.d - 5, k * 5)] as Pt));
        if (g > 0.15) { rejected.push(`side driveway would be ${Math.round(g * 100)}% steep`); continue; }
        const zs = [E(pad.x, pad.y), E(pad.x + pad.w, pad.y), E(pad.x, pad.y + pad.d), E(pad.x + pad.w, pad.y + pad.d)]; if (Math.max(...zs) - Math.min(...zs) > 4) { rejected.push("rear pad would need over 4 ft of leveling"); continue; }
        const stalls = Array.from({ length: n }, (_, k) => ({ x: pad.x + k * 9, y: pad.y, w: 9, d: 18 }));
        return { type: "side_drive_pad", count: n, stalls, drives: [drive], curbCuts: [[drive.x - 1, drive.x + 11]], garages: [], notes: [`Driveway along the ${side} side to ${n} space${n > 1 ? "s" : ""} behind the building.`] };
      }
      if (!rejected.some(r => r.includes("side"))) rejected.push("no 10-ft clear strip beside the building");
    }
  }
  return { ...none, notes: [`No workable parking: ${rejected.join("; ")}.`] };
}

/** Level floors; take the slope in the foundation. Townhouses step unit by unit at party walls; others step at most once, only if the drop exceeds a full story. */
export function planSegments(o: { typology: string; cand: { x: number; y: number; w: number; d: number; rowN?: number; rowUnitW?: number }; E: E; floorToFloor: number; streetFirst: boolean; streetGrade?: number | null }): Segment[] {
  const { cand: c } = o; const r = (z: number) => Math.round(z * 2) / 2;
  const E = o.streetGrade != null ? ((x: number, y: number) => (y < c.y + 2 ? o.streetGrade! : o.E(x, y))) : o.E;
  if (o.typology === "townhouse_row" && (c.rowN ?? 1) > 1) {
    const uw = c.rowUnitW ?? c.w; const segs = Array.from({ length: c.rowN! }, (_, k) => ({ x0: c.x + k * uw, x1: c.x + (k + 1) * uw, y0: c.y, y1: c.y + c.d, floorElev: r(E(c.x + (k + 0.5) * uw, c.y + 1)), unitIdx: k }));
    // units within 2 ft of their neighbor share a floor level (no token steps on flat ground)
    for (let k = 1; k < segs.length; k++) if (Math.abs(segs[k].floorElev - segs[k - 1].floorElev) < 2) segs[k].floorElev = segs[k - 1].floorElev;
    return segs;
  }
  const zf = r(E(c.x + c.w / 2, c.y + 1)); const zr = r(E(c.x + c.w / 2, c.y + c.d - 1)); const drop = zr - zf;
  if (Math.abs(drop) >= o.floorToFloor && c.d >= 36) {
    const mid = c.y + Math.round(c.d / 2); const step = Math.sign(drop) * o.floorToFloor;
    return [{ x0: c.x, x1: c.x + c.w, y0: c.y, y1: mid, floorElev: zf }, { x0: c.x, x1: c.x + c.w, y0: mid, y1: c.y + c.d, floorElev: zf + step }];
  }
  return [{ x0: c.x, x1: c.x + c.w, y0: c.y, y1: c.y + c.d, floorElev: zf }];
}

export function foundation(segs: Segment[], E: E) {
  let wall = 0, retLen = 0, retMax = 0, walkLen = 0;
  for (const s of segs) {
    const per: Pt[] = []; for (let x = s.x0; x < s.x1; x += 2) { per.push([x, s.y0]); per.push([x, s.y1]); } for (let y = s.y0; y < s.y1; y += 2) { per.push([s.x0, y]); per.push([s.x1, y]); }
    for (const p of per) { const g = E(p[0], p[1]); const cut = g - s.floorElev; wall += (Math.abs(cut) + 1) * 2; if (cut > 4) { retLen += 2; retMax = Math.max(retMax, cut); } if (cut < -6) walkLen += 2; }
  }
  return { foundationWallSqft: Math.round(wall), retainingWall: { lengthFt: retLen, maxHeightFt: Math.round(retMax * 10) / 10 }, walkoutFt: walkLen };
}

/** Window/door layout from the unit plan: bays per unit, clear of party walls, no openings within 3 ft of a side lot line. */
export function facade(o: { typology: string; segs: Segment[]; stories: number; floorToFloor: number; unitsPerFloor: number; cand: { x: number; y: number; w: number; d: number; rowN?: number; rowUnitW?: number }; garages: Rect[]; sideClear: (face: "left" | "right") => number; tuck: boolean }): Opening[] {
  const out: Opening[] = []; const { cand: c } = o; const F = o.floorToFloor;
  const bayWins = (x0: number, x1: number, face: Opening["face"], y: number, z0: number, floor: number, avoid: Rect[]) => {
    const inner0 = x0 + 2.5, inner1 = x1 - 2.5; const span = inner1 - inner0; if (span < 3) return;
    const n = Math.max(1, Math.floor((span + 2) / 7)); const gap = span / n;
    for (let k = 0; k < n; k++) { const wx = inner0 + gap * (k + 0.5) - 1.5; const w: Opening = { kind: "window", face, x: wx, y, z: z0 + floor * F + 2.6, w: 3, h: 5 }; if (floor === 0 && avoid.some(a => wx + 3 > a.x - 0.5 && wx < a.x + a.w + 0.5)) continue; out.push(w); }
  };
  const doors: Rect[] = [];
  if (o.typology === "townhouse_row") {
    const uw = c.rowUnitW ?? c.w;
    for (const s of o.segs) {
      const gar = o.garages.filter(g => g.x >= s.x0 - 0.1 && g.x + g.w <= s.x1 + 0.1);
      for (const g of gar) out.push({ kind: "garage", face: "front", x: g.x, y: s.y0, z: s.floorElev, w: g.w - 1, h: 7.5 });
      const dx = gar.length ? (gar[0].x - s.x0 > 4.5 ? s.x0 + 1 : s.x1 - 4.2) : s.x0 + uw / 2 - 1.6; const dz = s.floorElev + (gar.length && o.tuck ? 0 : 0);
      out.push({ kind: "door", face: "front", x: dx, y: s.y0, z: dz, w: 3.2, h: 7 }); doors.push({ x: dx, y: 0, w: 3.2, d: 0 });
      for (let f = 0; f < o.stories; f++) bayWins(s.x0, s.x1, "front", s.y0, s.floorElev, f, f === 0 ? [...gar, { x: dx, y: 0, w: 3.2, d: 0 }] : []);
      for (let f = 0; f < o.stories; f++) bayWins(s.x0, s.x1, "rear", s.y1, s.floorElev, f, []);
    }
    return out;
  }
  for (const s of o.segs) {
    const isFront = s.y0 <= c.y + 0.1; const units = Math.max(1, o.unitsPerFloor);
    const gar = isFront ? o.garages : [];
    for (const g of gar) out.push({ kind: "garage", face: "front", x: g.x, y: s.y0, z: s.floorElev, w: g.w - 1, h: 7.5 });
    if (isFront) { const cands = [s.x0 + 1, s.x1 - 4.2, (s.x0 + s.x1) / 2 - 1.6]; const free = cands.find(x => !gar.some(g => x + 3.2 > g.x - 0.5 && x < g.x + g.w + 0.5));
      if (free != null) { out.push({ kind: "door", face: "front", x: free, y: s.y0, z: s.floorElev, w: 3.2, h: 7 }); doors.push({ x: free, y: 0, w: 3.2, d: 0 }); }
      else { const face = o.sideClear("left") >= 3 ? "left" : "right"; out.push({ kind: "door", face, x: face === "left" ? s.x0 : s.x1, y: s.y0 + 22, z: s.floorElev, w: 3.2, h: 7 }); } }
    const uw = (s.x1 - s.x0) / units;
    for (let f = 0; f < o.stories; f++) for (let u = 0; u < units; u++) {
      const x0 = s.x0 + u * uw, x1 = x0 + uw;
      if (isFront) bayWins(x0, x1, "front", s.y0, s.floorElev, f, f === 0 ? [...gar, ...doors.map(d => ({ ...d, w: d.w }))] : []);
      if (s.y1 >= c.y + c.d - 0.1) bayWins(x0, x1, "rear", s.y1, s.floorElev, f, []);
    }
    // side walls: only if at least 3 ft from the side lot line
    for (const face of ["left", "right"] as const) {
      if (o.sideClear(face) < 3) continue; const xw = face === "left" ? s.x0 : s.x1; const d = s.y1 - s.y0; const n = Math.max(1, Math.floor((d - 5) / 10));
      for (let f = 0; f < o.stories; f++) for (let k = 0; k < n; k++) { if (f === 0 && o.tuck && s.y0 <= c.y + 0.1 && k === 0) continue; out.push({ kind: "window", face, x: xw, y: s.y0 + (d / (n + 1)) * (k + 1) - 1.4, z: s.floorElev + f * F + 2.6, w: 2.8, h: 5 }); }
    }
  }
  return out;
}
