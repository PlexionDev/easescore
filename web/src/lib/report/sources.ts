// Source definitions for Appendix A. Dates come from the data itself where the database records
// them; otherwise the entry says the vintage is not recorded (and Appendix E lists that as a gap).

import { assumptions, finance } from "@easescore/engine";
import { CiteRegistry } from "./cite";
import type { ReportModel } from "./load";

export const NOT_RECORDED = "vintage not recorded in our database";

export function buildSources(m: ReportModel): CiteRegistry {
  const f = m.facts;
  const c = new CiteRegistry();
  const a = f.assessment;
  const rules = f.zoning?.rules as { citation?: string | null } | null | undefined;

  c.define("assessment", { title: "Property Assessments", publisher: "Allegheny County Office of Property Assessments", date: a?.as_of ? `as of ${a.as_of}` : NOT_RECORDED, url: "https://data.wprdc.org/dataset/property-assessments", note: "Address, lot size, use, assessed values, year built, condition, owner category (never names)." });
  c.define("parcels", { title: "Parcel boundaries (GIS)", publisher: "Allegheny County", date: NOT_RECORDED, note: "Lot outline, GIS lot area and the lot plan in Figure 2." });
  c.define("zoning", { title: "Zoning districts", publisher: "City of Pittsburgh Department of City Planning", date: NOT_RECORDED });
  c.define("zoning_rules", { title: "Pittsburgh Zoning Code, Title Nine (transcribed rules table)", publisher: "City of Pittsburgh", date: "code as transcribed Sept. 2026", url: "https://library.municode.com/pa/pittsburgh", note: rules?.citation ? `Sections used: ${rules.citation}` : undefined });
  c.define("overlays", { title: "Zoning overlays and Registered Community Organizations", publisher: "City of Pittsburgh", date: NOT_RECORDED });
  c.define("slope_1m", { title: "1 m lidar elevation model (PA Western 2019), slope computed by EaseScore", publisher: "USGS 3D Elevation Program", date: "2019 lidar collection", url: "https://www.usgs.gov/3d-elevation-program", note: "Slope per 1 m cell inside the lot; shares are of the lot's cells." });
  c.define("landslide_prone", { title: "Landslide-prone areas (§906.04 overlay)", publisher: "City of Pittsburgh", date: NOT_RECORDED });
  c.define("undermined", { title: "Undermined areas (§906.05 overlay)", publisher: "City of Pittsburgh", date: NOT_RECORDED });
  c.define("mines", { title: "Mine maps and mined-out areas; Mine Subsidence Insurance risk map", publisher: "PA DEP; PA Mine Map Atlas (PASDA)", date: NOT_RECORDED, url: f.mines?.mine_map_url ?? "https://www.minemaps.psu.edu/", note: "Mine maps are incomplete; the absence of a mapped mine does not prove there is none." });
  c.define("landslide_inventory", { title: "Landslide inventory (recorded slides)", publisher: "Allegheny County / University of Pittsburgh", date: NOT_RECORDED });
  c.define("fema", { title: "National Flood Hazard Layer", publisher: "FEMA", date: NOT_RECORDED, url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer" });
  c.define("nfip", { title: "NFIP redacted policies and claims, aggregated by census tract", publisher: "OpenFEMA", date: NOT_RECORDED, url: "https://www.fema.gov/about/openfema/data-sets" });
  c.define("flood311", { title: "311 flooding requests (5 years), by census tract", publisher: "City of Pittsburgh 311", date: NOT_RECORDED, url: "https://data.wprdc.org/dataset/311-data" });
  c.define("sewer", { title: "Combined sewersheds", publisher: "PWSA / 3 Rivers Wet Weather", date: NOT_RECORDED });
  c.define("env", { title: "Land Recycling Program sites; ACRES brownfields", publisher: "PA DEP; US EPA", date: NOT_RECORDED, note: m.ease?.env_sites?.rules });
  c.define("hydro", { title: "Streams (National Hydrography Dataset) and wetlands (National Wetlands Inventory)", publisher: "USGS; US Fish and Wildlife Service", date: NOT_RECORDED });
  c.define("streets", { title: "Street centerlines (opened and paper streets)", publisher: "Allegheny County; City of Pittsburgh", date: NOT_RECORDED, note: "Frontage = an opened street centerline within 20 m of the lot. Confirm on a survey." });
  c.define("buildings", { title: "Building footprints", publisher: "Allegheny County", date: NOT_RECORDED });
  c.define("transit", { title: "Transit schedule (GTFS), weekday 7–9 am service", publisher: "Pittsburgh Regional Transit", date: NOT_RECORDED });
  c.define("schools", { title: "School district and Pittsburgh Public Schools feeder boundaries", publisher: "Allegheny County; Pittsburgh Public Schools", date: NOT_RECORDED });
  c.define("context", { title: "Neighborhoods, City-owned property, tax liens, street trees", publisher: "City of Pittsburgh; Allegheny County", date: NOT_RECORDED });
  c.define("acs", { title: "American Community Survey 5-year estimates (census tract)", publisher: "US Census Bureau", date: f.tract?.acs_year ? `ACS ${f.tract.acs_year}` : NOT_RECORDED, url: "https://www.census.gov/programs-surveys/acs" });
  c.define("tract_designations", { title: "Qualified Census Tracts and Difficult Development Areas; Opportunity Zones", publisher: "HUD; CDFI Fund", date: NOT_RECORDED, url: "https://www.huduser.gov/portal/datasets/qct.html" });
  c.define("sales", { title: "Property sale transactions (valid arm's-length sales)", publisher: "Allegheny County Department of Real Estate", date: m.sales?.date_range?.to ? `sales through ${m.sales.date_range.to}` : NOT_RECORDED, url: "https://data.wprdc.org/dataset/real-estate-sales", note: m.sales?.rules });
  c.define("zori", { title: "Zillow Observed Rent Index (ZORI), all homes, smoothed", publisher: "Zillow Research", date: m.rent?.zori?.latest_month ? `latest month ${m.rent.zori.latest_month}` : NOT_RECORDED, url: "https://www.zillow.com/research/data/" });
  c.define("hud_fmr", { title: `Fair Market Rents${m.rent?.hud_fmr?.level ? ` (${m.rent.hud_fmr.level})` : ""}`, publisher: "US Department of Housing and Urban Development", date: m.rent?.hud_fmr?.year ? `FY ${m.rent.hud_fmr.year}` : NOT_RECORDED, url: "https://www.huduser.gov/portal/datasets/fmr.html" });
  const pt = f.property_tax;
  c.define("millage", { title: "Real estate millage rates (county, municipality, school district)", publisher: "Allegheny County Treasurer", date: pt?.year ? `tax year ${pt.year}` : NOT_RECORDED });
  c.define("transfer_tax", { title: "Realty transfer tax rates", publisher: "PA Department of Revenue; local taxing bodies", date: NOT_RECORDED });
  const tapDates = [...new Set(m.tapFees.map((t) => t.effective_date).filter(Boolean))].sort();
  c.define("tap_fees", { title: "Water and wastewater tariffs (permit, connection and meter fees)", publisher: m.tapFees[0]?.authority ?? "Local water and sewer authority", date: tapDates.length ? `effective ${tapDates.join(", ")}` : NOT_RECORDED, url: m.tapFees[0]?.source_url ?? null });
  c.define("msi_rates", { title: "Mine Subsidence Insurance annual premiums rate chart", publisher: "PA DEP", date: `effective ${finance.MSI_CHART.effectiveDate}`, url: "https://www.depgreenport.state.pa.us/elibrary/GetDocument?docId=4892808&DocName=MINE%20SUBSIDENCE%20INSURANCE%20ANNUAL%20PREMIUMS%20RATE%20CHART.PDF" });
  const z = m.zba ? Object.values(m.zba.by_relief) : [];
  const zFrom = z.map((r) => r.from).filter(Boolean).sort()[0];
  const zTo = z.map((r) => r.to).filter(Boolean).sort().at(-1);
  c.define("zba", { title: "Zoning Board of Adjustment and City Council zoning decisions", publisher: "City of Pittsburgh (collected by EaseScore.AI)", date: zFrom && zTo ? `decisions ${zFrom} to ${zTo}` : NOT_RECORDED, note: m.zba?.rules });
  c.define("market_activity", { title: "Market activity: valid sales and completed building permits within ½ mile, 3 years", publisher: "Allegheny County sales; City of Pittsburgh PLI permits", date: m.ease?.market?.as_of ? `computed ${m.ease.market.as_of}` : NOT_RECORDED, note: m.ease?.market?.rules });
  c.define("permits", { title: "Building permits", publisher: "City of Pittsburgh Permits, Licenses and Inspections", date: NOT_RECORDED });
  const rl = m.rentLimits[0];
  c.define("phfa", { title: "LIHTC rent and income limits (Allegheny County)", publisher: "Pennsylvania Housing Finance Agency", date: rl ? `${rl.year}${rl.effective_date ? `, effective ${rl.effective_date}` : ""}` : NOT_RECORDED, url: rl?.source_url ?? "https://www.phfa.org/mhp/rent_and_income_limits/" });
  c.define("muni_rules", { title: "Point-of-sale and sewer-lateral rules at sale", publisher: "Municipality / water authority", date: NOT_RECORDED, url: (f.muni_rules?.source_url ?? "").split(" ")[0] || null });
  c.define("quickfit", { title: "QuickFit site-fit solver (EaseScore.AI engine)", publisher: "EaseScore.AI", date: "deterministic; same inputs give the same result", note: "Building sizes and story ranges are editable placeholders, not standards. See Appendix B." });
  c.define("requirements", { title: "Requirements catalog and rules (EaseScore.AI engine)", publisher: "EaseScore.AI, from the Pittsburgh Code and agency handouts", date: "catalog as of Sept. 2026", note: "Each item cites its code section in Section 5." });
  c.define("ease_score", { title: "Ease Score (EaseScore.AI engine)", publisher: "EaseScore.AI", date: m.score.status === "ready" ? `scoring config ${m.score.configVersion}` : "not run", note: "Deterministic; weights and curves live in one versioned config file. Factor sources are listed in Appendix D." });
  const cc = assumptions.COST_CONFIG;
  c.define("cost_config", { title: `Cost assumptions ${cc.version} (EaseScore.AI)`, publisher: "EaseScore.AI", date: `effective ${cc.effectiveDate}`, note: "Every default is editable and carries a source label: “Pittsburgh builder published ranges”, “Estimate — confirm with bids”, “Local project data (owner-provided)”, “Assumption — editable”. Full list in Appendix C." });
  c.define("builder_ranges", { title: "Pittsburgh builder published per-square-foot construction ranges", publisher: "Incline Homes (2026); Home Builder Digest survey of Pittsburgh builders; EcoCraft", date: "2026 publications", note: "Base cost above a standard foundation, including builder overhead and profit; excludes land, demolition, unusual site work and soft costs." });
  c.define("pli_fee", { title: "Residential building permit base fee: $6.00 per $1,000 of construction value", publisher: "City of Pittsburgh Permits, Licenses and Inspections (reported)", date: `effective ${cc.softCosts.pittsburghBuildingPermitFee.effectiveDate}`, note: "Verify with the PLI fee schedule; other City fees are not included." });
  c.define("prime", { title: "Bank Prime Loan Rate (DPRIME)", publisher: "Board of Governors of the Federal Reserve System, via FRED", date: m.prime ? `observation ${m.prime.date}` : NOT_RECORDED, url: "https://fred.stlouisfed.org/series/DPRIME", note: "Construction loan rate = prime + an editable spread." });
  c.define("benchmarks", { title: "Recent Allegheny County housing project costs (total development cost per home)", publisher: "WESA; NEXTpittsburgh; PublicSource (news reports)", date: "as reported, 2025–2026", note: "Sanity check only, never a default." });
  c.define("subsidy_ref", { title: "Subsidy needed per affordable for-sale home", publisher: cc.benchmarks.homeownershipSubsidy.sourceLabel, date: NOT_RECORDED });
  c.define("nahb", { title: "Cost of Constructing a Home 2024", publisher: "National Association of Home Builders", date: "2024", note: "National reference, not a Pittsburgh default." });
  c.define("sf_sales", { title: "Valid single-family sales used to price a finished home", publisher: "Allegheny County Department of Real Estate", date: m.sfComps?.date_range?.to ? `sales through ${m.sfComps.date_range.to}` : NOT_RECORDED, url: "https://data.wprdc.org/dataset/real-estate-sales", note: "Same rules as the sales comps: valid arm's-length sales, at least 5, search widens from ¼ mile." });
  c.define("finance_engine", { title: "Finance module (EaseScore.AI engine)", publisher: "EaseScore.AI", date: "deterministic", note: "Holds no prices, costs or rates of its own: every input comes from the cost assumptions, the database or the user; missing inputs stay missing." });
  return c;
}
