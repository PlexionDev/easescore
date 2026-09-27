// Site work by quantity: QuickFit v2's ground quantities (foundation wall area, retaining wall length
// and height, floor plates, garage cut) × unit cost ranges with their sources. Pure and deterministic.
//
// Every unit cost is a labeled assumption from a cited range (engine/config/site-work.v0.1.json).
// Nothing here changes the budget by itself: the caller decides whether these lines replace the
// cost model's allowances (cost model v0.2 prices hillside site work per sq ft of footprint plus a
// retaining-wall lump sum).

import cfgJson from "../../config/site-work.v0.1.json";

export interface UnitCost { label: string; unit: string; low: number; likely: number; high: number; sourceLabel: string; sourceNote: string }
export interface SiteWorkConfig {
  version: string;
  retainingWallFace: UnitCost;
  foundationWallExtra: UnitCost;
  excavationCut: UnitCost;
  staging: { domiPermitPeriod: UnitCost; periods: number; dumpsterHaul: UnitCost; demolitionHauls: number; sourceNote: string };
  lateral: UnitCost;
}
export const SITE_WORK: SiteWorkConfig = cfgJson as SiteWorkConfig;

/** The parts of a QuickFit v2 scheme the quantities read. */
export interface GroundQuantitiesInput {
  widthFt: number;
  depthFt: number;
  ground: { slopePct: number | null; steps: { elevFt: number }[]; foundationWallSqft: number; retainingWall: { lengthFt: number; maxHeightFt: number } } | null;
  /** Garage bays cut into the hill (tuck-under at street grade): count and cut depth at the back, ft. */
  garageCut?: { bays: number; depthFt: number } | null;
}

export interface SiteWorkLine {
  id: "retaining_walls" | "foundation_walls" | "excavation" | "staging" | "lateral";
  label: string;
  quantity: number | null;
  unit: string;
  /** "12 ft long × 6.5 ft high = 78 sq ft of wall face" */
  quantityBasis: string;
  unitCost: { low: number; likely: number; high: number; unit: string } | null;
  amount: { low: number; likely: number; high: number };
  sourceLabel: string;
  sourceNote: string;
}

export interface SiteWorkQuantities {
  lines: SiteWorkLine[];
  total: { low: number; likely: number; high: number };
  notes: string[];
}

const r100 = (n: number) => Math.round(n / 100) * 100;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

/** Garage cut from QuickFit's parking notes ("cut about 8 ft into the hill"); null when none. */
export function garageCutFromNotes(parking: { type?: string; count?: number; notes?: string[] } | null | undefined): { bays: number; depthFt: number } | null {
  if (!parking || parking.type !== "tuck") return null;
  const m = /cut about (\d+(?:\.\d+)?) ft into the hill/.exec((parking.notes ?? []).join(" "));
  return m ? { bays: Math.max(1, parking.count ?? 1), depthFt: Number(m[1]) } : null;
}

export function siteWorkQuantities(
  q: GroundQuantitiesInput,
  opts: { units: number; isCity: boolean; demolition: boolean; stagingInStreet: boolean; config?: SiteWorkConfig },
): SiteWorkQuantities {
  const c = opts.config ?? SITE_WORK;
  const lines: SiteWorkLine[] = [];
  const notes: string[] = [];
  const priced = (id: SiteWorkLine["id"], u: UnitCost, qty: number, qtyUnit: string, basis: string) =>
    lines.push({ id, label: u.label, quantity: Math.round(qty), unit: qtyUnit, quantityBasis: basis, unitCost: { low: u.low, likely: u.likely, high: u.high, unit: u.unit },
      amount: { low: r100(qty * u.low), likely: r100(qty * u.likely), high: r100(qty * u.high) }, sourceLabel: u.sourceLabel, sourceNote: u.sourceNote });
  const g = q.ground;
  if (g) {
    // Retaining walls where the cut at the building edge is over 4 ft: face = length × tallest height.
    const rw = g.retainingWall;
    if (rw.lengthFt > 0 && rw.maxHeightFt > 0)
      priced("retaining_walls", c.retainingWallFace, rw.lengthFt * rw.maxHeightFt, "sq ft of wall face", `${n0(rw.lengthFt)} ft long × ${rw.maxHeightFt} ft tallest = ${n0(rw.lengthFt * rw.maxHeightFt)} sq ft of wall face (length × tallest height, conservative)`);
    // Foundation wall beyond a flat lot's: QuickFit's wall area less 1 ft of wall per foot of perimeter (its flat-lot baseline).
    const perimeter = 2 * (q.widthFt + q.depthFt);
    const extra = Math.max(0, g.foundationWallSqft - perimeter);
    if (extra > 0)
      priced("foundation_walls", c.foundationWallExtra, extra, "sq ft of wall", `${n0(g.foundationWallSqft)} sq ft of foundation wall from the stepped floor plates − ${n0(perimeter)} sq ft a flat lot needs (1 ft × ${n0(perimeter)} ft of perimeter) = ${n0(extra)} sq ft`);
    // Cut to level the floor plates on the fitted ground plane: w × slope × d² ÷ (8 × plates), in cubic yards.
    const s = (g.slopePct ?? 0) / 100;
    const plates = Math.max(1, new Set(g.steps.map((x) => x.elevFt)).size);
    let cutCf = s > 0 ? (q.widthFt * s * q.depthFt * q.depthFt) / (8 * plates) : 0;
    let basis = s > 0 ? `${n0(q.widthFt)} × ${n0(q.depthFt)} ft footprint on a ${g.slopePct}% slope, ${plates} floor plate${plates === 1 ? "" : "s"}: cut ≈ width × slope × depth² ÷ (8 × plates) = ${n0(cutCf / 27)} cu yd` : "";
    if (q.garageCut && q.garageCut.depthFt > 0) {
      const gc = q.garageCut.bays * 10 * 20 * (q.garageCut.depthFt / 2);
      cutCf += gc;
      basis += `${basis ? "; plus " : ""}${q.garageCut.bays} garage bay${q.garageCut.bays === 1 ? "" : "s"} (10 × 20 ft) cut up to ${q.garageCut.depthFt} ft into the hill ≈ ${n0(gc / 27)} cu yd`;
    }
    if (cutCf / 27 >= 1) priced("excavation", c.excavationCut, cutCf / 27, "cu yd", `${basis}. Cut only; the soil is hauled away (no reuse as fill). Ordinary basement digging is in the construction cost.`);
  } else notes.push("No lidar ground under the building, so wall and cut quantities are not measured.");

  // Street occupancy and staging: DOMI construction staging permits (City) + dumpster hauls for demolition debris.
  if (opts.stagingInStreet || opts.demolition) {
    const st = c.staging;
    const domi = opts.isCity && opts.stagingInStreet ? st.periods * st.domiPermitPeriod.likely : 0;
    const domiLo = opts.isCity && opts.stagingInStreet ? st.periods * st.domiPermitPeriod.low : 0;
    const domiHi = opts.isCity && opts.stagingInStreet ? st.periods * st.domiPermitPeriod.high : 0;
    const hauls = opts.demolition ? st.demolitionHauls : 0;
    const d = st.dumpsterHaul;
    const parts = [
      domi ? `${st.periods} DOMI construction staging permit period${st.periods === 1 ? "" : "s"} × $${n0(st.domiPermitPeriod.likely)}` : null,
      hauls ? `${hauls} dumpster hauls for demolition debris × $${n0(d.likely)}` : null,
    ].filter(Boolean);
    if (parts.length)
      lines.push({ id: "staging", label: "Street occupancy and staging (estimate)", quantity: null, unit: "", quantityBasis: parts.join(" + "), unitCost: null,
        amount: { low: r100(domiLo + hauls * d.low), likely: r100(domi + hauls * d.likely), high: r100(domiHi + hauls * d.high) },
        sourceLabel: `${domi ? st.domiPermitPeriod.sourceLabel : ""}${domi && hauls ? "; " : ""}${hauls ? d.sourceLabel : ""}`, sourceNote: st.sourceNote });
  }
  // Water and sewer laterals (same default as the cost model).
  const L = c.lateral;
  lines.push({ id: "lateral", label: L.label, quantity: opts.units, unit: `house${opts.units === 1 ? "" : "s"}`, quantityBasis: `${opts.units} house${opts.units === 1 ? "" : "s"}`,
    unitCost: { low: L.low, likely: L.likely, high: L.high, unit: L.unit }, amount: { low: L.low * opts.units, likely: L.likely * opts.units, high: L.high * opts.units }, sourceLabel: L.sourceLabel, sourceNote: L.sourceNote });

  const total = lines.reduce((t, l) => ({ low: t.low + l.amount.low, likely: t.likely + l.amount.likely, high: t.high + l.amount.high }), { low: 0, likely: 0, high: 0 });
  return { lines, total, notes };
}
