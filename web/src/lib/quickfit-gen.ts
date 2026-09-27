// QuickFit 3D generator: the map controls (building type, stories, unit width, parking, setbacks) ->
// one QuickFit scheme -> 3D boxes (floors x units, stair core, garage or parking pad) on the lidar
// ground, with hillside stepping -> the engine pro forma for that scheme. Pure and deterministic (no
// clock, no randomness, no I/O), so the browser worker (lib/quickfit-worker.ts) and the parcel page on
// the server give the same scheme and the same numbers. Wraps the engine; never edits it.

import { assumptions, quickfit, score } from "@easescore/engine";
import { groundAt, type TerrainGrid } from "./terrain-grid";

type Pt = [number, number];
type Ring = Pt[];
type StrategyId = score.StrategyId;

// ------------------------------------------------------------------------------------------ config

/**
 * Hillside stepping. EDITABLE PLACEHOLDERS, not code or engineering standards: floor plates step down
 * the grade when the ground under the footprint is steeper than `thresholdPct`, in multiples of
 * `incrementFt` (2-3 ft), on footprint cells at least `minCellFt` long.
 */
export const STEPPING = {
  thresholdPct: 15,
  incrementFt: 2.5,
  minCellFt: 8,
  label: "Stepping starts where the ground under the building is steeper than 15%; plates step in 2.5 ft increments (placeholders, editable).",
} as const;

/** Drawing-only placeholders (the solver's own areas are unchanged): stair core, parking stall, floor gap. */
export const DRAW = { coreW: 4, coreD: 10, coreAboveRoofFt: 3, stallW: 9, stallD: 18, floorGapFt: 0.35, padFt: 0.5 } as const;

/** ADU placeholder preset: a small detached cottage or carriage house behind the main house. */
export const ADU_PRESET: quickfit.TypologyPreset = {
  id: "adu",
  label: "Accessory dwelling unit",
  arrangement: "detached",
  unitsPerBuilding: 1,
  unitWidthFt: { min: 14, max: 24, step: 1 }, // placeholder
  unitDepthFt: { min: 16, max: 28, step: 1 }, // placeholder
  stories: { min: 1, max: 2 }, // placeholder
  floorToFloorFt: 10, // placeholder
  roofAllowanceFt: 0,
  garage: true,
};
/** Placeholder separation between an ADU and the main house (feet). */
export const ADU_SEPARATION_FT = 10;

export type GenTypology = "sf" | "duplex" | "plex" | "townhouse" | "adu";
export type GenParking = "pad" | "tuck" | "none";

export interface GenTypologyDef {
  id: GenTypology;
  label: string;
  short: string;
  strategy: StrategyId;
  presets: quickfit.TypologyPreset[];
  stories: { min: number; max: number };
  width: { min: number; max: number };
  parking: GenParking[];
}

export const GEN_TYPOLOGIES: GenTypologyDef[] = [
  { id: "sf", label: "Single-family", short: "SF", strategy: "new_sf", presets: [quickfit.SINGLE_FAMILY], stories: { min: 1, max: 4 }, width: { min: 16, max: 32 }, parking: ["none", "pad", "tuck"] },
  { id: "duplex", label: "Duplex", short: "Duplex", strategy: "duplex", presets: [quickfit.DUPLEX], stories: { min: 1, max: 4 }, width: { min: 16, max: 24 }, parking: ["none", "pad", "tuck"] },
  { id: "plex", label: "3–4 units", short: "3–4", strategy: "three_four_unit", presets: [score.STACKED_TRIPLEX, score.STACKED_FOURPLEX], stories: { min: 2, max: 4 }, width: { min: 20, max: 40 }, parking: ["none", "pad"] },
  { id: "townhouse", label: "Townhouse row", short: "Row", strategy: "townhouse_row", presets: [quickfit.TOWNHOUSE_ROW], stories: { min: 1, max: 4 }, width: { min: 16, max: 26 }, parking: ["none", "pad", "tuck"] },
  { id: "adu", label: "ADU", short: "ADU", strategy: "adu", presets: [ADU_PRESET], stories: { min: 1, max: 2 }, width: { min: 14, max: 24 }, parking: ["none", "tuck"] },
];
export const typologyDef = (id: GenTypology) => GEN_TYPOLOGIES.find((t) => t.id === id)!;
export const typologyForStrategy = (s: StrategyId | null | undefined): GenTypology | null => GEN_TYPOLOGIES.find((t) => t.strategy === s)?.id ?? null;

const SOLVER_PARKING: Record<GenParking, quickfit.ParkingOption> = { pad: "surface", tuck: "garage", none: "none" };
const GEN_PARKING: Record<quickfit.ParkingOption, GenParking> = { surface: "pad", garage: "tuck", none: "none" };

export interface GenControls {
  typology: GenTypology;
  stories: number;
  /** null = the widest layout that fits (the solver sweeps the preset's widths). */
  unitWidthFt: number | null;
  parking: GenParking;
  /** Setback overrides in feet; null = the code value. Less than code = a variance what-if. */
  front: number | null;
  side: number | null;
  rear: number | null;
}

// ------------------------------------------------------------------------------------------ inputs

/** parcel_quickfit_input (local feet) plus the grant-odds counts it carries. */
export interface GenParcel {
  parcel: Ring;
  frontEdges: number[];
  streetSideEdges?: number[];
  edges?: { i: number; len: number; az: number; street_ft: number | null }[];
  masks?: quickfit.MaskInput[];
  zbaCounts?: quickfit.ZbaCountRow[];
  notes?: (string | null)[];
}

export interface GenInput {
  qf: GenParcel;
  zoneCode: string | null;
  /** parcel_facts zoning.rules (City parcels only, as the score reads it); null = no rules. */
  rulesRow: quickfit.QuickFitRules | null;
  terrain: TerrainGrid | null;
  /** Existing building footprints on the lot, local feet (ADU placement). */
  existing?: Ring[];
}

// ------------------------------------------------------------------------------------------ output

export type BoxKind = "sf" | "duplex" | "flat" | "townhouse" | "adu" | "garage" | "core" | "pad";

export const BOX_LABEL: Record<BoxKind, string> = {
  sf: "Single-family home", duplex: "Duplex unit", flat: "Flat (one unit per floor)", townhouse: "Townhouse",
  adu: "ADU", garage: "Tuck-under garage", core: "Stair core (illustrative)", pad: "Parking pad",
};

/** Colors by unit type (two shades alternate between neighboring units). */
export const BOX_COLORS: Record<BoxKind, [string, string]> = {
  sf: ["#2563eb", "#60a5fa"], duplex: ["#7c3aed", "#a78bfa"], flat: ["#0e7490", "#22d3ee"], townhouse: ["#be185d", "#f472b6"],
  adu: ["#15803d", "#4ade80"], garage: ["#64748b", "#64748b"], core: ["#1e293b", "#1e293b"], pad: ["#a8a29e", "#a8a29e"],
};
export const boxColor = (b: { kind: BoxKind; unit: number }) => BOX_COLORS[b.kind][b.unit >= 0 ? b.unit % 2 : 0];

/** One extruded box: a ring in the parcel's local feet, from z0 to z1 (feet NAVD88 when `zAbsolute`). */
export interface GenBox {
  ring: Ring;
  z0: number;
  z1: number;
  kind: BoxKind;
  /** Unit number (0-based) for alternating shades; -1 for shared parts. */
  unit: number;
  floor: number;
}

export interface SteppingResult {
  /** Ground under the footprint (plane fit), percent; null without lidar. */
  footprintSlopePct: number | null;
  thresholdPct: number;
  incrementFt: number;
  /** True when the plates step. */
  applies: boolean;
  /** Distinct plate levels minus one. */
  steps: number;
  dropFt: number;
  /** Every footprint cell: its plate and the lidar ground under it (feet). */
  cells: { plate: number; ground: number }[];
}

export interface GenResult {
  controls: GenControls;
  strategy: StrategyId;
  scheme: quickfit.Scheme | null;
  /** Why there is no scheme (plain words). */
  reason: string | null;
  /** "Front setback is the limit: +1 unit with a 0 ft front setback." */
  binding: string | null;
  approvals: string[];
  notes: string[];
  envelope: quickfit.Poly[];
  envelopeSf: number;
  lotSf: number;
  boxes: GenBox[];
  zAbsolute: boolean;
  stepping: SteppingResult;
  /** Layouts the solver tried for this request. */
  tried: number;
}

// ------------------------------------------------------------------------------------------ solve

const PERM_RANK: Record<string, number> = { P: 5, A: 4, S: 3, C: 2, N: 1 };
const permRank = (c: string | null | undefined) => (c ? PERM_RANK[c] ?? 0 : -1);
/** Same order as the score's pickStrategyScheme (most units, better permission, more floor area, id). */
const byMostUnits = (a: quickfit.Scheme, b: quickfit.Scheme) =>
  b.units - a.units || permRank(b.permission.code) - permRank(a.permission.code) || b.grossFloorAreaSf - a.grossFloorAreaSf || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const varCount = (s: quickfit.Scheme) => new Set(s.approvals.filter((a) => a.kind === "variance").map((a) => a.rule)).size;

/** Solver rules exactly as the score builds them (zoning row + attached-housing facts). */
export function genRules(input: GenInput): quickfit.QuickFitRules | null {
  return input.zoneCode && input.rulesRow ? score.solverRules(input.zoneCode, input.rulesRow) : null;
}

function codeSetbacks(r: quickfit.QuickFitRules) {
  return { front: r.min_front_setback_ft ?? 0, side: r.min_side_setback_ft ?? 0, rear: r.min_rear_setback_ft ?? 0 };
}

/** Local frame of a unit rectangle (solver order: front-left, front-right, back-right, back-left). */
function rectFrame(r: Ring) {
  const [p0, p1, , p3] = r as [Pt, Pt, Pt, Pt];
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ux: Pt = [(p1[0] - p0[0]) / w, (p1[1] - p0[1]) / w], uy: Pt = [(p3[0] - p0[0]) / d, (p3[1] - p0[1]) / d];
  const at = (u: number, v: number): Pt => [p0[0] + ux[0] * u + uy[0] * v, p0[1] + ux[1] * u + uy[1] * v];
  const back = (p: Pt): Pt => { const dx = p[0] - p0[0], dy = p[1] - p0[1]; return [dx * ux[0] + dy * ux[1], dx * uy[0] + dy * uy[1]]; };
  return { w, d, at, back };
}

function inRing([x, y]: Pt, r: Ring) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Plain binding sentence for a scheme. */
export function bindingSentence(s: quickfit.Scheme): string {
  const d = s.binding.detail.trim();
  return d ? `${s.binding.label}: ${d.charAt(0).toLowerCase()}${d.slice(1)}` : `${s.binding.label}.`;
}

/**
 * Run the solver for one set of controls and pick the scheme: among layouts with the chosen stories,
 * parking and (unless auto) unit width, the most units that fit by right or with the chosen setback
 * what-ifs; otherwise the one needing the fewest other variances.
 */
export function solveControls(input: GenInput, c: GenControls): { result: quickfit.QuickFitResult | null; scheme: quickfit.Scheme | null; reason: string | null; notes: string[] } {
  const rules = genRules(input);
  const notes: string[] = [];
  if (!rules) return { result: null, scheme: null, reason: "Zoning rules for this district are not loaded, so the site-fit check cannot run.", notes };
  const fe = score.frontEdgesFor(input.qf as score.QuickFitParcelInput);
  if (fe.note) notes.push(fe.note);
  if (!fe.front.length || input.qf.parcel.length < 3) return { result: null, scheme: null, reason: "No street frontage found for this lot, so a building cannot be oriented.", notes };
  const def = typologyDef(c.typology);
  const code = codeSetbacks(rules);
  const typologies = def.presets.map((p) => ({ ...p, stories: { min: c.stories, max: c.stories } }));
  const common = {
    parcel: input.qf.parcel, masks: [...(input.qf.masks ?? [])], typologies, parkingOptions: [SOLVER_PARKING[c.parking]],
    includeNotPermitted: true, zbaCounts: input.qf.zbaCounts ?? [], rules,
  };
  let solveIn: quickfit.QuickFitInput;
  if (c.typology === "adu") {
    // ADU: behind the main house. The rear lot line orients it (it sits as far back as the rear setback
    // allows), existing buildings plus a separation are cut from the envelope.
    const classes = quickfit.classifyEdges(input.qf.parcel, fe.front, undefined, fe.side);
    const P = input.qf.parcel, n = P.length;
    const len = (i: number) => Math.hypot(P[(i + 1) % n]![0] - P[i]![0], P[(i + 1) % n]![1] - P[i]![1]);
    const rear = classes.map((k, i) => (k === "rear" ? i : -1)).filter((i) => i >= 0).sort((x, y) => len(y) - len(x) || x - y);
    if (!rear.length) return { result: null, scheme: null, reason: "No rear lot line found, so an ADU cannot be placed behind the house.", notes };
    const cut: quickfit.MaskInput[] = (input.existing ?? []).filter((r) => r.length >= 3).map((r) => {
      const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]), m = ADU_SEPARATION_FT;
      const [x0, x1, y0, y1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...ys) - m, Math.max(...ys) + m];
      return { label: `Existing house + ${m} ft separation`, mode: "cut" as const, polygon: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] as quickfit.Poly };
    });
    if (!cut.length) notes.push("No main house on record on this lot; an ADU normally sits behind one.");
    notes.push("ADU placed from the rear lot line (the district's rear setback), kept clear of the existing house; ADU zoning rules are not in our table yet, so permission is not checked.");
    solveIn = { ...common, masks: [...common.masks, ...cut], frontEdges: rear, rearEdges: fe.front, streetSideEdges: fe.side,
      setbackOverrides: { front: c.rear ?? code.rear, rear: 0, side: c.side ?? code.side, note: "ADU placed from the rear lot line" } };
  } else {
    const variances: quickfit.VarianceToggle[] = [];
    const setbackOverrides: quickfit.SetbackOverrides = {};
    const ctxFt = score.DEFAULT_CONFIG.f1.contextualFrontSetbackFt;
    const one = (rule: "front_setback" | "side_setback" | "rear_setback", key: "front" | "side" | "rear", v: number | null) => {
      if (v == null || v === code[key]) return;
      if (key === "front" && rules.contextual_front_setback && v === ctxFt && code.front > ctxFt) { setbackOverrides.front = v; setbackOverrides.note = "contextual front setback (assumed)"; return; }
      if (v > code[key]) { setbackOverrides[key] = v; return; }
      variances.push({ rule, value: v, reliefType: "dimensional_variance", codeSection: "903.03" });
    };
    one("front_setback", "front", c.front);
    one("side_setback", "side", c.side);
    one("rear_setback", "rear", c.rear);
    // As the score's variance probe: a side-yard what-if also applies to the street side of a corner lot.
    if (c.side != null && c.side < code.side && fe.side.length) variances.push({ rule: "exterior_side_setback", value: c.side, reliefType: "dimensional_variance", codeSection: "903.03" });
    solveIn = { ...common, frontEdges: fe.front, streetSideEdges: fe.side, variances, ...(Object.keys(setbackOverrides).length ? { setbackOverrides } : {}) };
  }
  let result: quickfit.QuickFitResult;
  try {
    result = quickfit.solveQuickFit(solveIn);
  } catch (e) {
    return { result: null, scheme: null, reason: `The site-fit check could not run: ${(e as Error).message}`, notes };
  }
  const typs = def.presets.map((p) => p.id);
  const cands = result.all.filter((s) => typs.includes(s.typology) && (c.unitWidthFt == null || s.unitWidthFt === c.unitWidthFt));
  const ok = cands.filter((s) => s.approvals.every((a) => a.kind === "use" || a.toggled));
  const scheme = ok.length ? [...ok].sort(byMostUnits)[0]! : cands.length ? [...cands].sort((a, b) => varCount(a) - varCount(b) || byMostUnits(a, b))[0]! : null;
  let reason: string | null = null;
  if (!scheme) {
    const garageNo = c.parking === "tuck" && c.stories < 2 ? " A tuck-under garage needs at least 2 stories." : "";
    reason = result.envelope.areaSf <= 0
      ? "Nothing fits: the setbacks leave no buildable area."
      : `No ${def.label.toLowerCase()} layout${c.unitWidthFt != null ? ` ${c.unitWidthFt} ft wide` : ""} fits the ${Math.round(result.envelope.areaSf).toLocaleString("en-US")} sq ft buildable area at ${c.stories} stor${c.stories === 1 ? "y" : "ies"}.${garageNo} Try a narrower unit, fewer stories or smaller setbacks.`;
  }
  return { result, scheme, reason, notes: [...notes, ...(input.qf.notes ?? []).filter((n): n is string => !!n)] };
}

// ------------------------------------------------------------------------------------------ geometry

type Rect = { u0: number; u1: number; v0: number; v1: number };
const inter = (a: Rect, b: Rect): Rect | null => {
  const r = { u0: Math.max(a.u0, b.u0), u1: Math.min(a.u1, b.u1), v0: Math.max(a.v0, b.v0), v1: Math.min(a.v1, b.v1) };
  return r.u1 - r.u0 > 0.25 && r.v1 - r.v0 > 0.25 ? r : null;
};

/** Least-squares plane z = a + b*x + c*y; slope percent = |grad| * 100. */
function planeSlopePct(pts: [number, number, number][]): number | null {
  if (pts.length < 3) return null;
  let sx = 0, sy = 0, sz = 0;
  for (const [x, y, z] of pts) { sx += x; sy += y; sz += z; }
  const n = pts.length, mx = sx / n, my = sy / n, mz = sz / n;
  let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
  for (const [x, y, z] of pts) { const dx = x - mx, dy = y - my, dz = z - mz; xx += dx * dx; xy += dx * dy; yy += dy * dy; xz += dx * dz; yz += dy * dz; }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-9) return null;
  const b = (xz * yy - yz * xy) / det, c = (yz * xx - xz * xy) / det;
  return Math.hypot(b, c) * 100;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Mean lidar ground over a unit-frame rectangle (2 ft sampling); null without data. */
function meanGround(g: TerrainGrid, fr: ReturnType<typeof rectFrame>, r: Rect): number | null {
  let s = 0, n = 0;
  const nu = Math.max(1, Math.round((r.u1 - r.u0) / 2)), nv = Math.max(1, Math.round((r.v1 - r.v0) / 2));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const [x, y] = fr.at(r.u0 + ((r.u1 - r.u0) * i) / nu, r.v0 + ((r.v1 - r.v0) * j) / nv);
    const z = groundAt(g, x, y);
    if (z != null) { s += z; n++; }
  }
  return n ? s / n : null;
}

/**
 * Floor plates for the scheme's footprints. Flat (single plate at the mean ground) unless the ground
 * under the footprint is steeper than STEPPING.thresholdPct; then each unit is cut into cells (at least
 * STEPPING.minCellFt long, about one increment of grade each) and every cell's plate is the lowest
 * cell's ground plus a whole number of increments, the nearest to its own ground (so every plate is
 * within half an increment of the lidar grade under it).
 */
export function plates(footprints: Ring[], g: TerrainGrid | null): { cells: { rect: number; cell: Rect; plate: number; ground: number }[]; stepping: SteppingResult } {
  const base: SteppingResult = { footprintSlopePct: null, thresholdPct: STEPPING.thresholdPct, incrementFt: STEPPING.incrementFt, applies: false, steps: 0, dropFt: 0, cells: [] };
  const frames = footprints.map(rectFrame);
  const whole = (i: number): Rect => ({ u0: 0, u1: frames[i]!.w, v0: 0, v1: frames[i]!.d });
  if (!g || !footprints.length) return { cells: footprints.map((_, i) => ({ rect: i, cell: whole(i), plate: 0, ground: 0 })), stepping: base };
  const pts: [number, number, number][] = [];
  for (const fr of frames) {
    const nu = Math.max(1, Math.round(fr.w / 2)), nv = Math.max(1, Math.round(fr.d / 2));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const [x, y] = fr.at((fr.w * i) / nu, (fr.d * j) / nv);
      const z = groundAt(g, x, y);
      if (z != null) pts.push([x, y, z]);
    }
  }
  const slope = planeSlopePct(pts);
  const meanAll = pts.length ? pts.reduce((s, p) => s + p[2], 0) / pts.length : null;
  if (meanAll == null) return { cells: footprints.map((_, i) => ({ rect: i, cell: whole(i), plate: 0, ground: 0 })), stepping: base };
  if (slope == null || slope <= STEPPING.thresholdPct) {
    const plate = r1(meanAll);
    const cells = footprints.map((_, i) => ({ rect: i, cell: whole(i), plate, ground: r1(meanGround(g, frames[i]!, whole(i)) ?? meanAll) }));
    return { cells, stepping: { ...base, footprintSlopePct: slope == null ? null : r1(slope), cells: cells.map((c) => ({ plate: c.plate, ground: c.ground })) } };
  }
  const inc = STEPPING.incrementFt;
  const raw: { rect: number; cell: Rect; ground: number }[] = [];
  frames.forEach((fr, i) => {
    // Grade across and along this unit, from its corners.
    const zc = (u: number, v: number) => groundAt(g, ...fr.at(u, v)) ?? meanAll;
    const dropU = Math.abs((zc(fr.w, 0) + zc(fr.w, fr.d)) / 2 - (zc(0, 0) + zc(0, fr.d)) / 2);
    const dropV = Math.abs((zc(0, fr.d) + zc(fr.w, fr.d)) / 2 - (zc(0, 0) + zc(fr.w, 0)) / 2);
    const nu = Math.max(1, Math.min(Math.floor(fr.w / STEPPING.minCellFt), Math.round(dropU / inc)));
    const nv = Math.max(1, Math.min(Math.floor(fr.d / STEPPING.minCellFt), Math.round(dropV / inc)));
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      const cell = { u0: (fr.w * a) / nu, u1: (fr.w * (a + 1)) / nu, v0: (fr.d * b) / nv, v1: (fr.d * (b + 1)) / nv };
      raw.push({ rect: i, cell, ground: meanGround(g, fr, cell) ?? meanAll });
    }
  });
  const zRef = Math.min(...raw.map((c) => c.ground));
  const cells = raw.map((c) => ({ ...c, ground: r1(c.ground), plate: r1(zRef + inc * Math.round((c.ground - zRef) / inc)) }));
  const levels = [...new Set(cells.map((c) => c.plate))];
  const drop = Math.max(...levels) - Math.min(...levels);
  return {
    cells,
    stepping: { ...base, footprintSlopePct: r1(slope), applies: levels.length > 1, steps: levels.length - 1, dropFt: r1(drop), cells: cells.map((c) => ({ plate: c.plate, ground: c.ground })) },
  };
}

function presetOf(s: quickfit.Scheme): quickfit.TypologyPreset {
  for (const t of GEN_TYPOLOGIES) for (const p of t.presets) if (p.id === s.typology) return p;
  return quickfit.SINGLE_FAMILY;
}
const KIND_OF: Record<string, BoxKind> = { single_family: "sf", duplex: "duplex", townhouse_row: "townhouse", stacked_3: "flat", stacked_4: "flat", adu: "adu" };

/** Boxes for a scheme: floors x unit boxes (garage bays on the ground floor), stair cores, a parking pad. */
export function schemeBoxes(s: quickfit.Scheme, parcel: Ring, g: TerrainGrid | null): { boxes: GenBox[]; stepping: SteppingResult; notes: string[] } {
  const notes: string[] = [];
  const t = presetOf(s);
  const ftf = s.stories > 0 ? s.heightFt / s.stories || t.floorToFloorFt : t.floorToFloorFt;
  const kind = KIND_OF[s.typology] ?? "sf";
  const stacked = t.arrangement === "stacked";
  const garage = s.parking === "garage";
  const { cells, stepping } = plates(s.footprints, g);
  const boxes: GenBox[] = [];
  const frames = s.footprints.map(rectFrame);
  let unitNo = 0;
  frames.forEach((fr, ri) => {
    const myCells = cells.filter((c) => c.rect === ri);
    // Units on each floor (stacked: spread over the floors, lower floors first); others: this rect is one unit.
    const perFloor = (f: number) => {
      if (!stacked) return 1;
      const living = s.stories;
      return Math.floor(s.units / living) + (f < s.units % living ? 1 : 0);
    };
    const firstUnit = unitNo;
    let top = 0;
    for (let f = 0; f < s.stories; f++) {
      const regions: (Rect & { kind: BoxKind; unit: number })[] = [];
      if (garage && f === 0) {
        const gw = Math.min(10, fr.w), gd = Math.min(20, fr.d);
        regions.push({ u0: 0, u1: gw, v0: 0, v1: gd, kind: "garage", unit: stacked ? -1 : firstUnit });
        if (fr.w - gw > 0.5) regions.push({ u0: gw, u1: fr.w, v0: 0, v1: gd, kind, unit: stacked ? unitNo : firstUnit });
        if (fr.d - gd > 0.5) regions.push({ u0: 0, u1: fr.w, v0: gd, v1: fr.d, kind, unit: stacked ? unitNo : firstUnit });
      } else {
        const k = Math.max(1, perFloor(f));
        for (let q = 0; q < k; q++) regions.push({ u0: (fr.w * q) / k, u1: (fr.w * (q + 1)) / k, v0: 0, v1: fr.d, kind, unit: stacked ? unitNo + q : firstUnit });
        if (stacked) unitNo += k;
      }
      for (const c of myCells) for (const rg of regions) {
        const x = inter(c.cell, rg);
        if (!x) continue;
        const z0 = c.plate + f * ftf;
        top = Math.max(top, z0 + ftf);
        boxes.push({ ring: [fr.at(x.u0, x.v0), fr.at(x.u1, x.v0), fr.at(x.u1, x.v1), fr.at(x.u0, x.v1)], z0: r1(z0), z1: r1(z0 + ftf - DRAW.floorGapFt), kind: rg.kind, unit: rg.unit, floor: f });
      }
    }
    if (!stacked) unitNo++;
    // Stair core: shared at the back of a stacked building; one per unit otherwise, against the side wall.
    const plateMin = Math.min(...myCells.map((c) => c.plate));
    const cu0 = stacked ? fr.w / 2 - DRAW.coreW / 2 : Math.min(0.5, fr.w / 4), cv0 = stacked ? Math.max(0, fr.d - DRAW.coreD - 0.5) : Math.max(0, fr.d / 2 - DRAW.coreD / 2);
    const core = { u0: cu0, u1: Math.min(fr.w, cu0 + DRAW.coreW), v0: cv0, v1: Math.min(fr.d, cv0 + DRAW.coreD) };
    boxes.push({ ring: [fr.at(core.u0, core.v0), fr.at(core.u1, core.v0), fr.at(core.u1, core.v1), fr.at(core.u0, core.v1)], z0: r1(plateMin), z1: r1(top + DRAW.coreAboveRoofFt), kind: "core", unit: -1, floor: -1 });
  });
  // Surface parking: stalls behind the building, else beside it, inside the lot; the solver checks open area only.
  if (s.parking === "surface" && s.parkingSpaces > 0 && frames.length) {
    const f0 = frames[0]!;
    const all = s.footprints.flatMap((r) => r.map((p) => f0.back(p)));
    const bu0 = Math.min(...all.map((p) => p[0])), bu1 = Math.max(...all.map((p) => p[0])), bv1 = Math.max(...all.map((p) => p[1]));
    const n = s.parkingSpaces, W = DRAW.stallW, D = DRAW.stallD;
    const tries: Rect[] = [
      { u0: bu0, u1: bu0 + n * W, v0: bv1 + 5, v1: bv1 + 5 + D },
      { u0: bu1 + 3, u1: bu1 + 3 + W, v0: 0, v1: n * D },
      { u0: bu0 - 3 - W, u1: bu0 - 3, v0: 0, v1: n * D },
      { u0: bu0, u1: bu0 + Math.ceil(n / 2) * W, v0: bv1 + 5, v1: bv1 + 5 + (n > 1 ? 2 : 1) * D },
    ];
    const fits = tries.find((r) => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].every(([u, v]) => inRing(f0.at(u!, v!), parcel)));
    if (fits) {
      const ring: Ring = [f0.at(fits.u0, fits.v0), f0.at(fits.u1, fits.v0), f0.at(fits.u1, fits.v1), f0.at(fits.u0, fits.v1)];
      const gz = g ? meanGround(g, f0, fits) : null;
      boxes.push({ ring, z0: r1((gz ?? cells[0]?.plate ?? 0) - 0.2), z1: r1((gz ?? cells[0]?.plate ?? 0) + DRAW.padFt), kind: "pad", unit: -1, floor: -1 });
    } else notes.push(`Parking pad (${n} stall${n === 1 ? "" : "s"}) fits by open area, but no simple spot was drawn; stall layout and driveway are not modeled.`);
  }
  return { boxes, stepping, notes };
}

/** One full generator run: solve, pick, boxes, stepping. `fixed` (the priced scheme) is drawn as is when the controls match it. */
export function generate(input: GenInput, c: GenControls, fixed?: quickfit.Scheme | null): GenResult {
  const def = typologyDef(c.typology);
  const solved = solveControls(input, c);
  let scheme = solved.scheme;
  // The priced scheme is drawn as is (same object the score and pro forma read) when the controls describe it.
  // Callers pass `fixed` only while the setbacks are the priced scheme's own (see sameControls).
  if (fixed && controlsMatch(c, fixed) && c.unitWidthFt === fixed.unitWidthFt) scheme = fixed;
  const envelope = solved.result?.envelope.polygons ?? [];
  const base = {
    controls: c, strategy: def.strategy, envelope, envelopeSf: solved.result?.envelope.areaSf ?? 0, lotSf: solved.result?.lotAreaSf ?? 0,
    tried: solved.result?.all.length ?? 0, zAbsolute: !!input.terrain,
  };
  if (!scheme) {
    return { ...base, scheme: null, reason: solved.reason, binding: null, approvals: [], notes: solved.notes, boxes: [], stepping: plates([], input.terrain).stepping };
  }
  const geo = schemeBoxes(scheme, input.qf.parcel, input.terrain);
  return {
    ...base, scheme, reason: null, binding: bindingSentence(scheme),
    approvals: scheme.approvals.map((a) => a.label + (a.odds ? (a.odds.status === "rate" ? ` (past ZBA: ${Math.round(a.odds.rate * 100)}% of ${a.odds.n} granted)` : ` (too few past ZBA cases: ${a.odds.n})`) : "")),
    notes: [...solved.notes, ...geo.notes], boxes: geo.boxes, stepping: geo.stepping,
  };
}

// ------------------------------------------------------------------------------------------ controls <-> scheme / URL

export const sameControls = (a: GenControls | null | undefined, b: GenControls | null | undefined) =>
  !!a && !!b && a.typology === b.typology && a.stories === b.stories && a.unitWidthFt === b.unitWidthFt && a.parking === b.parking && a.front === b.front && a.side === b.side && a.rear === b.rear;

/** Does a scheme have these controls' stories, parking and (unless auto) width? */
export function controlsMatch(c: GenControls, s: quickfit.Scheme): boolean {
  const def = typologyDef(c.typology);
  return def.presets.some((p) => p.id === s.typology) && s.stories === c.stories && GEN_PARKING[s.parking] === c.parking && (c.unitWidthFt == null || c.unitWidthFt === s.unitWidthFt);
}

/**
 * Controls that reproduce the priced scheme: its width, stories and parking; setbacks at code, or the
 * contextual front setback / the score's variance-probe setbacks when that is how it fits.
 */
export function controlsFromScheme(t: GenTypology, s: { unitWidthFt: number; stories: number; parking: quickfit.ParkingOption } | null, path?: string | null, variancesNeeded?: string[]): GenControls {
  const def = typologyDef(t);
  if (!s) return { typology: t, stories: def.presets[0]!.stories.max, unitWidthFt: null, parking: "none", front: null, side: null, rear: null };
  const cfg = score.DEFAULT_CONFIG.f1;
  const v = new Set(variancesNeeded ?? []);
  const p = cfg.varianceProbeSetbacksFt;
  return {
    typology: t, stories: s.stories, unitWidthFt: s.unitWidthFt, parking: GEN_PARKING[s.parking],
    front: path === "contextual" ? cfg.contextualFrontSetbackFt : path === "variance" && v.has("front_setback") ? p.front : null,
    side: path === "variance" && (v.has("side_setback") || v.has("exterior_side_setback")) ? p.side : null,
    rear: path === "variance" && v.has("rear_setback") ? p.rear : null,
  };
}

/** URL keys for the controls (qf = the building type they apply to). */
export function controlsToQuery(c: GenControls): Record<string, string> {
  const q: Record<string, string> = { qf: c.typology, qf_st: String(c.stories), qf_pk: c.parking };
  if (c.unitWidthFt != null) q.qf_w = String(c.unitWidthFt);
  if (c.front != null) q.qf_f = String(c.front);
  if (c.side != null) q.qf_s = String(c.side);
  if (c.rear != null) q.qf_r = String(c.rear);
  return q;
}

export const QF_KEYS = ["qf", "qf_st", "qf_pk", "qf_w", "qf_f", "qf_s", "qf_r"] as const;

/** Controls from the URL when they apply to this building type; null otherwise. */
export function controlsFromQuery(sp: Record<string, string | string[] | undefined>, t: GenTypology): GenControls | null {
  const s = (k: string) => (typeof sp[k] === "string" && (sp[k] as string).trim() !== "" ? (sp[k] as string).trim() : null);
  if (s("qf") !== t) return null;
  const def = typologyDef(t);
  const num = (k: string, lo: number, hi: number) => { const x = Number(s(k)); return s(k) != null && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 2) / 2)) : null; };
  const pk = s("qf_pk");
  return {
    typology: t,
    stories: num("qf_st", def.stories.min, def.stories.max) ?? def.presets[0]!.stories.max,
    unitWidthFt: num("qf_w", def.width.min, def.width.max),
    parking: pk === "pad" || pk === "tuck" || pk === "none" ? (def.parking.includes(pk) ? pk : "none") : "none",
    front: num("qf_f", 0, 60), side: num("qf_s", 0, 30), rear: num("qf_r", 0, 60),
  };
}

// ------------------------------------------------------------------------------------------ finance

/** What the page's pro forma reads, shipped to the browser once (no secrets: public records and config). */
export interface FinanceInputs {
  facts: assumptions.ProFormaFacts;
  sfComps: assumptions.SalesCompsLike | null;
  newComps: Partial<Record<StrategyId, assumptions.CompSet | null>>;
  rehabComps: assumptions.CompSet | null;
  rents: assumptions.RentCompsLike | null;
  prime: { rate: number; date: string } | null;
  tapFees: number | null;
  permitMonths: Partial<Record<StrategyId, number | null>>;
  overrides: assumptions.CostOverrides;
  /** Per strategy: the score's fit scheme id and its F1 inputs (zoning path). */
  results: Partial<Record<StrategyId, { schemeId: string | null; f1: Record<string, unknown> | null }>>;
}

/** The pro forma facts subset (keeps the browser payload small). */
export function proFormaFacts(f: Record<string, unknown>): assumptions.ProFormaFacts {
  const pick = (k: string) => (f[k] ?? null) as never;
  const a = (f.assessment ?? null) as Record<string, unknown> | null;
  return {
    slope_1m: pick("slope_1m"), overlays: pick("overlays"), mines: pick("mines"), site: pick("site"),
    assessment: a ? { use: (a.use ?? null) as string | null, fmv_land: (a.fmv_land ?? null) as number | null, fmv_total: (a.fmv_total ?? null) as number | null, living_area_sqft: (a.living_area_sqft ?? null) as number | null, is_pittsburgh: (a.is_pittsburgh ?? null) as boolean | null, tax_year: (a.tax_year ?? null) as number | null, as_of: (a.as_of ?? null) as string | null } : null,
    property_tax: pick("property_tax"), transfer_tax: pick("transfer_tax"), building_footprint_sqft: pick("building_footprint_sqft"),
    flood_1pct_share: pick("flood_1pct_share"), flood_evidence: pick("flood_evidence"),
  };
}

export function steppingInput(st: SteppingResult | null | undefined): assumptions.SteppingInput | null {
  return st && st.applies && st.footprintSlopePct != null
    ? { steps: st.steps, dropFt: st.dropFt, footprintSlopePct: st.footprintSlopePct, thresholdPct: st.thresholdPct, incrementFt: st.incrementFt }
    : null;
}

/**
 * The SelectedScheme and the engine pro forma for a strategy and scheme: the same calls the parcel page
 * makes (score.selectScheme -> assumptions.buildDevelopmentInputs -> evaluateDevelopment).
 */
export function financeFor(fin: FinanceInputs, strategy: StrategyId, scheme: quickfit.Scheme | null, stepping: SteppingResult | null): { selected: score.SelectedScheme; pf: assumptions.ProFormaResult | null } {
  const o = fin.overrides;
  const res = fin.results[strategy];
  // The score's zoning path describes the score's own scheme: use it only for that scheme.
  const result = res && (!scheme || res.schemeId === scheme.id)
    ? ({ schemeId: res.schemeId, factors: res.f1 ? [{ id: "F1", inputs: res.f1 }] : [] } as unknown as score.SelectSchemeArgs["result"])
    : null;
  const a = fin.facts.assessment;
  const selected = score.selectScheme({
    strategy, scheme, result,
    existing: { livingAreaSqft: a?.living_area_sqft ?? null, use: a?.use ?? null },
    overrides: { units: o.units, storiesAboveGarage: o.storiesAboveGarage, parking: o.parking, bedrooms: o.bedrooms, baths: o.baths },
  });
  const rehab = strategy === "rehab_existing";
  let pf: assumptions.ProFormaResult | null = null;
  try {
    const plan = assumptions.buildDevelopmentInputs({
      strategy, facts: fin.facts, scheme, selected,
      comps: rehab ? fin.rehabComps : fin.sfComps,
      newComps: fin.newComps[strategy] ?? null,
      rents: fin.rents, primeRate: fin.prime?.rate ?? null, primeRateDate: fin.prime?.date ?? null,
      permitMonths: fin.permitMonths[strategy] ?? null, tapFeesPerUnit: fin.tapFees, overrides: o,
      stepping: rehab ? null : steppingInput(stepping),
    });
    pf = assumptions.evaluateDevelopment(plan);
  } catch {
    pf = null;
  }
  return { selected, pf };
}

export type Money3 = { low: number; likely: number; high: number };
export interface GenMetrics {
  units: number | null;
  avgUnitSf: number | null;
  grossSf: number | null;
  parking: { spaces: number | null; kind: GenParking | null; required: number | null };
  tenure: "sale" | "rent" | null;
  totalCost: Money3 | null;
  /** Sale: gross sales. Rent: gross rent a year (monthly per home x 12 x homes). */
  value: Money3 | null;
  /** Sale: profit (negative = gap). Rent: net operating income a year. */
  profit: Money3 | null;
  yieldOnCostPct: Money3 | null;
  marginPct: Money3 | null;
  verdict: "yes" | "thin" | "no" | null;
  headline: string | null;
  missing: string[];
  exclusions: string[];
  stepping: assumptions.DevelopmentPlan["stepping"];
}

/** The metrics bar, read straight off the engine's pro forma and SelectedScheme (no new numbers). */
export function metricsOf(selected: score.SelectedScheme, pf: assumptions.ProFormaResult | null): GenMetrics {
  const units = selected.units;
  const r = pf?.ranges;
  const tenure = pf?.plan.tenure ?? null;
  const mul = (m: Money3 | null | undefined, k: number): Money3 | null => (m ? { low: m.low * k, likely: m.likely * k, high: m.high * k } : null);
  const pk = selected.parking;
  return {
    units,
    avgUnitSf: units && selected.finishedSf != null ? Math.round(selected.finishedSf / units) : null,
    grossSf: selected.grossFloorAreaSf,
    parking: { spaces: pk?.spaces ?? null, kind: pk ? (pk.option === "garage" || pk.option === "tuck_under" ? "tuck" : pk.option === "surface" || pk.option === "pad" ? "pad" : "none") : null, required: pk?.required ?? null },
    tenure,
    totalCost: r?.tdc ?? null,
    value: tenure === "rent" ? mul(r?.rent.monthlyPerUnit, 12 * (units ?? 0)) : r?.sale.grossSales ?? null,
    profit: tenure === "rent" ? r?.rent.noi ?? null : r?.sale.profit ?? null,
    yieldOnCostPct: r?.rent.yieldOnCostPct ?? null,
    marginPct: r?.sale.marginPct ?? null,
    verdict: pf?.verdict ?? null,
    headline: r?.headline ?? null,
    missing: pf ? pf.plan.missing : selected.missing ? [selected.missing] : [],
    exclusions: pf ? pf.plan.exclusions.map((e) => e.text) : [],
    stepping: pf?.plan.stepping ?? null,
  };
}
