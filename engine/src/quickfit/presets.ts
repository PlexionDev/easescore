import type { Assumptions, ParkingOption, TypologyPreset } from "./types";

// EDITABLE PLACEHOLDERS. Every number in this file is a starting point for the sliders, not a
// researched standard, a code requirement or a market figure. Callers should pass their own
// presets/assumptions; the UI must show these as editable. No cost or price appears here.

/** Placeholder: single-family detached house, one unit. */
export const SINGLE_FAMILY: TypologyPreset = {
  id: "single_family",
  label: "Single-family detached",
  arrangement: "detached",
  unitsPerBuilding: 1,
  unitWidthFt: { min: 16, max: 32, step: 1 }, // placeholder
  unitDepthFt: { min: 24, max: 40, step: 1 }, // placeholder
  stories: { min: 2, max: 3 }, // placeholder
  floorToFloorFt: 10, // placeholder
  roofAllowanceFt: 0, // placeholder: set per roof form (how the code measures height)
  garage: true,
};

/** Placeholder: side-by-side duplex (two units, one building, one lot). */
export const DUPLEX: TypologyPreset = {
  id: "duplex",
  label: "Duplex (side by side)",
  arrangement: "side_by_side",
  unitsPerBuilding: 2,
  unitWidthFt: { min: 16, max: 24, step: 1 }, // placeholder, per unit
  unitDepthFt: { min: 28, max: 40, step: 1 }, // placeholder
  stories: { min: 2, max: 3 }, // placeholder
  floorToFloorFt: 10, // placeholder
  roofAllowanceFt: 0, // placeholder
  garage: true,
};

/** Placeholder: row of attached single-unit homes, each on its own new lot. */
export const TOWNHOUSE_ROW: TypologyPreset = {
  id: "townhouse_row",
  label: "Townhouse row",
  arrangement: "row",
  unitsPerBuilding: 1,
  unitWidthFt: { min: 16, max: 26, step: 1 }, // placeholder
  unitDepthFt: { min: 28, max: 40, step: 1 }, // placeholder
  stories: { min: 2, max: 3 }, // placeholder
  floorToFloorFt: 10, // placeholder
  roofAllowanceFt: 0, // placeholder
  garage: true,
  maxUnits: 8, // placeholder: small-infill scope
};

// Later typologies slot in as more presets, e.g. a stacked triplex is
// { arrangement: "stacked", unitsPerBuilding: 3, ... } and an ADU is a second detached building.
export const DEFAULT_TYPOLOGIES: TypologyPreset[] = [SINGLE_FAMILY, DUPLEX, TOWNHOUSE_ROW];

export const DEFAULT_PARKING_OPTIONS: ParkingOption[] = ["none", "surface", "garage"];

/** Placeholders for the solver's physical assumptions. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  efficiency: 0.85, // placeholder net/gross ratio
  gridStepFt: 1, // search resolution, not a design value
  garageWidthFt: 10, // placeholder one-car tuck-under bay
  garageDepthFt: 20, // placeholder
  surfaceStallAreaSf: 200, // placeholder: stall plus its share of drive
  spacesPerUnit: 1, // placeholder
};
