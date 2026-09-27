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

export type Tenure = "sale" | "rent";
export type Evidence = "complete" | "partial" | "missing";

/** The parts of parcel_facts the pro forma reads. */
export interface ProFormaFacts {
  slope_1m?: { mean_pct?: number | null; share_over_15?: number | null; share_over_25?: number | null } | null;
  overlays?: { layer: string; share: number }[] | null;
  mines?: { in_city_undermined?: boolean | null; in_mined_out?: boolean | null; msi_risk?: string | null } | null;
  site?: { building_count?: number | null } | null;
  assessment?: { use?: string | null; fmv_land?: number | null; fmv_total?: number | null; living_area_sqft?: number | null; is_pittsburgh?: boolean | null } | null;
  property_tax?: { general_mills?: number | null } | null;
  transfer_tax?: { total_pct?: number | null } | null;
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
  hud_fmr?: { year?: number | null; level?: string | null; br0?: number; br1?: number; br2?: number; br3?: number; br4?: number } | null;
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
  id: "moderate_slope" | "steep_slope" | "mine_grouting" | "mine_insurance";
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
  land: { value: number | null; sourceLabel: string };
  lines: PlanLine[];
  shares: { ae: number; permits: number; other: number; permitsBasis: string; contingency: number; contingencyKind: "flat" | "hillside" | "rehab" };
  loanFeeShare: number;
  adders: AdderFired[];
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
const wholePct = (share: number) => `${Math.round(share * 100)}%`;
const rangeText = (r: number[] | undefined, kind: "usd" | "share" | "usdSf") =>
  r && r.length === 2 ? (kind === "share" ? `${pctText(r[0]!)}–${pctText(r[1]!)}` : kind === "usdSf" ? `${usd(r[0]!)}–${usd(r[1]!)}/SF` : `${usd(r[0]!)}–${usd(r[1]!)}`) : null;

const has = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

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
  const o = a.overrides ?? {};
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

  // ---- Land
  const anchor = rehab ? f.assessment?.fmv_total : f.assessment?.fmv_land;
  const anchorLabel = rehab ? "County assessed total value (not a price)" : "County assessed land value (not a price)";
  const land = has(o.land) ? o.land : has(anchor) ? anchor : null;
  const landSource = has(o.land) ? "Your input" : anchorLabel;
  if (land == null) missing.push("No land price: enter the purchase price (the county assessment has no value to start from).");
  else {
    lines.push({ id: "land", group: "land", label: rehab ? "Purchase price (land and building)" : "Land (purchase price)", short: rehab ? "purchase" : "land", amount: land, basis: has(o.land) ? "Your price" : "Starting point until you enter the agreed price", sourceLabel: landSource });
    row("land", rehab ? "Purchase price" : "Land price", usd(land), { sourceLabel: anchorLabel }, null, has(o.land));
  }

  // ---- Base construction
  const tier = tierOf(cfg, o.tier);
  const costPerSf = has(o.costPerSf) ? o.costPerSf : tier.costPerSf.value;
  row("tier", "Construction quality tier", `${tier.label} — ${tier.meaning}`, { sourceLabel: tier.costPerSf.sourceLabel }, null, o.tier !== undefined && o.tier !== cfg.construction.defaultTier);
  row("costPerSf", "Construction cost per finished sq ft (includes builder overhead and profit)", `${usd(costPerSf)}/SF`, tier.costPerSf, rangeText(tier.costPerSf.range, "usdSf"), has(o.costPerSf));
  if (rehab) notes.push(cfg.construction.rehabNote);
  const garageShare = cfg.construction.garageLevelShareOfTier;
  const perUnitCost = has(o.costPerUnit) && units != null ? { value: o.costPerUnit, includesSite: o.costIncludesSite === true } : null;
  let hardBase: number | null = null;
  if (perUnitCost) {
    hardBase = perUnitCost.value * units!;
    lines.push({ id: "hard_base", group: "hard", label: rehab ? "Rehab construction (your number per home)" : "Construction (your number per home)", short: "construction", amount: hardBase, basis: `${units} home${units === 1 ? "" : "s"} × ${usd(perUnitCost.value)}${perUnitCost.includesSite ? ", including site work and foundation" : ", building only (site adders added separately)"}${garageSf ? "; covers the garage level too" : ""}`, sourceLabel: "Your number" });
    row("costPerUnit", "Construction cost per home", usd(perUnitCost.value), { sourceLabel: "Your number" }, null, true);
    row("costIncludesSite", "Per-home cost includes site work and foundation", perUnitCost.includesSite ? "Yes: site adders not added" : "No: site adders added on top", { sourceLabel: "Your input" }, null, true);
  } else if (rehab && !has(o.costPerSf)) {
    // No local rehab cost yet: never price a rehab at new-construction rates.
    missing.push("Enter your rehab cost (per sq ft or per home). No local rehab cost is set, and new-construction rates are not used for a rehab.");
  } else if (finishedSf != null) {
    hardBase = costPerSf * finishedSf;
    lines.push({ id: "hard_base", group: "hard", label: rehab ? "Rehab construction" : "Construction (base, standard foundation)", short: rehab ? "rehab construction" : "construction", amount: hardBase, basis: `${finishedSf.toLocaleString("en-US")} finished sq ft × ${usd(costPerSf)}/SF (${tier.label})`, sourceLabel: has(o.costPerSf) ? "Your input" : tier.costPerSf.sourceLabel });
    if (garageSf > 0) {
      const g = garageSf * costPerSf * garageShare.value;
      hardBase += g;
      lines.push({ id: "garage_level", group: "hard", label: "Tuck-under garage level", short: "garage level", amount: g, basis: `${garageSf.toLocaleString("en-US")} sq ft × ${usd(costPerSf)}/SF × ${Math.round(garageShare.value * 100)}%`, sourceLabel: garageShare.sourceLabel });
      row("garageShare", garageShare.label, `${Math.round(garageShare.value * 100)}% of the tier rate`, garageShare, null, false);
    }
  }
  if (has(o.costPerUnit) && units == null) notes.push("Your per-home cost needs a home count; no layout was found.");
  const siteSuppressed = perUnitCost?.includesSite === true;

  // ---- Site adders: slope
  const hardSite: { siteWork: number; grouting?: number; demolition?: number } = { siteWork: 0 };
  const sl = f.slope_1m;
  const mean = sl?.mean_pct;
  const sh25 = sl?.share_over_25;
  const steepT = cfg.siteAdders.steepSlope.trigger;
  const modT = cfg.siteAdders.moderateSlope.trigger;
  let slopeKind: "steep" | "moderate" | null = null;
  if (!sl || (!has(mean) && !has(sh25))) {
    if (!rehab) exclude("slope_adder", "Hillside foundation adder", "No lidar slope data for this lot, so no slope adder was checked", "no slope data for this lot");
  } else if (!rehab) {
    if ((has(sh25) && sh25 >= steepT.shareOver25Min) || (has(mean) && mean >= steepT.meanSlopePctMin)) slopeKind = "steep";
    else if (has(mean) && mean >= modT.meanSlopePctMin) slopeKind = "moderate";
  }
  if (slopeKind) {
    const def = slopeKind === "steep" ? cfg.siteAdders.steepSlope : cfg.siteAdders.moderateSlope;
    const perSf = has(o.slopeAdderPerSf) ? o.slopeAdderPerSf : def.value;
    const why =
      slopeKind === "steep"
        ? has(sh25) && sh25 >= steepT.shareOver25Min
          ? `Steep slope under ${wholePct(sh25)} of the lot`
          : `Steep slope: the lot averages ${Math.round(mean!)}%`
        : `Moderate slope: the lot averages ${Math.round(mean!)}% (8–25%)`;
    const amount = finishedSf != null && !siteSuppressed ? perSf * finishedSf : null;
    adders.push({
      id: slopeKind === "steep" ? "steep_slope" : "moderate_slope", label: def.label,
      reason: siteSuppressed ? `${why} → included in your per-home cost` : `${why} → +${usd(perSf)}/SF`,
      perSf: siteSuppressed ? null : perSf, amount, sourceLabel: siteSuppressed ? "Your number" : has(o.slopeAdderPerSf) ? "Your input" : def.sourceLabel, range: rangeText(def.range, "usdSf"),
    });
    if (siteSuppressed) notes.push(`${def.label}: included in your per-home cost, so it is not added again.`);
    row("slopeAdder", def.label, `${usd(perSf)}/SF`, def, rangeText(def.range, "usdSf"), has(o.slopeAdderPerSf));
    notes.push("Slope is measured across the whole lot (1 m lidar), not under the building footprint.");
    if (amount != null) {
      hardSite.siteWork += amount;
      lines.push({ id: "slope_adder", group: "hard", label: def.label, short: "hillside foundation", amount, basis: `${why}: ${finishedSf!.toLocaleString("en-US")} sq ft × ${usd(perSf)}/SF`, sourceLabel: has(o.slopeAdderPerSf) ? "Your input" : def.sourceLabel });
    }
    if (perSf > cfg.outliers.siteFoundationPerSfMax.value)
      outliers.push(`Foundation and site work at ${usd(perSf)}/SF is above ${usd(cfg.outliers.siteFoundationPerSfMax.value)}/SF: unusually high — verify.`);
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
  // New buildings in the overlay need the report (§906.04); interior rehab work does not disturb the slope.
  if (landslide && !rehab) {
    const g = cfg.siteAdders.geotechReport;
    const amount = has(o.geotech) ? o.geotech : (g.value as number | null);
    if (amount != null) {
      lines.push({ id: "geotech", group: "soft", label: "Geotechnical report", short: "geotechnical report", amount, basis: "Lot is in the City's landslide-prone overlay (§906.04)", sourceLabel: has(o.geotech) ? "Your input" : g.sourceLabel });
      row("geotech", g.label, usd(amount), g, null, has(o.geotech));
    } else {
      exclude("geotech", "Geotechnical report", "The lot is in the City's landslide-prone overlay (§906.04)");
      row("geotech", g.label, "not set", g, null, false);
    }
  }
  const dumpApplies = demoApplies || (slopeKind === "steep" && !siteSuppressed);
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
  let tapFees: number | undefined;
  if (!rehab && units != null && a.tapFeesPerUnit !== undefined) {
    if (a.tapFeesPerUnit === null) exclude("tap_fees", "Water and sewer tap fees", "Every new home needs water and sewer connections", "fee schedule not loaded for this area");
    else {
      tapFees = a.tapFeesPerUnit * units;
      lines.push({ id: "tap_fees", group: "soft", label: "Water and sewer permit, connection and meter fees", short: "tap fees", amount: tapFees, basis: `${usd(a.tapFeesPerUnit)} per home × ${units}`, sourceLabel: "Published water authority tariff" });
    }
  }

  // ---- Soft costs
  const sc = cfg.softCosts;
  const pgh = f.assessment?.is_pittsburgh === true;
  const ae = has(o.aeShare) ? o.aeShare : sc.architectureEngineering.value;
  const permitComputable = pgh && !has(o.permitShare);
  const permits = has(o.permitShare) ? o.permitShare : pgh ? sc.pittsburghBuildingPermitFee.value / 1000 : sc.permitsAndFees.value;
  const permitsBasis = has(o.permitShare)
    ? "Your input"
    : permitComputable
      ? `${usd(sc.pittsburghBuildingPermitFee.value)} per $1,000 of construction value (verify with PLI schedule)`
      : `${pctText(permits)} of hard cost`;
  const other = has(o.softOtherShare) ? o.softOtherShare : sc.surveyTitleLegalInsurance.value;
  row("ae", sc.architectureEngineering.label, pctText(ae), sc.architectureEngineering, rangeText(sc.architectureEngineering.range, "share"), has(o.aeShare));
  if (permitComputable) row("permits", sc.pittsburghBuildingPermitFee.label, `${usd(sc.pittsburghBuildingPermitFee.value)} per $1,000 (${pctText(permits)})`, sc.pittsburghBuildingPermitFee, null, false);
  else row("permits", sc.permitsAndFees.label, pctText(permits), sc.permitsAndFees, rangeText(sc.permitsAndFees.range, "share"), has(o.permitShare));
  row("other", sc.surveyTitleLegalInsurance.label, pctText(other), sc.surveyTitleLegalInsurance, rangeText(sc.surveyTitleLegalInsurance.range, "share"), has(o.softOtherShare));
  row("gcFee", sc.gcFee.label, `not applied (${pctText(sc.gcFee.value)} when used)`, sc.gcFee, rangeText(sc.gcFee.range, "share"), false);
  if (ae > cfg.outliers.aeShareMax.value) outliers.push(`Architecture and engineering at ${pctText(ae)} of hard cost is above ${pctText(cfg.outliers.aeShareMax.value)}: unusually high — verify.`);

  // ---- Contingency
  const hazard = slopeKind != null || landslide || mineApplies;
  const contingencyKind: "flat" | "hillside" | "rehab" = rehab ? "rehab" : hazard ? "hillside" : "flat";
  const cdef = cfg.contingency[contingencyKind];
  const contingency = has(o.contingencyShare) ? o.contingencyShare : cdef.value;
  row("contingency", cdef.label, pctText(contingency), cdef, null, has(o.contingencyShare));

  // ---- Schedule, holding and financing
  const fin = cfg.financing;
  const approvalMonths = has(o.approvalMonths) ? Math.round(o.approvalMonths) : has(a.permitMonths) ? Math.round(a.permitMonths) : (fin.approvalMonthsFallback.value as number | null);
  if (approvalMonths == null) exclude("approval_holding", "Holding costs during approval", "Approval time is not estimated for this lot", "approval time not estimated");
  row("approvalMonths", "Months to approval", approvalMonths != null ? `${approvalMonths}` : "not estimated", { sourceLabel: has(o.approvalMonths) ? "Your input" : "Ease Score months to a permit" }, null, has(o.approvalMonths));
  const cm = rehab ? fin.constructionMonths.rehab : units != null && units > 1 ? fin.constructionMonths.multi : fin.constructionMonths.single;
  const constructionMonths = has(o.constructionMonths) ? Math.round(o.constructionMonths) : cm.value;
  row("constructionMonths", fin.constructionMonths.label, `${constructionMonths}`, cm, null, has(o.constructionMonths));

  const mills = f.property_tax?.general_mills;
  const assessed = f.assessment?.fmv_total;
  const monthlyTax = has(mills) && has(assessed) ? (assessed * mills) / 1000 / 12 : null;
  if (monthlyTax == null) exclude("holding_taxes", "Property taxes while holding", "Taxes are owed while approving and building", "tax rate or assessment not loaded");
  else row("holdingTax", "Property taxes while holding, monthly", usd(monthlyTax), { sourceLabel: "County assessment × total millage (County Treasurer)" }, null, false);

  const rate = has(o.constructionRate) ? o.constructionRate : has(a.primeRate) ? a.primeRate + fin.rateSpreadOverPrime.value : null;
  if (rate == null) exclude("construction_interest", "Construction loan interest", "A construction loan pays interest while building", "prime rate not loaded");
  else
    row(
      "constructionRate",
      "Construction loan rate",
      pctText(rate),
      has(o.constructionRate)
        ? { sourceLabel: "Your input" }
        : { sourceLabel: "Bank prime rate (FRED DPRIME) + assumption", sourceNote: `Prime ${pctText(a.primeRate!)}${a.primeRateDate ? ` on ${a.primeRateDate}` : ""} + ${pctText(fin.rateSpreadOverPrime.value)} (${fin.rateSpreadOverPrime.sourceLabel})` },
      null,
      has(o.constructionRate),
    );
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
  const grossSales = perUnitPrice != null ? perUnitPrice * units! : pricePerSf != null && finishedSf != null ? pricePerSf * finishedSf : null;
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
  const tt = f.transfer_tax?.total_pct;
  const sellerTt = has(tt) ? (tt / 100) * saleCfg.sellerTransferTaxShare.value : null;
  if (sellerTt == null && tenure === "sale") exclude("transfer_tax", "Seller's realty transfer tax", "Pennsylvania and local transfer tax is due at sale", "rate not loaded");
  const sellingShare = saleCfg.brokerShare.value + (sellerTt ?? 0);
  row("broker", saleCfg.brokerShare.label, pctText(saleCfg.brokerShare.value), saleCfg.brokerShare, null, false);
  if (sellerTt != null) row("transferTax", "Seller's share of the realty transfer tax", `${pctText(sellerTt)} (half of ${+tt!.toFixed(2)}%)`, { sourceLabel: "Transfer tax rates (PA Dept. of Revenue, local)", sourceNote: saleCfg.sellerTransferTaxShare.sourceNote }, null, false);
  row("salesMonths", saleCfg.salesMonths.label, String(saleCfg.salesMonths.value), saleCfg.salesMonths, null, false);

  const saleMix: UnitRow[] | undefined =
    units != null ? [{ label: "Finished home", count: units, salePrice: grossSales != null ? grossSales / units : null }] : undefined;
  const forSale: ForSaleInputs = { ...dev, unitMix: saleMix, sellingCostShare: sellingShare, salesMonths: saleCfg.salesMonths.value };

  // ---- Revenue: rent
  const r = a.rents;
  const br = has(o.bedrooms) ? Math.min(4, Math.max(0, Math.round(o.bedrooms))) : units != null && units > 1 ? cfg.rent.fmrBedroomsFallback.multi : cfg.rent.fmrBedroomsFallback.single;
  const fmr = r?.hud_fmr ? (r.hud_fmr as Record<string, number | undefined>)[`br${br}`] : undefined;
  const zori = r?.zori?.latest_rent;
  const rentPerUnit = has(o.rentPerUnit) ? o.rentPerUnit : has(zori) ? Math.round(zori) : has(fmr) ? fmr : null;
  const rentBasis = has(o.rentPerUnit)
    ? "Your rent"
    : has(zori)
      ? `Zillow Observed Rent Index, ZIP ${r!.zori!.zip ?? ""}, ${r!.zori!.latest_month ?? ""}`.trim()
      : has(fmr)
        ? `HUD Fair Market Rent ${r!.hud_fmr!.year ?? ""}, ${br} bedrooms`
        : "No rent index for this ZIP code";
  const rentSource = has(o.rentPerUnit) ? "Your input" : has(zori) ? "Zillow Observed Rent Index (ZORI)" : has(fmr) ? "HUD Fair Market Rents" : "Not available";
  if (rentPerUnit == null && tenure === "rent") missing.push("No rent: there is no rent index or Fair Market Rent for this ZIP code. Enter a monthly rent to test it.");
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
  const assessedAfter = has(f.assessment?.fmv_land) && hardTotal != null ? f.assessment!.fmv_land! + hardTotal : null;
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
    land: { value: land, sourceLabel: landSource },
    lines,
    shares: { ae, permits, other, permitsBasis, contingency, contingencyKind },
    loanFeeShare: fin.loanFeeShare.value,
    adders,
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
    assumptions: rows,
    outliers,
    missing,
    evidence,
    notes,
  };
}
