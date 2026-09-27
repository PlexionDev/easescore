// Confidence grades for a feasibility study: a fixed rule per topic, never an opinion.
// Pure: the caller passes what the study had; the same inputs always give the same grades.

import type { DevelopmentPlan } from "./build";
import type { CompGrid } from "./comps-grid";

export type Grade = "High" | "Moderate" | "Low" | "Placeholder" | "Your input" | "Preliminary";

export interface GradeRow {
  topic: string;
  grade: Grade;
  /** Why this grade, for this parcel. */
  why: string;
  /** The rule, printed in the report. */
  rule: string;
}

export interface ConfidenceInputs {
  plan: DevelopmentPlan;
  grid: CompGrid | null;
  isCity: boolean;
  zoningCode: string | null;
  /** The zoning rules the site-fit used were loaded (transcribed from the code, with citations). */
  zoningRules: boolean;
  /** County parcel outline available. */
  hasOutline: boolean;
  /** 1 m lidar slope under the lot. */
  hasLidar: boolean;
  /** A site-fit building was placed. */
  hasScheme: boolean;
  /** Months to a permit came from City permit records (false: a heuristic or fallback). */
  permitFromRecords?: boolean | null;
}

export const GRADE_RULES: Record<string, string> = {
  Zoning: "High: City of Pittsburgh parcel whose zoning rules are transcribed from the Zoning Code and cited. Moderate: City parcel with a zoning code but no transcribed rules for it. Low: outside the City (the municipality's ordinance is not transcribed).",
  "Site geometry": "High: County parcel outline, 1 m lidar terrain and a site-fit building. Moderate: outline, but no lidar or no building placed. Low: no parcel outline.",
  Geotechnical: "Low: landslide-prone overlay, undermined or mined-out ground, or a steep site (25% or more), with no geotechnical report on file. Moderate: none of these; screened from maps and lidar only, no borings. Never High without a report.",
  "Construction cost": "Moderate: cost model v0.2 (published local ranges, builder fee removed), backtested on 515 new County homes. Low: a cost item that applies is not included, or a hillside, landslide or mine site where site work is priced as allowances. Your input: you entered the construction cost.",
  "Sale revenue": "Moderate: 5 or more valid new-construction sales. Low: fewer than 5 (never filled in with older homes). Your input: you entered the sale price.",
  Financing: "Placeholder: default loan terms (rate, loan-to-cost) and no lender quote. Your input: you entered the rate or loan-to-cost.",
  Schedule: "Moderate: months to a permit from City permit records. Low: estimated from typical approval steps or a fallback assumption (outside the City, or no permit records). Your input: you entered the months.",
  Overall: "Always Preliminary: a screening study from public data, not an appraisal, survey, geotechnical report or bid.",
};

export function confidenceGrades(i: ConfidenceInputs): GradeRow[] {
  const p = i.plan;
  const edited = (key: string) => p.assumptions.some((r) => r.key === key && r.edited);
  const rows: GradeRow[] = [];
  const add = (topic: string, grade: Grade, why: string) => rows.push({ topic, grade, why, rule: GRADE_RULES[topic]! });

  // Zoning
  if (!i.isCity) add("Zoning", "Low", "Outside the City of Pittsburgh: the municipal zoning ordinance is not transcribed; confirm with the municipality.");
  else if (i.zoningCode && i.zoningRules) add("Zoning", "High", `${i.zoningCode} rules transcribed from the Pittsburgh Zoning Code, with citations.`);
  else add("Zoning", "Moderate", i.zoningCode ? `${i.zoningCode} has no transcribed rules in our data.` : "No zoning district found for this parcel.");

  // Site geometry
  if (!i.hasOutline) add("Site geometry", "Low", "No County parcel outline.");
  else if (i.hasLidar && i.hasScheme) add("Site geometry", "High", "County parcel outline, 1 m lidar terrain and a placed site-fit building.");
  else add("Site geometry", "Moderate", !i.hasLidar ? "Parcel outline, but no lidar terrain." : "Parcel outline and lidar, but no building could be placed.");

  // Geotechnical: the plan prices a geotechnical report exactly when a trigger fires.
  const geo = p.lines.find((l) => l.id === "geotech");
  if (geo) add("Geotechnical", "Low", `${geo.basis.replace(/\.$/, "")}; no geotechnical report on file.`);
  else add("Geotechnical", "Moderate", "No landslide, mine or steep-slope trigger; screened from maps and lidar only (no borings).");

  // Construction cost
  const hazard = p.shares.contingencyKind === "hillside" || p.lines.some((l) => l.id === "mine_grouting" || l.id === "retaining_walls");
  if (edited("costPerSf") || edited("costPerUnit")) add("Construction cost", "Your input", "You entered the construction cost.");
  else if (p.exclusions.length) add("Construction cost", "Low", `${p.exclusions.length} cost item${p.exclusions.length === 1 ? "" : "s"} not included: ${p.exclusions.map((e) => e.label).join("; ")}.`);
  else if (hazard) add("Construction cost", "Low", "Hillside, landslide or mine site: site work is priced as allowances until a bid.");
  else add("Construction cost", "Moderate", "Cost model v0.2 defaults; confirm with local bids.");

  // Sale revenue
  if (edited("salePricePerSf") || edited("salePricePerUnit")) add("Sale revenue", "Your input", "You entered the sale price.");
  else if (i.grid) add("Sale revenue", i.grid.confidence, `${i.grid.confidenceWhy}.`);
  else add("Sale revenue", "Low", "New-construction sales could not be loaded.");

  // Financing
  if (edited("constructionRate") || edited("ltc")) add("Financing", "Your input", "You entered the loan terms.");
  else add("Financing", "Placeholder", "Default construction loan terms; no lender quote.");

  // Schedule
  const appr = p.assumptions.find((r) => r.key === "approvalMonths");
  if (appr?.edited) add("Schedule", "Your input", "You entered the months to approval.");
  else if (i.isCity && i.permitFromRecords !== false && appr && /Ease Score/.test(appr.sourceLabel) && appr.value !== "not estimated") add("Schedule", "Moderate", `${appr.value} months to a permit, from City permit records.`);
  else add("Schedule", "Low", i.isCity ? "Months to a permit are estimated from typical approval steps, not permit records." : "Outside the City: no permit-time data; a fallback assumption is used.");

  add("Overall", "Preliminary", "Screening study from public data.");
  return rows;
}
