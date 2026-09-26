// Housing strategies scored by the Ease Score, and how each one's dimensional fit is read from
// QuickFit. `fitsFromQuickFit` is pure extraction; `runStrategyFits` runs the solver (still pure:
// no I/O, deterministic) so callers that already hold solver results can skip it.

import { useColumn } from "../helpers";
import type { UsePermission } from "../types";
import { attachedRulesForDistrict } from "../quickfit/rules";
import { DUPLEX, SINGLE_FAMILY, TOWNHOUSE_ROW } from "../quickfit/presets";
import { solveQuickFit } from "../quickfit/solve";
import type { MaskInput, QuickFitResult, QuickFitRules, Ring, Scheme, TypologyPreset, VarianceToggle } from "../quickfit/types";
import { VERIFIED_ATTACHED } from "./code-refs";
import type { StrategyFit, StrategyId } from "./types";

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  new_sf: "New single-family house",
  duplex: "Duplex",
  three_four_unit: "3-4 unit building",
  townhouse_row: "Townhouse row",
  adu: "Accessory dwelling unit (ADU)",
  rehab_existing: "Rehab of the existing building",
};

export const NEW_BUILD: StrategyId[] = ["new_sf", "duplex", "three_four_unit", "townhouse_row"];

// EDITABLE PLACEHOLDERS, like the QuickFit presets: small stacked buildings, one unit per floor.
export const STACKED_TRIPLEX: TypologyPreset = {
  id: "stacked_3",
  label: "Stacked triplex",
  arrangement: "stacked",
  unitsPerBuilding: 3,
  unitWidthFt: { min: 20, max: 36, step: 1 }, // placeholder: building width
  unitDepthFt: { min: 36, max: 50, step: 1 }, // placeholder
  stories: { min: 3, max: 3 }, // placeholder
  floorToFloorFt: 10, // placeholder
  roofAllowanceFt: 0, // placeholder
  garage: false,
};

export const STACKED_FOURPLEX: TypologyPreset = {
  ...STACKED_TRIPLEX,
  id: "stacked_4",
  label: "Stacked fourplex",
  unitsPerBuilding: 4,
  unitWidthFt: { min: 24, max: 40, step: 1 }, // placeholder
};

export const SCORE_TYPOLOGIES: TypologyPreset[] = [SINGLE_FAMILY, DUPLEX, TOWNHOUSE_ROW, STACKED_TRIPLEX, STACKED_FOURPLEX];

const TYPOLOGIES_FOR: Partial<Record<StrategyId, string[]>> = {
  new_sf: ["single_family"],
  duplex: ["duplex"],
  three_four_unit: ["stacked_3", "stacked_4"],
  townhouse_row: ["townhouse_row"],
};

/** Use-table column(s) a strategy needs. Townhouse rows use single-unit attached. */
export function useColumnsFor(s: StrategyId, existingUse?: string | null): string[] {
  switch (s) {
    case "new_sf": return ["single_unit_detached"];
    case "duplex": return ["two_unit"];
    case "three_four_unit": return ["three_unit", "multi_unit"];
    case "townhouse_row": return ["single_unit_attached"];
    case "adu": return [];
    case "rehab_existing": {
      const col = existingUseColumn(existingUse);
      return col ? [col] : [];
    }
  }
}

/** Zoning use column for the building's current use (county assessment use description). */
export function existingUseColumn(use: string | null | undefined): string | null {
  const u = (use ?? "").toUpperCase();
  if (/ROWHOUSE|TOWNHOUSE/.test(u)) return "single_unit_attached";
  if (/SINGLE FAMILY/.test(u)) return useColumn(1);
  if (/TWO FAMILY/.test(u)) return useColumn(2);
  if (/THREE FAMILY/.test(u)) return useColumn(3);
  if (/FOUR FAMILY|APART|MULTI/.test(u)) return useColumn(4);
  return null;
}

const PERM_RANK: Record<string, number> = { P: 5, A: 4, S: 3, C: 2, N: 1 };
export const permRank = (c: UsePermission | null | undefined) => (c ? PERM_RANK[c] ?? 0 : -1);

// ---------------------------------------------------------------- QuickFit input from SQL

/** Shape returned by public.parcel_quickfit_input(parid). */
export interface QuickFitParcelInput {
  parcel: Ring;
  edges?: { i: number; len: number; az: number; street_ft: number | null }[];
  frontEdges: number[];
  streetSideEdges?: number[];
  masks?: MaskInput[];
  notes?: string[];
}

/** Front edges, falling back to the edge nearest any opened street when the SQL found none within 45 ft. */
export function frontEdgesFor(q: QuickFitParcelInput): { front: number[]; side: number[]; note: string | null } {
  if (q.frontEdges.length) return { front: q.frontEdges, side: q.streetSideEdges ?? [], note: null };
  const withDist = (q.edges ?? []).filter((e) => e.street_ft != null && e.len >= 8);
  if (withDist.length) {
    const e = [...withDist].sort((a, b) => a.street_ft! - b.street_ft! || b.len - a.len || a.i - b.i)[0]!;
    return {
      front: [e.i],
      side: [],
      note: `No lot edge sits within 45 ft of a street centerline; the edge nearest a street (${Math.round(e.street_ft!)} ft away) is used as the front. Confirm on a survey.`,
    };
  }
  if (q.edges?.length) {
    const e = [...q.edges].sort((a, b) => b.len - a.len || a.i - b.i)[0]!;
    return { front: [e.i], side: [], note: "No street found near the lot; the longest edge is used as the front for the fit test only." };
  }
  return { front: [], side: [], note: null };
}

// ---------------------------------------------------------------- fit extraction

const dimOk = (s: Scheme) => !s.approvals.some((a) => a.kind === "variance");
const varRules = (s: Scheme) => [...new Set(s.approvals.filter((a) => a.kind === "variance").map((a) => a.rule))].sort();

function bestCode(schemes: Scheme[]): UsePermission | null {
  let best: UsePermission | null = null;
  for (const s of schemes) if (permRank(s.permission.code) > permRank(best)) best = s.permission.code;
  return best;
}

function maxUnits(schemes: Scheme[]): number {
  return schemes.reduce((m, s) => Math.max(m, s.units), 0);
}

/**
 * Read one strategy's dimensional fit from QuickFit runs:
 * `base` (tabulated rules), `contextual` (contextual front setback applied), `probe` (setback relief).
 */
export function fitFromQuickFit(
  strategy: StrategyId,
  runs: { base: QuickFitResult; contextual?: QuickFitResult | null; probe?: QuickFitResult | null },
): StrategyFit | null {
  const typs = TYPOLOGIES_FOR[strategy];
  if (!typs) return null;
  const pick = (r?: QuickFitResult | null) => (r ? r.all.filter((s) => typs.includes(s.typology)) : []);
  const base = pick(runs.base);
  const envelopeAreaSf = runs.base.envelope.areaSf;
  const needsSubdivision = strategy === "townhouse_row";
  const common = { envelopeAreaSf, needsSubdivision };

  const okBase = base.filter(dimOk);
  if (okBase.length) return { ...common, status: "by_right", varianceRules: [], units: maxUnits(okBase), permissionCode: bestCode(okBase), notes: [] };

  const okCtx = pick(runs.contextual).filter(dimOk);
  if (okCtx.length)
    return { ...common, status: "contextual", varianceRules: [], units: maxUnits(okCtx), permissionCode: bestCode(okCtx),
      notes: ["Fits once the contextual front setback applies."] };

  const cands = [...base, ...pick(runs.probe)];
  if (cands.length) {
    const s = [...cands].sort(
      (a, b) => varRules(a).length - varRules(b).length || b.units - a.units || permRank(b.permission.code) - permRank(a.permission.code) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0]!;
    return { ...common, status: "variance", varianceRules: varRules(s), units: s.units, permissionCode: s.permission.code,
      notes: [`Fits only with relief from: ${varRules(s).map((r) => r.replace(/_/g, " ")).join(", ")}.`] };
  }
  return { ...common, status: "no_fit", varianceRules: [], units: 0, permissionCode: null,
    notes: ["No building of this type fits, even with reduced setbacks."] };
}

/**
 * The scheme behind a strategy's fit (same selection as fitFromQuickFit): the most units among
 * schemes that fit by right, else with the contextual setback, else the variance candidate with the
 * fewest rules to relieve. Used to size the pro forma (floor area, units). Null when nothing was tried.
 */
export function schemeFromQuickFit(
  strategy: StrategyId,
  runs: { base: QuickFitResult; contextual?: QuickFitResult | null; probe?: QuickFitResult | null },
): Scheme | null {
  const typs = TYPOLOGIES_FOR[strategy];
  if (!typs) return null;
  const pick = (r?: QuickFitResult | null) => (r ? r.all.filter((s) => typs.includes(s.typology)) : []);
  const most = (xs: Scheme[]) =>
    [...xs].sort((a, b) => b.units - a.units || permRank(b.permission.code) - permRank(a.permission.code) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
  const base = pick(runs.base);
  const okBase = base.filter(dimOk);
  if (okBase.length) return most(okBase);
  const okCtx = pick(runs.contextual).filter(dimOk);
  if (okCtx.length) return most(okCtx);
  const cands = [...base, ...pick(runs.probe)];
  if (!cands.length) return null;
  return [...cands].sort(
    (a, b) => varRules(a).length - varRules(b).length || b.units - a.units || permRank(b.permission.code) - permRank(a.permission.code) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0]!;
}

export interface FitRunOptions {
  /** Front setback when the contextual rule applies; undefined skips the contextual run. */
  contextualFrontFt?: number;
  /** Setbacks tried for the "could a variance make it fit" probe. */
  probeSetbacksFt: { front: number; rear: number; side: number };
}

/** Rules row for the solver: the zoning table row plus the single-unit-attached facts kept in its notes. */
export function solverRules(zoneCode: string, rules: QuickFitRules): QuickFitRules {
  const verified = VERIFIED_ATTACHED[zoneCode.toUpperCase()];
  return { ...(verified ? { single_unit_attached: verified } : {}), ...attachedRulesForDistrict(zoneCode), ...stripNulls(rules) } as QuickFitRules;
}

function stripNulls(r: QuickFitRules): QuickFitRules {
  // Keep explicit nulls for table columns (null = no limit / unknown), but never let a null from the
  // table erase the attached-housing facts supplied by attachedRulesForDistrict.
  const out: Record<string, unknown> = { ...r };
  for (const k of ["single_unit_attached", "attached_by_right_max_lot_width_ft", "attached_wider_lot_permission", "attached_parking_per_unit"])
    if (out[k] === null || out[k] === undefined) delete out[k];
  return out as unknown as QuickFitRules;
}

/** Run QuickFit (base, contextual, setback probe) and read every new-build strategy's fit. */
export function runStrategyFits(
  q: QuickFitParcelInput,
  rules: QuickFitRules,
  opts: FitRunOptions,
): { fits: Partial<Record<StrategyId, StrategyFit>>; notes: string[]; schemes: Partial<Record<StrategyId, Scheme>> } {
  const fe = frontEdgesFor(q);
  const notes = fe.note ? [fe.note] : [];
  if (!fe.front.length || q.parcel.length < 3) return { fits: {}, schemes: {}, notes: [...notes, "Lot outline or street frontage unavailable; the fit test did not run."] };
  const common = {
    parcel: q.parcel,
    frontEdges: fe.front,
    streetSideEdges: fe.side,
    masks: q.masks ?? [],
    typologies: SCORE_TYPOLOGIES,
    includeNotPermitted: true,
  };
  const base = solveQuickFit({ ...common, rules });
  const contextual =
    opts.contextualFrontFt != null && rules.contextual_front_setback && (rules.min_front_setback_ft ?? 0) > opts.contextualFrontFt
      ? solveQuickFit({ ...common, rules, setbackOverrides: { front: opts.contextualFrontFt, note: "contextual front setback (assumed)" } })
      : null;
  const p = opts.probeSetbacksFt;
  const toggles: VarianceToggle[] = [];
  if ((rules.min_front_setback_ft ?? 0) > p.front) toggles.push({ rule: "front_setback", value: p.front });
  if ((rules.min_rear_setback_ft ?? 0) > p.rear) toggles.push({ rule: "rear_setback", value: p.rear });
  if ((rules.min_side_setback_ft ?? 0) > p.side) toggles.push({ rule: "side_setback", value: p.side });
  if (fe.side.length) toggles.push({ rule: "exterior_side_setback", value: p.side });
  const probe = toggles.length ? solveQuickFit({ ...common, rules, variances: toggles }) : null;

  const fits: Partial<Record<StrategyId, StrategyFit>> = {};
  const schemes: Partial<Record<StrategyId, Scheme>> = {};
  for (const s of NEW_BUILD) {
    const f = fitFromQuickFit(s, { base, contextual, probe });
    if (f) fits[s] = f;
    const sc = schemeFromQuickFit(s, { base, contextual, probe });
    if (sc) schemes[s] = sc;
  }
  return { fits, notes, schemes };
}
