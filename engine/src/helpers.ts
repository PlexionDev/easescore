import type { Overlay, ParcelFacts, ProjectAnswers, Trigger } from "./types";

export const pct = (share: number) => `${Math.round(share * 100)}%`;

export function overlays(f: ParcelFacts, layer: string): Overlay[] {
  return f.overlays.filter((o) => o.layer === layer && o.share > 0);
}

/** Zoning-overlay features whose label mentions a term (the city layer packs several overlays per label). */
export function overlayLabelled(f: ParcelFacts, term: RegExp): Overlay[] {
  return f.overlays.filter(
    (o) => o.share > 0 && ["zoning_overlay_pgh", "inclusionary_pgh"].includes(o.layer) && term.test(o.label ?? ""),
  );
}

export const isPittsburgh = (f: ParcelFacts) => f.assessment?.is_pittsburgh === true;

export const municipality = (f: ParcelFacts) => f.assessment?.municipality ?? "the municipality";

export const isConstruction = (p: ProjectAnswers) =>
  p.type === "new_build" || p.type === "addition" || p.type === "rehab" || p.type === "conversion";

export const buildsNew = (p: ProjectAnswers) => p.type === "new_build" || p.type === "addition";

export const hasStructure = (f: ParcelFacts) =>
  (f.assessment?.fmv_building ?? 0) > 0 || !!f.assessment?.year_built;

/** Zoning use column for the project's unit count. */
export function useColumn(units: number): "single_unit_detached" | "two_unit" | "three_unit" | "multi_unit" {
  return units <= 1 ? "single_unit_detached" : units === 2 ? "two_unit" : units === 3 ? "three_unit" : "multi_unit";
}

export const USE_LABEL = {
  single_unit_detached: "a single-unit detached house",
  two_unit: "a two-unit building",
  three_unit: "a three-unit building",
  multi_unit: "a multi-unit building",
} as const;

/** Permission code for this project in this district, or null when we can't tell. */
export function usePermission(f: ParcelFacts, p: ProjectAnswers) {
  const rules = f.zoning?.rules;
  if (!rules || p.units === undefined) return null;
  const col = useColumn(p.units);
  const code = rules[col];
  return code ? { code, col, rules } : null;
}

/** Plain-language note that a transcribed rule isn't fully confirmed. */
export const confidenceNote = (c: string | null | undefined) =>
  c && c !== "confirmed" ? ` (rule transcription is ${c}; check the code text)` : "";

export const ask =(question: string): Trigger => ({ status: "ASK", reason: question, source: "Project answers" });

export const notNeeded = (reason: string, source?: string): Trigger => ({ status: "NOT_NEEDED", reason, source });

export const SRC = {
  assessment: "Allegheny County Property Assessments",
  zoning: "City of Pittsburgh Zoning Districts",
  flood: "FEMA National Flood Hazard Layer",
  landslide: "City of Pittsburgh Landslide Prone Areas",
  undermined: "City of Pittsburgh Undermined Areas",
  historic: "City of Pittsburgh Historic Districts",
  overlays: "City of Pittsburgh Zoning Overlays",
  slope: "USGS 3DEP elevation (10 m)",
  project: "Project answers",
} as const;
