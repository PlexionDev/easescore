// Turn parcel data + the cost config + user overrides into finance-module inputs.
//
// Deterministic: the same arguments give the same plan. Every value used is listed in
// `plan.assumptions` with its source label. Items that apply to this project but have no cost yet
// are never counted as zero: they are left out of the totals and listed in `plan.exclusions`, and
// the plan's evidence becomes "partial".

import { developmentCosts, MSI_CHART, msiAnnualPremium, type ForSaleInputs, type Receipt, type RentalInputs, type UnitRow } from "../finance";
import type { StrategyId } from "../score/types";
import { selectScheme, type ParkingProgram, type SelectedScheme } from "../score/selected";
import type { CompSet } from "./comps";
import { COST_CONFIG, tierOf, type CostConfig } from "./config";
import { landEstimate, type LandEstimate } from "./land";
import { assessedAfterCompletion, type AssessedEstimate } from "./tax";
import { rehabEstimate, type RehabEstimate } from "./rehab";
import { rentForBedrooms, type RentEstimate, type RentsByBedroom } from "../rents";

export type Tenure = "sale" | "rent";
export type Evidence = "complete" | "partial" | "missing";

/** The parts of parcel_facts the pro forma reads. */
export interface ProFormaFacts {
  slope_1m?: { mean_pct?: number | null; share_over_15?: number | null; share_over_25?: number | null } | null;
  overlays?: { layer: string; share: number }[] | null;
  mines?: { in_city_undermined?: boolean | null; in_mined_out?: boolean | null; msi_risk?: string | null } | null;
  site?: { building_count?: number | null } | null;
  assessment?: { use?: string | null; fmv_land?: number | null; fmv_total?: number | null; living_area_sqft?: number | null; is_pittsburgh?: boolean | null; tax_year?: number | null; as_of?: string | null; condition?: string | null; year_built?: number | null; lot_area_sqft?: number | null } | null;
  /** Owner class (parcel_owner_class: private, city, ura, county, hacp, other_public, nonprofit). */
  owner_class?: string | null;
  /** Comp area: City neighborhood inside Pittsburgh, municipality elsewhere. */
  area?: string | null;
  lot_area_sqft_gis?: number | null;
  property_tax?: { general_mills?: number | null } | null;
  transfer_tax?: { total_pct?: number | null; parts?: unknown } | null;
  building_footprint_sqft?: number | null;
  flood_1pct_share?: number | null;
  flood_evidence?: { tract_nfip_median_premium?: number | null } | null;
}

/** parcel_sales_comps payload (single-family search). */
export interface SalesCompsLike {
  status?: string | null;
  sufficient?: boolean | null;
  count?: number | null;
  radius_mi?: number | null;
  comparable_use?: string | null;
  median_price_per_sqft?: number | null;
  note?: string | null;
  date_range?: { from?: string | null; to?: string | null } | null;
}

/** parcel_rent_comps payload. */
export interface RentCompsLike {
  zori?: { zip?: string | null; latest_rent?: number | null; latest_month?: string | null } | null;
  hud_fmr?: { year?: number | null; zip?: string | null; level?: string | null; br0?: number; br1?: number; br2?: number; br3?: number; br4?: number } | null;
}

/** Building size from the site-fit solver. */
export interface SchemeSize {
  units: number;
  grossFloorAreaSf: number;
  netFloorAreaSf: number;
  /** Building footprint, all units (needed to lay out a custom unit program). */
  footprintSf?: number;
  stories?: number;
  typologyLabel?: string;
}

export type { ParkingProgram } from "../score/selected";

/** User edits. Shares are decimals (0.08 = 8%); money is dollars. */
export interface CostOverrides {
  tenure?: Tenure;
  tier?: string;
  costPerSf?: number;
  land?: number;
  slopeAdderPerSf?: number;
  minePath?: "grouting" | "insurance";
  groutingCost?: number;
  demolition?: number;
  geotech?: number;
  dumpsters?: number;
  aeShare?: number;
  permitShare?: number;
  softOtherShare?: number;
  contingencyShare?: number;
  constructionRate?: number;
  ltc?: number;
  approvalMonths?: number;
  constructionMonths?: number;
  salePricePerSf?: number;
  rentPerUnit?: number;
  /** Your program: number of homes (default: the site-fit count). */
  units?: number;
  /** Living floors above the garage (or total floors when there is no tuck-under garage). */
  storiesAboveGarage?: number;
  parking?: ParkingProgram;
  bedrooms?: number;
  baths?: number;
  /** Your construction cost per home; replaces tier × sq ft for the hard base. */
  costPerUnit?: number;
  /** True when your per-home cost already covers site work and foundation (site adders are then not added). */
  costIncludesSite?: boolean;
  /** Your sale price per home; replaces the comps value. */
  salePricePerUnit?: number;
  /** "Your number" for a budget line, in dollars, by line id (land, hard_base, slope_adder, ae, contingency...). */
  lineAmounts?: Record<string, number>;
}

export interface PlanArgs {
  strategy: StrategyId;
  facts: ProFormaFacts;
  /** Site-fit scheme for new builds; ignored for the rehab option (existing living area is used). */
  scheme: SchemeSize | null;
  /** The one SelectedScheme (score.selectScheme). When given, it sizes the plan and `scheme` is ignored. */
  selected?: SelectedScheme | null;
  /**
   * Existing-home sales comps. Rehab is valued from these (pass matchedExistingComps for size/age
   * matching); for new builds they are only a labeled floor, never the value.
   */
  comps: SalesCompsLike | null;
  /** Nearby home sales, all conditions (parcel single-family comps): the rehab's as-is purchase price. */
  asIsComps?: SalesCompsLike | null;
  /** New-construction comps (newConstructionComps). New builds are valued only from these. */
  newComps?: CompSet | null;
  rents: RentCompsLike | null;
  /** Bank prime rate as a decimal (FRED DPRIME), and its date. */
  primeRate?: number | null;
  primeRateDate?: string | null;
  /** Months to a permit from the Ease Score. */
  permitMonths?: number | null;
  /** Published water/sewer permit, connection and meter fees for one new home. null = not loaded here. */
  tapFeesPerUnit?: number | null;
  overrides?: CostOverrides;
  config?: CostConfig;
  /**
   * Hillside stepping of the site-fit building (floor plates stepped down the lidar grade under the
   * footprint). When it steps, the steep-slope adder (stepped foundation, retaining walls) prices it:
   * it replaces the moderate-slope adder, or is added when no slope adder fired; when the lot already
   * gets the steep-slope adder, nothing is added again. Ignored for the rehab option.
   */
  stepping?: SteppingInput | null;
  /**
   * Slope of the ground under the site-fit building footprint (1 m lidar, plane fit), percent. The slope
   * premium, structural engineer, steep geotech and 15% contingency key off it; the lot's average slope
   * stands in when there is no footprint. Defaults to `stepping.footprintSlopePct` when given.
   */
  footprintSlopePct?: number | null;
  /** Rents by bedroom count (engine rents module: RentCast comps, else HUD SAFMR, else ZORI). When absent, built from `rents` (HUD / ZORI only). */
  rentsByBedroom?: RentsByBedroom | null;
}

/** Hillside stepping measured under the building footprint (computed by the caller from the lidar grid). */
export interface SteppingInput {
  /** Level changes between floor plates (0 = no stepping). */
  steps: number;
  /** Highest plate minus lowest plate, feet. */
  dropFt: number;
  /** Slope of the ground under the footprint (plane fit), percent. */
  footprintSlopePct: number;
  /** Stepping starts at this footprint slope, percent (labeled threshold). */
  thresholdPct: number;
  /** Plate increment, feet. */
  incrementFt: number;
}

export type LineGroup = "land" | "hard" | "soft" | "contingency" | "financing";

/** A cost line the plan knows before the finance run (land, hard base, site adders, fixed soft items). */
export interface PlanLine {
  id: string;
  group: LineGroup;
  label: string;
  /** Short name for the "A + B = C" cost sentence. */
  short: string;
  amount: number;
  basis: string;
  sourceLabel: string;
}

export interface AdderFired {
  id: "moderate_slope" | "steep_slope" | "retaining_walls" | "mine_grouting" | "mine_insurance";
  label: string;
  /** Plain reason, e.g. "Steep slope under 84% of the lot → +$60/SF". */
  reason: string;
  perSf: number | null;
  /** Dollars added to development cost (null for the insurance path, a yearly premium). */
  amount: number | null;
  sourceLabel: string;
  range: string | null;
}

export interface Exclusion {
  id: string;
  label: string;
  /** Why it applies here. */
  reason: string;
  /** "Not included: Demolition — cost not set yet" */
  text: string;
}

export interface AssumptionRow {
  key: string;
  label: string;
  value: string;
  range: string | null;
  sourceLabel: string;
  sourceNote: string | null;
  /** True when the user changed it from the default. */
  edited: boolean;
}

/** Where a land, value or rent number comes from, always with its year / vintage (or "Assumption, edit me"). */
export interface DataSource {
  /** Plain label with the year or date range, e.g. "HUD Fair Market Rent FY2026, ZIP 15219, 2 bedrooms". */
  label: string;
  /** Year, month or date range of the data; null only for your own input or an assumption. */
  asOf: string | null;
  kind: "data" | "user" | "assumption";
}

export interface DevelopmentPlan {
  configVersion: string;
  strategy: StrategyId;
  /** The building this plan prices (same object the score, summary, report and 3D read). */
  scheme: SelectedScheme;
  tenure: Tenure;
  units: number | null;
  finishedSf: number | null;
  sizeBasis: string;
  /** The unit program used, when the user set one (or a tuck-under garage). */
  program: {
    units: number;
    storiesAboveGarage: number;
    parking: ParkingProgram;
    bedrooms: number | null;
    baths: number | null;
    footprintPerUnitSf: number;
    finishedPerUnitSf: number;
    garagePerUnitSf: number;
    grossSf: number;
  } | null;
  /** Plain warning when the layout is small next to new homes that sold nearby. */
  sizeWarning: string | null;
  /** The comps the value came from (new-construction for new builds). */
  valueComps: CompSet | SalesCompsLike | null;
  /** New builds: older-home $/SF shown only as a floor. */
  floor: { pricePerSf: number; text: string } | null;
  /** "Your price $350,000 vs. recent new-build median $629,950 (...)". */
  priceCheck: string | null;
  /** Hard base comes from the user's per-home number. */
  perUnitCost: { value: number; includesSite: boolean } | null;
  tier: { id: string; label: string };
  costPerSf: number;
  land: { value: number | null; sourceLabel: string; estimate: LandEstimate | null; flag: string | null };
  /** Rehab option: the condition-tier estimate that priced the construction line. */
  rehab: RehabEstimate | null;
  /** Assessed value after completion (rental taxes), from completed projects. */
  assessedAfter: AssessedEstimate | null;
  /** Rent estimate used (by bedroom count), when the plan has a rent. */
  rentEstimate: RentEstimate | null;
  bedrooms: number;
  /** Raw values before rounding, shown once in each receipt ("comps median $1,483, rounded to $1,500"). */
  rounding: { rent: string | null; sale: string | null; land: string | null };
  /** Footprint the slope premium is priced on, sq ft. */
  footprintSf: number | null;
  /** Budget line ids that carry "Your number". */
  userLines: string[];
  lines: PlanLine[];
  shares: {
    ae: number; aeRange: number[] | null; permits: number; other: number; permitsBasis: string; contingency: number; contingencyKind: "flat" | "hillside" | "rehab";
    /** Cost model v0.2: plain dollar bases for the soft lines, and share ranges for the permits and other soft lines. */
    aeBasis?: string; otherBasis?: string; otherLabel?: string; permitsRange?: number[] | null; otherRange?: number[] | null;
  };
  /** Where the slope that priced the site came from ("under the building footprint" or the lot average). */
  slopeBasis: string | null;
  loanFeeShare: number;
  adders: AdderFired[];
  /** Hillside stepping that priced the stepped-foundation line (or was covered by the lot's steep-slope adder). */
  stepping: (SteppingInput & { pricedBy: "stepping" | "steep_slope_adder" }) | null;
  exclusions: Exclusion[];
  minePath: "grouting" | "insurance" | null;
  msiPremium: Receipt | null;
  msiCoverage: number | null;
  revenue: {
    sale: { pricePerSf: number | null; pricePerUnit: number | null; grossSales: number | null; basis: string; sourceLabel: string };
    rent: { perUnit: number | null; basis: string; sourceLabel: string };
  };
  forSale: ForSaleInputs;
  rental: RentalInputs;
  /** Source and year of the land, sale value and rent numbers. */
  sources: { land: DataSource; sale: DataSource; rent: DataSource };
  assumptions: AssumptionRow[];
  outliers: string[];
  /** Plain reasons the answer cannot be computed (missing size, value, land...). */
  missing: string[];
  evidence: Evidence;
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// Formatting (plain, exact)

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pctText = (share: number) => `${+(share * 100).toFixed(2)}%`;
const rangeText = (r: number[] | undefined, kind: "usd" | "share" | "usdSf") =>
  r && r.length === 2 ? (kind === "share" ? `${pctText(r[0]!)}–${pctText(r[1]!)}` : kind === "usdSf" ? `${usd(r[0]!)}–${usd(r[1]!)}/SF` : `${usd(r[0]!)}–${usd(r[1]!)}`) : null;

const has = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const roundStep = (x: number, step: number) => Math.round(x / step) * step + 0;
const r1000 = (x: number) => roundStep(x, 1000);

// ---------------------------------------------------------------------------------------------

const DEFAULT_TENURE: Record<StrategyId, Tenure> = {
  new_sf: "sale",
  duplex: "sale",
  townhouse_row: "sale",
  rehab_existing: "sale",
  three_four_unit: "rent",
  adu: "rent",
};

export function buildDevelopmentInputs(a: PlanArgs): DevelopmentPlan {
  const cfg = a.config ?? COST_CONFIG;
  const o: CostOverrides = { ...(a.overrides ?? {}) };
  // A "Your number" on a site line is the same as that line's own override.
  const la0 = o.lineAmounts ?? {};
  if (has(la0.grouting)) o.groutingCost = la0.grouting;
  if (has(la0.demolition)) o.demolition = la0.demolition;
  if (has(la0.geotech)) o.geotech = la0.geotech;
  if (has(la0.dumpsters)) o.dumpsters = la0.dumpsters;
  const f = a.facts;
  const rows: AssumptionRow[] = [];
  const row = (key: string, label: string, value: string, src: { sourceLabel: string; sourceNote?: string | null }, range: string | null, edited: boolean) =>
    rows.push({ key, label, value, range, sourceLabel: edited ? "Your input" : src.sourceLabel, sourceNote: edited ? `Default: ${src.sourceLabel}` : src.sourceNote ?? null, edited });
  const exclusions: Exclusion[] = [];
  const exclude = (id: string, label: string, reason: string, why = "cost not set yet") =>
    exclusions.push({ id, label, reason, text: `Not included: ${label} — ${why}` });
  const missing: string[] = [];
  const notes: string[] = [];
  const lines: PlanLine[] = [];
  const adders: AdderFired[] = [];
  const outliers: string[] = [];

  const rehab = a.strategy === "rehab_existing";
  const tenure: Tenure = o.tenure ?? DEFAULT_TENURE[a.strategy];

  // ---- Size: from the one SelectedScheme (built here only when the caller did not pass it)
  const sel: SelectedScheme = a.selected ?? selectScheme({
    strategy: a.strategy,
    scheme: a.scheme ?? null,
    existing: { livingAreaSqft: f.assessment?.living_area_sqft ?? null, use: f.assessment?.use ?? null },
    overrides: { units: o.units, storiesAboveGarage: o.storiesAboveGarage, parking: o.parking, bedrooms: o.bedrooms, baths: o.baths },
  });
  const units: number | null = sel.units;
  const finishedSf: number | null = sel.finishedSf;
  const garageSf = sel.garageSf;
  const sizeBasis = sel.sizeBasis;
  const program: DevelopmentPlan["program"] = sel.program;
  if (sel.missing) missing.push(sel.missing);
  notes.push(...sel.notes.filter((n) => !n.startsWith("The score's fit")));
  if (units != null) row("units", "Homes (units)", String(units), { sourceLabel: rehab ? "County assessment (existing use)" : "Site-fit scheme (QuickFit)" }, null, has(o.units));
  if (finishedSf != null) row("finishedSf", "Finished (livable) floor area", `${finishedSf.toLocaleString("en-US")} sq ft${units != null && units > 1 ? ` (${Math.round(finishedSf / units).toLocaleString("en-US")} per home)` : ""}`, { sourceLabel: rehab ? "County assessment" : program ? "Your program on the site-fit footprint" : "Site-fit scheme (QuickFit)", sourceNote: rehab ? null : "Floor area × the solver's livable share (placeholder)" }, null, program != null);
  if (program) {
    row("program", "Unit program", `${program.parking === "tuck_under" ? "Tuck-under garage + " : ""}${program.storiesAboveGarage} living floor${program.storiesAboveGarage === 1 ? "" : "s"}${program.bedrooms != null ? `, ${program.bedrooms} bed` : ""}${program.baths != null ? ` / ${program.baths} bath` : ""}; parking: ${program.parking.replace("_", "-")}`, { sourceLabel: "Your input" }, null, true);
  }

  // ---- Land: vacant-land sales (public lots: agency sales), never the assessed land value; the
  // rehab's purchase price: nearby as-is home sales × living area. Your number always overrides.
  const la = o.lineAmounts ?? {};
  const userLand = has(la.land) ? la.land : has(o.land) ? o.land : null;
  const isCity = f.assessment?.is_pittsburgh === true;
  const lotSqft = f.assessment?.lot_area_sqft ?? f.lot_area_sqft_gis ?? null;
  const landEst: LandEstimate | null = rehab ? null : landEstimate({ lotSqft, area: f.area, isCity, ownerClass: f.owner_class }, cfg);
  let rehabPurchase: { likely: number; low: number; high: number; basis: string } | null = null;
  if (rehab) {
    const asIs = a.asIsComps;
    const la2 = f.assessment?.living_area_sqft;
    if (asIs && asIs.status === "ok" && asIs.sufficient !== false && has(asIs.median_price_per_sqft) && has(la2) && la2 > 0) {
      const raw = asIs.median_price_per_sqft * la2;
      const sh = cfg.land.rehabPurchase.rangeShare;
      rehabPurchase = { likely: r1000(raw), low: r1000(raw * (1 - sh)), high: r1000(raw * (1 + sh)), basis: `Nearby home sales as-is (${asIs.count} sales within ${asIs.radius_mi} mi${asIs.date_range?.from ? `, ${asIs.date_range.from} to ${asIs.date_range.to}` : ""}): median ${usd(asIs.median_price_per_sqft)}/SF × ${la2.toLocaleString("en-US")} sq ft = ${usd(raw)}, rounded to ${usd(r1000(raw))}; range ±${Math.round(sh * 100)}% (Assumption, edit me)` };
    }
  }
  const land = userLand != null ? userLand : rehab ? rehabPurchase?.likely ?? null : landEst?.likely ?? null;
  const landLabel = rehab ? "Nearby home sales (as-is)" : landEst?.public ? cfg.land.publicFlag : cfg.land.sourceLabel;
  const landSource = userLand != null ? "Your number" : landLabel;
  if (land == null) missing.push(rehab
    ? "No purchase price: too few nearby home sales to estimate it. Enter the purchase price (the assessed value is not a price)."
    : "No land price: too few vacant-land sales to estimate it. Enter the purchase price (the assessed land value is not a price).");
  else {
    const basis = userLand != null ? "Your price" : rehab ? rehabPurchase!.basis : landEst!.basis;
    lines.push({ id: "land", group: "land", label: rehab ? "Purchase price (land and building)" : "Land (purchase price)", short: rehab ? "purchase" : "land", amount: land, basis, sourceLabel: landSource });
    row("land", rehab ? "Purchase price" : "Land price", usd(land), { sourceLabel: landLabel, sourceNote: rehab ? rehabPurchase?.basis ?? null : landEst?.basis ?? null }, userLand == null && (landEst || rehabPurchase) ? `${usd((landEst ?? rehabPurchase)!.low)}–${usd((landEst ?? rehabPurchase)!.high)}` : null, userLand != null);
    if (landEst?.public && userLand == null) notes.push(`${cfg.land.publicFlag}. Ask the agency (URA, City or Land Bank) for its disposition price; enter it to replace the estimate.`);
  }

  // ---- Base construction
  const tier = tierOf(cfg, o.tier);
  const rehabEst: RehabEstimate | null = rehab ? rehabEstimate({ condition: f.assessment?.condition, yearBuilt: f.assessment?.year_built, finishedSf }, cfg) : null;
  const costPerSf = has(o.costPerSf) ? o.costPerSf : rehabEst ? rehabEst.perSf[1] : tier.costPerSf.value;
  if (rehabEst) {
    row("rehabTier", "Rehab scope (from the County condition)", rehabEst.tier.label, { sourceLabel: rehabEst.sourceLabel, sourceNote: rehabEst.basis }, null, false);
    row("costPerSf", "Rehab cost per finished sq ft", `${usd(costPerSf)}/SF`, { sourceLabel: rehabEst.sourceLabel, sourceNote: rehabEst.basis }, `${usd(rehabEst.perSf[0])}–${usd(rehabEst.perSf[2])}/SF`, has(o.costPerSf));
    notes.push(cfg.construction.rehabNote);
  } else {
    row("tier", "Build quality", `${tier.label} — ${tier.meaning}`, { sourceLabel: tier.costPerSf.sourceLabel }, null, o.tier !== undefined && o.tier !== cfg.construction.defaultTier);
    row("costPerSf", "Construction cost per finished sq ft (includes builder overhead and profit)", `${usd(costPerSf)}/SF`, tier.costPerSf, rangeText(tier.costPerSf.range, "usdSf"), has(o.costPerSf));
  }
  const garageShare = cfg.construction.garageLevelShareOfTier;
  const perUnitCost = has(o.costPerUnit) && units != null ? { value: o.costPerUnit, includesSite: o.costIncludesSite === true } : null;
  let hardBase: number | null = null;
  if (has(la.hard_base)) {
    hardBase = la.hard_base;
    lines.push({ id: "hard_base", group: "hard", label: rehab ? "Rehab construction" : "Construction (base, standard foundation)", short: rehab ? "rehab construction" : "construction", amount: hardBase, basis: "Your number", sourceLabel: "Your number" });
  } else if (perUnitCost) {
    hardBase = perUnitCost.value * units!;
    lines.push({ id: "hard_base", group: "hard", label: rehab ? "Rehab construction (your number per home)" : "Construction (your number per home)", short: "construction", amount: hardBase, basis: `${units} home${units === 1 ? "" : "s"} × ${usd(perUnitCost.value)}${perUnitCost.includesSite ? ", including site work and foundation" : ", building only (site adders added separately)"}${garageSf ? "; covers the garage level too" : ""}`, sourceLabel: "Your number" });
    row("costPerUnit", "Construction cost per home", usd(perUnitCost.value), { sourceLabel: "Your number" }, null, true);
    row("costIncludesSite", "Per-home cost includes site work and foundation", perUnitCost.includesSite ? "Yes: site adders not added" : "No: site adders added on top", { sourceLabel: "Your input" }, null, true);
  } else if (finishedSf != null) {
    hardBase = r1000(costPerSf * finishedSf);
    lines.push({ id: "hard_base", group: "hard", label: rehab ? "Rehab construction" : "Construction (base, standard foundation)", short: rehab ? "rehab construction" : "construction", amount: hardBase, basis: `${finishedSf.toLocaleString("en-US")} finished sq ft × ${usd(costPerSf)}/SF (${rehabEst ? rehabEst.tier.label : tier.label})`, sourceLabel: has(o.costPerSf) ? "Your input" : rehabEst ? rehabEst.sourceLabel : tier.costPerSf.sourceLabel });
    if (garageSf > 0) {
      const g = has(la.garage_level) ? la.garage_level : r1000(garageSf * costPerSf * garageShare.value);
      hardBase += g;
      lines.push({ id: "garage_level", group: "hard", label: "Tuck-under garage level", short: "garage level", amount: g, basis: `${garageSf.toLocaleString("en-US")} sq ft × ${usd(costPerSf)}/SF × ${Math.round(garageShare.value * 100)}%`, sourceLabel: has(la.garage_level) ? "Your number" : garageShare.sourceLabel });
      row("garageShare", garageShare.label, `${Math.round(garageShare.value * 100)}% of the tier rate`, garageShare, null, false);
    }
  }
  if (has(o.costPerUnit) && units == null) notes.push("Your per-home cost needs a home count; no layout was found.");
  const siteSuppressed = perUnitCost?.includesSite === true;

  // ---- Site adders: slope
  const hardSite: { siteWork: number; grouting?: number; demolition?: number } = { siteWork: 0 };
  const sl = f.slope_1m;
  const mean = sl?.mean_pct;
  const LM = cfg.lineModel;
  // Cost model v0.2 (backtest run D): the slope class comes from the slope UNDER THE BUILDING FOOTPRINT
  // (lidar under the site-fit footprint); the lot's average slope stands in when there is no footprint.
  // Over 15%: moderate premium + structural engineer. 25% or more: steep premium + retaining walls.
  const fpSlope = has(a.footprintSlopePct) ? a.footprintSlopePct : has(a.stepping?.footprintSlopePct) ? a.stepping!.footprintSlopePct : null;
  const slopeUsed: number | null = fpSlope ?? (has(mean) ? mean : null);
  const slopeBasis: string | null = slopeUsed == null ? null : fpSlope != null ? "under the building footprint" : "lot average (no building footprint)";
  let slopeKind: "steep" | "moderate" | null = null;
  if (slopeUsed == null) {
    if (!rehab) exclude("slope_adder", "Hillside foundation adder", "No lidar slope data for this lot, so no slope adder was checked", "no slope data for this lot");
  } else if (!rehab) {
    if (slopeUsed >= LM.steepPct) slopeKind = "steep";
    else if (slopeUsed > LM.slopeOverPct) slopeKind = "moderate";
  }
  const lotSlopeKind = slopeKind;
  const st = !rehab && a.stepping && a.stepping.steps > 0 ? a.stepping : null;
  // Stepped plates are drawn in 3D; the foundation is priced by the footprint-slope class above (run D).
  const stepping: DevelopmentPlan["stepping"] = st && slopeKind === "steep" ? { ...st, pricedBy: "steep_slope_adder" } : null;
  if (st) row("stepping", "Hillside stepping (under the footprint)", `${st.steps} step${st.steps === 1 ? "" : "s"}, ${+st.dropFt.toFixed(1)} ft drop, ${Math.round(st.footprintSlopePct)}% slope`, { sourceLabel: "1 m lidar under the site-fit footprint", sourceNote: "Priced by the slope premium for the slope under the building footprint" }, null, false);
  const steppedOnly = false;
  // The slope premium is priced on the building footprint (the foundation area), never on the finished
  // floor area of every floor; a steep or stepped site also gets one retaining-wall lump sum per building.
  const footprintSf: number | null = has(sel.footprintSf) && sel.footprintSf > 0
    ? sel.footprintSf
    : finishedSf != null ? Math.round(finishedSf / Math.max(1, sel.stories ?? 2)) : null;
  const footprintBasis = has(sel.footprintSf) && sel.footprintSf > 0 ? "building footprint" : `footprint estimated as finished area ÷ ${Math.max(1, sel.stories ?? 2)} floors`;
  if (slopeKind) {
    const def0 = slopeKind === "steep" ? cfg.siteAdders.steepSlope : cfg.siteAdders.moderateSlope;
    const def = steppedOnly ? { ...def0, label: "Stepped foundation (hillside stepping)" } : def0;
    const perSf = has(o.slopeAdderPerSf) ? o.slopeAdderPerSf : def.value;
    const where = fpSlope != null ? "under the building footprint" : "(lot average, no building footprint yet)";
    const why = slopeKind === "steep"
      ? `Steep slope ${where}: ${Math.round(slopeUsed!)}% (${LM.steepPct}% or more)`
      : `Moderate slope ${where}: ${Math.round(slopeUsed!)}% (over ${LM.slopeOverPct}%)`;
    const userLine = has(la.slope_adder) ? la.slope_adder : null;
    const amount = siteSuppressed ? null : userLine ?? (footprintSf != null ? r1000(perSf * footprintSf) : null);
    adders.push({
      id: slopeKind === "steep" ? "steep_slope" : "moderate_slope", label: def.label,
      reason: siteSuppressed ? `${why} → included in your per-home cost` : `${why} → +${usd(perSf)} per sq ft of footprint`,
      perSf: siteSuppressed ? null : perSf, amount, sourceLabel: siteSuppressed ? "Your number" : userLine != null ? "Your number" : has(o.slopeAdderPerSf) ? "Your input" : def.sourceLabel, range: rangeText(def.range, "usdSf"),
    });
    if (siteSuppressed) notes.push(`${def.label}: included in your per-home cost, so it is not added again.`);
    row("slopeAdder", `${def.label} (per sq ft of footprint)`, `${usd(perSf)}/SF of footprint`, def, rangeText(def.range, "usdSf"), has(o.slopeAdderPerSf));
    notes.push(fpSlope != null ? "Slope is measured under the building footprint (1 m lidar); the premium is priced on the footprint area." : "No building footprint yet, so the lot's average slope (1 m lidar) stands in; the premium is priced on the footprint area.");
    if (amount != null) {
      hardSite.siteWork += amount;
      lines.push({ id: "slope_adder", group: "hard", label: def.label, short: steppedOnly ? "stepped foundation" : "hillside foundation", amount, basis: userLine != null ? "Your number" : `${why}: ${footprintSf!.toLocaleString("en-US")} sq ft ${footprintBasis} × ${usd(perSf)}/SF`, sourceLabel: userLine != null ? "Your number" : has(o.slopeAdderPerSf) ? "Your input" : def.sourceLabel });
    }
    // Retaining walls: steep lot or stepped building, one lump sum per building.
    if (slopeKind === "steep" && !siteSuppressed) {
      const rw = cfg.siteAdders.retainingWalls;
      const nb = Math.max(1, sel.buildings ?? 1);
      const rwAmt = has(la.retaining_walls) ? la.retaining_walls : rw.value * nb;
      hardSite.siteWork += rwAmt;
      adders.push({ id: "retaining_walls", label: rw.label, reason: `${why} → retaining walls ${usd(rwAmt)}${nb > 1 ? ` (${nb} buildings)` : ""}`, perSf: null, amount: rwAmt, sourceLabel: has(la.retaining_walls) ? "Your number" : rw.sourceLabel, range: rangeText(rw.range, "usd") });
      lines.push({ id: "retaining_walls", group: "hard", label: rw.label, short: "retaining walls", amount: rwAmt, basis: has(la.retaining_walls) ? "Your number" : `${nb} building${nb === 1 ? "" : "s"} × ${usd(rw.value)} lump sum`, sourceLabel: has(la.retaining_walls) ? "Your number" : rw.sourceLabel });
      row("retainingWalls", rw.label, `${usd(rw.value)} per building`, rw, rangeText(rw.range, "usd"), false);
    }
    const perFinished = amount != null && finishedSf ? amount / finishedSf : 0;
    if (perFinished > cfg.outliers.siteFoundationPerSfMax.value)
      outliers.push(`Foundation and site work at ${usd(perFinished)} per finished sq ft is above ${usd(cfg.outliers.siteFoundationPerSfMax.value)}/SF: unusually high — verify.`);
  }

  // ---- Mine subsidence
  const overlay = (layer: string) => (f.overlays ?? []).some((x) => x.layer === layer && x.share > 0);
  const cityUndermined = f.mines?.in_city_undermined === true || overlay("undermined_pgh");
  const mineApplies = cityUndermined || f.mines?.in_mined_out === true || f.mines?.msi_risk === "confirmed";
  let minePath: DevelopmentPlan["minePath"] = null;
  let msiPremium: Receipt | null = null;
  let msiCoverage: number | null = null;
  if (mineApplies) {
    // Grouting protects a new foundation; a rehab of the existing house defaults to mine subsidence insurance.
    minePath = o.minePath ?? (cityUndermined && !rehab ? "grouting" : "insurance");
    const why = cityUndermined ? "In the City's undermined area" : f.mines?.in_mined_out ? "Over a mapped mined-out area (PA DEP)" : "Mine subsidence risk confirmed on the PA DEP insurance map";
    if (minePath === "grouting") {
      const g = cfg.siteAdders.mineGrouting;
      const amount = has(o.groutingCost) ? o.groutingCost : g.value;
      hardSite.grouting = amount;
      adders.push({ id: "mine_grouting", label: g.label, reason: `${why} → grouting ${usd(amount)}`, perSf: null, amount, sourceLabel: has(o.groutingCost) ? "Your input" : g.sourceLabel, range: rangeText(g.range, "usd") });
      lines.push({ id: "grouting", group: "hard", label: "Mine grouting", short: "mine grouting", amount, basis: `${why}; lump sum`, sourceLabel: has(o.groutingCost) ? "Your input" : g.sourceLabel });
      row("grouting", g.label, usd(amount), g, rangeText(g.range, "usd"), has(o.groutingCost));
    } else {
      const m = cfg.siteAdders.mineInsurance;
      if (hardBase != null) {
        msiCoverage = Math.min(MSI_CHART.maxCoverage, Math.max(MSI_CHART.minCoverage, Math.round(hardBase)));
        msiPremium = msiAnnualPremium(msiCoverage);
      }
      const prem = msiPremium?.status === "ok" ? msiPremium.value : null;
      adders.push({ id: "mine_insurance", label: m.label, reason: `${why} → insurance${prem != null ? ` about ${usd(prem)} a year` : ""}`, perSf: null, amount: null, sourceLabel: m.sourceLabel, range: null });
      row("msi", m.label, prem != null ? `${usd(prem)} a year on ${usd(msiCoverage!)} of coverage` : "needs a construction cost", m, null, false);
      if (tenure === "sale") notes.push("Mine subsidence insurance is a yearly cost for the owner, so it is not part of the development budget.");
    }
  }

  // ---- Items that apply but have no default cost
  const buildingOnLot = (f.site?.building_count ?? 0) > 0;
  const demoApplies = rehab || buildingOnLot;
  if (demoApplies) {
    const d = cfg.siteAdders.demolition;
    const label = rehab ? "Interior demolition for the rehab" : "Demolition of the existing building";
    const reason = rehab ? "Rehab work starts with removing old finishes and systems" : "A building stands on the lot";
    const perSf = d.value as number | null;
    const amount = has(o.demolition) ? o.demolition : perSf != null && has(f.building_footprint_sqft) ? perSf * f.building_footprint_sqft : null;
    if (amount != null) {
      hardSite.demolition = amount;
      lines.push({ id: "demolition", group: "hard", label, short: "demolition", amount, basis: reason, sourceLabel: has(o.demolition) ? "Your input" : d.sourceLabel });
      row("demolition", label, usd(amount), d, null, has(o.demolition));
    } else {
      exclude("demolition", label, reason);
      row("demolition", label, "not set", d, null, false);
    }
  }
  const landslide = overlay("landslide_prone_pgh");
  // Geotechnical report (cost model v0.2): $7,000 in the landslide-prone overlay (§906.04) or on a steep
  // site; $4,000 over undermined ground only. Interior rehab work does not disturb the slope.
  const steepSite = slopeKind === "steep";
  const underminedOnly = !landslide && !steepSite && (cityUndermined || f.mines?.in_mined_out === true);
  if (!rehab && (landslide || steepSite || underminedOnly)) {
    const g = LM.geotech;
    const amount = has(o.geotech) ? o.geotech : underminedOnly ? g.underminedOnly : g.hillsideOrLandslide;
    const reason = landslide ? "Lot is in the City's landslide-prone overlay (§906.04)" : steepSite ? `Steep site (${Math.round(slopeUsed!)}% ${slopeBasis})` : "Over undermined ground";
    lines.push({ id: "geotech", group: "soft", label: "Geotechnical report", short: "geotechnical report", amount, basis: reason, sourceLabel: has(o.geotech) ? "Your input" : g.sourceLabel });
    row("geotech", g.label, usd(amount), { sourceLabel: g.sourceLabel, sourceNote: g.trigger }, rangeText(g.range, "usd"), has(o.geotech));
  }
  const dumpApplies = demoApplies || (lotSlopeKind === "steep" && !siteSuppressed);
  if (dumpApplies) {
    const dd = cfg.siteAdders.dumpstersAndStreetPermit;
    const reason = demoApplies ? "Debris from demolition has to be hauled away" : "A steep lot leaves no flat room to stage on site";
    const amount = has(o.dumpsters) ? o.dumpsters : (dd.value as number | null);
    if (amount != null) {
      hardSite.siteWork += amount;
      lines.push({ id: "dumpsters", group: "hard", label: "Dumpsters and DOMI street permit", short: "dumpsters and street permit", amount, basis: reason, sourceLabel: has(o.dumpsters) ? "Your input" : dd.sourceLabel });
      row("dumpsters", dd.label, usd(amount), dd, null, has(o.dumpsters));
    } else {
      exclude("dumpsters", "Dumpsters and DOMI street permit", reason);
      row("dumpsters", dd.label, "not set", dd, null, false);
    }
  }
  // Water/sewer tap and connection fees are part of the permits line (City: Pittsburgh Water $610 per
  // house; suburbs: inside the flat permits-and-taps figure), so `tapFeesPerUnit` is not added again.
  const tapFees: number | undefined = undefined;
  // Water and sewer laterals (excavation, street opening, restoration), per house.
  if (!rehab && units != null && !siteSuppressed) {
    const wl = cfg.siteAdders.waterSewerLateral;
    const amount = has(la.lateral) ? la.lateral : wl.value * units;
    hardSite.siteWork += amount;
    lines.push({ id: "lateral", group: "hard", label: wl.label, short: "water and sewer laterals", amount, basis: has(la.lateral) ? "Your number" : `${units} house${units === 1 ? "" : "s"} × ${usd(wl.value)}`, sourceLabel: has(la.lateral) ? "Your number" : wl.sourceLabel });
    row("lateral", wl.label, `${usd(wl.value)} per house`, wl, rangeText(wl.range, "usd"), has(la.lateral));
  }

  // ---- Soft costs (cost model v0.2 = backtest run D): dollar items with triggers, carried as shares of hard + site.
  const sc = cfg.softCosts;
  const pgh = f.assessment?.is_pittsburgh === true;
  const hard0 = (hardBase ?? 0) + hardSite.siteWork + (hardSite.grouting ?? 0) + (hardSite.demolition ?? 0);
  const nb = units ?? 1;
  const newBuild = !rehab && hard0 > 0;
  const toShare = (d: number) => d / hard0;
  const aeCfg = sc.architectureEngineering;
  const aeDollars = Math.max(aeCfg.value * hard0, aeCfg.min);
  let ae = has(o.aeShare) ? o.aeShare : newBuild ? toShare(aeDollars) : aeCfg.value;
  const aeBasis = has(o.aeShare) ? `${pctText(ae)} of hard cost (your input)` : newBuild ? `${pctText(aeCfg.value)} of hard cost, at least ${usd(aeCfg.min)}` : `${pctText(ae)} of hard cost`;
  // Permits: City of Pittsburgh from the PLI 2026 schedule; suburbs a flat per-house figure to confirm.
  const pc = sc.pittsburghBuildingPermitFee;
  const pli = (value: number) => Math.min(pc.max, Math.max(pc.min, (pc.value * value) / 1000)) + pc.stateTrainingFee + pc.recordRetentionFee + (value > pc.techFeeValueOver ? pc.techFeeHigh : pc.techFeeLow);
  let permitDollars: number | null = null;
  let permitsBasis: string;
  let permitsRange: number[] | null = null;
  if (has(o.permitShare)) permitsBasis = "Your input";
  else if (newBuild && pgh) {
    const b = pli(hard0), e = pli(hard0 * pc.electricalShareOfValue), m = pli(hard0 * pc.mechanicalShareOfValue);
    permitDollars = b + e + m + (pc.certificateOfOccupancy + pc.pittsburghWater) * nb;
    permitsBasis = `City PLI schedule: building ${usd(b)} + electrical ${usd(e)} + mechanical ${usd(m)} + certificate of occupancy ${usd(pc.certificateOfOccupancy * nb)} + Pittsburgh Water permit and connection ${usd(pc.pittsburghWater * nb)} (per $1,000 of value)`;
    permitsRange = [toShare(permitDollars), toShare(permitDollars)];
  } else if (newBuild) {
    permitDollars = sc.permitsAndFees.flatPerHouse * nb;
    permitsBasis = `${usd(sc.permitsAndFees.flatPerHouse)} per house for permits and water/sewer tap-in fees: confirm with the municipality`;
    permitsRange = [toShare(sc.permitsAndFees.flatRange[0]! * nb), toShare(sc.permitsAndFees.flatRange[1]! * nb)];
    notes.push(`Permits and tap-in fees outside the City: ${usd(permitDollars)} is a placeholder (${usd(sc.permitsAndFees.flatRange[0]!)}–${usd(sc.permitsAndFees.flatRange[1]!)} per house in Pennsylvania). Confirm with the municipality and its water/sewer authority.`);
  } else permitsBasis = pgh ? `${usd(pc.value)} per $1,000 of construction value (PLI schedule)` : `${pctText(0.015)} of hard cost`;
  let permits = has(o.permitShare) ? o.permitShare : permitDollars != null ? toShare(permitDollars) : pgh ? pc.value / 1000 : 0.015;
  // Structural, civil, survey, insurance, title and closing.
  const structural = newBuild && ((slopeUsed != null && slopeUsed > LM.slopeOverPct) || steepSite) ? LM.structural.value : 0;
  const lotSf = f.assessment?.lot_area_sqft ?? f.lot_area_sqft_gis ?? Infinity;
  const disturbance = footprintSf != null ? Math.round(Math.min(lotSf, (Math.sqrt(footprintSf) + 2 * LM.civil.workZoneFt) ** 2 + LM.civil.drivewaySf)) : null;
  const civil = newBuild && ((disturbance != null && disturbance >= LM.civil.disturbanceSfMin) || steepSite) ? LM.civil.value : 0;
  const survey = newBuild ? LM.survey.value : 0;
  const insurance = LM.insurance.value * hard0;
  const titleClosing = LM.titleClosing.value * (land ?? 0);
  const otherDollars = structural + civil + survey + insurance + titleClosing;
  let other = has(o.softOtherShare) ? o.softOtherShare : newBuild ? toShare(otherDollars) : sc.surveyTitleLegalInsurance.value;
  const otherParts = [
    structural ? `structural engineer ${usd(structural)}` : null,
    civil ? `civil/grading ${usd(civil)}` : null,
    survey ? `survey ${usd(survey)}` : null,
    `builder's risk and liability ${pctText(LM.insurance.value)} (${usd(insurance)})`,
    land ? `title and closing ${pctText(LM.titleClosing.value)} of land (${usd(titleClosing)})` : null,
  ].filter(Boolean);
  const otherBasis = has(o.softOtherShare) ? `${pctText(other)} of hard cost (your input)` : newBuild ? otherParts.join(" + ") : `${pctText(other)} of hard cost`;
  const otherRange = newBuild && !has(o.softOtherShare)
    ? [toShare((structural ? LM.structural.range[0]! : 0) + (civil ? LM.civil.range[0]! : 0) + (survey ? LM.survey.range[0]! : 0) + LM.insurance.range[0]! * hard0 + LM.titleClosing.range[0]! * (land ?? 0)),
       toShare((structural ? LM.structural.range[1]! : 0) + (civil ? LM.civil.range[1]! : 0) + (survey ? LM.survey.range[1]! : 0) + LM.insurance.range[1]! * hard0 + LM.titleClosing.range[1]! * (land ?? 0))]
    : null;
  row("ae", aeCfg.label, newBuild ? `${pctText(aeCfg.value)} of hard cost, at least ${usd(aeCfg.min)}` : pctText(ae), aeCfg, rangeText(aeCfg.range, "share"), has(o.aeShare));
  if (newBuild && pgh) row("permits", pc.label, `${usd(pc.value)} per $1,000 of value + fees (${usd(permitDollars!)})`, pc, null, has(o.permitShare));
  else if (newBuild) row("permits", sc.permitsAndFees.label, `${usd(sc.permitsAndFees.flatPerHouse)} per house`, sc.permitsAndFees, rangeText(sc.permitsAndFees.flatRange, "usd"), has(o.permitShare));
  else row("permits", "Permits and fees", pctText(permits), { sourceLabel: pgh ? pc.sourceLabel : "Assumption, edit me" }, null, has(o.permitShare));
  if (newBuild) {
    row("structural", LM.structural.label, structural ? usd(structural) : `not needed (${LM.structural.trigger.toLowerCase()})`, { sourceLabel: LM.structural.sourceLabel, sourceNote: LM.structural.trigger }, rangeText(LM.structural.range, "usd"), false);
    row("civil", LM.civil.label, civil ? usd(civil) : `not needed (disturbed area about ${(disturbance ?? 0).toLocaleString("en-US")} sq ft)`, { sourceLabel: LM.civil.sourceLabel, sourceNote: LM.civil.trigger }, rangeText(LM.civil.range, "usd"), false);
    row("survey", LM.survey.label, usd(survey), LM.survey, rangeText(LM.survey.range, "usd"), false);
    row("insurance_builder", LM.insurance.label, `${pctText(LM.insurance.value)} of hard cost`, LM.insurance, rangeText(LM.insurance.range, "share"), false);
    row("titleClosing", LM.titleClosing.label, `${pctText(LM.titleClosing.value)} of the land price`, LM.titleClosing, rangeText(LM.titleClosing.range, "share"), false);
  }
  row("other", sc.surveyTitleLegalInsurance.label, pctText(other), { sourceLabel: sc.surveyTitleLegalInsurance.sourceLabel, sourceNote: otherBasis }, null, has(o.softOtherShare));
  row("gcFee", sc.gcFee.label, "not applied", sc.gcFee, rangeText(sc.gcFee.range, "share"), false);
  if (ae > cfg.outliers.aeShareMax.value) outliers.push(`Architecture and engineering at ${pctText(ae)} of hard cost is above ${pctText(cfg.outliers.aeShareMax.value)}: unusually high — verify.`);

  // ---- Contingency: 15% in the landslide-prone overlay or on a steep site, 10% otherwise; rehab 15%.
  const contingencyKind: "flat" | "hillside" | "rehab" = rehab ? "rehab" : landslide || steepSite ? "hillside" : "flat";
  const cdef = cfg.contingency[contingencyKind];
  let contingency = has(o.contingencyShare) ? o.contingencyShare : cdef.value;
  row("contingency", cdef.label, pctText(contingency), cdef, null, has(o.contingencyShare));

  // Share lines as dollars: a "Your number" sets the share (the line then equals your number).
  const hardSum = (hardBase ?? 0) + hardSite.siteWork + (hardSite.grouting ?? 0) + (hardSite.demolition ?? 0);
  if (hardSum > 0) {
    const fix = (share: number, id: string) => (has(la[id]) ? la[id]! / hardSum : share);
    ae = fix(ae, "ae");
    permits = fix(permits, "permits");
    other = fix(other, "other_soft");
    contingency = fix(contingency, "contingency");
  }

  // ---- Schedule, holding and financing
  const fin = cfg.financing;
  const approvalMonths = has(o.approvalMonths) ? Math.round(o.approvalMonths) : has(a.permitMonths) ? Math.round(a.permitMonths) : (fin.approvalMonthsFallback.value as number | null);
  if (approvalMonths == null) exclude("approval_holding", "Holding costs during approval", "Approval time is not estimated for this lot", "approval time not estimated");
  row("approvalMonths", "Months to approval", approvalMonths != null ? `${approvalMonths}` : "not estimated", { sourceLabel: has(o.approvalMonths) ? "Your input" : "Ease Score months to a permit" }, null, has(o.approvalMonths));
  const cm = rehab ? fin.constructionMonths.rehab : units != null && units > 1 ? fin.constructionMonths.multi : fin.constructionMonths.single;
  const constructionMonths = has(o.constructionMonths) ? Math.round(o.constructionMonths) : cm.value;
  row("constructionMonths", fin.constructionMonths.label, `${constructionMonths}`, cm, null, has(o.constructionMonths));

  // City of Pittsburgh: 2026 total millage (City + parks + library + schools + County); elsewhere the parcel's rate.
  const mills = isCity ? cfg.propertyTax.cityMills.value : f.property_tax?.general_mills;
  const assessed = f.assessment?.fmv_total;
  const monthlyTax = has(mills) && has(assessed) ? (assessed * mills) / 1000 / 12 : null;
  if (monthlyTax == null) exclude("holding_taxes", "Property taxes while holding", "Taxes are owed while approving and building", "tax rate or assessment not loaded");
  else row("holdingTax", "Property taxes while holding, monthly", usd(monthlyTax), isCity ? { sourceLabel: `County assessment × ${cfg.propertyTax.cityMills.value} mills`, sourceNote: cfg.propertyTax.cityMills.sourceLabel } : { sourceLabel: "County assessment × total millage (County Treasurer)" }, null, false);

  // Construction loan: an assumed rate, interest-only on the drawn balance (cost model v0.2: 7.75%).
  const rate = has(o.constructionRate) ? o.constructionRate : fin.constructionRate.value;
  row("constructionRate", fin.constructionRate.label, pctText(rate), has(o.constructionRate) ? { sourceLabel: "Your input" } : { sourceLabel: fin.constructionRate.sourceLabel, sourceNote: `${fin.constructionRate.sourceNote}${has(a.primeRate) ? ` Latest prime in our data: ${pctText(a.primeRate)}${a.primeRateDate ? ` on ${a.primeRateDate}` : ""}.` : ""}` }, rangeText(fin.constructionRate.range, "share"), has(o.constructionRate));
  const ltc = has(o.ltc) ? o.ltc : fin.loanToCost.value;
  row("ltc", fin.loanToCost.label, pctText(ltc), fin.loanToCost, null, has(o.ltc));
  row("draw", fin.averageDrawShare.label, pctText(fin.averageDrawShare.value), fin.averageDrawShare, null, false);
  row("loanFees", fin.loanFeeShare.label, pctText(fin.loanFeeShare.value), fin.loanFeeShare, null, false);

  const dev = {
    units: units ?? undefined,
    grossSqFt: finishedSf ?? undefined,
    land: land ?? undefined,
    hardCost: hardBase ?? undefined,
    hardSiteLines: { ...hardSite },
    softCostShareOfHard: ae + permits + other,
    softSiteLines: {
      ...(lines.some((l) => l.id === "geotech") ? { geotechnical: lines.find((l) => l.id === "geotech")!.amount } : {}),
      ...(tapFees !== undefined ? { tapFees } : {}),
    },
    contingencyShareOfHard: contingency,
    approvalMonths: approvalMonths ?? 0,
    approvalDelayMonths: 0,
    constructionMonths,
    constructionDelayMonths: 0,
    monthlyHoldingCost: monthlyTax ?? 0,
    constructionLoanLtc: rate == null ? 0 : ltc,
    constructionRate: rate ?? 0,
    averageDrawShare: fin.averageDrawShare.value,
    loanFees: 0,
    grants: [],
  };
  // Lender fees are a share of the loan, and the loan is a share of cost: size it with one finance pass.
  const first = developmentCosts(dev);
  if (first.constructionLoan.status === "ok") dev.loanFees = first.constructionLoan.value * fin.loanFeeShare.value;
  const hardTotal = first.hard.status === "ok" ? first.hard.value : null;

  // ---- Revenue: sale
  const saleCfg = cfg.sale;
  // New builds are valued only from new-construction comps; older-home sales are shown as a floor.
  // Rehab is valued from existing-home comps (matched on size and age by the caller).
  const c: CompSet | SalesCompsLike | null = rehab ? a.comps : a.newComps ?? null;
  const compsOk = !!c && c.status === "ok" && c.sufficient !== false && has(c.median_price_per_sqft) && (!rehab || c.comparable_use !== "vacant land");
  const old = a.comps;
  const floor =
    !rehab && old && old.status === "ok" && old.sufficient !== false && old.comparable_use === "single family" && has(old.median_price_per_sqft)
      ? { pricePerSf: old.median_price_per_sqft, text: `Older homes nearby sold for a median ${usd(old.median_price_per_sqft)} per sq ft (${old.count} sales within ${old.radius_mi} mi). That is a floor, not the value of a new home.` }
      : null;
  const compSource = rehab ? ("sourceLabel" in (c ?? {}) ? (c as CompSet).sourceLabel : "Allegheny County sales (existing homes)") : cfg.comps.newConstruction.sourceLabel;
  const compText = compsOk
    ? `Median of ${c!.count} ${rehab ? "" : "new-construction "}sales within ${c!.radius_mi} mi${c!.date_range?.from ? ` (${c!.date_range.from} to ${c!.date_range.to})` : ""}`
    : !c
      ? rehab
        ? "No value: nearby sales of this kind of home could not be loaded."
        : "No value: new-construction sales near this lot could not be loaded."
      : c.note
        ? `No value: ${c.note.replace(/\s*No (new-home value|value|estimate) is (estimated|made)\.?$/, "")}`
        : "No value: there are not enough comparable sales nearby to price a finished home.";
  const perUnitPrice = has(o.salePricePerUnit) && units != null ? o.salePricePerUnit : null;
  const pricePerSf = perUnitPrice != null ? (finishedSf ? (perUnitPrice * units!) / finishedSf : null) : has(o.salePricePerSf) ? o.salePricePerSf : compsOk ? c!.median_price_per_sqft! : null;
  const saleBasis = perUnitPrice != null ? `Your sale price per home` : has(o.salePricePerSf) ? "Your sale price per sq ft" : compText;
  const saleSource = perUnitPrice != null || has(o.salePricePerSf) ? "Your input" : compsOk ? compSource : "Insufficient comps";
  if (pricePerSf == null && perUnitPrice == null && tenure === "sale") {
    const why = saleBasis.replace(/^No value: /, "").replace(/\.?$/, ".");
    missing.push(`No sale value. ${why.charAt(0).toUpperCase()}${why.slice(1)}${floor ? ` ${floor.text}` : ""} Enter a sale price to test it.`);
  }
  // Sale price per home rounded to $5,000; the math uses the rounded price.
  const rawPerHome = perUnitPrice == null && pricePerSf != null && finishedSf != null && units ? (pricePerSf * finishedSf) / units : null;
  const roundedPerHome = rawPerHome != null ? roundStep(rawPerHome, cfg.rounding.salePrice) : null;
  const grossSales = perUnitPrice != null ? perUnitPrice * units! : roundedPerHome != null ? roundedPerHome * units! : null;
  const saleRounding = rawPerHome != null && roundedPerHome != null
    ? `${usd(pricePerSf!)}/SF × ${Math.round(finishedSf! / units!).toLocaleString("en-US")} sq ft = ${usd(rawPerHome)} per home, rounded to ${usd(roundedPerHome)}`
    : null;
  if (perUnitPrice != null) row("salePricePerUnit", "Sale price per home", usd(perUnitPrice), { sourceLabel: "Your input" }, null, true);
  else row("salePricePerSf", "Sale price per finished sq ft", pricePerSf != null ? `${usd(pricePerSf)}/SF` : "not set", { sourceLabel: saleSource, sourceNote: saleBasis }, null, has(o.salePricePerSf));
  const nc = !rehab && c && c.status === "ok" && c.sufficient !== false ? (c as CompSet) : null;
  const priceCheck =
    (perUnitPrice != null || has(o.salePricePerSf)) && nc && has(nc.median_price)
      ? `Your price ${usd(perUnitPrice ?? (pricePerSf! * (finishedSf ?? 0)) / (units ?? 1))} per home vs. recent new-build median ${usd(nc.median_price)} (${usd(nc.median_price_per_sqft ?? 0)}/SF, ${Math.round(nc.median_living_area_sqft ?? 0).toLocaleString("en-US")} sq ft; ${nc.count} sales within ${nc.radius_mi} mi).`
      : null;
  let sizeWarning: string | null = null;
  const perHome = finishedSf != null && units ? finishedSf / units : null;
  if (!rehab && nc && has(nc.median_living_area_sqft) && perHome != null && perHome < nc.median_living_area_sqft * cfg.comps.smallLayoutRatio.value)
    sizeWarning = `This layout is small for new construction nearby: ${Math.round(perHome).toLocaleString("en-US")} vs ${Math.round(nc.median_living_area_sqft).toLocaleString("en-US")} sq ft typical per home.${perUnitPrice == null && !has(o.salePricePerSf) ? " The value assumes a home this size sells for the same price per sq ft." : ""}`;
  // Realty transfer tax (total): City 5% (4.5% in the Baldwin-Whitehall School District); elsewhere the parcel's rate.
  const ttc = saleCfg.transferTax;
  const bwSd = JSON.stringify(f.transfer_tax?.parts ?? "").includes("Baldwin-Whitehall");
  const tt = isCity ? (bwSd ? ttc.cityBaldwinWhitehallPct : ttc.cityPct) : f.transfer_tax?.total_pct ?? ttc.suburbDefaultPct;
  const sellerTt = has(tt) ? (tt / 100) * saleCfg.sellerTransferTaxShare.value : null;
  if (sellerTt == null && tenure === "sale") exclude("transfer_tax", "Seller's realty transfer tax", "Pennsylvania and local transfer tax is due at sale", "rate not loaded");
  const sellingShare = saleCfg.brokerShare.value + (sellerTt ?? 0);
  row("broker", saleCfg.brokerShare.label, pctText(saleCfg.brokerShare.value), saleCfg.brokerShare, null, false);
  if (sellerTt != null) row("transferTax", "Seller's share of the realty transfer tax", `${pctText(sellerTt)} (half of ${+tt!.toFixed(2)}%)`, { sourceLabel: isCity || !has(f.transfer_tax?.total_pct) ? ttc.sourceLabel : "Transfer tax rates (PA Dept. of Revenue, local)", sourceNote: saleCfg.sellerTransferTaxShare.sourceNote }, null, false);
  row("salesMonths", saleCfg.salesMonths.label, String(saleCfg.salesMonths.value), saleCfg.salesMonths, null, false);

  const saleMix: UnitRow[] | undefined =
    units != null ? [{ label: "Finished home", count: units, salePrice: grossSales != null ? grossSales / units : null }] : undefined;
  const forSale: ForSaleInputs = { ...dev, unitMix: saleMix, sellingCostShare: sellingShare, salesMonths: saleCfg.salesMonths.value };

  // ---- Revenue: rent
  const r = a.rents;
  const byOption = cfg.rent.bedroomsByOption as Record<string, number | string>;
  const br = has(o.bedrooms) ? Math.min(4, Math.max(0, Math.round(o.bedrooms))) : Number(byOption[a.strategy] ?? 2);
  const hudB = r?.hud_fmr ? { year: r.hud_fmr.year ?? null, zip: r.hud_fmr.zip ?? null, level: r.hud_fmr.level ?? null, br0: r.hud_fmr.br0 ?? null, br1: r.hud_fmr.br1 ?? null, br2: r.hud_fmr.br2 ?? null, br3: r.hud_fmr.br3 ?? null, br4: r.hud_fmr.br4 ?? null } : null;
  const zoriB = r?.zori ? { zip: r.zori.zip ?? null, latest_rent: r.zori.latest_rent ?? null, latest_month: r.zori.latest_month ?? null } : null;
  const rentEst: RentEstimate | null = a.rentsByBedroom?.byBedroom?.[br] ?? (hudB || zoriB ? rentForBedrooms(br, null, { asOf: "", hud: hudB, zori: zoriB }) : null);
  const estOk = rentEst != null && rentEst.likely != null;
  const rentPerUnit = has(o.rentPerUnit) ? o.rentPerUnit : estOk ? rentEst!.likely : null;
  const rawRent = estOk ? (rentEst!.basis === "hud_safmr" ? rentEst!.hud : rentEst!.basis === "zori" ? rentEst!.zori : null) : null;
  const rentRounding = rawRent != null && rentPerUnit != null && !has(o.rentPerUnit) ? `${rentEst!.basis === "hud_safmr" ? "HUD Fair Market Rent" : "ZIP rent index"} ${usd(rawRent)}, rounded to ${usd(rentPerUnit)}` : null;
  const brText = br === 0 ? "studio" : `${br}-bedroom`;
  const rentBasis = has(o.rentPerUnit) ? "Your rent" : estOk ? `${brText} home: ${rentEst!.basisLabel}` : "No rent evidence for this ZIP code";
  const rentSource = has(o.rentPerUnit) ? "Your input" : estOk ? rentEst!.basisLabel : "Not available";
  if (rentPerUnit == null && tenure === "rent") missing.push("No rent: no rental listings, Fair Market Rent or rent index for this ZIP code. Enter a monthly rent to test it.");
  row("bedrooms", "Bedrooms per home (rent)", String(br), { sourceLabel: has(o.bedrooms) ? "Your input" : String(byOption.sourceLabel ?? "Assumption, edit me"), sourceNote: "Default mix by option: single-family, duplex and townhouse 3 bedrooms; 3–4 unit building 2; ADU 1" }, null, has(o.bedrooms));
  row("rentPerUnit", "Monthly rent per home", rentPerUnit != null ? usd(rentPerUnit) : "not set", { sourceLabel: rentSource, sourceNote: rentBasis }, null, has(o.rentPerUnit));

  const op = cfg.operating;
  const perUnit = (v: number) => (units != null ? v * units : null);
  const opexLines: RentalInputs["opexLines"] = {};
  const prem = msiPremium?.status === "ok" ? msiPremium.value : undefined;
  if (minePath === "insurance" && prem !== undefined) opexLines.mineSubsidenceInsurance = prem;
  const floodShare = f.flood_1pct_share ?? 0;
  if (floodShare > 0) {
    const nfip = f.flood_evidence?.tract_nfip_median_premium;
    if (has(nfip)) {
      opexLines.floodInsurance = nfip * (units ?? 1);
      row("flood", "Flood insurance per home, yearly", usd(nfip), { sourceLabel: "OpenFEMA NFIP median premium in this census tract" }, null, false);
    } else if (tenure === "rent") exclude("flood_insurance", "Flood insurance", "Part of the lot is in the FEMA 1% flood zone", "no premium data for this tract");
  }
  const rentMix: UnitRow[] | undefined = units != null ? [{ label: "Market-rate home", count: units, monthlyRent: rentPerUnit }] : undefined;
  // Assessed value after completion, from completed projects (ratio of assessed value to sale price) × the value.
  const valueForTax = grossSales != null ? { v: grossSales, basis: perUnitPrice != null || has(o.salePricePerSf) ? "(your sale value)" : "(estimated sale value from new-construction comps)" }
    : hardTotal != null ? { v: (land ?? 0) + hardTotal, basis: "(land + construction cost: no sale comps to value it)" } : null;
  const attached = a.strategy !== "new_sf" && a.strategy !== "rehab_existing" && a.strategy !== "adu";
  const assessedEst: AssessedEstimate | null = valueForTax ? assessedAfterCompletion({ value: valueForTax.v, isCity, attached, valueBasis: valueForTax.basis }) : null;
  const assessedAfter = assessedEst ? assessedEst.assessed : null;
  if (assessedEst && tenure === "rent") row("assessedAfter", "Assessed value after completion (for taxes)", usd(assessedEst.assessed), { sourceLabel: "Completed projects: County assessed value ÷ sale price", sourceNote: assessedEst.receipt }, `${Math.round(assessedEst.ratioRange[0] * 100)}–${Math.round(assessedEst.ratioRange[1] * 100)}% of value`, false);
  const rental: RentalInputs = {
    ...dev,
    unitMix: rentMix,
    vacancyShare: op.vacancyShare.value,
    otherIncomeAnnual: 0,
    taxMills: mills ?? undefined,
    assessedValue: assessedAfter ?? undefined,
    propertyInsurance: perUnit(op.propertyInsurancePerUnitYear.value),
    maintenance: perUnit(op.maintenancePerUnitYear.value),
    managementShareOfEgi: op.managementShareOfEgi.value,
    ownerUtilities: perUnit(op.ownerUtilitiesPerUnitYear.value),
    replacementReserves: perUnit(op.replacementReservesPerUnitYear.value),
    opexLines,
  };
  if (tenure === "rent") {
    row("vacancy", op.vacancyShare.label, pctText(op.vacancyShare.value), op.vacancyShare, null, false);
    row("management", op.managementShareOfEgi.label, pctText(op.managementShareOfEgi.value), op.managementShareOfEgi, null, false);
    row("maintenance", op.maintenancePerUnitYear.label, usd(op.maintenancePerUnitYear.value), op.maintenancePerUnitYear, null, false);
    row("insurance", op.propertyInsurancePerUnitYear.label, usd(op.propertyInsurancePerUnitYear.value), op.propertyInsurancePerUnitYear, null, false);
    row("reserves", op.replacementReservesPerUnitYear.label, usd(op.replacementReservesPerUnitYear.value), op.replacementReservesPerUnitYear, null, false);
    row("utilities", op.ownerUtilitiesPerUnitYear.label, usd(op.ownerUtilitiesPerUnitYear.value), op.ownerUtilitiesPerUnitYear, null, false);
    if (has(mills)) row("taxMills", "Property tax rate", `${mills} mills`, { sourceLabel: "Allegheny County Treasurer millage", sourceNote: op.assessedValueNote }, null, false);
    else exclude("rental_taxes", "Property taxes (rental)", "Taxes are owed every year", "tax rate not loaded");
  }

  // ---- Sources with years (land, value, rent)
  const ASSUME: DataSource = { label: "Assumption, edit me", asOf: null, kind: "assumption" };
  const USER: DataSource = { label: "Your input", asOf: null, kind: "user" };
  const taxYear = f.assessment?.tax_year ?? null;
  const assessAsOf = f.assessment?.as_of ?? null;
  void taxYear; void assessAsOf;
  const landSrc: DataSource = userLand != null ? USER : land == null ? ASSUME : rehab ? {
    label: rehabPurchase!.basis.split(":")[0]!, asOf: a.asIsComps?.date_range?.from ? `${a.asIsComps.date_range.from} to ${a.asIsComps.date_range.to}` : null, kind: "data",
  } : {
    label: landEst!.public ? `${cfg.land.publicFlag}; agency and private vacant-land sales, ${landEst!.dateRange.from.slice(0, 7)} to ${landEst!.dateRange.to.slice(0, 7)}` : `Allegheny County vacant-land sales, ${landEst!.scope}, ${landEst!.sales} sales, ${landEst!.dateRange.from.slice(0, 7)} to ${landEst!.dateRange.to.slice(0, 7)}`,
    asOf: `${landEst!.dateRange.from.slice(0, 7)} to ${landEst!.dateRange.to.slice(0, 7)}`, kind: "data",
  };
  const cr = c && compsOk ? c : null;
  const saleSrc: DataSource = perUnitPrice != null || has(o.salePricePerSf) ? USER : cr ? {
    label: `${compSource}, ${cr.count} sales within ${cr.radius_mi} mi${cr.date_range?.from ? `, ${cr.date_range.from} to ${cr.date_range.to}` : ""}`,
    asOf: cr.date_range?.from ? `${cr.date_range.from} to ${cr.date_range.to}` : null, kind: "data",
  } : ASSUME;
  const rentSrc: DataSource = has(o.rentPerUnit) ? USER : estOk ? {
    label: `${rentEst!.basisLabel}, ${brText}`,
    asOf: rentEst!.basis === "hud_safmr" ? (hudB?.year != null ? `FY${hudB.year}` : null) : rentEst!.basis === "zori" ? (zoriB?.latest_month ?? "").slice(0, 7) || null : a.rentsByBedroom?.asOf ?? null, kind: "data",
  } : ASSUME;

  const evidence: Evidence = missing.length ? "missing" : exclusions.length ? "partial" : "complete";
  return {
    configVersion: cfg.version,
    strategy: a.strategy,
    scheme: sel,
    tenure,
    units,
    finishedSf,
    sizeBasis,
    program,
    sizeWarning,
    valueComps: c,
    floor,
    priceCheck,
    perUnitCost,
    tier: { id: tier.id, label: tier.label },
    costPerSf,
    land: { value: land, sourceLabel: landSource, estimate: landEst, flag: landEst?.public && userLand == null ? cfg.land.publicFlag : null },
    rehab: rehabEst,
    assessedAfter: assessedEst,
    rentEstimate: estOk ? rentEst : null,
    bedrooms: br,
    rounding: {
      rent: rentRounding,
      sale: saleRounding,
      land: landEst && userLand == null && Math.abs(landEst.raw - landEst.likely) >= 1 ? `${usd(landEst.raw)}, rounded to ${usd(landEst.likely)}` : null,
    },
    footprintSf,
    userLines: Object.keys(la).filter((k) => has(la[k])),
    lines,
    shares: { ae, aeRange: null, permits, other, permitsBasis, contingency, contingencyKind, aeBasis, otherBasis, otherLabel: newBuild ? "Structural, civil, survey, insurance and closing" : undefined, permitsRange, otherRange },
    slopeBasis,
    loanFeeShare: fin.loanFeeShare.value,
    adders,
    stepping,
    exclusions,
    minePath,
    msiPremium,
    msiCoverage,
    revenue: {
      sale: { pricePerSf, pricePerUnit: grossSales != null && units ? grossSales / units : null, grossSales, basis: saleBasis, sourceLabel: saleSource },
      rent: { perUnit: rentPerUnit, basis: rentBasis, sourceLabel: rentSource },
    },
    forSale,
    rental,
    sources: { land: landSrc, sale: saleSrc, rent: rentSrc },
    assumptions: rows,
    outliers,
    missing,
    evidence,
    notes,
  };
}
