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

export const ask = (question: string): Trigger => ({ status: "ASK", reason: question, source: "Project answers" });

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
