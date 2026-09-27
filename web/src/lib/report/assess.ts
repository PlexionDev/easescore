// Plain-language findings shared by several report sections: red flags, review items, approvals,
// data gaps, and the next steps. Pure functions of the report model.

import { narrative, PHASE_ORDER, type RequirementResult } from "@easescore/engine";
import type { ReportModel } from "./load";

export interface Finding {
  title: string;
  reason: string;
  mitigation: string;
  /** Source keys (see sources.ts) the finding relies on. */
  sources: string[];
}

// Formatting --------------------------------------------------------------------------------------

export const money = (v: number | null | undefined, digits = 0) =>
  typeof v === "number" && Number.isFinite(v)
    ? `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`
    : "—";
export const num = (v: number | null | undefined, digits = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
export const pct = (share: number | null | undefined, digits = 0) =>
  typeof share === "number" && Number.isFinite(share) ? `${(share * 100).toFixed(digits)}%` : "—";
export const sqft = (v: number | null | undefined) => (typeof v === "number" ? `${num(v)} sq ft` : "—");
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
export const titleCase = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\b([a-z])/g, (x) => x.toUpperCase()).replace(/\b(Of|And|The)\b/g, (x) => x.toLowerCase());

// Findings ----------------------------------------------------------------------------------------

const overlay = (m: ReportModel, layer: string) => m.facts.overlays?.find((o) => o.layer === layer && o.share > 0);

/**
 * Red flags are only three things: the FEMA floodway, no legal access, and an active contamination
 * site on the parcel. Everything else is a review item (never hidden, never a blocker by itself).
 */
export function redFlags(m: ReportModel): Finding[] {
  const f = m.facts;
  const out: Finding[] = [];
  const fw = f.flood_evidence?.floodway_share ?? 0;
  if (fw > 0)
    out.push({
      title: "In the FEMA floodway",
      reason: `${pct(fw)} of the lot is in the regulatory floodway, where new buildings and fill are heavily restricted.`,
      mitigation: "Ask the City floodplain administrator whether any part of the lot is outside the floodway, and whether a map revision is realistic. Otherwise treat the floodway area as unbuildable.",
      sources: ["fema"],
    });
  if (f.street_frontage === "none")
    out.push({
      title: "No legal access found",
      reason: "No street centerline lies within 20 m of the lot. It may be landlocked or reached only by steps.",
      mitigation: "Order a title search and boundary survey to confirm a recorded right of access before spending on design.",
      sources: ["streets"],
    });
  const onParcel = m.ease?.env_sites?.on_parcel ?? 0;
  if (onParcel > 0)
    out.push({
      title: "Contamination site on the parcel",
      reason: `${onParcel} environmental cleanup record${onParcel > 1 ? "s" : ""} sit on the lot.`,
      mitigation: "Get a Phase I Environmental Site Assessment and check the record's status with PA DEP before buying.",
      sources: ["env"],
    });
  return out;
}

/** Amber "Review required" items: real costs or process steps, shown plainly, not blockers. */
export function reviewItems(m: ReportModel, alreadyShown: string[] = []): Finding[] {
  const f = m.facts;
  const out: Finding[] = [];
  const shown = alreadyShown.join(" ").toLowerCase();
  const slide = overlay(m, "landslide_prone_pgh");
  if (slide)
    out.push({
      title: "Landslide-prone area",
      reason: `${pct(slide.share)} of the lot is in the City's landslide-prone overlay. New construction needs a full geotechnical report (Pittsburgh Code §906.04).`,
      mitigation: "Budget for a geotechnical engineer early; their report sets foundation and retaining-wall design.",
      sources: ["landslide_prone"],
    });
  const under = overlay(m, "undermined_pgh");
  if (under || f.mines?.in_city_undermined)
    out.push({
      title: "Undermined area",
      reason: "The lot is mapped over old coal workings (City overlay, §906.05). A coal status report is required, and a geotechnical report for anything other than one house.",
      mitigation: "Get the coal status report and quotes for mine subsidence insurance; ask the engineer whether grouting is needed.",
      sources: ["undermined"],
    });
  else if (f.mines?.in_mined_out)
    out.push({
      title: "Over a mapped mine (PA DEP)",
      reason: "Not a City permit requirement here, but subsidence risk is real.",
      mitigation: "Get mine subsidence insurance quotes and consider a geotechnical check.",
      sources: ["mines"],
    });
  const over25 = f.slope_1m?.share_over_25 ?? 0;
  if (over25 >= 0.25)
    out.push({
      title: "Steep lot",
      reason: `${pct(over25)} of the lot is steeper than 25%. Expect retaining walls, stepped foundations and harder construction access.`,
      mitigation: "Order a topographic survey and ask a civil engineer where a building and driveway can sit.",
      sources: ["slope_1m"],
    });
  const sfha = f.flood_evidence?.sfha_share ?? f.flood_1pct_share ?? 0;
  if (sfha > 0 && (f.flood_evidence?.floodway_share ?? 0) === 0)
    out.push({
      title: "In the 100-year flood zone",
      reason: `${pct(sfha)} of the lot is in the FEMA 1%-annual-chance flood zone. Lenders require flood insurance and the building must be elevated.`,
      mitigation: "Get an elevation certificate and a flood insurance quote.",
      sources: ["fema"],
    });
  if (f.street_frontage === "paper")
    out.push({
      title: "Only an unopened (paper) street",
      reason: "The street next to the lot exists on paper but is not built. Construction access may need a right-of-way process.",
      mitigation: "Ask the City's Department of Mobility and Infrastructure (DOMI) what opening or access would require.",
      sources: ["streets"],
    });
  if (f.street_frontage === "steps")
    out.push({
      title: "Reached by City steps",
      reason: "The nearest public way is a set of City steps, not a drivable street.",
      mitigation: "Confirm construction and emergency access with the City before design.",
      sources: ["streets"],
    });
  const adj = (m.ease?.env_sites?.adjacent_50ft ?? 0) - (m.ease?.env_sites?.on_parcel ?? 0);
  if (adj > 0)
    out.push({
      title: "Cleanup site next door",
      reason: `${adj} environmental cleanup record${adj > 1 ? "s" : ""} within 50 ft of the lot.`,
      mitigation: "A Phase I Environmental Site Assessment will say whether it affects this lot.",
      sources: ["env"],
    });
  const hist = overlay(m, "historic_district_pgh");
  if (hist)
    out.push({
      title: "Historic district",
      reason: `In the ${hist.label ?? "City"} historic district: exterior work needs a Certificate of Appropriateness.`,
      mitigation: "Meet Historic Review Commission staff before design and plan for review cycles.",
      sources: ["overlays"],
    });
  if (f.condemned)
    out.push({
      title: "Condemned structure",
      reason: "An active City condemnation record exists for the property.",
      mitigation: "Check the violation record and demolition orders with the City.",
      sources: ["permits"],
    });
  const slides = f.landslides_within_300ft ?? 0;
  if (slides > 0)
    out.push({
      title: "Mapped slope-movement areas nearby",
      reason: `${slides} slope-movement area${slides > 1 ? "s" : ""} from the 1982 inventory within 300 ft of the lot (a historic map, not a record of recent landslides).`,
      mitigation: "Share the slope-movement map with the geotechnical engineer.",
      sources: ["landslide_inventory"],
    });
  // Skip items the Ease Score engine already lists (same topic, its wording).
  const topic = (t: string) => (/landslide-prone/i.test(t) ? "landslide" : /undermined|mine/i.test(t) ? "undermin" : /paper|steps|access/i.test(t) ? "access" : null);
  return out.filter((x) => {
    const k = topic(x.title);
    return !k || !shown.includes(k);
  });
}

/** Zoning approvals the studied scheme needs (or why no scheme fits). */
export function approvalItems(m: ReportModel): Finding[] {
  const s = m.scheme;
  if (!s) {
    const c = m.closest;
    const why = c
      ? `The closest scheme tried (${c.typologyLabel.toLowerCase()}) needs ${[...(c.permission.code === "N" ? [`a use not permitted here (${c.permission.use})`] : []), ...c.approvals.map((a) => a.label.toLowerCase())].join("; ") || c.binding.label.toLowerCase()}.`
      : m.qfError ?? "No building type fit inside the setbacks and rules for this district.";
    return [{ title: c ? "No new building allowed by right" : "No scheme found by the site-fit solver", reason: why, mitigation: "Ask a zoning professional what could fit; relief may be possible.", sources: ["quickfit"] }];
  }
  return s.approvals.map((a) => ({
    title: a.label,
    reason:
      a.odds?.status === "rate"
        ? `Past decisions for this kind of request: ${a.odds.granted} granted, ${a.odds.denied} denied (${a.odds.n} decided).`
        : a.odds
          ? `Fewer than 5 past decisions match this request (${a.odds.n}), so no approval rate is shown.`
          : "An approval step for this scheme.",
    mitigation: "Meet zoning staff before applying; talk to the Registered Community Organization early.",
    sources: a.odds ? ["zba"] : ["zoning_rules"],
  }));
}

export interface Gap {
  what: string;
  effect: string;
  mitigation: string;
}

/** Inputs that do not exist yet. Listed in Risks (§12) and Limitations (Appendix E). */
export function dataGaps(m: ReportModel): Gap[] {
  const g: Gap[] = [];
  const f = m.facts;
  g.push({ what: "Local bids", effect: "Construction costs are published builder ranges and editable estimates, not quotes for this lot.", mitigation: "Get a contractor's estimate and enter it in the pro forma." });
  for (const e of m.proForma.plan.exclusions)
    g.push({ what: `${e.label} cost`, effect: `${e.reason}, but no cost is set, so it is left out of the total development cost.`, mitigation: "Get a local quote and enter it in the pro forma." });
  if (m.score.status === "pending") g.push(m.score.partial
    ? { what: "Ease Score", effect: "No numeric score or band: this municipality's zoning is not loaded (a partial screen of the known facts only).", mitigation: `Confirm zoning with ${titleCase(f.assessment?.municipality) || "the municipality"}.` }
    : { what: "Ease Score", effect: "The score, its band and predicted months to permit are not shown.", mitigation: "Pending the scoring engine; every input it uses appears in this report." });
  g.push({ what: "City review times", effect: "The timeline shows the order of steps but not their length.", mitigation: "Ask the City's zoning and permit offices for current review times." });
  if (!f.zoning?.code) g.push({ what: "Zoning outside the City of Pittsburgh", effect: "Allowed uses and dimensional rules are unknown here.", mitigation: `Confirm zoning with ${titleCase(f.assessment?.municipality) || "the municipality"}.` });
  if (!m.sales || m.sales.status !== "ok" || m.sales.sufficient === false) g.push({ what: "Enough comparable sales", effect: "There is no market reference value.", mitigation: "Ask a local appraiser or agent for comps." });
  if (m.sales?.comparable_use === "vacant land") g.push({ what: "New-home sale comps for this lot", effect: "The lot is vacant, so comps are vacant-land sales. There is no market reference for the value of a finished home.", mitigation: "Ask a local agent or appraiser for recent new-construction sales nearby." });
  g.push({ what: "Listing-level rent comps", effect: "Rents rely on a ZIP-level index and HUD Fair Market Rents only.", mitigation: "Survey current listings nearby." });
  g.push({ what: "Absorption and lease-up data", effect: "Months to sell or lease up are editable assumptions (Section 6), supported only by counts of nearby sales, not a market study.", mitigation: "Ask local brokers how long similar homes took to sell or lease." });
  if (!m.tapFees.length) g.push({ what: "Water and sewer fees for this area", effect: "Tap and connection fees are unknown.", mitigation: "Call the local water and sewer authority." });
  if (f.assessment?.is_pittsburgh) g.push({ what: "Which water utility serves the lot", effect: "Fees assume Pittsburgh Water (PWSA); some City neighborhoods are served by Pennsylvania American Water.", mitigation: "Confirm the utility with a water and sewer availability letter." });
  if (m.qfInput?.notes?.some((n) => n && /steep-slope areas are not cut/i.test(n))) g.push({ what: "Steep areas in the buildable area", effect: "The site-fit solver does not yet remove slopes over 25% from the buildable area, so it may place a building on steep ground.", mitigation: "Check the scheme against a topographic survey." });
  if (m.frontInferred) g.push({ what: "Where the lot meets the street", effect: `No lot edge is within 45 ft of an opened street centerline (nearest: ${Math.round(m.frontInferred.distFt)} ft), so the front edge was inferred.`, mitigation: "Confirm frontage and legal access with a survey and title search." });
  g.push({ what: "Surveyed lot lines and frontage", effect: "Lot lines and frontage come from GIS, not a survey.", mitigation: "Order a boundary survey." });
  return g;
}

/**
 * The first steps to take: decisive checklist items only (routine transaction and permit items stay in
 * the full checklist), ranked by decision impact — can it kill the project, how much can it cost.
 */
export function nextSteps(m: ReportModel, n = 3): RequirementResult[] {
  return m.requirements
    .filter((r) => (r.status === "REQUIRED" || r.status === "LIKELY") && narrative.DECISION_IMPACT[r.id] !== undefined && !narrative.ROUTINE_REQUIREMENTS.has(r.id))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => narrative.DECISION_IMPACT[b.r.id]! - narrative.DECISION_IMPACT[a.r.id]! || PHASE_ORDER.indexOf(a.r.phase) - PHASE_ORDER.indexOf(b.r.phase) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.r);
}
