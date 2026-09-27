export type Pt = [number, number];
export type Ring = Pt[];
export type Use = "P" | "S" | "C" | "N"; // permitted, special exception, conditional use, not allowed
export type Typology = "single_detached" | "two_unit" | "three_four" | "townhouse_row" | "adu";

export interface ZoningRules {
  district: string;
  uses: { single_detached: Use; single_attached: Use; two_unit: Use; three_unit: Use; multi_unit: Use; adu: Use };
  minLotSqft: number;
  minLotSqftAttachedPerUnit?: number | null;
  lotAreaPerUnitSqft?: number | null;
  setbacksFt: { front: number; rear: number; side: number; streetSide: number; sideAttachedPartyWall?: number };
  maxHeightFt: number;
  maxStories: number;
  parkingPerUnit: { single_detached: number; two_unit: number; multi_unit: number; single_attached: number };
  aduMaxSqft?: number;
  codeSections?: { setbacks?: string; parking?: string; uses?: string; height?: string; lotSize?: string; contextual?: string };
}

export interface Street { name: string; centerline: Pt[]; opened?: boolean; rowWidthFt?: number }
export interface ParcelInput {
  parcelId: string;
  addressStreet?: string;
  parcel: Ring;              // feet, any planar frame
  streets: Street[];
  alleys?: { centerline: Pt[] }[];
  zoning: ZoningRules;
  floodway?: Ring[];
  landslideProne?: Ring[];
  existingBuildings?: { footprint: Ring; heightFt?: number }[];
  neighbors?: { parcel: Ring; building?: { footprint: Ring; heightFt?: number } }[]; // context only (drawing, future contextual setbacks)
  terrain?: { elevAt: (x: number, y: number) => number } | null; // world feet -> NAVD88 ft
  zbaStats?: Record<string, { granted: number; denied: number; years: string; scope: string }>;
  frontEdgeIndex?: number;   // user override
}

export type EdgeKind = "front" | "streetSide" | "side" | "rear";
export interface Edge { i: number; a: Pt; b: Pt; kind: EdgeKind; setbackFt: number; alley?: boolean; lengthFt: number }

export interface Controls {
  typology: Typology;
  goal?: "most_homes" | "most_floor_area" | "by_right_only";
  stories?: number | null;          // null = max allowed
  unitWidthFt?: number | null;      // null = auto
  depthFt?: number | null;          // null = auto (building depth from the front of the building)
  parking?: "auto" | "none" | "pad" | "tuck";
  setbackOverridesFt?: Partial<Record<EdgeKind, number>>; // what-ifs; blank = code
  unitTemplate?: Partial<UnitTemplate>;
  avoidSteepOver40?: boolean;
}
export interface UnitTemplate { floorToFloorFt: number; roofFt: number; minWidth: number; maxWidth: number; minDepth: number; maxDepth: number; plateMin: number; plateMax: number; rowUnitMin: number; rowUnitMax: number; coreSqft: number; efficiency: number; garageSqftPerSpace: number; aduMaxSqft: number; aduSeparationFt: number }

export type Status = "allowed_by_right" | "needs_approval" | "not_allowed" | "does_not_fit";
export interface Approval { kind: "special_exception" | "conditional_use" | "use_variance_or_rezoning" | "dimensional_variance"; rule: string; detail: string; code?: string; zba?: { granted: number; denied: number; years: string; scope: string } | null }
export interface Constraint { rule: string; label: string; slack: number; unit: string; blocking: boolean; code?: string }

export interface Box { x: number; y: number; w: number; d: number; z0: number; h: number; kind: "unit" | "core" | "parking" | "foundation" | "roof"; color?: string; label?: string }

export interface Scheme {
  parcelId: string; typology: Typology; typologyLabel: string; status: Status; statusSentence: string;
  approvalsNeeded: Approval[]; bindingConstraint: { rule: string; sentence: string } | null; unlock: { rule: string; sentence: string } | null;
  units: { id: string; bedrooms: number; netSqft: number; floor: number }[];
  footprintLocal: Ring | null; footprintWorld: Ring | null; widthFt: number; depthFt: number;
  stories: number; grossSqft: number; netSqft: number; heightFt: number;
  parking: { count: number; type: string; required: number };
  lotSqft: number; lotCoverage: number; subdivisionNeeded: boolean; frontageFt: number;
  ground: { avgGradeFt: number | null; slopePct: number | null; steps: { y0: number; y1: number; elevFt: number }[]; foundationWallSqft: number; retainingWall: { lengthFt: number; maxHeightFt: number }; steepShare: number } | null;
  site?: { parking: any; segments: any[]; openings: any[]; walkoutFt: number };
  flags: string[]; constraints: Constraint[]; whatIfs: Controls["setbackOverridesFt"]; solveMs: number; solverVersion: string;
  massing: Box[]; frame: { origin: Pt; ux: Pt; uy: Pt };
}
