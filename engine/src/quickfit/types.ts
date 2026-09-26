// QuickFit input and output shapes.
//
// UNITS: every length is in FEET and every area in SQUARE FEET. Coordinates must be in a local
// projected (planar) system measured in feet, e.g. a State Plane feet CRS. Never pass lon/lat.
// The solver translates and rotates coordinates internally, so large State Plane values are fine.

import type { UsePermission, ZoningRules } from "../types";

/** [x, y] in feet. */
export type Pt = [number, number];
/** A ring of points. Closed (last == first) or open, either works. */
export type Ring = Pt[];
/** Outer ring first, then holes. */
export type Poly = Ring[];

/**
 * A zoning row as stored in public.zoning_rules plus the optional columns that table has but the
 * shared ZoningRules type does not list, plus facts the table keeps only in its notes (single-unit
 * attached permission and parking). Missing values mean "unknown", never "no limit" for permission.
 */
export interface QuickFitRules extends ZoningRules {
  min_lot_area_per_unit_sqft?: number | null;
  max_far?: number | null;
  max_lot_coverage_pct?: number | null;
  /** Use-table code for single-unit attached (townhouse on its own lot). */
  single_unit_attached?: UsePermission | null;
  /** When set, single-unit attached is `single_unit_attached` only on lots at most this wide ... */
  attached_by_right_max_lot_width_ft?: number | null;
  /** ... and this code on wider lots. */
  attached_wider_lot_permission?: UsePermission | null;
  /** Minimum parking per single-unit attached dwelling. */
  attached_parking_per_unit?: number | null;
  /** Street-side (exterior) side yard on corner lots. */
  exterior_side_setback_ft?: number | null;
}

export type SetbackClass = "front" | "rear" | "side" | "exterior_side";

export interface MaskInput {
  /** Polygon (outer ring + optional holes) in the same coordinates as the parcel. */
  polygon: Poly;
  /** Plain-language name, e.g. "Slope over 25%". */
  label: string;
  /** "cut" removes the area from the envelope (default). "flag" only warns when a footprint overlaps it. */
  mode?: "cut" | "flag";
}

export type TypologyId = "single_family" | "duplex" | "townhouse_row" | string;

/**
 * How units sit in a building.
 * detached: one unit per building. side_by_side / stacked: `unitsPerBuilding` units in one building,
 * next to each other or on separate floors. row: a row of attached units, count swept by the solver.
 */
export type Arrangement = "detached" | "side_by_side" | "stacked" | "row";

export interface Range {
  min: number;
  max: number;
  step: number;
}

export interface TypologyPreset {
  id: TypologyId;
  label: string;
  arrangement: Arrangement;
  /** Units in the one building (detached = 1). Ignored for "row". */
  unitsPerBuilding: number;
  /** Per-unit frontage width. For stacked, the building width. */
  unitWidthFt: Range;
  unitDepthFt: Range;
  /** Whole stories, including a tuck-under garage level. `step` is ignored. */
  stories: { min: number; max: number };
  floorToFloorFt: number;
  /** Added to stories x floor-to-floor to get building height. */
  roofAllowanceFt: number;
  /** Whether a tuck-under garage variant is tried. */
  garage: boolean;
  /** Row only: most units the solver will try. */
  maxUnits?: number;
}

export type ParkingOption = "none" | "surface" | "garage";

export interface Assumptions {
  /** Net / gross floor area. */
  efficiency: number;
  /** Placement search resolution in feet. */
  gridStepFt: number;
  garageWidthFt: number;
  garageDepthFt: number;
  /** Area one surface stall uses on the lot, drive aisle included. */
  surfaceStallAreaSf: number;
  /** Spaces per unit when a surface or garage option is chosen (never below the minimum). */
  spacesPerUnit: number;
}

/** By-right adjustments to the tabulated setbacks (e.g. a contextual front setback, §925.06). */
export interface SetbackOverrides {
  front?: number;
  rear?: number;
  side?: number;
  exterior_side?: number;
  note?: string;
}

export type VarianceRule =
  | "front_setback"
  | "rear_setback"
  | "side_setback"
  | "exterior_side_setback"
  | "max_height_ft"
  | "max_height_stories"
  | "min_lot_area"
  | "min_lot_area_per_unit"
  | "parking_per_unit";

/** A "what if the ZBA granted this" toggle: relaxes one dimensional rule to `value`. */
export interface VarianceToggle {
  rule: VarianceRule;
  value: number;
  /** For the historical-odds lookup, e.g. "variance" and "903.03". */
  reliefType?: string;
  codeSection?: string;
}

/** Counts from the ZBA decisions table, aggregated by relief type and code section. */
export interface ZbaCountRow {
  reliefType: string;
  codeSection: string;
  granted: number;
  denied: number;
}

export type OddsResult =
  | { status: "rate"; rate: number; n: number; granted: number; denied: number }
  | { status: "insufficient_history"; n: number };

/**
 * User-supplied cost table. The engine ships NO cost numbers. Any cost field the scheme needs that
 * is missing makes the dependent outputs null.
 */
export interface CostTable {
  /** Hard cost per gross square foot, by typology id. */
  hardCostPerGsf?: Partial<Record<TypologyId, number>>;
  /** Per surface stall (only needed for surface-parking schemes). */
  surfaceParkingCostPerSpace?: number;
  /** Extra per tuck-under garage space, on top of the $/gsf (optional; treated as 0 when absent). */
  garagePremiumPerSpace?: number;
  /** Soft costs as a fraction of hard cost (e.g. 0.2 = 20%). */
  softCostPctOfHard?: number;
  /** Land/acquisition. When absent, total cost EXCLUDES land and the scheme says so. */
  landCost?: number;
  /** Subdivision plan cost, used only for schemes that need one (treated as 0 when absent, noted). */
  subdivisionCost?: number;
}

/** User-supplied revenue inputs. The engine ships NO prices or rents. */
export interface RevenueInputs {
  tenure?: "sale" | "rent";
  /** Sale price per net square foot. */
  salePricePerNsf?: number;
  monthlyRentPerUnit?: number;
  affordableMonthlyRentPerUnit?: number;
  /** Operating expenses as a fraction of gross rent. */
  operatingExpenseRatio?: number;
  capRate?: number;
}

export type Goal = "most_units" | "best_return" | "smallest_affordable_gap" | "by_right_only";

export interface QuickFitInput {
  /** Parcel outline, a simple polygon (no holes), in feet. */
  parcel: Ring;
  /** Indices of street-frontage edges; edge i runs from vertex i to vertex i+1. The first one orients the row. */
  frontEdges: number[];
  /** Rear edges. Default: edges facing away from the first front edge. */
  rearEdges?: number[];
  /** Street-side edges of a corner lot (exterior side yard). */
  streetSideEdges?: number[];
  rules: QuickFitRules;
  setbackOverrides?: SetbackOverrides;
  masks?: MaskInput[];
  typologies?: TypologyPreset[];
  parkingOptions?: ParkingOption[];
  assumptions?: Partial<Assumptions>;
  variances?: VarianceToggle[];
  zbaCounts?: ZbaCountRow[];
  costs?: CostTable;
  revenue?: RevenueInputs;
  goal?: Goal;
  /** Keep schemes whose use is "N" (not permitted) in the ranking. Default false. */
  includeNotPermitted?: boolean;
}

export type BindingId =
  | "front_setback"
  | "rear_setback"
  | "side_setback"
  | "exterior_side_setback"
  | "unbuildable_area"
  | "lot_area_per_unit"
  | "height"
  | "row_length"
  /** A wider unit of the same typology fits under the same rules. */
  | "unit_width"
  /** Nothing in the zoning limits it; the preset's size or story range does. */
  | "preset";

export interface Binding {
  id: BindingId;
  /** e.g. "Front setback is the limit" */
  label: string;
  detail: string;
}

export interface Approval {
  kind: "use" | "variance";
  rule: string;
  label: string;
  /** True when this relief is one of the user's variance toggles. */
  toggled: boolean;
  odds?: OddsResult;
}

export type Badge = "by_right" | "needs_approval" | "not_permitted";

export interface Finance {
  hardCost: number | null;
  softCost: number | null;
  totalCost: number | null;
  revenue: number | null;
  profit: number | null;
  returnOnCost: number | null;
  /** Total cost minus the value supported by the affordable rent. Positive = funding gap. */
  affordableGap: number | null;
  notes: string[];
}

export interface Scheme {
  id: string;
  typology: TypologyId;
  typologyLabel: string;
  unitWidthFt: number;
  unitDepthFt: number;
  stories: number;
  heightFt: number;
  parking: ParkingOption;
  units: number;
  buildings: number;
  /** One rectangle per unit, in the input coordinates. */
  footprints: Ring[];
  footprintSf: number;
  grossFloorAreaSf: number;
  netFloorAreaSf: number;
  garageAreaSf: number;
  lotCoveragePct: number;
  parkingSpaces: number;
  parkingRequired: number | null;
  permission: { code: UsePermission | null; use: string };
  badge: Badge;
  byRight: boolean;
  approvals: Approval[];
  needsSubdivision: boolean;
  /** Row only: widest and narrowest new lot along the frontage. */
  subLots?: { count: number; maxWidthFt: number; minWidthFt: number; minAreaSf: number };
  binding: Binding;
  finance: Finance;
  warnings: string[];
}

export interface VarianceDelta {
  rule: VarianceRule;
  from: number | null;
  to: number;
  odds: OddsResult;
  deltaUnits: number;
  deltaGrossFloorAreaSf: number;
  deltaProfit: number | null;
}

export interface VarianceReport {
  byRightBest: { schemeId: string; units: number; grossFloorAreaSf: number } | null;
  withVariancesBest: { schemeId: string; units: number; grossFloorAreaSf: number } | null;
  deltaUnits: number;
  deltaGrossFloorAreaSf: number;
  deltaProfit: number | null;
  perToggle: VarianceDelta[];
}

export interface QuickFitResult {
  units: "ft";
  lotAreaSf: number;
  envelope: { polygons: Poly[]; areaSf: number };
  goal: Goal;
  /** Ranked by the goal. */
  ranked: Scheme[];
  best: Scheme | null;
  /** Every generated scheme, in sweep order. */
  all: Scheme[];
  variance: VarianceReport | null;
  /** Assumptions and data caveats that apply to every scheme. */
  receipts: string[];
}
