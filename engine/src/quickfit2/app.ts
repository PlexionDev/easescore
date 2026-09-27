// EaseScore.AI glue for the QuickFit v2 solver (./src, used as delivered). Two jobs:
//  1. toParcelInput: build the solver's ParcelInput from the data the app already has for a parcel
//     (parcel_quickfit_input, the zoning_rules row, the lidar grid under the lot, Zoning Board counts).
//     The page, the pane batch, the report and the browser worker all call this with the same data,
//     so every place gets the same Scheme.
//  2. Adapters from a v2 Scheme to what the rest of the app reads: the score's fit (StrategyFit), the
//     pro forma's scheme shape (the v1 Scheme fields the finance engine and SelectedScheme read) and
//     the hillside stepping summary. The finance engine itself is unchanged.
// Pure and deterministic.

import { solve as solveRaw, TYPOLOGIES, SOLVER_VERSION } from "./src";
import { classify, buildable, Raster } from "./src/geom";
import type { Controls, EdgeKind, ParcelInput, Pt, Ring, Scheme, Typology, Use } from "./src/types";
import type { QuickFitRules, Scheme as V1Scheme } from "../quickfit/types";
import { attachedRulesForDistrict } from "../quickfit/rules";

export { SOLVER_VERSION };

/** Lidar grid under the lot in the lot's local feet (same shape as web/src/lib/terrain-grid.ts). */
export interface GridLike { x0: number; y0: number; step: number; nx: number; ny: number; z: (number | null)[] }

/** parcel_quickfit_input (local feet, origin at the lot centroid). */
export interface QfParcel {
  parcel: Ring;
  edges?: { i: number; len: number; az: number; street_ft: number | null }[];
  frontEdges?: number[];
  streetSideEdges?: number[];
  masks?: { label: string; mode?: "cut" | "flag"; polygon: Ring[] }[];
}

export interface ReliefCounts { granted: number; denied: number; from?: string | null; to?: string | null }

export interface AppSources {
  parid: string;
  qf: QfParcel;
  zoneCode: string | null;
  /** zoning_rules row (parcel_facts.zoning.rules); null = no transcribed rules. */
  rules: QuickFitRules | null;
  terrain?: GridLike | null;
  /** Existing buildings on the lot (local feet): the backyard cottage keeps clear of them. */
  existing?: Ring[];
  zba?: { by_relief?: Record<string, ReliefCounts> } | null;
  zbaCitywide?: Record<string, ReliefCounts> | null;
  /** User's pick of the front lot line (edge index of qf.parcel). */
  frontEdgeIndex?: number | null;
}

/** App building types ↔ solver typologies ↔ score strategies. */
export const TYPOLOGY_OF: Record<string, Typology> = { new_sf: "single_detached", duplex: "two_unit", three_four_unit: "three_four", townhouse_row: "townhouse_row", adu: "adu" };
export const STRATEGY_OF: Record<Typology, string> = { single_detached: "new_sf", two_unit: "duplex", three_four: "three_four_unit", townhouse_row: "townhouse_row", adu: "adu" };

// ------------------------------------------------------------------------------------ input

/** Bilinear ground (ft) at local (x, y); outside the grid or on a gap, the nearest cell with data. */
export function elevFn(g: GridLike): (x: number, y: number) => number {
  const at = (i: number, j: number) => g.z[j * g.nx + i];
  let mean = 0, n = 0;
  for (const v of g.z) if (v != null) { mean += v; n++; }
  mean = n ? mean / n : 0;
  const nearest = (fi: number, fj: number) => {
    const i = Math.max(0, Math.min(g.nx - 1, Math.round(fi))), j = Math.max(0, Math.min(g.ny - 1, Math.round(fj)));
    const v = at(i, j);
    if (v != null) return v;
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
      const w = at(ii, jj);
      if (w != null) return w;
    }
    return mean;
  };
  return (x: number, y: number) => {
    const fi = (x - g.x0) / g.step, fj = (y - g.y0) / g.step;
    if (fi < 0 || fj < 0 || fi > g.nx - 1 || fj > g.ny - 1) return nearest(fi, fj);
    const i0 = Math.min(Math.floor(fi), g.nx - 2), j0 = Math.min(Math.floor(fj), g.ny - 2);
    const u = fi - i0, v = fj - j0;
    const a = at(i0, j0), b = at(i0 + 1, j0), c = at(i0, j0 + 1), d = at(i0 + 1, j0 + 1);
    if (a == null || b == null || c == null || d == null) return nearest(fi, fj);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

const USES = ["P", "S", "C", "N"];
const use = (u: unknown): Use | null => (typeof u === "string" && USES.includes(u) ? (u as Use) : u === "A" ? "S" : null);

/** Street centerline for one lot edge: the edge moved out by its distance to the street (the DB measured it). */
function streetFor(p: Ring, i: number, distFt: number | null | undefined, name: string) {
  const n = p.length;
  const a = p[i]!, b = p[(i + 1) % n]!;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const tx = dx / L, ty = dy / L;
  // parcel rings from parcel_quickfit_input are CCW: outward is to the right of the edge direction
  const ox = ty, oy = -tx;
  const d = Math.max(10, Math.min(30, distFt ?? 20));
  const ext = 30;
  const line: Pt[] = [[a[0] - tx * ext + ox * d, a[1] - ty * ext + oy * d], [b[0] + tx * ext + ox * d, b[1] + ty * ext + oy * d]];
  return { name, centerline: line, opened: true, rowWidthFt: 2 * d - 12 };
}

function signedArea(r: Ring) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]!, b = r[(i + 1) % r.length]!; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

function counts(c: ReliefCounts | undefined, scope: string) {
  if (!c) return null;
  const years = [c.from?.slice(0, 4), c.to?.slice(0, 4)].filter(Boolean);
  return { granted: c.granted, denied: c.denied, years: years.length ? [...new Set(years)].join("–") : "", scope };
}

/** Which uses the rules table leaves blank (the solver then treats them as not allowed; the app says so). */
export function unknownUses(src: AppSources): Typology[] {
  const r = src.rules as unknown as Record<string, unknown> | null;
  if (!r) return ["single_detached", "two_unit", "three_four", "townhouse_row", "adu"];
  const merged = { ...attachedRulesForDistrict(src.zoneCode ?? ""), ...stripNull(r) } as Record<string, unknown>;
  const out: Typology[] = [];
  if (!use(merged.single_unit_detached)) out.push("single_detached");
  if (!use(merged.two_unit)) out.push("two_unit");
  if (!use(merged.three_unit)) out.push("three_four");
  if (!use(merged.single_unit_attached)) out.push("townhouse_row");
  out.push("adu"); // not in the rules table for any district
  return out;
}
function stripNull(r: Record<string, unknown>) { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r)) if (v != null) o[k] = v; return o; }

/** The solver input for a parcel. null when there is no lot outline or no zoning rules to solve against. */
export function toParcelInput(src: AppSources): ParcelInput | null {
  const ring = src.qf?.parcel;
  if (!Array.isArray(ring) || ring.length < 3 || !src.rules || !src.zoneCode) return null;
  const parcel: Ring = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  const flipped = parcel[0] !== ring[0];
  const n = ring.length;
  const idx = (i: number) => (flipped ? (n - 2 - i + n) % n : i); // edge i of the input ring in the CCW ring
  const r = { ...attachedRulesForDistrict(src.zoneCode), ...stripNull(src.rules as unknown as Record<string, unknown>) } as QuickFitRules & Record<string, unknown>;

  const edgeLen = (i: number) => { const a = ring[i]!, b = ring[(i + 1) % n]!; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  const fronts = src.qf.frontEdges ?? [];
  const frontage = fronts.reduce((s, i) => s + edgeLen(i), 0);
  let attached = use(r.single_unit_attached);
  if (attached && r.attached_by_right_max_lot_width_ft != null && frontage > r.attached_by_right_max_lot_width_ft)
    attached = use(r.attached_wider_lot_permission) ?? attached;

  const front = r.min_front_setback_ft ?? 0;
  const maxH = r.max_height_ft ?? 40;
  const park = r.parking_per_unit ?? 0;
  const cite = (r.citation ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const std = cite.find((c) => /903|904|905|§9/.test(c)) ?? cite[0];
  const dist = src.zba?.by_relief ?? {};
  const city = src.zbaCitywide ?? {};
  const pick = (k: string) => {
    const d = dist[k];
    if (d && d.granted + d.denied >= 5) return counts(d, src.zoneCode!);
    const c = city[k];
    return c && c.granted + c.denied >= 5 ? counts(c, "citywide") : null;
  };
  const zbaStats: ParcelInput["zbaStats"] = {};
  for (const k of ["dimensional_variance", "use_variance", "special_exception", "conditional_use"]) { const v = pick(k); if (v) zbaStats[k] = v; }

  const edges = src.qf.edges ?? [];
  const dOf = (i: number) => edges.find((e) => e.i === i)?.street_ft ?? null;
  const streets = [
    ...fronts.map((i) => streetFor(parcel, idx(i), dOf(i), "front street")),
    ...(src.qf.streetSideEdges ?? []).map((i) => streetFor(parcel, idx(i), dOf(i), "side street")),
  ];
  const masks = src.qf.masks ?? [];
  const E = src.terrain ? elevFn(src.terrain) : null;

  return {
    parcelId: src.parid,
    addressStreet: "front street",
    parcel,
    streets,
    alleys: [],
    zoning: {
      district: src.zoneCode,
      uses: {
        single_detached: use(r.single_unit_detached) ?? "N",
        single_attached: attached ?? "N",
        two_unit: use(r.two_unit) ?? "N",
        three_unit: use(r.three_unit) ?? "N",
        multi_unit: use(r.multi_unit) ?? "N",
        adu: "N",
      },
      minLotSqft: r.min_lot_area_sqft ?? 0,
      minLotSqftAttachedPerUnit: null,
      lotAreaPerUnitSqft: r.min_lot_area_per_unit_sqft ?? null,
      setbacksFt: {
        front, rear: r.min_rear_setback_ft ?? 0, side: r.min_side_setback_ft ?? 0,
        streetSide: r.exterior_side_setback_ft ?? front,
        ...(attached ? { sideAttachedPartyWall: 0 } : {}),
      },
      maxHeightFt: maxH,
      maxStories: r.max_height_stories ?? Math.max(1, Math.floor((maxH - 5) / 10)),
      parkingPerUnit: { single_detached: park, two_unit: park, multi_unit: park, single_attached: r.attached_parking_per_unit ?? park },
      codeSections: { setbacks: std, height: std, lotSize: std, parking: "§914.02.A", uses: "§911.02", contextual: "§925.06" },
    },
    floodway: masks.filter((m) => m.mode === "cut" && m.polygon?.[0]).map((m) => m.polygon[0]!),
    landslideProne: masks.filter((m) => m.mode !== "cut" && /landslide/i.test(m.label) && m.polygon?.[0]).map((m) => m.polygon[0]!),
    existingBuildings: (src.existing ?? []).filter((f) => f.length >= 3).map((footprint) => ({ footprint })),
    neighbors: [],
    terrain: E ? { elevAt: E } : null,
    zbaStats,
    ...(src.frontEdgeIndex != null && src.frontEdgeIndex >= 0 && src.frontEdgeIndex < n ? { frontEdgeIndex: idx(src.frontEdgeIndex) } : {}),
  };
}

// ------------------------------------------------------------------------------------ safe solve

const LABEL: Record<Typology, string> = { single_detached: "Single-family house", two_unit: "Duplex", three_four: "3–4 unit building", townhouse_row: "Townhouse row", adu: "Backyard cottage (ADU)" };
const USE_OF: Record<Typology, keyof ParcelInput["zoning"]["uses"]> = { single_detached: "single_detached", two_unit: "two_unit", three_four: "three_unit", townhouse_row: "single_attached", adu: "adu" };

/**
 * True when no buildable cell is left after the setbacks and cuts (same steps as the solver's own
 * raster). The delivered solver does not return in that case (its footprint search starts at the
 * first buildable row, which is then at infinity), so the app answers "doesn't fit" itself.
 */
function noBuildableArea(input: ParcelInput, ctl: Controls): { empty: boolean; frame: Scheme["frame"]; lotSqft: number; frontageFt: number; flags: string[] } {
  const pre = classify(input, ctl);
  const pw = input.zoning.setbacksFt.sideAttachedPartyWall;
  const party = ctl.typology === "townhouse_row" && pw != null && ctl.setbackOverridesFt?.side == null && pre.frontageFt <= 30;
  const cls = party ? classify(input, { ...ctl, setbackOverridesFt: { ...(ctl.setbackOverridesFt ?? {}), side: pw! } }) : pre;
  const cuts = (input.floodway ?? []).map((r) => r.map(cls.toLocal));
  const { buildable: B, strips } = buildable(cls.localRing, cls.edges, cuts);
  const R = new Raster(B, cls.localRing, strips, cuts.map((r) => ({ label: "floodway", ring: r })));
  const lotSqft = Math.abs(cls.localRing.reduce((a, p, i, r) => { const q = r[(i + 1) % r.length]!; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  return { empty: !Number.isFinite(R.ymin), frame: cls.frame, lotSqft, frontageFt: cls.frontageFt, flags: cls.flags };
}

/** solve(), except that a lot with no buildable area at all gets a "doesn't fit" answer instead of no answer. */
export function solve(input: ParcelInput, ctl: Controls): Scheme {
  if (input.zoning.uses[USE_OF[ctl.typology]] !== "N") {
    const t0 = Date.now();
    const b = noBuildableArea(input, ctl);
    if (b.empty) {
      return {
        parcelId: input.parcelId, typology: ctl.typology, typologyLabel: LABEL[ctl.typology], status: "does_not_fit",
        statusSentence: `A ${LABEL[ctl.typology].toLowerCase()} doesn't fit inside the setbacks on this lot.`,
        approvalsNeeded: [], bindingConstraint: { rule: "size", sentence: "After setbacks, no buildable area is left." }, unlock: null,
        units: [], footprintLocal: null, footprintWorld: null, widthFt: 0, depthFt: 0, stories: 0, grossSqft: 0, netSqft: 0, heightFt: 0,
        parking: { count: 0, type: "none", required: 0 }, lotSqft: Math.round(b.lotSqft), lotCoverage: 0, subdivisionNeeded: false, frontageFt: Math.round(b.frontageFt),
        ground: null, flags: b.flags, constraints: [], whatIfs: ctl.setbackOverridesFt, solveMs: Date.now() - t0, solverVersion: SOLVER_VERSION, massing: [], frame: b.frame,
      };
    }
  }
  return solveRaw(input, ctl);
}

/** solveAll() through the guarded solve (same order: allowed, needs approval, doesn't fit, not allowed; then homes, floor area). */
export function solveAll(input: ParcelInput, ctl: Omit<Controls, "typology"> = {}) {
  const t0 = Date.now();
  const results = TYPOLOGIES.map((ty) => solve(input, { ...ctl, typology: ty }));
  const rank = (s: Scheme) => ({ allowed_by_right: 0, needs_approval: 1, does_not_fit: 2, not_allowed: 3 }[s.status]);
  const ordered = results.slice().sort((a, b) => rank(a) - rank(b) || b.units.length - a.units.length || b.grossSqft - a.grossSqft);
  return { results, ordered, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------------------------ controls

export type AppParking = "auto" | "none" | "pad" | "tuck";
export interface AppControls {
  typology: Typology;
  stories: number | null;
  unitWidthFt: number | null;
  depthFt: number | null;
  parking: AppParking;
  setbacks: Partial<Record<EdgeKind, number>>;
  frontEdgeIndex: number | null;
}
export const DEFAULT_CONTROLS = (t: Typology): AppControls => ({ typology: t, stories: null, unitWidthFt: null, depthFt: null, parking: "auto", setbacks: {}, frontEdgeIndex: null });

export function toControls(c: AppControls): Controls {
  return { typology: c.typology, goal: "most_homes", stories: c.stories, unitWidthFt: c.unitWidthFt, depthFt: c.depthFt, parking: c.parking, setbackOverridesFt: { ...c.setbacks } };
}

/** Solve one building type for the app (plain-words fixes for uses the rules table leaves blank). */
export function solveApp(input: ParcelInput, c: AppControls, unknown: Typology[] = []): Scheme {
  const s = solve(input, toControls(c));
  if (s.status === "not_allowed" && unknown.includes(c.typology)) {
    const what = c.typology === "adu" ? "Backyard cottages (ADUs)" : `${s.typologyLabel}s`;
    s.statusSentence = `${what} aren't in our zoning rules table for ${input.zoning.district}, so they are shown as not allowed. Confirm with City zoning staff.`;
    s.approvalsNeeded = [];
    s.flags = [...s.flags, "Use permission not in our rules table (not a finding that it is prohibited)."];
  }
  return s;
}

/** Controls that reproduce the solver's own choice (what a blank control means). */
export function effectiveControls(c: AppControls, s: Scheme): AppControls {
  return { ...c, stories: c.stories ?? (s.stories || null) };
}

// ------------------------------------------------------------------------------------ adapters

const RULE_V1: Record<string, string> = {
  front: "front_setback", rear: "rear_setback", side: "side_setback", streetSide: "exterior_side_setback",
  height: "max_height_stories", lotSize: "min_lot_area", density: "min_lot_area_per_unit", parking: "parking_per_unit",
};
const V1_TYPOLOGY: Record<Typology, string> = { single_detached: "single_family", two_unit: "duplex", three_four: "stacked_3", townhouse_row: "townhouse_row", adu: "adu" };

/** Variance rules (score names) a scheme needs. */
export function varianceRules(s: Scheme): string[] {
  return [...new Set(s.approvalsNeeded.filter((a) => a.kind === "dimensional_variance").map((a) => RULE_V1[a.rule] ?? a.rule))].sort();
}

/** Use-permission code the scheme stands on (P / S / C / N). */
export function permissionOf(s: Scheme, input: ParcelInput): Use {
  const u = s.approvalsNeeded.find((a) => a.rule === "use");
  if (u?.kind === "special_exception") return "S";
  if (u?.kind === "conditional_use") return "C";
  if (u?.kind === "use_variance_or_rezoning" || s.status === "not_allowed") return "N";
  return "P";
}

/** Units in the rectangle split one footprint per home (rows and side-by-side duplexes), else the building once per home. */
function unitRects(s: Scheme): Ring[] {
  const f = s.footprintWorld;
  if (!f) return [];
  const [p0, p1, , p3] = f as [Pt, Pt, Pt, Pt];
  const segs = (s.site?.segments ?? []) as { x0: number; x1: number; unitIdx?: number }[];
  const n = s.units.length || 1;
  const split = s.typology === "townhouse_row" ? segs.filter((g) => g.unitIdx != null).length || n : s.typology === "two_unit" && s.massing.some((b) => b.kind === "unit" && b.w < s.widthFt - 0.1) ? 2 : 1;
  const at = (u: number, v: number): Pt => [p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v, p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v];
  const out: Ring[] = [];
  for (let k = 0; k < split; k++) out.push([at(k / split, 0), at((k + 1) / split, 0), at((k + 1) / split, 1), at(k / split, 1)]);
  while (out.length < n) out.push(out[out.length - 1]!.map((p) => [p[0], p[1]] as Pt));
  return out.slice(0, Math.max(n, split));
}

/** The v2 Scheme in the scheme shape the pro forma and SelectedScheme read. */
export function toV1Scheme(s: Scheme, input: ParcelInput): V1Scheme | null {
  if (!s.footprintWorld || !s.units.length) return null;
  const n = s.units.length;
  const perm = permissionOf(s, input);
  const vr = varianceRules(s);
  const rowW = s.typology === "townhouse_row" ? Math.round((s.widthFt / n) * 10) / 10 : s.typology === "two_unit" && unitRects(s).length === 2 ? s.widthFt / 2 : s.widthFt;
  const park = s.parking.type === "tuck" ? "garage" : s.parking.type === "none" ? "none" : "surface";
  const garages = (s.site?.parking?.garages ?? []).length;
  const bindingId = (s.bindingConstraint?.rule ?? "none") as string;
  return {
    id: `qf2:${s.typology}:${s.widthFt}x${s.depthFt}x${s.stories}:${n}`,
    typology: V1_TYPOLOGY[s.typology],
    typologyLabel: s.typologyLabel,
    unitWidthFt: rowW,
    unitDepthFt: s.depthFt,
    stories: s.stories,
    heightFt: s.heightFt,
    parking: park,
    units: n,
    buildings: s.typology === "adu" ? 1 : 1,
    footprints: unitRects(s),
    footprintSf: s.widthFt * s.depthFt,
    grossFloorAreaSf: s.grossSqft,
    netFloorAreaSf: s.netSqft,
    garageAreaSf: garages * 250,
    lotCoveragePct: s.lotCoverage,
    parkingSpaces: s.parking.count,
    parkingRequired: s.parking.required,
    permission: { code: perm, use: s.typologyLabel },
    badge: s.status === "allowed_by_right" ? "by_right" : s.status === "needs_approval" ? "needs_approval" : "not_permitted",
    byRight: s.status === "allowed_by_right",
    approvals: [
      ...s.approvalsNeeded.filter((a) => a.rule === "use").map((a) => ({ kind: "use" as const, rule: "use", label: a.detail, toggled: false })),
      ...vr.map((rule) => ({ kind: "variance" as const, rule, label: s.approvalsNeeded.find((a) => (RULE_V1[a.rule] ?? a.rule) === rule)?.detail ?? rule, toggled: false })),
    ],
    needsSubdivision: s.subdivisionNeeded,
    binding: { id: bindingId as V1Scheme["binding"]["id"], label: s.bindingConstraint?.sentence ?? "", detail: s.unlock?.sentence ?? "" },
    finance: { hardCost: null, softCost: null, totalCost: null, revenue: null, profit: null, returnOnCost: null, affordableGap: null, notes: [] },
    warnings: s.flags,
  } as V1Scheme;
}

/** Hillside stepping for the pro forma (same fields the finance engine reads). */
export function steppingOf(s: Scheme) {
  const g = s.ground;
  const levels = [...new Set((g?.steps ?? []).map((x) => x.elevFt))];
  const drop = levels.length ? Math.max(...levels) - Math.min(...levels) : 0;
  return {
    footprintSlopePct: g?.slopePct ?? null,
    thresholdPct: 15,
    incrementFt: 2.5,
    applies: levels.length > 1,
    steps: Math.max(0, levels.length - 1),
    dropFt: Math.round(drop * 10) / 10,
    cells: [] as { plate: number; ground: number }[],
  };
}

// ------------------------------------------------------------------------------------ score fits

export interface V2Fit {
  status: "by_right" | "contextual" | "variance" | "no_fit";
  varianceRules: string[];
  envelopeAreaSf: number | null;
  units: number | null;
  permissionCode: Use | null;
  schemeId: string | null;
  needsSubdivision: boolean;
  notes: string[];
}

/**
 * The score's fit per new-build strategy from QuickFit v2: the scheme at code; if it needs dimensional
 * relief, the scheme with the contextual front setback (§925.06) when that rule applies; if nothing fits
 * at code, the scheme at the probe setbacks (variance path). Returns the fit and the priced scheme.
 */
export function scoreFits(src: AppSources, opts: { contextualFrontFt?: number; probeSetbacksFt: { front: number; rear: number; side: number } }) {
  const input = toParcelInput(src);
  const fits: Record<string, V2Fit> = {};
  const schemes: Record<string, V1Scheme> = {};
  const v2: Record<string, Scheme> = {};
  const controls: Record<string, AppControls> = {};
  const notes: string[] = [];
  if (!input) return { fits, schemes, v2, controls, notes: ["Lot outline or zoning rules unavailable; the fit test did not run."] };
  if (!(src.qf.frontEdges ?? []).length && src.frontEdgeIndex == null) notes.push("No street frontage found for this lot; the front was taken as its longest edge.");
  const unknown = unknownUses(src);
  const r = src.rules!;
  const USE_KEY: Record<Typology, keyof ParcelInput["zoning"]["uses"]> = { single_detached: "single_detached", two_unit: "two_unit", three_four: "three_unit", townhouse_row: "single_attached", adu: "adu" };
  for (const t of ["single_detached", "two_unit", "three_four", "townhouse_row"] as Typology[]) {
    const strategy = STRATEGY_OF[t];
    const base = DEFAULT_CONTROLS(t);
    let s = solveApp(input, base, unknown);
    let used: AppControls = base;
    // A use the district does not permit still gets its dimensional fit measured (the score reads the
    // permission separately), as the v1 fit did: solve the same lot with that use permitted.
    const notAllowed = s.status === "not_allowed";
    const inp = notAllowed ? { ...input, zoning: { ...input.zoning, uses: { ...input.zoning.uses, [USE_KEY[t]]: "P", ...(t === "three_four" ? { three_unit: "P", multi_unit: "P" } : {}) } } } as ParcelInput : input;
    if (notAllowed) s = solve(inp, toControls(base));
    let status: V2Fit["status"];
    const dims = (x: Scheme) => varianceRules(x);
    if (!s.footprintWorld) {
      const p = opts.probeSetbacksFt;
      const pc: AppControls = { ...base, setbacks: { front: Math.min(p.front, r.min_front_setback_ft ?? p.front), rear: Math.min(p.rear, r.min_rear_setback_ft ?? p.rear), side: Math.min(p.side, r.min_side_setback_ft ?? p.side) } };
      const probe = solve(inp, toControls(pc));
      if (probe.footprintWorld) { s = probe; used = pc; status = "variance"; } else status = "no_fit";
    } else if (!dims(s).length) status = "by_right";
    else {
      status = "variance";
      const ctx = opts.contextualFrontFt;
      if (ctx != null && r.contextual_front_setback && (r.min_front_setback_ft ?? 0) > ctx) {
        const cc: AppControls = { ...base, setbacks: { front: ctx } };
        const c = solve(inp, toControls(cc));
        const rest = dims(c).filter((x) => x !== "front_setback");
        if (c.footprintWorld && !rest.length) { s = c; used = cc; status = "contextual"; }
      }
    }
    const v1 = s.footprintWorld ? toV1Scheme(s, inp) : null;
    if (v1 && notAllowed) v1.permission = { code: "N", use: v1.permission.use };
    if (v1) schemes[strategy] = v1;
    v2[strategy] = s;
    controls[strategy] = used;
    const vr = status === "variance" ? (dims(s).length ? dims(s) : ["front_setback"]) : [];
    fits[strategy] = {
      status,
      varianceRules: vr,
      envelopeAreaSf: ((s as unknown as { debug?: { buildableSqft?: number } }).debug?.buildableSqft) ?? null,
      units: status === "no_fit" ? 0 : s.units.length,
      permissionCode: unknown.includes(t) ? null : notAllowed ? "N" : permissionOf(s, inp),
      schemeId: v1?.id ?? null,
      needsSubdivision: t === "townhouse_row",
      notes: status === "no_fit" ? ["No building of this type fits, even with reduced setbacks."]
        : status === "contextual" ? ["Fits once the contextual front setback applies."]
          : status === "variance" ? [`Fits only with relief from: ${vr.map((x) => x.replace(/_/g, " ")).join(", ")}.`] : [],
    };
  }
  return { fits, schemes, v2, controls, notes };
}
