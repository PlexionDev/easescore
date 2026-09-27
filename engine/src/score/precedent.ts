// Street precedent: what the existing buildings on a lot's block face look like, and what Pittsburgh's
// contextual front setback (§925.06.B) lets a new building do because of them.
//
// Input is public.parcel_street_precedent(parid) (migration 130): the block face's lots in street
// order with measured front setbacks (footprint to street-facing lot line), side yards, widths, areas,
// stories and units. Pure and deterministic; the medians match Postgres percentile_cont.
//
// §925.06.B (docs/CODE-CITATIONS.md §6), as applied here:
//   The front setback may fall anywhere between the district requirement and EITHER the setback of an
//   adjacent lot on the same side of the street OR a build-to line set by at least 50% of the primary
//   structures on the block face. It never requires more than the district setback and is not
//   available in the RIV riparian buffer. It applies by right (the applicant documents it).
// Interpretation (logged in .planning/DECISIONS.md):
//   * adjacent lot = the lots immediately before and after this one on the same block face;
//   * build-to line = the smallest setback that at least half of the other primary structures on the
//     face sit at or in front of (needs 2+ measured structures);
//   * the permitted setback is the smaller of those candidates, rounded UP to a whole foot, never
//     more than the district's;
//   * the lot's own existing building is not its own precedent.

export interface PrecedentLot {
  parid: string;
  pos: number | null;
  building: boolean;
  front: number | null;
  sideMin: number | null;
  width: number | null;
  area: number | null;
  stories: number | null;
  units: number | null;
  yearBuilt?: number | null;
  nonconform: string[] | null;
}

export interface BlockFaceRow {
  face_id: string;
  street_name: string | null;
  side: string;
  zone_code: string | null;
  district_front_ft: number | null;
  n_lots: number;
  n_buildings: number;
  front_median_ft: number | null;
  n_nonconform: number;
  nonconform_share: number | null;
  top_rules: { rule: string; n: number }[] | null;
}

export interface NearbyZbaCase {
  case: string | null;
  decision_date: string | null;
  address: string | null;
  relief: string | null;
  section: string | null;
  outcome: string | null;
  distance_m: number | null;
}

/** Shape of public.parcel_street_precedent(parid). */
export interface PrecedentRpc {
  parid: string;
  /** "face" = the centerline segment's side; "stretch" = same street and side within 400 ft (short or corner faces). */
  scope?: "face" | "stretch";
  streetName?: string | null;
  face: BlockFaceRow | null;
  lots: PrecedentLot[] | null;
  zba: NearbyZbaCase[] | null;
}

export interface PrecedentRules {
  zoneCode: string | null;
  min_front_setback_ft: number | null;
  contextual_front_setback: boolean | null;
}

export interface Spread { n: number; median: number; p25: number; p75: number; min: number; max: number }

export interface ContextualFront {
  /** True when §925.06.B lets this lot use a shallower front setback than the district's. */
  applies: boolean;
  /** The front setback the rule allows, ft (null when it does not apply). */
  ft: number | null;
  basis: "adjacent" | "block" | null;
  districtFt: number | null;
  /** Neighbors' measured setbacks (immediately before / after on the face). */
  adjacentFt: number[];
  /** Build-to line set by at least 50% of the other primary structures, ft. */
  buildToFt: number | null;
  reason: string;
  /** Short why, e.g. "the house next door sits 5.1 ft back" (empty when it does not apply). */
  why: string;
  citation: string;
}

export interface StreetPrecedent {
  parid: string;
  faceId: string;
  streetName: string | null;
  scope: "face" | "stretch";
  /** Lots in street order (for the strip chart): measured front setback when a building stands. */
  lots: { parid: string; building: boolean; front: number | null }[];
  /** Lots on the face, and those with a measured primary building (the subject lot left out). */
  nLots: number;
  nBuildings: number;
  front: Spread | null;
  sideMinFt: number | null;
  lotWidthFt: number | null;
  lotAreaSf: number | null;
  stories: number | null;
  units: number | null;
  maxUnits: number | null;
  districtFrontFt: number | null;
  /** Buildings sitting closer to the street than the district allows (1 ft tolerance). */
  closerThanCode: number;
  headline: string;
  contextual: ContextualFront;
  conformity: { nonconforming: number; withBuilding: number; share: number | null; topRules: { rule: string; n: number }[] };
  zba: NearbyZbaCase[];
}

export const CONTEXTUAL_CITATION = "Pittsburgh Zoning Code §925.06.B (contextual front setback)";
/** Measurement tolerance when comparing a measured setback with a code number, ft. */
export const TOLERANCE_FT = 1;
/** Fewest measured buildings for a block pattern to count (headline, badge, lever). */
export const MIN_BUILDINGS = 3;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Linear-interpolated quantile, same as Postgres percentile_cont. Null for an empty list. */
export function quantile(xs: number[], q: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo]! + (v[hi]! - v[lo]!) * (i - lo);
}

export const median = (xs: number[]) => quantile(xs, 0.5);

export function spread(xs: number[]): Spread | null {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return { n: v.length, median: quantile(v, 0.5)!, p25: quantile(v, 0.25)!, p75: quantile(v, 0.75)!, min: Math.min(...v), max: Math.max(...v) };
}

/** The smallest setback that at least half the structures sit at or in front of. Needs 2+. */
export function buildToLine(fronts: number[]): number | null {
  const v = fronts.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  return v[Math.ceil(v.length * 0.5) - 1]!;
}

const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x != null && Number.isFinite(Number(x))).map(Number);

/** §925.06.B for one lot on its block face (see the header for the reading used). */
export function contextualFront(parid: string, lots: PrecedentLot[], rules: PrecedentRules): ContextualFront {
  const districtFt = rules.min_front_setback_ft ?? null;
  const base = { districtFt, adjacentFt: [] as number[], buildToFt: null as number | null, citation: CONTEXTUAL_CITATION, why: "" };
  const no = (reason: string, extra: Partial<ContextualFront> = {}): ContextualFront => ({ ...base, ...extra, applies: false, ft: null, basis: null, reason });
  if (!rules.contextual_front_setback) return no("This district does not use contextual setbacks.");
  if ((rules.zoneCode ?? "").toUpperCase().startsWith("RIV")) return no("Contextual setbacks are not available in the riverfront (RIV) districts.");
  if (districtFt == null || districtFt <= 0) return no("The district has no minimum front setback, so there is nothing to relieve.");

  const ordered = [...lots].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const i = ordered.findIndex((l) => l.parid === parid);
  const neighbors = i < 0 ? [] : [ordered[i - 1], ordered[i + 1]].filter((l): l is PrecedentLot => !!l);
  const adjacentFt = nums(neighbors.filter((l) => l.building).map((l) => l.front));
  const others = nums(ordered.filter((l) => l.parid !== parid && l.building).map((l) => l.front));
  const buildToFt = buildToLine(others);
  const cands: { ft: number; basis: "adjacent" | "block" }[] = [
    ...adjacentFt.map((ft) => ({ ft, basis: "adjacent" as const })),
    ...(buildToFt != null ? [{ ft: buildToFt, basis: "block" as const }] : []),
  ];
  const extra = { adjacentFt, buildToFt };
  if (!cands.length) return no("No measured neighbor buildings on this block face, so the district setback applies.", extra);
  const best = cands.sort((a, b) => a.ft - b.ft || (a.basis === "adjacent" ? -1 : 1))[0]!;
  const ft = Math.min(districtFt, Math.ceil(best.ft - 1e-9));
  if (ft >= districtFt) return no(`Neighbors sit at least ${districtFt} ft back, the same as the code, so matching them gains nothing.`, extra);
  const why = best.basis === "adjacent"
    ? `the house next door sits ${r1(best.ft)} ft back`
    : `at least half of the ${others.length} buildings on this block sit ${r1(best.ft)} ft back or closer`;
  return { ...base, ...extra, applies: true, ft, basis: best.basis, why,
    reason: `A new building may line up with its neighbors: ${why}, so the front setback can be ${ft} ft instead of ${districtFt} ft (by right; the applicant documents the neighbors).` };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Block-face summary for the parcel pane card (null when the lot has no block face). */
export function streetPrecedent(rpc: PrecedentRpc | null | undefined, rules: PrecedentRules): StreetPrecedent | null {
  if (!rpc?.face || !rpc.lots?.length) return null;
  const lots = rpc.lots;
  const others = lots.filter((l) => l.parid !== rpc.parid);
  const built = others.filter((l) => l.building);
  const fronts = nums(built.map((l) => l.front));
  const front = spread(fronts);
  const districtFrontFt = rules.min_front_setback_ft ?? rpc.face.district_front_ft ?? null;
  const closerThanCode = districtFrontFt != null && districtFrontFt > 0 ? fronts.filter((f) => f < districtFrontFt - TOLERANCE_FT).length : 0;
  const unitsList = nums(built.map((l) => l.units));
  const withBuilding = lots.filter((l) => l.building).length;
  const nonconforming = lots.filter((l) => (l.nonconform ?? []).length > 0).length;
  const counts = new Map<string, number>();
  for (const l of lots) for (const r of l.nonconform ?? []) counts.set(r, (counts.get(r) ?? 0) + 1);
  const topRules = [...counts].map(([rule, n]) => ({ rule, n })).sort((a, b) => b.n - a.n || a.rule.localeCompare(b.rule));

  let headline: string;
  const n = fronts.length;
  if (!front || n < MIN_BUILDINGS) headline = n === 0 ? "No other buildings are measured on this block face." : `Only ${plural(n, "other building is", "other buildings are")} measured on this block face: too few to call a pattern.`;
  else {
    const band = `${Math.round(front.p25)}–${Math.round(front.p75)} ft`;
    headline = districtFrontFt != null && districtFrontFt > 0
      ? `${closerThanCode} of ${n} buildings on this block sit closer to the street than the ${districtFrontFt} ft the code requires (most ${band} from the front lot line).`
      : `${n} buildings on this block; most sit ${band} from the front lot line. The district has no minimum front setback.`;
  }
  return {
    parid: rpc.parid,
    faceId: rpc.face.face_id,
    streetName: rpc.streetName ?? rpc.face.street_name,
    scope: rpc.scope ?? "face",
    lots: [...lots].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map((l) => ({ parid: l.parid, building: l.building, front: l.front })),
    nLots: lots.length,
    nBuildings: n,
    front: front ? { ...front, median: r1(front.median), p25: r1(front.p25), p75: r1(front.p75) } : null,
    sideMinFt: nullR1(median(nums(built.map((l) => l.sideMin)))),
    lotWidthFt: nullR1(median(nums(others.map((l) => l.width)))),
    lotAreaSf: nullRound(median(nums(others.map((l) => l.area)))),
    stories: median(nums(built.map((l) => l.stories))),
    units: median(unitsList),
    maxUnits: unitsList.length ? Math.max(...unitsList) : null,
    districtFrontFt,
    closerThanCode,
    headline,
    contextual: contextualFront(rpc.parid, lots, rules),
    conformity: { nonconforming, withBuilding, share: withBuilding ? Math.round((nonconforming / withBuilding) * 1000) / 1000 : null, topRules },
    zba: rpc.zba ?? [],
  };
}

const nullR1 = (x: number | null) => (x == null ? null : r1(x));
const nullRound = (x: number | null) => (x == null ? null : Math.round(x));

/**
 * The front setback the fit test should use as the contextual setback:
 *   no precedent data -> undefined (the engine keeps its config assumption, labeled "assumed");
 *   the rule applies  -> the measured, permitted setback;
 *   it does not apply -> the district setback (so the contextual run adds nothing).
 */
export function contextualInputFt(p: StreetPrecedent | null | undefined): number | undefined {
  if (!p) return undefined;
  if (p.contextual.applies && p.contextual.ft != null) return p.contextual.ft;
  return p.contextual.districtFt ?? undefined;
}

/**
 * Planning-badge input "project matches block pattern": at least MIN_BUILDINGS measured buildings on
 * the face, the option's unit count is no more than the most units already on the face, and the front
 * line either follows the neighbors by right or the district setback already matches the block.
 * null when there is no block data (not evaluated).
 */
export function matchesBlockPattern(p: StreetPrecedent | null | undefined, units: number | null): { matched: boolean | null; note: string } {
  if (!p) return { matched: null, note: "Block-face data not loaded for this lot." };
  if (p.nBuildings < MIN_BUILDINGS) return { matched: null, note: "Too few measured buildings on this block face to set a pattern." };
  if (units != null && p.maxUnits != null && units > p.maxUnits)
    return { matched: false, note: `${units} units; the block's buildings have at most ${p.maxUnits}.` };
  const d = p.districtFrontFt ?? 0;
  const lineOk = p.contextual.applies || d <= 0 || (p.front != null && p.front.median >= d - TOLERANCE_FT);
  if (!lineOk) return { matched: false, note: "The block's front line is closer than the code allows and the contextual rule does not reach it." };
  return { matched: true, note: `Matches the block: ${p.nBuildings} measured buildings${p.maxUnits != null ? `, up to ${p.maxUnits} units` : ""}${p.contextual.applies ? `, front line ${p.contextual.ft} ft by §925.06` : ""}.` };
}
