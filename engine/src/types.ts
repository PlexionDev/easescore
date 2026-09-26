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
  slope_1m?: { mean_pct: number; max_pct: number; p95_pct: number | null; share_over_25: number; steep_25: boolean } | null;
  /** Filled when those layers are loaded; undefined = layer not available yet. */
  landslides_within_300ft?: number;
  red_bed_landslides_300ft?: number;
  soils_limitation?: string | null;
  streams_or_wetlands_within_100ft?: boolean;
  env_sites_within_500ft?: number;
  building_footprint_sqft?: number | null;
  shares_wall?: boolean;
  mines?: { in_mined_out: boolean; in_city_undermined?: boolean; dist_mined_out_ft: number | null; in_coal_bearing: boolean; mine_map_url?: string | null } | null;
  tax_delinquent?: boolean;
  muni_rules?: {
    municipality?: string; sewer_lateral_at_sale?: "Y" | "N" | "unknown" | string; sewer_lateral_details?: string | null;
    point_of_sale_inspection?: "Y" | "N" | "unknown" | string; pos_details?: string | null;
    source_url?: string | null; confidence?: string | null;
  } | null;
  property_tax?: { year: number; general_mills: number | null; split_rate: boolean;
                   parts: { jurisdiction_type: string; name: string; rate_type: string; mills: number }[] } | null;
  transfer_tax?: { total_pct: number; parts: { jurisdiction: string; jurisdiction_type: string; rate_pct: number; confidence: string }[] } | null;
  street_frontage?: "street" | "steps" | "paper" | "none";
  flood_evidence?: { floodway_share: number; sfha_share: number; x500_share: number; tract_nfip_claims_10y: number | null;
                     tract_nfip_median_premium: number | null; tract_nfip_policies: number | null;
                     flooding_311_5y_tract: number | null; in_combined_sewer: boolean | null } | null;
  context?: { municipality: string | null; neighborhood: string | null; street_trees_15m: number | null;
              public_owner: string | null; tax_delinquent: boolean | null; delinquency_band: string | null } | null;
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
  /** Smaller work on a hillside lot: parking pad, deck, porch, stoop, balcony, retaining wall (City geotech handout tier 2). */
  minor_work?: "parking_pad" | "deck" | "porch" | "stoop" | "balcony" | "retaining_wall";
  /** Will grading create cut or fill slopes steeper than 25%? (Pittsburgh §915.02.A.1.c) */
  cut_fill_over_25?: boolean;
}

export interface Trigger {
  status: Status;
  reason: string; // plain language, shown to the user
  source?: string; // dataset or answer the reason relies on
  confirm?: boolean; // "our data strongly indicates this; confirm the code section"
  /** Awareness note: shown to the user but never changes the status (e.g. possible mine, not legally required). */
  advisory?: boolean;
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
  advisories: string[]; // awareness notes that don't change the status
  citation: string | null;
  notes: string[]; // "confirm with <municipality>", "verify with the issuing office", ...
  cost: null; // Paul fills — never invented
  duration: null;
}
