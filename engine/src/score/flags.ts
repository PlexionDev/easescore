// Red flags (shown above the score, never averaged in) and "Review required" callouts.
// Red flags are limited to three conditions: FEMA floodway, no legal access, and an active
// cleanup site on the parcel. Everything else that deserves attention is a callout.

import type { EaseScoreConfig, EaseScoreInput, RedFlag, ReviewCallout, StrategyFit, StrategyId } from "./types";
import { SRC, sitePlanReviewApplies } from "./factors";
import { CITE, SITE_PLAN_REVIEW } from "./code-refs";
import { pctText } from "./curves";

export function redFlags(inp: EaseScoreInput, cfg: EaseScoreConfig): RedFlag[] {
  const out: RedFlag[] = [];
  const fw = inp.hazards.floodwayShare;
  if (fw != null && fw >= cfg.redFlags.floodwayMinShare)
    out.push({
      id: "floodway",
      title: "In the FEMA floodway",
      reason: `${pctText(fw)} of the lot is in the regulatory floodway, where new buildings and fill are effectively prohibited.`,
      path: "Talk to the floodplain administrator first. Building would need a FEMA map revision (LOMR) or a design that keeps every structure and all fill outside the floodway.",
      source: SRC.flood,
    });
  if (inp.access.frontage === "none")
    out.push({
      id: "no_access",
      title: "No legal street access",
      reason: "No street centerline reaches the lot (county and City street files), so it may be landlocked.",
      path: "Confirm access on a survey and title search. Unblocking needs a recorded access easement or combining with a lot that fronts a street.",
      source: SRC.streets,
    });
  const c = inp.hazards.contamination;
  if (c && c.activeOnParcel > 0)
    out.push({
      id: "contamination_on_site",
      title: "Active cleanup site on the parcel",
      reason: `${c.activeOnParcel} active state or federal cleanup record(s) sit on this lot.`,
      path: "Get a Phase I and Phase II environmental assessment; housing needs a PA DEP Act 2 cleanup to residential standards (or an approved remedy) before permits.",
      source: SRC.env,
    });
  return out;
}

export function reviewCallouts(
  inp: EaseScoreInput, s: StrategyId, fit: StrategyFit | null, fitNotes: string[], cfg: EaseScoreConfig, lotOfRecord = false,
): ReviewCallout[] {
  const out: ReviewCallout[] = [];
  if (lotOfRecord)
    out.push({
      id: "lot_of_record",
      severity: "amber",
      title: "Review required: confirm lot-of-record status",
      reason: "The lot is below the district's minimum lot size. A single-unit house is likely allowed as an Administrator Exception for a lot of record, instead of a variance.",
      checklist: [
        "Confirm the lot was recorded separately and was vacant when the Zoning Code took effect (the effective date isn't in our data) (§921.04.A).",
        "Confirm it is not owned together with an abutting lot (§921.04.A).",
        "Design to the district's dimensional rules as far as practicable; the Zoning Administrator approves the exception.",
      ],
      costNotes: [],
      citations: [CITE.lotOfRecord],
      source: SRC.assessment,
    });
  const spr = inp.zoning ? SITE_PLAN_REVIEW[inp.zoning.code] : undefined;
  if (spr && inp.lotAreaSf != null && inp.lotAreaSf >= spr.minLotSf)
    out.push({
      id: "site_plan_review",
      severity: "amber",
      title: "Review required: site plan review",
      reason: sitePlanReviewApplies(inp, s)
        ? `New construction or an addition on a ${inp.zoning!.code} lot of ${spr.minLotSf.toLocaleString()} sf or more needs Site Plan Review (§922.04).`
        : `Exterior renovation or an addition on this ${inp.zoning!.code} lot needs Site Plan Review (§922.04); interior-only work does not.`,
      checklist: ["Submit a site plan to City Planning for Site Plan Review (§922.04) before the building permit."],
      costNotes: [],
      citations: [spr.citation],
      source: SRC.zoningCode,
    });
  const h = inp.hazards;
  const rc = cfg.reviewCallouts;
  const geotechCost = rc.geotechReportCostUsd == null ? rc.geotechReportCostNote : `Geotechnical report: about $${rc.geotechReportCostUsd} (editable default).`;
  if ((h.landslideProneShare ?? 0) > 0)
    out.push({
      id: "landslide_prone",
      severity: "amber",
      title: "Review required: landslide-prone area",
      reason: `${pctText(h.landslideProneShare!)} of the lot is in the City's Landslide-Prone Overlay. Not a deal-breaker, but it adds engineering, review time and cost.`,
      checklist: [
        "Field investigation by a registered professional or geotechnical consultant before zoning sign-off; required when the work involves excavation, fill or vegetation removal (§906.04).",
        "New construction or a multi-story addition: full geotechnical report with borings (§906.04.B.2; City geotechnical handout).",
        "Construction and land-operations plans approved by PLI based on that investigation before permits issue (§906.04).",
        "Site plan and building plan showing the hillside development standards (§906.04).",
      ],
      costNotes: [geotechCost, "Hillside foundations and retaining walls usually cost more; price them after the report."],
      citations: ["Pittsburgh Code §906.04", "§906.04.B.2", "City of Pittsburgh geotechnical report handout"],
      source: SRC.landslide,
    });
  if (h.undermined) {
    const city = inp.isPittsburgh && h.underminedSource === SRC.undermined;
    const g = rc.groutingCostUsd;
    out.push({
      id: "undermined",
      severity: "amber",
      title: "Review required: undermined (old coal mines)",
      reason: city
        ? "The lot is in the City's Undermined Area Overlay: mapped mine workings lie beneath it."
        : "PA DEP maps old mine workings under this lot. Mine maps are incomplete; absence of a mapped mine is not proof of none.",
      checklist: city
        ? [
            "Submit the available PA DEP information on any mine under or next to the site (depth, extent, subsidence likelihood) with the zoning application (§906.05).",
            "Single-unit house with more than 100 ft of cover and no nearby subsidence: competent evidence of the cover; engineer's advice strongly recommended (§906.05).",
            "100 ft of cover or less, nearby subsidence, or a building larger than a typical house (can include small multifamily): site investigation by a registered professional required before zoning approval (§906.05).",
            "If the investigation calls for special construction (e.g. grouting), PLI approves the plans before permits (§906.05).",
            "Consider Mine Subsidence Insurance (PA DEP program).",
          ]
        : [
            "Check the PA DEP mine map viewer for depth and extent.",
            `Ask ${inp.municipality ?? "the municipality"} whether its ordinance requires a subsidence investigation.`,
            "Get an engineer's opinion before designing foundations; consider Mine Subsidence Insurance.",
          ],
      costNotes: [
        `Mine grouting, if the investigation calls for it: $${g.low.toLocaleString()}-$${g.high.toLocaleString()} (${g.label})`,
        geotechCost,
      ],
      citations: city ? ["Pittsburgh Code §906.05"] : ["PA DEP mined-out areas"],
      source: h.underminedSource ?? SRC.undermined,
    });
  }
  if (fit?.status === "no_fit" && s !== "rehab_existing" && s !== "adu")
    out.push({
      id: "unbuildable_lot",
      severity: "amber",
      title: "Review required: lot too small for this building type",
      reason: "After setbacks, no building of this type fits, even with reduced setbacks.",
      checklist: ["Try a smaller building type or the existing building.", "Ask about combining with an adjacent lot.", "Confirm lot lines on a survey."],
      costNotes: [],
      citations: [],
      source: SRC.quickfit,
    });
  const limited = inp.access.frontage === "paper" || inp.access.frontage === "steps";
  const inferred = fitNotes.some((n) => /No lot edge sits within 45 ft|No street found near the lot/.test(n));
  if (limited || (inferred && inp.access.frontage === "street"))
    out.push({
      id: "limited_access",
      severity: "amber",
      title: "Review required: street access",
      reason: limited
        ? `Only ${inp.access.frontage === "paper" ? "an unopened (paper) street" : "City steps"} reach the lot.`
        : "The frontage test finds a street within 20 m of the lot, but no lot edge sits within 45 ft of a street centerline; the front edge used for the fit test is a guess.",
      checklist: limited
        ? ["Confirm legal access on a survey.", "Ask DOMI about opening the street or vacating the paper street.", "Budget for a driveway or utility run across the right-of-way."]
        : ["Confirm which lot line fronts the street on a survey.", "Confirm driveway and utility access with DOMI."],
      costNotes: [],
      citations: [],
      source: SRC.streets,
    });
  return out;
}
