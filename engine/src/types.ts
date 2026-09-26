// Shapes shared by the requirements engine. ParcelFacts mirrors public.parcel_facts(parid).

export type Status = "REQUIRED" | "LIKELY" | "POSSIBLE" | "ASK" | "NOT_NEEDED";

export const STATUS_RANK: Record<Status, number> = {
  REQUIRED: 5,
  LIKELY: 4,
  POSSIBLE: 3,
  ASK: 2,
  NOT_NEEDED: 1,
};

export type Phase =
  | "due_diligence"
  | "design_engineering"
  | "zoning"
  | "permits"
  | "construction"
  | "closeout";

export const PHASE_ORDER: Phase[] = [
  "due_diligence",
  "design_engineering",
  "zoning",
  "permits",
  "construction",
  "closeout",
];

export interface Overlay {
  layer: string;
  label: string | null;
  attrs: Record<string, unknown> | null;
  share: number; // 0-1 of the lot
}

/** P permitted · C conditional use · S special exception · A administrator exception · N not permitted */
export type UsePermission = "P" | "C" | "S" | "A" | "N" | string;

/** One row of public.zoning_rules (transcribed from the Pittsburgh Zoning Code). */
export interface ZoningRules {
  district_name: string | null;
  single_unit_detached: UsePermission | null;
  two_unit: UsePermission | null;
  three_unit: UsePermission | null;
  multi_unit: UsePermission | null;
  min_lot_area_sqft: number | null;
  min_front_setback_ft: number | null;
  min_rear_setback_ft: number | null;
  min_side_setback_ft: number | null;
  max_height_ft: number | null;
  max_height_stories: number | null;
  parking_per_unit: number | null;
  contextual_front_setback: boolean | null;
  citation: string | null;
  confidence: "confirmed" | "partial" | "unconfirmed" | string | null;
}

export interface ParcelFacts {
  parid: string;
  lot_area_sqft_gis: number;
  assessment: {
    address: string;
    municipality: string;
    is_pittsburgh: boolean;
    class: string | null;
    use: string | null;
    lot_area_sqft: number | null;
    year_built: number | null;
    stories: number | null;
    fmv_building: number | null;
    fmv_total: number | null;
  } | null;
  zoning: { code: string; type: string; rules?: ZoningRules | null } | null;
  overlays: Overlay[];
  flood_1pct_share: number;
  slope: { mean_pct: number; steep_share: number; cells: number; resolution_m: number } | null;
  /** Filled when those layers are loaded; undefined = layer not available yet. */
  landslides_within_300ft?: number;
  soils_limitation?: string | null;
  streams_or_wetlands_within_100ft?: boolean;
  env_sites_within_500ft?: number;
  building_footprint_sqft?: number | null;
  shares_wall?: boolean;
}

export type ProjectType = "new_build" | "addition" | "rehab" | "demolition" | "conversion";

/** Answers the user gives once per project. Missing answers turn project-driven items into ASK. */
export interface ProjectAnswers {
  type?: ProjectType;
  units?: number;
  stories?: number;
  tenure?: "sale" | "rent";
  affordable_financing?: boolean;
  financed?: boolean;
  touches_street?: boolean;
  party_wall?: boolean;
  new_driveway?: boolean;
  lot_split_or_merge?: boolean;
  disturbed_area_sqft?: number;
}

export interface Trigger {
  status: Status;
  reason: string; // plain language, shown to the user
  source?: string; // dataset or answer the reason relies on
  confirm?: boolean; // "our data strongly indicates this; confirm the code section"
}

export interface RequirementResult {
  id: string;
  item: string;
  category: string;
  phase: Phase;
  issuer: string;
  status: Status;
  confirm: boolean;
  reasons: Trigger[]; // every trigger found, strongest first
  citation: string | null;
  notes: string[]; // "confirm with <municipality>", "verify with the issuing office", ...
  cost: null; // Paul fills — never invented
  duration: null;
}
