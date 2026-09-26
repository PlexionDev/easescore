// A–Z requirements catalog. Each item's rule reads parcel facts + project answers and returns
// every trigger it finds. No AI decides a status. Citations marked null are pending
// confirmation (see docs/CODE-CITATIONS.md). Cost and duration are never filled here.
import {
  SRC, ask, buildsNew, hasStructure, isConstruction, isPittsburgh, notNeeded,
  overlayLabelled, overlays, pct,
} from "./helpers";
import type { ParcelFacts, Phase, ProjectAnswers, Trigger } from "./types";

export interface CatalogItem {
  id: string;
  item: string;
  category: string;
  phase: Phase;
  issuer: string;
  trigger: string; // "Required when" in plain language
  data: string[];
  citation: string | null;
  rule: (f: ParcelFacts, p: ProjectAnswers) => Trigger[];
}

const needsType = (p: ProjectAnswers) => (p.type ? null : ask("What kind of project is this (new build, addition, rehab, demolition, conversion)?"));

export const CATALOG: CatalogItem[] = [
  // ---------- Due diligence ----------
  {
    id: "title", item: "Title search & title insurance", category: "Due diligence", phase: "due_diligence",
    issuer: "Title company", trigger: "Any purchase", data: [], citation: null,
    rule: () => [{ status: "REQUIRED", reason: "Every purchase needs clear title before closing." }],
  },
  {
    id: "survey_boundary", item: "Survey (boundary)", category: "Due diligence", phase: "due_diligence",
    issuer: "Licensed surveyor", trigger: "Almost always; needed for setbacks, subdivision, lenders",
    data: ["Parcel boundary"], citation: null,
    rule: (f) => {
      const t: Trigger[] = [{ status: "REQUIRED", reason: "Setbacks, permits, and lenders all rely on the true lot lines.", source: "Allegheny County Parcel Boundaries" }];
      const listed = f.assessment?.lot_area_sqft;
      if (listed && Math.abs(listed - f.lot_area_sqft_gis) / listed > 0.1) {
        t.push({ status: "REQUIRED", reason: `Recorded lot size (${Math.round(listed).toLocaleString()} sq ft) and mapped size (${f.lot_area_sqft_gis.toLocaleString()} sq ft) differ by more than 10%.`, source: SRC.assessment });
      }
      return t;
    },
  },
  {
    id: "survey_topo", item: "Survey (topographic)", category: "Due diligence", phase: "due_diligence",
    issuer: "Licensed surveyor", trigger: "Slopes, grading, drainage design", data: ["Slope"], citation: null,
    rule: (f, p) => {
      const s = f.slope;
      if (s && s.steep_share > 0) return [{ status: "REQUIRED", reason: `${pct(s.steep_share)} of the lot is steeper than 25%; grading and foundations need measured contours.`, source: SRC.slope }];
      if (s && s.mean_pct >= 15) return [{ status: "LIKELY", reason: `Average slope is ${s.mean_pct}%.`, source: SRC.slope }];
      if (buildsNew(p)) return [{ status: "POSSIBLE", reason: "New construction usually needs spot elevations for drainage design." }];
      return [notNeeded("Lot is fairly flat.", SRC.slope)];
    },
  },
  {
    id: "phase1_esa", item: "Phase I Environmental Site Assessment", category: "Environmental", phase: "due_diligence",
    issuer: "Environmental consultant", trigger: "Past commercial/industrial use, or DEP-listed site nearby; lender requires",
    data: ["Land use", "DEP sites"], citation: "ASTM E1527-21",
    rule: (f, p) => {
      const t: Trigger[] = [];
      const cls = f.assessment?.class ?? "";
      if (/INDUSTRIAL|COMMERCIAL|UTILIT/i.test(cls)) t.push({ status: "LIKELY", reason: `Parcel is classed ${cls.toLowerCase()}; past uses may have left contamination.`, source: SRC.assessment });
      if ((f.env_sites_within_500ft ?? 0) > 0) t.push({ status: "LIKELY", reason: `${f.env_sites_within_500ft} state or federal cleanup site(s) within 500 ft.`, source: "PA DEP / EPA sites" });
      if (p.financed) t.push({ status: "LIKELY", reason: "Lenders commonly require a Phase I." , source: SRC.project });
      return t.length ? t : [{ status: "POSSIBLE", reason: f.env_sites_within_500ft === undefined ? "Nearby cleanup-site data isn't loaded yet; a lender may still require one." : "No trigger found in our data; a lender may still require one." }];
    },
  },
  {
    id: "phase2_esa", item: "Phase II Environmental Site Assessment", category: "Environmental", phase: "due_diligence",
    issuer: "Environmental consultant", trigger: "Phase I finds concerns", data: [], citation: null,
    rule: () => [{ status: "POSSIBLE", reason: "Only if the Phase I finds a recognized environmental condition." }],
  },
  {
    id: "flood_determination", item: "Elevation certificate / flood determination", category: "Environmental", phase: "due_diligence",
    issuer: "Surveyor; floodplain review", trigger: "Parcel touches FEMA flood zone", data: ["FEMA flood zones"], citation: "44 CFR 60.3; Pittsburgh Zoning Code Ch. 906 (floodplain overlay) — confirm",
    rule: (f) => {
      if (f.flood_1pct_share > 0) return [{ status: "REQUIRED", reason: `${pct(f.flood_1pct_share)} of the lot is in FEMA's 1%-annual-chance (100-year) floodplain.`, source: SRC.flood }];
      const x500 = f.overlays.some((o) => o.layer === "flood_fema_nfhl" && o.share > 0);
      if (x500) return [{ status: "POSSIBLE", reason: "Lot touches FEMA's 0.2%-annual-chance (500-year) area.", source: SRC.flood }];
      return [notNeeded("Lot is outside FEMA flood zones.", SRC.flood)];
    },
  },

  // ---------- Design & engineering ----------
  {
    id: "geotech", item: "Geotechnical report", category: "Engineering", phase: "design_engineering",
    issuer: "Geotechnical engineer", trigger: "Steep slope, landslide-prone, undermined, poor soils, multifamily (see decision rules)",
    data: ["Slope", "Landslide-prone areas", "Undermined areas", "Soils", "Recorded landslides"],
    citation: "Pittsburgh Zoning Code Ch. 915 (environmental performance standards) — section numbers pending",
    rule: (f, p) => {
      const t: Trigger[] = [];
      const s = f.slope;
      if (s && s.steep_share > 0) t.push({ status: "REQUIRED", confirm: true, reason: `${pct(s.steep_share)} of the lot is steeper than 25% (steep-slope standards apply).`, source: SRC.slope });
      for (const o of overlays(f, "landslide_prone_pgh")) t.push({ status: "REQUIRED", confirm: true, reason: `${pct(o.share)} of the lot is in a mapped landslide-prone area.`, source: SRC.landslide });
      for (const o of overlays(f, "undermined_pgh")) t.push({ status: "REQUIRED", confirm: true, reason: `${pct(o.share)} of the lot is over mapped old mine workings (subsidence risk).`, source: SRC.undermined });
      if ((f.landslides_within_300ft ?? 0) > 0) t.push({ status: "LIKELY", reason: `${f.landslides_within_300ft} recorded landslide(s) within 300 ft.`, source: "Landslide inventory" });
      if (s && s.steep_share === 0 && s.mean_pct >= 15) t.push({ status: "POSSIBLE", reason: `Average slope is ${s.mean_pct}% (15–25% range).`, source: SRC.slope });
      if (f.soils_limitation) t.push({ status: "POSSIBLE", reason: `Soil survey rates this ground "${f.soils_limitation}" for building.`, source: "USDA soil survey" });
      if ((p.units ?? 0) >= 3) t.push({ status: "LIKELY", reason: `${p.units}-unit building: building officials commonly require a soils investigation.`, source: SRC.project });
      if (!isPittsburgh(f)) t.push({ status: "POSSIBLE", reason: "Landslide and undermined-area maps cover Pittsburgh only; outside the city these risks are unknown, not absent." });
      if (!s) t.push({ status: "POSSIBLE", reason: "Slope data isn't available for this parcel." });
      return t.length ? t : [notNeeded("Flat, stable ground and no mapped hazards. The building official may still require one.")];
    },
  },
  {
    id: "mine_subsidence", item: "Mine subsidence investigation & insurance", category: "Environmental", phase: "design_engineering",
    issuer: "Engineer; PA Mine Subsidence Insurance", trigger: "Undermined area", data: ["Undermined areas"], citation: "52 P.S. §1406.1 et seq. (Bituminous Mine Subsidence and Land Conservation Act) — confirm",
    rule: (f) => {
      const u = overlays(f, "undermined_pgh");
      if (u.length) return [{ status: "REQUIRED", confirm: true, reason: `${pct(u[0]!.share)} of the lot is over mapped mine workings.`, source: SRC.undermined }];
      if (!isPittsburgh(f)) return [{ status: "POSSIBLE", reason: "Mine maps in our data cover Pittsburgh only; much of the county is undermined. Check PA DEP's mine map viewer." }];
      return [notNeeded("No mapped mine workings under the lot.", SRC.undermined)];
    },
  },
  {
    id: "architectural", item: "Architectural drawings", category: "Design", phase: "design_engineering",
    issuer: "Architect / designer", trigger: "Almost all permits; sealed drawings above certain scope", data: ["Project"], citation: null,
    rule: (_f, p) => {
      if (!p.type) return [needsType(p)!];
      if (isConstruction(p)) return [{ status: "REQUIRED", reason: "Permits need drawings; sealed drawings above certain scope (confirm threshold).", source: SRC.project }];
      return [notNeeded("Demolition only.")];
    },
  },
  {
    id: "structural", item: "Structural engineer", category: "Engineering", phase: "design_engineering",
    issuer: "Structural engineer", trigger: "Additions, load changes, foundations on slope, retaining walls, multifamily", data: ["Project", "Slope"], citation: null,
    rule: (f, p) => {
      const t: Trigger[] = [];
      if (p.type === "addition") t.push({ status: "REQUIRED", reason: "Additions change structural loads.", source: SRC.project });
      if (buildsNew(p) && f.slope && f.slope.steep_share > 0) t.push({ status: "REQUIRED", reason: `Foundation on a lot that is ${pct(f.slope.steep_share)} steeper than 25%.`, source: SRC.slope });
      if ((p.units ?? 0) >= 3) t.push({ status: "LIKELY", reason: "Multifamily building.", source: SRC.project });
      if (!p.type) t.push(needsType(p)!);
      return t.length ? t : [{ status: "POSSIBLE", reason: "Depends on the design." }];
    },
  },
  {
    id: "retaining_wall", item: "Retaining wall design", category: "Engineering", phase: "design_engineering",
    issuer: "Structural/geotechnical engineer", trigger: "Grade changes; walls over ~4 ft need engineered design", data: ["Slope"], citation: "IRC R404.4 (as adopted in PA UCC) — confirm",
    rule: (f, p) => {
      const s = f.slope;
      if (s && s.steep_share > 0 && (buildsNew(p) || !p.type)) return [{ status: "LIKELY", reason: `${pct(s.steep_share)} of the lot is steeper than 25%; level building area usually means walls over 4 ft.`, source: SRC.slope }];
      if (s && s.mean_pct >= 15) return [{ status: "POSSIBLE", reason: `Average slope ${s.mean_pct}%.`, source: SRC.slope }];
      return [notNeeded("Lot is fairly flat.", SRC.slope)];
    },
  },
  {
    id: "civil_site_plan", item: "Civil site plan", category: "Design", phase: "design_engineering",
    issuer: "Civil engineer", trigger: "Grading, stormwater, multiple units, new driveways", data: ["Slope", "Project"], citation: null,
    rule: (f, p) => {
      const t: Trigger[] = [];
      if (f.slope && f.slope.steep_share > 0 && buildsNew(p)) t.push({ status: "LIKELY", reason: "New construction on steep ground needs a grading plan.", source: SRC.slope });
      if ((p.units ?? 0) >= 3) t.push({ status: "LIKELY", reason: `${p.units} units.`, source: SRC.project });
      if (p.new_driveway) t.push({ status: "LIKELY", reason: "New driveway.", source: SRC.project });
      if (!p.type) t.push(needsType(p)!);
      return t.length ? t : [{ status: "POSSIBLE", reason: "Depends on grading and site work." }];
    },
  },
  {
    id: "energy_code", item: "Energy code compliance", category: "Design", phase: "design_engineering",
    issuer: "Designer; reviewed at permit", trigger: "New build, additions", data: ["Project"], citation: "PA UCC (34 Pa. Code Ch. 403) — IECC as adopted",
    rule: (_f, p) => (!p.type ? [needsType(p)!] : buildsNew(p) ? [{ status: "REQUIRED", reason: "New conditioned space.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "Applies to altered systems in some rehabs." }]),
  },
  {
    id: "accessibility", item: "Accessibility design (Fair Housing Act / code)", category: "Design", phase: "design_engineering",
    issuer: "Architect; reviewed at permit", trigger: "Buildings with 4+ units", data: ["Units"], citation: "42 U.S.C. §3604(f)(3)(C); PA UCC / ICC A117.1",
    rule: (_f, p) => (p.units === undefined ? [ask("How many units?")] : p.units >= 4 && buildsNew(p) ? [{ status: "REQUIRED", reason: `${p.units} new units (Fair Housing Act covers buildings of 4+ units).`, source: SRC.project }] : [notNeeded(`${p.units} unit(s).`)]),
  },
  {
    id: "fire_protection", item: "Fire alarm / sprinkler design and permit", category: "Permit", phase: "design_engineering",
    issuer: "Fire protection engineer; PLI / fire marshal", trigger: "Multifamily, commercial; townhouses (confirm current PA rule)", data: ["Units", "Attached"], citation: null,
    rule: (_f, p) => {
      if (p.units === undefined) return [ask("How many units?")];
      if (p.units >= 3) return [{ status: "REQUIRED", reason: `${p.units}-unit building falls under the commercial building code.`, source: SRC.project }];
      if (p.party_wall) return [{ status: "POSSIBLE", reason: "Attached/townhouse construction — confirm the current PA sprinkler rule.", source: SRC.project }];
      return [notNeeded("One- or two-unit detached building.")];
    },
  },

  // ---------- Zoning ----------
  {
    id: "zoning_approval", item: "Record of zoning approval / zoning application", category: "Zoning", phase: "zoning",
    issuer: "Zoning (Pittsburgh: OneStopPGH)", trigger: "Nearly all new builds, additions, changes of use", data: ["Zoning"], citation: null,
    rule: (f, p) => (!p.type ? [needsType(p)!] : p.type === "rehab" ? [{ status: "POSSIBLE", reason: "Needed if the use or footprint changes." }] : [{ status: "REQUIRED", reason: `${f.zoning ? `Zoned ${f.zoning.code}. ` : ""}New buildings, additions, and changes of use need zoning approval.`, source: SRC.zoning }]),
  },
  {
    id: "historic_coa", item: "Certificate of Appropriateness (historic)", category: "Zoning", phase: "zoning",
    issuer: "Historic Review Commission", trigger: "Local historic district + exterior change/demo", data: ["Historic districts"], citation: "Pittsburgh Code Ch. 1101 — confirm",
    rule: (f, p) => {
      const h = overlays(f, "historic_district_pgh");
      if (!h.length) return [notNeeded("Not in a City historic district.", SRC.historic)];
      if (p.type === "rehab" && p.touches_street === false) return [{ status: "POSSIBLE", reason: `In the ${h[0]!.label} historic district; interior-only work may not need review.`, source: SRC.historic }];
      return [{ status: "REQUIRED", reason: `In the ${h[0]!.label} historic district; exterior changes and demolition need Historic Review Commission approval.`, source: SRC.historic }];
    },
  },
  {
    id: "inclusionary", item: "Inclusionary zoning compliance", category: "Zoning", phase: "zoning",
    issuer: "City Planning", trigger: "Inclusionary overlay and project over the unit threshold", data: ["Inclusionary overlay", "Units"], citation: "Pittsburgh Zoning Code §907.04 — threshold pending confirmation",
    rule: (f, p) => {
      const iz = [...overlays(f, "inclusionary_pgh"), ...overlayLabelled(f, /Inclusionary|IZ-O/i)];
      if (!iz.length) return [notNeeded("Not in the Inclusionary Housing Overlay.", SRC.overlays)];
      if (p.units === undefined) return [ask("How many units? The Inclusionary Housing Overlay applies above a unit threshold.")];
      return [{ status: p.units >= 20 ? "REQUIRED" : "POSSIBLE", reason: `In the Inclusionary Housing Overlay with ${p.units} units (threshold pending confirmation).`, source: SRC.overlays }];
    },
  },
  {
    id: "rco_meeting", item: "Registered Community Organization meeting", category: "Zoning", phase: "zoning",
    issuer: "City Planning / RCO", trigger: "Development activities that need a public hearing or Planning Commission review", data: ["RCO areas"], citation: "Pittsburgh Code Ch. 178E — confirm",
    rule: (f) => {
      const r = overlayLabelled(f, /RCO/i);
      if (!r.length) return [notNeeded("No Registered Community Organization mapped here.", SRC.overlays)];
      return [{ status: "POSSIBLE", reason: `Within ${r[0]!.label?.replace(/^.*?RCO[:\s-]*/i, "") ?? "an RCO area"}. A development activities meeting is required if the project needs a hearing (variance, special exception, conditional use).`, source: SRC.overlays }];
    },
  },
  {
    id: "variance", item: "Variance", category: "Zoning", phase: "zoning",
    issuer: "Zoning Board of Adjustment (hearing)", trigger: "Project breaks a dimensional rule (setback, height, lot size)", data: ["Zoning rules", "Project"], citation: "Pittsburgh Zoning Code Ch. 922 — confirm",
    rule: (f) => {
      if (!isPittsburgh(f)) return [{ status: "POSSIBLE", reason: `Zoning rules for ${f.assessment?.municipality ?? "this municipality"} aren't in our data.` }];
      const t: Trigger[] = [];
      if (f.slope && f.slope.steep_share > 0.3) t.push({ status: "POSSIBLE", reason: "Steep lots often can't meet standard setbacks without a variance.", source: SRC.slope });
      t.push({ status: "POSSIBLE", reason: "Depends on the design vs. the district's setbacks, height, and lot size (dimensional rules not loaded yet)." });
      return t;
    },
  },
  {
    id: "contextual_setback", item: "Contextual setback determination", category: "Zoning", phase: "zoning",
    issuer: "Zoning Administrator", trigger: "Front setback short of code; neighbors sit closer to street", data: ["Setbacks", "Building footprints"], citation: null,
    rule: (f) => (isPittsburgh(f) ? [{ status: "POSSIBLE", reason: "Needs neighboring building footprints (not loaded yet) to compare front setbacks." }] : [{ status: "POSSIBLE", reason: `Confirm with ${f.assessment?.municipality ?? "the municipality"}.` }]),
  },
  {
    id: "special_exception", item: "Special exception", category: "Zoning", phase: "zoning",
    issuer: "Zoning Board of Adjustment", trigger: "Use listed as special exception", data: ["Zoning rules"], citation: null,
    rule: () => [{ status: "POSSIBLE", reason: "Depends on the proposed use vs. the district's use table (loading)." }],
  },
  {
    id: "conditional_use", item: "Conditional use approval", category: "Zoning", phase: "zoning",
    issuer: "City Council (Pittsburgh)", trigger: "Use listed as conditional", data: ["Zoning rules"], citation: null,
    rule: () => [{ status: "POSSIBLE", reason: "Depends on the proposed use vs. the district's use table (loading)." }],
  },
  {
    id: "parking", item: "Parking & loading compliance", category: "Zoning", phase: "zoning",
    issuer: "Zoning review", trigger: "District requires parking", data: ["Zoning rules", "Parking reduction overlay"], citation: null,
    rule: (f) => {
      const red = [...overlays(f, "parking_reduction_pgh"), ...overlayLabelled(f, /Parking/i)];
      if (red.length) return [{ status: "POSSIBLE", reason: `Parking reduction area: ${red[0]!.label}.`, source: SRC.overlays }];
      return [{ status: "POSSIBLE", reason: "Depends on the district's parking minimums (loading)." }];
    },
  },
  {
    id: "subdivision", item: "Lot consolidation / subdivision / lot line adjustment", category: "Zoning", phase: "zoning",
    issuer: "Planning Commission / municipality", trigger: "Combining lots, splitting for fee-simple townhomes", data: ["Parcels", "Project"], citation: null,
    rule: (_f, p) => (p.lot_split_or_merge === undefined ? [ask("Will you combine or split lots?")] : p.lot_split_or_merge ? [{ status: "REQUIRED", reason: "Lot lines change.", source: SRC.project }] : [notNeeded("Lot lines stay as they are.")]),
  },

  // ---------- Permits ----------
  {
    id: "building_permit", item: "Building permit", category: "Permit", phase: "permits",
    issuer: "PLI (Pittsburgh) / municipal building official", trigger: "New build, addition, structural or major rehab", data: ["Project"], citation: "PA UCC (34 Pa. Code Ch. 403)",
    rule: (_f, p) => (!p.type ? [needsType(p)!] : isConstruction(p) ? [{ status: "REQUIRED", reason: "Construction work.", source: SRC.project }] : [notNeeded("Demolition only (see demolition permit).")]),
  },
  {
    id: "demolition_permit", item: "Demolition permit", category: "Permit", phase: "permits",
    issuer: "PLI / municipality", trigger: "Removing any structure", data: ["Existing structure"], citation: null,
    rule: (f, p) => {
      if (p.type === "demolition") return [{ status: "REQUIRED", reason: "Project is a demolition.", source: SRC.project }];
      if (hasStructure(f) && p.type === "new_build") return [{ status: "LIKELY", reason: "There is a structure on the lot today.", source: SRC.assessment }];
      if (!p.type && hasStructure(f)) return [ask("Will the existing structure be removed?")];
      return [notNeeded(hasStructure(f) ? "Existing structure stays." : "No structure recorded on the lot.", SRC.assessment)];
    },
  },
  {
    id: "grading_permit", item: "Grading / earth disturbance permit", category: "Permit", phase: "permits",
    issuer: "PLI / municipality", trigger: "Cut/fill beyond threshold, hillside work", data: ["Slope", "Project"], citation: null,
    rule: (f, p) => {
      if (buildsNew(p) && f.slope && f.slope.steep_share > 0) return [{ status: "LIKELY", reason: `Hillside construction (${pct(f.slope.steep_share)} of lot over 25%).`, source: SRC.slope }];
      if (buildsNew(p)) return [{ status: "POSSIBLE", reason: "Depends on cut/fill volume (threshold pending)." }];
      return p.type ? [notNeeded("No significant earthwork expected.")] : [needsType(p)!];
    },
  },
  {
    id: "erosion_sediment", item: "Erosion & sediment control plan", category: "Environmental", phase: "permits",
    issuer: "Allegheny County Conservation District; PA DEP", trigger: "Earth disturbance (1+ acre needs NPDES permit)", data: ["Disturbed area"], citation: "25 Pa. Code Ch. 102",
    rule: (f, p) => {
      const d = p.disturbed_area_sqft;
      if (d !== undefined) {
        if (d >= 43560) return [{ status: "REQUIRED", reason: `${d.toLocaleString()} sq ft disturbed (1+ acre): E&S plan and NPDES permit.`, source: SRC.project }];
        if (d >= 5000) return [{ status: "REQUIRED", reason: `${d.toLocaleString()} sq ft disturbed: written E&S plan.`, source: SRC.project }];
        return [{ status: "POSSIBLE", reason: "Best management practices still apply to small disturbances." }];
      }
      if (buildsNew(p) && f.lot_area_sqft_gis >= 5000) return [{ status: "LIKELY", reason: `Lot is ${f.lot_area_sqft_gis.toLocaleString()} sq ft; new construction commonly disturbs 5,000+ sq ft.`, source: "Parcel boundary" }];
      return [ask("Roughly how much ground will be disturbed (sq ft)?")];
    },
  },
  {
    id: "stormwater", item: "Stormwater management plan", category: "Environmental", phase: "permits",
    issuer: "Water & sewer authority / municipality", trigger: "New impervious area / disturbance above threshold", data: ["Footprint", "Disturbed area"], citation: null,
    rule: (_f, p) => (buildsNew(p) ? [{ status: "LIKELY", reason: "New roof and paving add impervious area (threshold pending).", source: SRC.project }] : p.type ? [notNeeded("No new impervious area expected.")] : [needsType(p)!]),
  },
  { id: "electrical_permit", item: "Electrical permit", category: "Permit", phase: "permits", issuer: "PLI / inspection agency", trigger: "New wiring/service", data: ["Project"], citation: null,
    rule: (_f, p) => (!p.type ? [needsType(p)!] : isConstruction(p) ? [{ status: "LIKELY", reason: "New or altered wiring.", source: SRC.project }] : [notNeeded("Demolition only.")]) },
  { id: "mechanical_permit", item: "Mechanical (HVAC) permit", category: "Permit", phase: "permits", issuer: "PLI / municipality", trigger: "New/replaced systems", data: ["Project"], citation: null,
    rule: (_f, p) => (!p.type ? [needsType(p)!] : isConstruction(p) ? [{ status: "LIKELY", reason: "New or replaced heating/cooling.", source: SRC.project }] : [notNeeded("Demolition only.")]) },
  { id: "plumbing_permit", item: "Plumbing permit", category: "Permit", phase: "permits", issuer: "Allegheny County Health Dept", trigger: "New plumbing", data: ["Project"], citation: "ACHD Article XV (Plumbing) — confirm",
    rule: (_f, p) => (!p.type ? [needsType(p)!] : isConstruction(p) ? [{ status: "LIKELY", reason: "New or altered plumbing.", source: SRC.project }] : [notNeeded("Demolition only.")]) },
  {
    id: "asbestos", item: "Asbestos survey + Health Dept notification", category: "Environmental", phase: "permits",
    issuer: "Certified inspector; Allegheny County Health Dept", trigger: "Demolition or major rehab of older structures (pre-1980)", data: ["Year built"], citation: "ACHD Article XXI; 40 CFR 61 Subpart M (NESHAP)",
    rule: (f, p) => {
      const yb = f.assessment?.year_built;
      if (!hasStructure(f)) return [notNeeded("No structure recorded on the lot.", SRC.assessment)];
      if (p.type === "demolition" || p.type === "rehab" || p.type === "new_build") {
        if (yb && yb < 1980) return [{ status: "REQUIRED", reason: `Built in ${yb}; asbestos survey before demolition or renovation.`, source: SRC.assessment }];
        return [{ status: "LIKELY", reason: "Demolition/renovation notifications apply regardless of age; survey scope depends on age.", source: SRC.assessment }];
      }
      return p.type ? [notNeeded("No demolition or renovation.")] : [ask("Will existing structures be demolished or renovated?")];
    },
  },
  {
    id: "lead_rrp", item: "Lead-safe work practices", category: "Environmental", phase: "construction",
    issuer: "Certified renovator (EPA RRP)", trigger: "Renovation of pre-1978 housing", data: ["Year built"], citation: "40 CFR 745 Subpart E",
    rule: (f, p) => {
      const yb = f.assessment?.year_built;
      if (!yb) return [notNeeded("No building year recorded.", SRC.assessment)];
      if (yb >= 1978) return [notNeeded(`Built in ${yb}.`, SRC.assessment)];
      if (p.type === "rehab" || p.type === "addition" || p.type === "conversion") return [{ status: "REQUIRED", reason: `Built in ${yb} (before 1978).`, source: SRC.assessment }];
      return p.type ? [notNeeded("No renovation of the existing building.")] : [ask(`Built in ${yb}: will the existing building be renovated?`)];
    },
  },

  // ---------- Right-of-way & utilities ----------
  { id: "curb_cut", item: "Curb cut / driveway permit", category: "Right-of-way", phase: "permits", issuer: "DOMI", trigger: "New or changed driveway on a city street", data: ["Street centerlines"], citation: null,
    rule: (_f, p) => (p.new_driveway === undefined ? [ask("Will you add or change a driveway?")] : p.new_driveway ? [{ status: "REQUIRED", reason: "New or changed driveway.", source: SRC.project }] : [notNeeded("No driveway change.")]) },
  { id: "street_opening", item: "Street opening permit", category: "Right-of-way", phase: "permits", issuer: "DOMI", trigger: "Utility connection dug in the street", data: ["Utility needs"], citation: null,
    rule: (f, p) => (buildsNew(p) && !hasStructure(f) ? [{ status: "LIKELY", reason: "Vacant lot: new water/sewer connections are usually dug in the street.", source: SRC.assessment }] : [{ status: "POSSIBLE", reason: "Only if utility connections cross the street." }]) },
  { id: "row_closure", item: "Road / lane / sidewalk closure permit", category: "Right-of-way", phase: "construction", issuer: "DOMI", trigger: "Work blocking street or sidewalk", data: ["Street centerlines", "Staging"], citation: null,
    rule: (_f, p) => (p.touches_street === undefined ? [ask("Will work, deliveries, or containers block the street or sidewalk?")] : p.touches_street ? [{ status: "REQUIRED", reason: "Work affects the street or sidewalk.", source: SRC.project }] : [notNeeded("All work stays on the lot.")]) },
  { id: "dumpster_street", item: "Dumpster / container permit in street", category: "Right-of-way", phase: "construction", issuer: "DOMI", trigger: "Container can't fit on the lot", data: ["Lot vs footprint"], citation: null,
    rule: (f) => (f.lot_area_sqft_gis < 2500 ? [{ status: "LIKELY", reason: `Small lot (${f.lot_area_sqft_gis.toLocaleString()} sq ft) leaves little room to stage a container.`, source: "Parcel boundary" }] : [{ status: "POSSIBLE", reason: "Depends on staging space once the building footprint is placed." }]) },
  { id: "sidewalk", item: "Sidewalk repair / replacement", category: "Right-of-way", phase: "construction", issuer: "DOMI / owner", trigger: "Damaged sidewalk or new curb cut", data: [], citation: null,
    rule: (_f, p) => (p.new_driveway ? [{ status: "LIKELY", reason: "New curb cut crosses the sidewalk.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "Depends on sidewalk condition at inspection." }]) },
  { id: "street_tree", item: "Tree removal / street tree permit", category: "Right-of-way", phase: "construction", issuer: "City forestry", trigger: "Removing or affecting street trees", data: [], citation: null,
    rule: () => [{ status: "POSSIBLE", reason: "Street tree data isn't loaded yet." }] },
  { id: "paper_street", item: "Paper street vacation", category: "Right-of-way", phase: "zoning", issuer: "DOMI right-of-way vacation", trigger: "Unopened street adjoins parcel and is needed", data: ["Street centerlines"], citation: null,
    rule: () => [{ status: "POSSIBLE", reason: "Unopened-street data isn't loaded yet." }] },
  { id: "utility_letters", item: "Utility availability letters", category: "Utilities", phase: "due_diligence", issuer: "Each utility", trigger: "New connections", data: ["Service areas"], citation: null,
    rule: (f, p) => (buildsNew(p) && !hasStructure(f) ? [{ status: "LIKELY", reason: "Vacant lot: confirm water, sewer, gas, and electric can serve it.", source: SRC.assessment }] : [{ status: "POSSIBLE", reason: "Needed if adding load or new connections." }]) },
  { id: "sewage_planning", item: "Sewage planning (new connections/lots)", category: "Utilities", phase: "permits", issuer: "Municipality / sewer authority; PA DEP", trigger: "New lots or added units adding sewer load", data: ["Units"], citation: "PA Sewage Facilities Act (Act 537), 35 P.S. §750.1 et seq.",
    rule: (_f, p) => (p.units === undefined ? [ask("How many units?")] : buildsNew(p) || p.lot_split_or_merge ? [{ status: "POSSIBLE", reason: "New units or lots add sewer load; confirm the local planning rule.", source: SRC.project }] : [notNeeded("No added sewer load.")]) },
  { id: "utility_disconnect", item: "Utility disconnects", category: "Demolition", phase: "permits", issuer: "Each utility", trigger: "Before any demolition", data: ["Existing structure"], citation: null,
    rule: (f, p) => (p.type === "demolition" || (p.type === "new_build" && hasStructure(f)) ? [{ status: "REQUIRED", reason: "Utilities must be cut before demolition.", source: SRC.assessment }] : [notNeeded("No demolition.")]) },

  // ---------- Construction ----------
  { id: "contractor_license", item: "Contractor licensing / registration", category: "Construction", phase: "construction", issuer: "City; PA Attorney General (HICPA)", trigger: "Always", data: [], citation: "Home Improvement Consumer Protection Act, 73 P.S. §517.1 et seq.",
    rule: (f) => [{ status: "REQUIRED", reason: isPittsburgh(f) ? "City contractor license plus state home-improvement registration for residential work." : "State home-improvement registration; confirm any local license." }] },
  { id: "builders_risk", item: "Builder's risk insurance", category: "Construction", phase: "construction", issuer: "Insurer", trigger: "Any construction", data: [], citation: null,
    rule: (_f, p) => (!p.type ? [needsType(p)!] : isConstruction(p) ? [{ status: "REQUIRED", reason: "Construction in progress.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "Demolition contractors carry their own coverage." }]) },
  { id: "party_wall", item: "Neighbor / party wall agreement", category: "Construction", phase: "construction", issuer: "Owner & neighbor (attorney)", trigger: "Rowhouse, shared wall, work at the lot line", data: ["Footprints"], citation: null,
    rule: (f, p) => (p.party_wall || f.shares_wall ? [{ status: "REQUIRED", reason: "Shared wall with a neighbor.", source: p.party_wall ? SRC.project : "Building footprints" }] : p.party_wall === undefined ? [ask("Is it a rowhouse or does work touch a shared wall?")] : [notNeeded("Detached.")]) },
  { id: "dumpster", item: "Dumpster (container count)", category: "Construction", phase: "construction", issuer: "Hauler", trigger: "Demo or major rehab", data: ["Building size"], citation: null,
    rule: (_f, p) => (p.type === "demolition" || p.type === "rehab" || p.type === "new_build" ? [{ status: "REQUIRED", reason: "Debris removal.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "Depends on scope." }]) },
  { id: "site_facilities", item: "Portable toilet / site facilities", category: "Construction", phase: "construction", issuer: "Vendor", trigger: "Crews on site", data: [], citation: null,
    rule: (_f, p) => (isConstruction(p) ? [{ status: "LIKELY", reason: "Crews on site." }] : [{ status: "POSSIBLE", reason: "Depends on scope." }]) },

  // ---------- Finance ----------
  { id: "appraisal", item: "Appraisal", category: "Finance", phase: "due_diligence", issuer: "Lender", trigger: "Any financed project", data: [], citation: null,
    rule: (_f, p) => (p.financed === undefined ? [ask("Will the project be financed?")] : p.financed ? [{ status: "REQUIRED", reason: "Financed project.", source: SRC.project }] : [notNeeded("Cash project.")]) },
  { id: "construction_loan", item: "Construction loan", category: "Finance", phase: "due_diligence", issuer: "Lender", trigger: "Financed builds", data: [], citation: null,
    rule: (_f, p) => (p.financed === undefined ? [ask("Will the project be financed?")] : p.financed && isConstruction(p) ? [{ status: "LIKELY", reason: "Financed construction.", source: SRC.project }] : [notNeeded("Not financed construction.")]) },
  { id: "tax_abatement", item: "Tax abatement / incentive application", category: "Finance", phase: "due_diligence", issuer: "City / County / school district", trigger: "Eligible area or program", data: ["Location", "Project"], citation: null,
    rule: (f, p) => (p.affordable_financing ? [{ status: "LIKELY", reason: "Affordable financing often pairs with abatement programs.", source: SRC.project }] : [{ status: "POSSIBLE", reason: `Check ${isPittsburgh(f) ? "City of Pittsburgh (e.g. LERTA)" : "local"} programs.` }]) },

  // ---------- Closeout ----------
  { id: "certificate_occupancy", item: "Certificate of Occupancy", category: "Closeout", phase: "closeout", issuer: "PLI / municipality", trigger: "New units, change of use", data: ["Project"], citation: null,
    rule: (_f, p) => (!p.type ? [needsType(p)!] : buildsNew(p) || p.type === "conversion" ? [{ status: "REQUIRED", reason: "New units or change of use.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "Needed if the use changes." }]) },
  { id: "as_built", item: "As-built survey", category: "Closeout", phase: "closeout", issuer: "Surveyor", trigger: "New construction, lender or subdivision requires", data: ["Project"], citation: null,
    rule: (_f, p) => (p.type === "new_build" ? [{ status: "LIKELY", reason: "New construction.", source: SRC.project }] : [{ status: "POSSIBLE", reason: "If a lender or subdivision requires it." }]) },

  // ---------- Environmental extras ----------
  { id: "wetland_stream", item: "Wetland / stream delineation", category: "Environmental", phase: "due_diligence", issuer: "Environmental consultant", trigger: "Stream, wetland, or buffer near parcel", data: ["Streams", "Wetlands", "Riparian buffer"], citation: "25 Pa. Code Ch. 105 — confirm",
    rule: (f) => {
      const rip = overlayLabelled(f, /Riparian/i);
      if (rip.length) return [{ status: "LIKELY", reason: "In a riparian buffer overlay.", source: SRC.overlays }];
      if (f.streams_or_wetlands_within_100ft) return [{ status: "LIKELY", reason: "Stream or wetland within 100 ft.", source: "NHD / NWI" }];
      if (f.streams_or_wetlands_within_100ft === undefined) return [{ status: "POSSIBLE", reason: "Stream and wetland maps aren't loaded yet." }];
      return [notNeeded("No stream or wetland mapped nearby.", "NHD / NWI")];
    } },
];
