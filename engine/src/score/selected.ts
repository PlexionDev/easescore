// SelectedScheme: the one building program for the selected strategy. It is produced once, from
// the QuickFit scheme behind the score's fit plus the user's program edits, and the score (F1 fit),
// the pro forma, the summary, the report and the 3D massing all read it, so they always describe the
// same building.

import { DEFAULT_ASSUMPTIONS as QF_DEFAULTS } from "../quickfit/presets";
import type { Binding, ParkingOption, Ring, Scheme } from "../quickfit/types";
import { STRATEGY_LABEL, existingUseColumn } from "./strategies";
import type { StrategyFit, StrategyId, StrategyResult } from "./types";

export type ParkingProgram = "tuck_under" | "pad" | "none";

/** User program edits that change the building (pro forma "Your program"). */
export interface ProgramOverrides {
  /** Number of homes (default: the site-fit count). */
  units?: number;
  /** Living floors above the garage (or total floors when there is no tuck-under garage). */
  storiesAboveGarage?: number;
  parking?: ParkingProgram;
  bedrooms?: number;
  baths?: number;
}

export interface UnitProgram {
  units: number;
  storiesAboveGarage: number;
  parking: ParkingProgram;
  bedrooms: number | null;
  baths: number | null;
  footprintPerUnitSf: number;
  finishedPerUnitSf: number;
  garagePerUnitSf: number;
  grossSf: number;
}

export interface SelectedScheme {
  strategy: StrategyId;
  strategyLabel: string;
  /** Where the size comes from: the site-fit layout, the existing building, or nothing sized. */
  source: "site_fit" | "existing_building" | "none";
  /** QuickFit scheme id; the score's fit (StrategyResult.schemeId) names the same id. */
  schemeId: string | null;
  typologyLabel: string | null;
  /** Homes after the user's edits. */
  units: number | null;
  /** Homes the site-fit layout placed (before edits). */
  siteFitUnits: number | null;
  buildings: number | null;
  /** One rectangle per unit (local feet), for the 3D massing and the site plan. */
  footprints: Ring[];
  footprintSf: number | null;
  grossFloorAreaSf: number | null;
  /** Finished (livable, sellable) floor area. */
  finishedSf: number | null;
  /** Tuck-under garage level area (gross, never finished). */
  garageSf: number;
  stories: number | null;
  heightFt: number | null;
  parking: { option: ParkingOption | ParkingProgram; spaces: number | null; required: number | null } | null;
  /** What limits the layout, e.g. "Front setback is the limit". */
  bindingConstraint: Binding | null;
  /** Zoning path of the site-fit scheme. */
  path: StrategyFit["status"] | null;
  /** Dimensional rules that need a variance for this scheme. */
  variancesNeeded: string[];
  permissionCode: string | null;
  /** The user's unit program, when they set one. */
  program: UnitProgram | null;
  /** Plain sentence: where the size comes from. */
  sizeBasis: string;
  /** Plain reason the building cannot be sized (then units / finishedSf are null). */
  missing: string | null;
  notes: string[];
  /** True when the user's edits changed the site-fit layout. */
  overridden: boolean;
}

const has = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

function unitsForExisting(use: string | null | undefined): number {
  const col = existingUseColumn(use);
  return col === "two_unit" ? 2 : col === "three_unit" ? 3 : col === "multi_unit" ? 4 : 1;
}

/** The size fields a caller may pass instead of a full QuickFit scheme (older callers, tests). */
export interface SchemeLike {
  units: number;
  grossFloorAreaSf: number;
  netFloorAreaSf: number;
  footprintSf?: number;
  stories?: number;
  typologyLabel?: string;
}

export interface SelectSchemeArgs {
  strategy: StrategyId;
  /** QuickFit scheme behind the fit (EaseScoreResult.schemes[strategy]); a size-only scheme also works. */
  scheme: Scheme | SchemeLike | null;
  /** The strategy's score result, for the zoning path; optional. */
  result?: Pick<StrategyResult, "factors" | "schemeId"> | null;
  /** Existing building facts (rehab). */
  existing?: { livingAreaSqft?: number | null; use?: string | null } | null;
  overrides?: ProgramOverrides;
}

/** Build the SelectedScheme once for the selected strategy (+ the user's program edits). */
export function selectScheme(a: SelectSchemeArgs): SelectedScheme {
  const o = a.overrides ?? {};
  const f1 = a.result?.factors?.find((f) => f.id === "F1")?.inputs as { fitStatus?: StrategyFit["status"] | null; varianceRules?: string[]; permissionCode?: string | null } | undefined;
  const base: SelectedScheme = {
    strategy: a.strategy, strategyLabel: STRATEGY_LABEL[a.strategy], source: "none", schemeId: null, typologyLabel: null,
    units: null, siteFitUnits: null, buildings: null, footprints: [], footprintSf: null, grossFloorAreaSf: null, finishedSf: null,
    garageSf: 0, stories: null, heightFt: null, parking: null, bindingConstraint: null,
    path: f1?.fitStatus ?? null, variancesNeeded: Array.isArray(f1?.varianceRules) ? f1!.varianceRules! : [], permissionCode: f1?.permissionCode ?? null,
    program: null, sizeBasis: "", missing: null, notes: [], overridden: false,
  };

  if (a.strategy === "rehab_existing") {
    const la = a.existing?.livingAreaSqft;
    const finishedSf = has(la) && la > 0 ? la : null;
    return {
      ...base, source: "existing_building", path: "existing", units: unitsForExisting(a.existing?.use), finishedSf,
      grossFloorAreaSf: finishedSf,
      sizeBasis: finishedSf ? `Existing living area from the county assessment (${finishedSf.toLocaleString("en-US")} sq ft)` : "Existing living area not recorded",
      missing: finishedSf ? null : "The county assessment has no living area for the existing building, so the rehab cannot be sized.",
    };
  }
  if (a.strategy === "adu")
    return { ...base, sizeBasis: "Accessory dwelling unit size is not modeled yet", missing: "An accessory dwelling unit is not sized by the site-fit check yet, so its cost cannot be estimated." };

  const sch = a.scheme as (Partial<Scheme> & SchemeLike) | null;
  if (!sch || sch.units <= 0)
    return { ...base, sizeBasis: "No layout of this type fits the lot", missing: "No building of this type fits the lot in the site-fit check, so there is nothing to price." };

  const fromScheme: SelectedScheme = {
    ...base, source: "site_fit", schemeId: sch.id ?? null, typologyLabel: sch.typologyLabel ?? null, siteFitUnits: sch.units, buildings: sch.buildings ?? null,
    footprints: sch.footprints ?? [], footprintSf: sch.footprintSf ?? null, grossFloorAreaSf: sch.grossFloorAreaSf, stories: sch.stories ?? null, heightFt: sch.heightFt ?? null,
    parking: sch.parking ? { option: sch.parking, spaces: sch.parkingSpaces ?? null, required: sch.parkingRequired ?? null } : null, bindingConstraint: sch.binding ?? null,
    variancesNeeded: base.variancesNeeded.length ? base.variancesNeeded : [...new Set((sch.approvals ?? []).filter((x) => x.kind === "variance").map((x) => x.rule))].sort(),
    permissionCode: base.permissionCode ?? sch.permission?.code ?? null, garageSf: 0,
  };
  if (a.result?.schemeId && a.result.schemeId !== sch.id)
    fromScheme.notes.push("The score's fit and this layout are different schemes; the layout shown here is the one priced.");

  const nUnits = has(o.units) && o.units >= 1 ? Math.round(o.units) : sch.units;
  const custom = has(o.storiesAboveGarage) || o.parking !== undefined || has(o.units) || has(o.bedrooms) || has(o.baths);
  if (custom && has(sch.footprintSf) && sch.footprintSf > 0) {
    // Your program on the site-fit footprint: floors above a tuck-under garage level. The garage level
    // counts as gross area, never as finished (sellable) area.
    const footprintPerUnit = sch.footprintSf / sch.units;
    const parking: ParkingProgram = o.parking ?? "none";
    const tuck = parking === "tuck_under";
    const schemeStories = has(sch.stories) ? sch.stories : 1;
    const above = has(o.storiesAboveGarage) && o.storiesAboveGarage >= 1 ? Math.round(o.storiesAboveGarage) : tuck ? Math.max(1, schemeStories - 1) : schemeStories;
    const eff = QF_DEFAULTS.efficiency;
    const finishedPerUnit = Math.round(footprintPerUnit * above * eff);
    const garageSf = tuck ? Math.round(footprintPerUnit) * nUnits : 0;
    const grossSf = Math.round(footprintPerUnit * (above + (tuck ? 1 : 0))) * nUnits;
    const program: UnitProgram = { units: nUnits, storiesAboveGarage: above, parking, bedrooms: has(o.bedrooms) ? o.bedrooms : null, baths: has(o.baths) ? o.baths : null, footprintPerUnitSf: Math.round(footprintPerUnit), finishedPerUnitSf: finishedPerUnit, garagePerUnitSf: tuck ? Math.round(footprintPerUnit) : 0, grossSf };
    const bb = program.bedrooms != null || program.baths != null ? `, ${program.bedrooms ?? "?"} bed / ${program.baths ?? "?"} bath` : "";
    const notes = [...fromScheme.notes];
    if (nUnits > sch.units) notes.push(`${nUnits} homes is more than the ${sch.units} the site-fit check placed; the extra homes are not checked against zoning.`);
    return {
      ...fromScheme, units: nUnits, finishedSf: finishedPerUnit * nUnits, garageSf, grossFloorAreaSf: grossSf, stories: above + (tuck ? 1 : 0),
      heightFt: has(sch.heightFt) && has(sch.stories) && sch.stories > 0 ? Math.round((sch.heightFt / sch.stories) * (above + (tuck ? 1 : 0))) : fromScheme.heightFt,
      parking: { option: parking, spaces: null, required: fromScheme.parking?.required ?? null }, program, notes, overridden: true,
      sizeBasis: `Your program: ${nUnits} home${nUnits === 1 ? "" : "s"} on the site-fit footprint (${program.footprintPerUnitSf.toLocaleString("en-US")} sq ft each), ${tuck ? `a tuck-under garage level + ${above} living floor${above === 1 ? "" : "s"}` : `${above} living floor${above === 1 ? "" : "s"}`}${bb}: ${finishedPerUnit.toLocaleString("en-US")} sq ft finished per home (floor area × ${Math.round(eff * 100)}% livable share)${tuck ? `; the ${program.garagePerUnitSf.toLocaleString("en-US")} sq ft garage level is not counted as finished` : ""}`,
    };
  }
  const finishedSf = Math.round((sch.netFloorAreaSf / sch.units) * nUnits);
  const notes = [...fromScheme.notes];
  if (nUnits !== sch.units) notes.push(`Home count set to ${nUnits} (the site-fit layout has ${sch.units}); each home keeps the layout's size.`);
  return {
    ...fromScheme, units: nUnits, finishedSf, grossFloorAreaSf: Math.round((sch.grossFloorAreaSf / sch.units) * nUnits), garageSf: 0, notes,
    overridden: nUnits !== sch.units,
    sizeBasis: `Site-fit layout${sch.typologyLabel ? ` (${sch.typologyLabel})` : ""}: ${Math.round((sch.grossFloorAreaSf / sch.units) * nUnits).toLocaleString("en-US")} sq ft gross, ${finishedSf.toLocaleString("en-US")} sq ft finished (livable)${nUnits > 1 ? `, ${Math.round(finishedSf / nUnits).toLocaleString("en-US")} sq ft per home` : ""}`,
  };
}
