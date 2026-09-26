// Zoning checks for QuickFit: use permission by unit count, parking minimums, and the
// historical-odds hook. Pure functions; the ZBA counts are passed in, never queried here.

import { useColumn } from "../helpers";
import type { UsePermission } from "../types";
import type { Approval, OddsResult, QuickFitRules, TypologyPreset, VarianceToggle, ZbaCountRow } from "./types";

/**
 * Single-unit attached facts that public.zoning_rules keeps only in its notes column
 * (see the pgh_zoning_rules seed): R1D permits it by right on lots 35 ft wide or narrower and by
 * special exception on wider lots (§911.04.A.69A); R1A, R2, R3 and RM permit it; H needs a special
 * exception. Parking Schedule A (§914.02.A) sets the attached minimum at 0 per unit.
 * Returns {} for other districts, so the caller must supply the values.
 */
export function attachedRulesForDistrict(zoneCode: string): Partial<QuickFitRules> {
  const z = zoneCode.toUpperCase();
  if (z.startsWith("R1D-"))
    return {
      single_unit_attached: "P",
      attached_by_right_max_lot_width_ft: 35,
      attached_wider_lot_permission: "S",
      attached_parking_per_unit: 0,
    };
  if (/^(R1A|R2|R3|RM)-/.test(z)) return { single_unit_attached: "P", attached_parking_per_unit: 0 };
  if (z === "H") return { single_unit_attached: "S", attached_parking_per_unit: 0 };
  return {};
}

const USE_NAME: Record<string, string> = {
  single_unit_detached: "single-unit detached",
  two_unit: "two-unit",
  three_unit: "three-unit",
  multi_unit: "multi-unit",
  single_unit_attached: "single-unit attached",
};

const PERMISSION_TEXT: Record<string, string> = {
  S: "Special exception from the Zoning Board of Adjustment",
  C: "Conditional use (Planning Commission and City Council)",
  A: "Administrator exception",
  N: "Not permitted in this district (needs a use variance or rezoning)",
};

export interface PermissionCheck {
  code: UsePermission | null;
  use: string;
  approval: Approval | null;
}

/**
 * Use permission for a scheme. Row = single-unit attached on each new lot; `widestSubLotFt` is
 * checked against the attached by-right lot-width limit when the district has one.
 */
export function permissionFor(rules: QuickFitRules, t: TypologyPreset, units: number, widestSubLotFt?: number): PermissionCheck {
  let col: string;
  let code: UsePermission | null;
  let why = "";
  if (t.arrangement === "row") {
    col = "single_unit_attached";
    code = rules.single_unit_attached ?? null;
    const maxW = rules.attached_by_right_max_lot_width_ft;
    if (code && maxW != null && widestSubLotFt != null && widestSubLotFt > maxW + 1e-9) {
      code = rules.attached_wider_lot_permission ?? null;
      why = ` on a lot wider than ${maxW} ft (widest new lot is ${round1(widestSubLotFt)} ft)`;
    }
  } else {
    col = useColumn(t.arrangement === "detached" ? 1 : units);
    code = (rules as unknown as Record<string, UsePermission | null>)[col] ?? null;
  }
  const use = USE_NAME[col] ?? col;
  if (code === "P") return { code, use, approval: null };
  const label = code
    ? `${PERMISSION_TEXT[code] ?? `Use code "${code}"`} for ${use}${why}`
    : `Permission for ${use} is not in our rules table; check the use table`;
  return { code, use, approval: { kind: "use", rule: `use:${col}`, label, toggled: false } };
}

/** Minimum parking per unit for this typology, or null when unknown. */
export function parkingPerUnit(rules: QuickFitRules, t: TypologyPreset): number | null {
  if (t.arrangement === "row") return rules.attached_parking_per_unit ?? rules.parking_per_unit ?? null;
  return rules.parking_per_unit ?? null;
}

/**
 * Historical odds from ZBA counts. Returns a rate ONLY when at least `minN` decided cases exist,
 * otherwise "insufficient_history". Takes counts as input; never queries a database.
 */
export function historicalOdds(counts: { granted: number; denied: number } | null | undefined, minN = 5): OddsResult {
  const granted = counts?.granted ?? 0;
  const denied = counts?.denied ?? 0;
  const n = granted + denied;
  if (n < minN) return { status: "insufficient_history", n };
  return { status: "rate", rate: granted / n, n, granted, denied };
}

/** Sum the rows matching a toggle's relief type and code section (prefix match on the section). */
export function oddsForToggle(v: VarianceToggle, rows: ZbaCountRow[] | undefined, minN = 5): OddsResult {
  if (!rows || !v.reliefType || !v.codeSection) return historicalOdds(null, minN);
  const sec = v.codeSection.replace(/^§/, "");
  const hits = rows.filter(
    (r) => r.reliefType === v.reliefType && r.codeSection.replace(/^§/, "").startsWith(sec),
  );
  return historicalOdds(
    { granted: hits.reduce((s, r) => s + r.granted, 0), denied: hits.reduce((s, r) => s + r.denied, 0) },
    minN,
  );
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
