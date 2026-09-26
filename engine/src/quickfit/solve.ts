// QuickFit solver: envelope -> placement sweep -> zoning checks -> metrics -> ranking.
// Pure and deterministic: no clock, no randomness, no I/O. Same input, same output.

import { schemeFinance } from "./finance";
import {
  buildEnvelope, classifyEdges, frameFromEdge, indexEnvelope, multiArea, openRing, overlapArea,
  polyToLocal, polyToWorld, rectInside, signedArea, toLocal, toWorld, type EnvIndex, type Frame,
} from "./geometry";
import { place, steps, type Placement } from "./placement";
import { DEFAULT_ASSUMPTIONS, DEFAULT_PARKING_OPTIONS, DEFAULT_TYPOLOGIES } from "./presets";
import { oddsForToggle, parkingPerUnit, permissionFor, round1 } from "./rules";
import type {
  Approval, Assumptions, Badge, Binding, BindingId, Goal, ParkingOption, Poly, QuickFitInput,
  QuickFitResult, Ring, Scheme, SetbackClass, TypologyPreset, VarianceDelta, VarianceReport,
  VarianceRule, VarianceToggle,
} from "./types";

/** The dimensional rules one run uses (base rules, or base rules with variance toggles applied). */
export interface RuleSet {
  setbacks: Record<SetbackClass, number>;
  maxHeightFt: number | null;
  maxStories: number | null;
  minLotArea: number | null;
  perUnit: number | null;
  /** Set only by a parking variance toggle; otherwise the typology's minimum applies. */
  parkingPerUnit: number | null;
}

const SETBACK_RULE: Record<SetbackClass, VarianceRule> = {
  front: "front_setback",
  rear: "rear_setback",
  side: "side_setback",
  exterior_side: "exterior_side_setback",
};

const BINDING_LABEL: Record<BindingId, string> = {
  front_setback: "Front setback is the limit",
  rear_setback: "Rear setback is the limit",
  side_setback: "Side setbacks are the limit",
  exterior_side_setback: "Street-side setback is the limit",
  unbuildable_area: "Unbuildable area is the limit",
  lot_area_per_unit: "Lot area per unit is the limit",
  height: "Height is the limit",
  row_length: "Row length cap is the limit",
  unit_width: "Unit width is the limit",
  preset: "Unit size preset is the limit",
};

export function applyToggle(rs: RuleSet, v: VarianceToggle): RuleSet {
  const next: RuleSet = { ...rs, setbacks: { ...rs.setbacks } };
  switch (v.rule) {
    case "front_setback": next.setbacks.front = v.value; break;
    case "rear_setback": next.setbacks.rear = v.value; break;
    case "side_setback": next.setbacks.side = v.value; break;
    case "exterior_side_setback": next.setbacks.exterior_side = v.value; break;
    case "max_height_ft": next.maxHeightFt = v.value; break;
    case "max_height_stories": next.maxStories = v.value; break;
    case "min_lot_area": next.minLotArea = v.value; break;
    case "min_lot_area_per_unit": next.perUnit = v.value; break;
    case "parking_per_unit": next.parkingPerUnit = v.value; break;
  }
  return next;
}

function baseValue(rs: RuleSet, rule: VarianceRule): number | null {
  switch (rule) {
    case "front_setback": return rs.setbacks.front;
    case "rear_setback": return rs.setbacks.rear;
    case "side_setback": return rs.setbacks.side;
    case "exterior_side_setback": return rs.setbacks.exterior_side;
    case "max_height_ft": return rs.maxHeightFt;
    case "max_height_stories": return rs.maxStories;
    case "min_lot_area": return rs.minLotArea;
    case "min_lot_area_per_unit": return rs.perUnit;
    case "parking_per_unit": return rs.parkingPerUnit;
  }
}

const BADGE_RANK: Record<Badge, number> = { by_right: 0, needs_approval: 1, not_permitted: 2 };

function byUnits(a: Scheme, b: Scheme): number {
  return (
    b.units - a.units ||
    BADGE_RANK[a.badge] - BADGE_RANK[b.badge] ||
    b.grossFloorAreaSf - a.grossFloorAreaSf ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function nullsLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
}

export function rankSchemes(schemes: Scheme[], goal: Goal, includeNotPermitted = false): Scheme[] {
  let list = schemes.filter((s) => includeNotPermitted || s.badge !== "not_permitted");
  if (goal === "by_right_only") list = list.filter((s) => s.byRight);
  const cmp =
    goal === "best_return"
      ? (a: Scheme, b: Scheme) => nullsLast(a.finance.profit, b.finance.profit, -1) || byUnits(a, b)
      : goal === "smallest_affordable_gap"
        ? (a: Scheme, b: Scheme) => nullsLast(a.finance.affordableGap, b.finance.affordableGap, 1) || byUnits(a, b)
        : byUnits;
  return [...list].sort(cmp);
}

type KeyedEnv = EnvIndex & { key: string };

interface Ctx {
  input: QuickFitInput;
  frame: Frame;
  parcelLocal: Ring;
  classes: SetbackClass[];
  lotArea: number;
  frontageFt: number;
  cutMasks: Poly[];
  cutLabels: string[];
  flagMasks: { poly: Poly; label: string }[];
  typologies: TypologyPreset[];
  parking: ParkingOption[];
  a: Assumptions;
  envCache: Map<string, KeyedEnv>;
  placeCache: Map<string, Placement | null>;
}

function envFor(ctx: Ctx, setbacks: Record<SetbackClass, number>, masks = true): KeyedEnv {
  const key = `${setbacks.front}|${setbacks.rear}|${setbacks.side}|${setbacks.exterior_side}|${masks}`;
  let e = ctx.envCache.get(key);
  if (!e) {
    e = { ...indexEnvelope(buildEnvelope(ctx.parcelLocal, ctx.classes, setbacks, masks ? ctx.cutMasks : [])), key };
    ctx.envCache.set(key, e);
  }
  return e;
}

function placeFor(ctx: Ctx, env: KeyedEnv, t: TypologyPreset, w: number): Placement | null {
  const key = `${env.key}#${t.id}#${w}`;
  if (!ctx.placeCache.has(key)) ctx.placeCache.set(key, env.polys.length ? place(env, t, w, ctx.a.gridStepFt) : null);
  return ctx.placeCache.get(key)!;
}

/** Most stories the height rules allow for this preset, or null when unlimited. */
function storiesAllowed(rs: RuleSet, t: TypologyPreset): number | null {
  const byFt = rs.maxHeightFt != null ? Math.floor((rs.maxHeightFt - t.roofAllowanceFt) / t.floorToFloorFt + 1e-9) : null;
  if (byFt == null) return rs.maxStories;
  return rs.maxStories == null ? byFt : Math.min(byFt, rs.maxStories);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function unitsUnderCap(ctx: Ctx, rs: RuleSet, t: TypologyPreset, p: Placement): { units: number; capped: boolean } {
  if (t.arrangement !== "row" || !rs.perUnit) return { units: p.units, capped: false };
  const max = Math.floor(ctx.lotArea / rs.perUnit + 1e-9);
  return max < p.units ? { units: max, capped: true } : { units: p.units, capped: false };
}

const rowFootprint = (t: TypologyPreset, p: Placement, units: number) =>
  t.arrangement === "row" ? units * p.unitWidth * p.depth : p.footprintSf;

function findBinding(
  ctx: Ctx, rs: RuleSet, t: TypologyPreset, w: number, p: Placement, units: number, capped: boolean, stories: number,
): Binding {
  if (capped)
    return {
      id: "lot_area_per_unit",
      label: BINDING_LABEL.lot_area_per_unit,
      detail: `${round1(ctx.lotArea)} sf of lot at ${rs.perUnit} sf per unit allows ${plural(units, "unit")}; ${p.units} would fit.`,
    };
  if (t.arrangement === "row" && t.maxUnits != null && p.units >= t.maxUnits)
    return { id: "row_length", label: BINDING_LABEL.row_length, detail: `The preset stops at ${t.maxUnits} units.` };

  const gfa = rowFootprint(t, p, units) * stories;
  // Best (units, then floor area) this typology reaches at this width or wider, inside `env`.
  const widths = steps(t.unitWidthFt).filter((x) => x >= w - 1e-9);
  const bestAt = (env: KeyedEnv) => {
    let best: { units: number; gfa: number; width: number } | null = null;
    for (const x of widths) {
      const q = placeFor(ctx, env, t, x);
      if (!q) continue;
      const u = unitsUnderCap(ctx, rs, t, q).units;
      const g = rowFootprint(t, q, u) * stories;
      if (!best || u > best.units || (u === best.units && g > best.gfa + 1e-6)) best = { units: u, gfa: g, width: x };
    }
    return best;
  };
  const here = bestAt(envFor(ctx, rs.setbacks));
  if (here && (here.units > units || here.gfa > gfa + 1e-6))
    return {
      id: "unit_width",
      label: BINDING_LABEL.unit_width,
      detail: `A ${here.width} ft unit also fits here (${plural(here.units, "unit")}, ${round1(here.gfa)} sf).`,
    };

  const cands: { id: BindingId; unitsGain: number; gfaGain: number; how: string }[] = [];
  const tryEnv = (id: BindingId, env: KeyedEnv, how: string) => {
    const b = bestAt(env);
    if (b) cands.push({ id, unitsGain: b.units - units, gfaGain: b.gfa - gfa, how });
  };
  const present = new Set(ctx.classes);
  for (const cls of ["front", "rear", "side", "exterior_side"] as SetbackClass[])
    if (present.has(cls) && rs.setbacks[cls] > 0)
      tryEnv(SETBACK_RULE[cls] as BindingId, envFor(ctx, { ...rs.setbacks, [cls]: 0 }), `with a 0 ft ${cls.replace("_", " ")} setback`);
  if (ctx.cutMasks.length) tryEnv("unbuildable_area", envFor(ctx, rs.setbacks, false), "without the unbuildable area");
  const allowed = storiesAllowed(rs, t);
  if (allowed != null && stories >= allowed)
    cands.push({ id: "height", unitsGain: 0, gfaGain: rowFootprint(t, p, units), how: "with one more story" });

  const best = cands
    .filter((c) => c.unitsGain > 0 || c.gfaGain > 1e-6)
    .sort((a, b) => b.unitsGain - a.unitsGain || b.gfaGain - a.gfaGain)[0];
  if (!best)
    return {
      id: "preset",
      label: BINDING_LABEL.preset,
      detail: "No single zoning rule limits this scheme; widen the unit size or story range to go bigger.",
    };
  const label =
    best.id === "unbuildable_area" ? `Unbuildable area (${ctx.cutLabels.join(", ")}) is the limit` : BINDING_LABEL[best.id];
  const gains = [best.unitsGain > 0 ? `+${plural(best.unitsGain, "unit")}` : "", best.gfaGain > 1e-6 ? `+${round1(best.gfaGain)} sf` : ""]
    .filter(Boolean)
    .join(", ");
  return { id: best.id, label, detail: `${gains} ${best.how}.` };
}

function blocksInside(env: EnvIndex, p: Placement, units: number, t: TypologyPreset): boolean {
  // Row: only the first `units` units are kept, so shrink the block to them.
  const [x0, y0, x1, y1] = p.blocks[0]!;
  const right = t.arrangement === "row" ? x0 + units * p.unitWidth : x1;
  return rectInside(env, x0, y0, right, y1);
}

function run(ctx: Ctx, base: RuleSet, toggles: VarianceToggle[]): Scheme[] {
  const rs = toggles.reduce(applyToggle, base);
  const toggled = new Map(toggles.map((v) => [v.rule, v]));
  const env = envFor(ctx, rs.setbacks);
  const out: Scheme[] = [];
  const rules = ctx.input.rules;

  for (const t of ctx.typologies) {
    for (const w of steps(t.unitWidthFt)) {
      const p = placeFor(ctx, env, t, w);
      if (!p) continue;
      const { units, capped } = unitsUnderCap(ctx, rs, t, p);
      if (units < 1 || (t.arrangement === "row" && units < 2)) continue;
      const footprintSf = rowFootprint(t, p, units);
      const rects = t.arrangement === "row" ? p.unitRects.slice(0, units) : p.unitRects;
      const footprints = rects.map((r) => r.map((q) => toWorld(ctx.frame, q)));

      // New lots for a row: interior lots are one unit wide, end lots take the leftover frontage.
      let subLots: Scheme["subLots"];
      if (t.arrangement === "row") {
        const endW = w + (ctx.frontageFt - units * w) / 2;
        const minW = units >= 3 ? Math.min(w, endW) : endW;
        subLots = {
          count: units,
          maxWidthFt: round1(Math.max(w, endW)),
          minWidthFt: round1(minW),
          minAreaSf: round1((ctx.lotArea * minW) / ctx.frontageFt),
        };
      }
      const perm = permissionFor(rules, t, units, subLots?.maxWidthFt);

      // Setback toggles this placement actually relies on.
      const setbackNeeds: Approval[] = [];
      for (const cls of ["front", "rear", "side", "exterior_side"] as SetbackClass[]) {
        const v = toggled.get(SETBACK_RULE[cls]);
        if (!v || v.value >= base.setbacks[cls]) continue;
        const without = envFor(ctx, { ...rs.setbacks, [cls]: base.setbacks[cls] });
        if (!blocksInside(without, p, units, t))
          setbackNeeds.push({
            kind: "variance",
            rule: SETBACK_RULE[cls],
            label: `Variance: ${cls.replace("_", " ")} setback ${base.setbacks[cls]} ft -> ${v.value} ft`,
            toggled: true,
            odds: oddsForToggle(v, ctx.input.zbaCounts),
          });
      }

      const minPark = rs.parkingPerUnit ?? parkingPerUnit(rules, t);
      const basePark = base.parkingPerUnit ?? parkingPerUnit(rules, t);
      const perBuildingUnits = t.arrangement === "row" ? 1 : t.unitsPerBuilding;
      for (let stories = t.stories.min; stories <= t.stories.max; stories++) {
        for (const parking of ctx.parking) {
          const warnings: string[] = [];
          if (parking === "garage") {
            if (!t.garage || stories < 2 || w < ctx.a.garageWidthFt || p.depth < ctx.a.garageDepthFt) continue;
            if (t.arrangement === "stacked" && Math.floor(w / ctx.a.garageWidthFt) < perBuildingUnits) continue;
          }
          const required = minPark == null ? null : Math.ceil(units * minPark - 1e-9);
          const requiredBase = basePark == null ? null : Math.ceil(units * basePark - 1e-9);
          const wanted = Math.ceil(units * ctx.a.spacesPerUnit - 1e-9);
          const spaces = parking === "none" ? 0 : parking === "garage" ? units : Math.max(required ?? 0, wanted);
          if (parking === "surface") {
            const open = ctx.lotArea - footprintSf - ctx.frontageFt * rs.setbacks.front;
            if (open < spaces * ctx.a.surfaceStallAreaSf) continue;
            warnings.push("Surface parking is checked by open area only; stall layout, drive and curb cut are not modeled.");
          }
          if (required === null) warnings.push("Parking minimum unknown for this use; check §914.02.A.");

          const garageAreaSf = parking === "garage" ? spaces * ctx.a.garageWidthFt * ctx.a.garageDepthFt : 0;
          const gfa = footprintSf * stories;
          const nfa = (gfa - garageAreaSf) * ctx.a.efficiency;
          const heightFt = stories * t.floorToFloorFt + t.roofAllowanceFt;

          const approvals: Approval[] = [];
          if (perm.approval) approvals.push(perm.approval);
          approvals.push(...setbackNeeds);
          const dim = (rule: VarianceRule, label: string, breaksBase: boolean, breaksRelaxed: boolean) => {
            if (!breaksBase) return;
            const v = toggled.get(rule);
            const isToggled = !!v && !breaksRelaxed;
            approvals.push({ kind: "variance", rule, label, toggled: isToggled, odds: isToggled ? oddsForToggle(v!, ctx.input.zbaCounts) : undefined });
          };
          dim("max_height_stories", `Variance: ${stories} stories (limit ${base.maxStories})`,
            base.maxStories != null && stories > base.maxStories, rs.maxStories != null && stories > rs.maxStories);
          dim("max_height_ft", `Variance: ${heightFt} ft height (limit ${base.maxHeightFt} ft)`,
            base.maxHeightFt != null && heightFt > base.maxHeightFt, rs.maxHeightFt != null && heightFt > rs.maxHeightFt);
          const lotForMin = subLots ? subLots.minAreaSf : ctx.lotArea;
          dim("min_lot_area", `Variance: ${subLots ? "new lot" : "lot"} area ${round1(lotForMin)} sf (minimum ${base.minLotArea} sf)`,
            base.minLotArea != null && lotForMin < base.minLotArea - 1e-6, rs.minLotArea != null && lotForMin < rs.minLotArea - 1e-6);
          dim("min_lot_area_per_unit", `Variance: ${units} units needs ${base.perUnit} sf of lot each`,
            base.perUnit != null && units * base.perUnit > ctx.lotArea + 1e-6, rs.perUnit != null && units * rs.perUnit > ctx.lotArea + 1e-6);
          dim("parking_per_unit", `Variance: ${spaces} parking spaces (minimum ${requiredBase})`,
            requiredBase != null && spaces < requiredBase, required != null && spaces < required);
          if (rules.max_far != null && gfa / ctx.lotArea > rules.max_far + 1e-9)
            approvals.push({ kind: "variance", rule: "max_far", label: `Variance: FAR ${round1(gfa / ctx.lotArea)} (limit ${rules.max_far})`, toggled: false });
          const coverage = (footprintSf / ctx.lotArea) * 100;
          if (rules.max_lot_coverage_pct != null && coverage > rules.max_lot_coverage_pct + 1e-9)
            approvals.push({ kind: "variance", rule: "max_lot_coverage", label: `Variance: lot coverage ${round1(coverage)}% (limit ${rules.max_lot_coverage_pct}%)`, toggled: false });

          for (const m of ctx.flagMasks) {
            const ov = overlapArea(rects.map((r) => [r]), [m.poly]);
            if (ov > 1) warnings.push(`Footprint overlaps ${m.label} (${round1(ov)} sf); flagged, not cut.`);
          }

          const needsSubdivision = t.arrangement === "row";
          const badge: Badge = perm.code === "N" ? "not_permitted" : approvals.length ? "needs_approval" : "by_right";
          out.push({
            id: `${t.id}|w${w}|s${stories}|${parking}`,
            typology: t.id,
            typologyLabel: t.label,
            unitWidthFt: w,
            unitDepthFt: p.depth,
            stories,
            heightFt,
            parking,
            units,
            buildings: 1,
            footprints,
            footprintSf: round1(footprintSf),
            grossFloorAreaSf: round1(gfa),
            netFloorAreaSf: round1(nfa),
            garageAreaSf: round1(garageAreaSf),
            lotCoveragePct: round1(coverage),
            parkingSpaces: spaces,
            parkingRequired: required,
            permission: { code: perm.code, use: perm.use },
            badge,
            byRight: approvals.length === 0,
            approvals,
            needsSubdivision,
            ...(subLots ? { subLots } : {}),
            binding: findBinding(ctx, rs, t, w, p, units, capped, stories),
            finance: schemeFinance(
              { typology: t.id, units, grossFloorAreaSf: gfa, netFloorAreaSf: nfa, parking, parkingSpaces: spaces, needsSubdivision },
              ctx.input.costs,
              ctx.input.revenue,
            ),
            warnings,
          });
        }
      }
    }
  }
  return out;
}

function bestSummary(schemes: Scheme[], ok: (s: Scheme) => boolean) {
  const s = [...schemes]
    .filter((x) => x.badge !== "not_permitted" && ok(x))
    .sort((a, b) => b.units - a.units || b.grossFloorAreaSf - a.grossFloorAreaSf || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  return s ? { scheme: s, summary: { schemeId: s.id, units: s.units, grossFloorAreaSf: s.grossFloorAreaSf } } : null;
}

function varianceReport(ctx: Ctx, base: RuleSet, baseRun: Scheme[], allRun: Scheme[], toggles: VarianceToggle[]): VarianceReport {
  const byRight = bestSummary(baseRun, (s) => s.byRight);
  const onlyToggled = (s: Scheme) => s.approvals.every((a) => a.toggled);
  const withAll = bestSummary(allRun, onlyToggled);
  const d = (x: typeof byRight, y: typeof byRight) => ({
    units: (y?.scheme.units ?? 0) - (x?.scheme.units ?? 0),
    gfa: round1((y?.scheme.grossFloorAreaSf ?? 0) - (x?.scheme.grossFloorAreaSf ?? 0)),
    profit: x?.scheme.finance.profit != null && y?.scheme.finance.profit != null ? y.scheme.finance.profit - x.scheme.finance.profit : null,
  });
  const total = d(byRight, withAll);
  const perToggle: VarianceDelta[] = toggles.map((v) => {
    const one = bestSummary(run(ctx, base, [v]), onlyToggled);
    const dd = d(byRight, one);
    return {
      rule: v.rule,
      from: baseValue(base, v.rule),
      to: v.value,
      odds: oddsForToggle(v, ctx.input.zbaCounts),
      deltaUnits: dd.units,
      deltaGrossFloorAreaSf: dd.gfa,
      deltaProfit: dd.profit,
    };
  });
  return {
    byRightBest: byRight?.summary ?? null,
    withVariancesBest: withAll?.summary ?? null,
    deltaUnits: total.units,
    deltaGrossFloorAreaSf: total.gfa,
    deltaProfit: total.profit,
    perToggle,
  };
}

export function solveQuickFit(input: QuickFitInput): QuickFitResult {
  const parcel = openRing(input.parcel);
  if (parcel.length < 3) throw new Error("QuickFit: parcel needs at least 3 vertices");
  if (!input.frontEdges.length) throw new Error("QuickFit: at least one front edge is required");
  for (const i of [...input.frontEdges, ...(input.rearEdges ?? []), ...(input.streetSideEdges ?? [])])
    if (!Number.isInteger(i) || i < 0 || i >= parcel.length) throw new Error(`QuickFit: edge index ${i} is out of range`);

  const a: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...input.assumptions };
  const frame = frameFromEdge(parcel, input.frontEdges[0]!);
  const parcelLocal = parcel.map((q) => toLocal(frame, q));
  const f0a = parcel[input.frontEdges[0]!]!;
  const f0b = parcel[(input.frontEdges[0]! + 1) % parcel.length]!;
  const masks = input.masks ?? [];
  const ctx: Ctx = {
    input,
    frame,
    parcelLocal,
    classes: classifyEdges(parcel, input.frontEdges, input.rearEdges, input.streetSideEdges),
    lotArea: Math.abs(signedArea(parcel)),
    frontageFt: Math.hypot(f0b[0] - f0a[0], f0b[1] - f0a[1]),
    cutMasks: masks.filter((m) => (m.mode ?? "cut") === "cut").map((m) => polyToLocal(frame, m.polygon)),
    cutLabels: [...new Set(masks.filter((m) => (m.mode ?? "cut") === "cut").map((m) => m.label))],
    flagMasks: masks.filter((m) => m.mode === "flag").map((m) => ({ poly: polyToLocal(frame, m.polygon), label: m.label })),
    typologies: input.typologies ?? DEFAULT_TYPOLOGIES,
    parking: input.parkingOptions ?? DEFAULT_PARKING_OPTIONS,
    a,
    envCache: new Map(),
    placeCache: new Map(),
  };

  const r = input.rules;
  const o = input.setbackOverrides ?? {};
  const receipts: string[] = [
    "Lengths in feet, areas in square feet, coordinates in a local projected CRS.",
    "Typology presets and physical assumptions are editable placeholders, not standards.",
    `Net floor area = (gross - garage) x ${a.efficiency} efficiency.`,
    "Overlay districts, residential compatibility standards and parking maximums are not modeled.",
    "Row schemes assume each unit gets its own lot along the frontage (fee-simple), so they need a subdivision.",
  ];
  const sb = (v: number | undefined, tab: number | null, name: string) => {
    if (v != null) return v;
    if (tab == null) receipts.push(`No ${name} setback in the rules; treated as 0 ft.`);
    return tab ?? 0;
  };
  const front = sb(o.front, r.min_front_setback_ft, "front");
  const setbacks: Record<SetbackClass, number> = {
    front,
    rear: sb(o.rear, r.min_rear_setback_ft, "rear"),
    side: sb(o.side, r.min_side_setback_ft, "side"),
    exterior_side: o.exterior_side ?? r.exterior_side_setback_ft ?? front,
  };
  if (ctx.classes.includes("exterior_side") && o.exterior_side == null && r.exterior_side_setback_ft == null)
    receipts.push("Street-side setback not given; the front setback was used.");
  if (o.note) receipts.push(`Setback override: ${o.note}`);
  if (r.contextual_front_setback) receipts.push("A contextual front setback may apply (§925.06); pass it as a setback override.");
  if (r.confidence && r.confidence !== "confirmed") receipts.push(`Zoning rule transcription is ${r.confidence}; check the code text.`);

  const base: RuleSet = {
    setbacks,
    maxHeightFt: r.max_height_ft,
    maxStories: r.max_height_stories,
    minLotArea: r.min_lot_area_sqft,
    perUnit: r.min_lot_area_per_unit_sqft ?? null,
    parkingPerUnit: null,
  };

  const toggles = input.variances ?? [];
  const baseRun = run(ctx, base, []);
  const allRun = toggles.length ? run(ctx, base, toggles) : baseRun;
  const goal = input.goal ?? "most_units";
  const ranked = rankSchemes(allRun, goal, input.includeNotPermitted);
  const envelope = envFor(ctx, setbacks);

  return {
    units: "ft",
    lotAreaSf: round1(ctx.lotArea),
    envelope: { polygons: envelope.polys.map((p) => polyToWorld(frame, p)), areaSf: round1(multiArea(envelope.polys)) },
    goal,
    ranked,
    best: ranked[0] ?? null,
    all: allRun,
    variance: toggles.length ? varianceReport(ctx, base, baseRun, allRun, toggles) : null,
    receipts,
  };
}
