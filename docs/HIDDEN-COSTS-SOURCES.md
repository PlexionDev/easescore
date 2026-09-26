# Hidden-cost sources

These are research notes on location-specific "surprise cost" triggers in Allegheny County, PA. The notes were compiled on 2026-09-26 from public sources. Every fact below has a source URL. Anything we could not confirm is marked **UNCONFIRMED**, and there is a list at the end.

Seed files that go with this note:

| File | What it holds |
|---|---|
| `data/seed/muni_transfer_requirements.csv` | One row per municipality (130): sewer-lateral / dye test at sale, point-of-sale inspection, and occupancy permit at resale |
| `data/seed/realty_transfer_tax.csv` | The state rate, plus the local municipal and school-district shares for every municipality |
| `data/seed/utility_tap_fees.csv` | Water and sewer tap, connection and capacity fees from official schedules |

---

## 1. Point-of-sale requirements (`muni_transfer_requirements.csv`)

**Starting source (secondary):** Pennsylvania Land Titles, *Allegheny County Municipal Information: Dye Testing, Occupancy, Transfer Tax and Real Estate Tax*, updated February 2024.
- URL: https://localwebdesigncompany.com/pennsylvanialandtitles/wp-content/uploads/sites/224/2024/03/Allegheny-County-Dye-Test-Occupancy-Info-Rev.-2024.pdf
- It covers 127 of the 130 municipalities.
- It has known errors. For example, the Wilkinsburg entry links to Wilkins Township forms.
- We treated it as a lead only. Rows were then checked against the municipality's ordinance, official web page or official form wherever one could be found.

**Column meanings:**
- `sewer_lateral_at_sale = Y`: a test of the private sewer lateral or its connections is required at sale or transfer. This covers a dye test, smoke test or CCTV lateral inspection. `sewer_lateral_details` says which kind, and whether refinances are included.
  - A **dye test** only checks for illegal stormwater connections (downspouts, area drains, sumps).
  - A **CCTV lateral inspection** can force a lateral repair or replacement. That repair is the big surprise cost.
- `point_of_sale_inspection = Y`: the municipality inspects the building (U&O or code compliance) before the sale can close.
- `occupancy_permit_at_resale = Y`: a certificate, permit or registration must be issued for the resale. This can be Y even when `point_of_sale_inspection` is N, for example a zoning or occupancy certificate with no entry into the building.
- `confidence` values:
  - `confirmed`: an official municipal or authority source states it.
  - `partial`: the sewer part is confirmed officially, but the occupancy part rests on the guide, or the reverse.
  - `likely`: only the title-company guide, or an older official document, supports it.
  - `unknown`: we have neither.
- `source_url` lists the official URLs first, then the guide.
- **Verification status:** Edgewood through Wilmerding (97 rows) were checked against official sources. Aleppo through Dravosburg (33 rows) still rest on the guide only and are marked `likely`.
- Many ecode360 citations were read from search-result excerpts, because ecode360 returns HTTP 403 to automated fetches.

**City of Pittsburgh specifics:**
- PWSA requires a dye test only in some areas. It decides case by case through its Evidence of Compliance application: https://www.pgh2o.com/residential-commercial-customers/buying-or-selling-property/dye-testing
- The City does not require a resale occupancy inspection. Some realtor blogs say it does; they are wrong on this point. See the muni CSV row for the citation.

## 2. Realty transfer tax (`realty_transfer_tax.csv`)

**State rate:**
- 1% of value, per the PA Department of Revenue: https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/realty-transfer-tax

**Local rates:**
- Source: Allegheny County, "Local Realty Transfer Tax Rates": https://www.alleghenycounty.us/Services/Property-Assessments-and-Real-Estate/Realty-Transfer-Taxes/Local-Tax-Rates
- Retrieved 2026-09-26. The page carries no "last updated" date.
- The page states that its table excludes the 1% owed to the Commonwealth.
- School-district names were normalised to their official form. For example, the county's "Monroeville-Gateway" and "Pitcairn-Gateway" are written as "Gateway School District", and "Keystone Oakes" as "Keystone Oaks".
- A blank `effective_date` means "current as of the retrieval date".

**How to compute the total tax:**
- Total = state 1% + municipal row + the school-district row for the parcel's school district.
- Do not add rows across school districts. Pittsburgh has two school-district rows, because a small part of the City is in Baldwin-Whitehall SD.
- Who pays is customary, not statutory. In Allegheny County the tax is usually split 50/50 between buyer and seller, but that is set by the sales agreement. We did not look for a source on this, so it is **UNCONFIRMED**.

**City of Pittsburgh:**

| Part | Rate |
|---|---|
| City | 3.0% |
| Pittsburgh Public Schools | 1.0% |
| State | 1.0% |
| **Total** | **5.0%** |

- Pittsburgh parcels in Baldwin-Whitehall SD pay 3.0% + 0.5% + 1.0% state = **4.5%**.
- The City's 3% includes a home-rule realty transfer tax. It was raised from 1.0% to 1.5% on 2018-02-01 and to 2.0% on 2020-01-01, to fund the Housing Opportunity Fund. That puts the combined rate at 5.0% from 2020-01-01.
  - Source (a secondary law-firm summary of the December 2017 ordinance): https://point-bridge.com/what-to-watch/higher-taxes-in-2020/
  - The City Code chapter is Ch. 255, https://ecode360.com/45439907. ecode360 blocked automated fetching, so the section text was not read.
- We found no evidence of a Pittsburgh transfer-tax change for 2026. The 2026 budget raised the property-tax millage (8.06 to 9.67 mills), not the transfer tax: https://www.wesa.fm/politics-government/2025-12-23/pittsburgh-2026-budget-gainey-approves

**Other municipalities with a local share above 1%:**

| Municipality | Combined local rate |
|---|---|
| Bellevue | 1.5% |
| Bethel Park | 1.5% |
| Green Tree | 1.5% |
| Hampton | 1.5% |
| McCandless | 1.5% |
| Monroeville | 1.5% |
| Mt. Lebanon | 1.5% |
| O'Hara | 1.5% |
| Pine | 1.5% |
| Upper St. Clair | 1.5% |
| West Deer | 1.5% |
| Whitehall | 1.5% (see conflict below) |
| McKeesport | 2.0% |
| Penn Hills | 2.0% |
| Mt. Oliver | 2.0% |

**Conflicts and oddities:**
- **Whitehall Borough (conflict):**
  - The county table shows 1% municipal + 0.5% school.
  - Two title-company "variations from 1%" lists dated 2023-09-01 show Whitehall at 1.25% combined local. That implies a 0.75% municipal share.
    - https://www.keymaxsettlement.com/wp-content/uploads/2023/08/PA-Transfer-Taxes.pdf
    - The PA Land Titles guide above.
  - We could not reach the Borough ordinance. The CSV row is marked `conflict`.
- **Trafford Borough:** the county lists 1% municipal and "No School Tax". Trafford straddles the Westmoreland County line. We did not verify this entry.

## 3. Utility tap / connection fees (`utility_tap_fees.csv`)

- Only numbers from official tariffs, rate resolutions or fee schedules are included.
- Pennsylvania municipal authorities must itemise tapping fees under 53 Pa.C.S. §5607(d)(24) (Act 57 of 2003). The components are capacity, distribution/collection, special purpose and reimbursement, plus separate connection and customer-facilities fees. Where a schedule itemises them, each component is its own row.
- 104 fee rows cover 17 authorities.
- **PWSA has no tapping, capacity or system-development fee** in its current PUC tariffs (Water Supplement 18 and Wastewater Supplement 17, effective 2026-03-08). It charges only permit, review, connection and meter fees.
- **Pennsylvania American Water:** the first street service connection per applicant is free (tariff Rule 3.2). Additional connections are charged at cost, plus a $30 activation fee. The PAWC wastewater tariff was not reviewed.
- **Largest per-unit charges found** (5/8–3/4 in residential):

| Authority | Service | Fee |
|---|---|---|
| South Fayette MA | sewer | $6,894 per EDU |
| McCandless Twp SA | sewer | $6,500 per EDU, plus watershed add-ons |
| Findlay Twp MA | sewer | $5,490 per EDU |
| Hampton Shaler WA | water | $4,591 |
| Fox Chapel Authority | water | $4,000 |
| Monroeville MA | water | $3,600 per EDU |
| Monroeville MA | sewer | $3,600 per EDU |

- The Monroeville amounts come from Resolutions 447/448, effective 2026-07-01. Monroeville's own web page still shows the older fees.
- **Excluded rows:**
  - An Upper St. Clair sewer connection fee ($1,500 + $1,000 per EDU), seen only in a search snippet.
  - A computed Monroeville reimbursement component.

---

## 4. PWSA lead service line data

**Public apps:**
- "Pgh2o Lead Service Line Map": https://pwsa.maps.arcgis.com/apps/webappviewer/index.html?id=9d7352ef7f694c8eb5f703a3e0955fda
  - Linked from https://www.pgh2o.com/your-water/community-lead-response
- "PGH2O Lead Service Line Web Application": https://experience.arcgis.com/experience/b984ee2a769444049d333beefcf7f7bc
  - Linked from https://www.pgh2o.com/construction-projects-maintenance/lead-line-replacement-programs
- Both apps use web map item `1aae14d661b94ba0906aaba0d0f9108f`: https://www.arcgis.com/sharing/rest/content/items/1aae14d661b94ba0906aaba0d0f9108f/data?f=json

**Machine-readable source (ArcGIS REST FeatureServer):**
- URL: https://services5.arcgis.com/jAsbh6V9IpseXByp/arcgis/rest/services/PGH2O_Water_Service_Line_Material/FeatureServer/0
- Layer `Water_Service_Line_Material`: point geometry, query-only, maxRecordCount 1000.
- Last edited around 2026-09.
- 80,876 records, checked with a count-only query on 2026-09-26. LocationID values are unique.

| Field | Meaning |
|---|---|
| `LocationID` | PWSA service-location ID (string) |
| `FinalReportedMaterialPublic` | Utility-side material: NonLead / Lead / Unknown / Galvanized / Abandoned_* |
| `FinalReportedMaterialPrivate` | Customer-side material, same value set |
| `FinalDescriptionPublic`, `FinalDescriptionPrivate` | Null in every record |
| `HouseNumber`, `Street`, `Address` | Service address |
| `PublicSide_PrivateSide` | The two materials concatenated, e.g. "NonLead \| NonLead" |

**Value counts on 2026-09-26:**

| Value | Public side | Private side |
|---|---|---|
| NonLead | 66,954 | 64,047 |
| Unknown | 8,414 | 3,838 |
| Lead | 5,469 | 9,632 |
| Galvanized | 2 | 3,048 |

**Keying:**
- Records are **per service location or address point**, not per parcel. There is no PARID field.
- Joining to parcels needs a point-in-parcel spatial join or address matching.
- There is no verification-status field and no date field.

**Related layers:**
- Replacement work-order areas: https://services5.arcgis.com/jAsbh6V9IpseXByp/arcgis/rest/services/LSLR_WO_Boundaries_Public_View/FeatureServer/0
- PWSA service area: https://services5.arcgis.com/jAsbh6V9IpseXByp/arcgis/rest/services/PWSA_Water_Service_Area/FeatureServer/0

**License / terms:**
- There is **no open-data license**.
- The web map's `licenseInfo` disclaims accuracy and says the maps are for giving property owners and residents the best available data, "not for any commercial, legal or other use".
- **Get legal review before a commercial product ingests this data.** Linking users out to the PWSA map is the low-risk option.

**Regulatory context:**
- PA DEP says the initial Lead and Copper Rule Revisions service-line inventory was due 2024-10-16. The LCRI baseline inventory is due by 2027-11-01: https://www.pa.gov/agencies/dep/programs-and-services/water/bureau-of-safe-drinking-water/drinking-water-management/drinking-water-regulations/lead-and-copper-rule
- PWSA's 2024-10-11 notice to customers: https://www.pgh2o.com/news-events/news/press-release/2024-10-11-pwsa-updates-customers-service-line-material

## 5. Radon

**EPA radon zone:**
- **Allegheny County is EPA Radon Zone 1**, the highest potential (predicted average indoor level above 4 pCi/L).
- EPA Pennsylvania zone map: https://www.epa.gov/sites/default/files/2014-08/documents/pennsylvania.pdf
- EPA overview: https://www.epa.gov/radon/epa-map-radon-zones
- Machine-readable copy on PASDA (FIPS 42003 has `RadonZone = 1`): https://mapservices.pasda.psu.edu/server/rest/services/pasda/USEnvironmentalProtectionAgency/MapServer/4
- EPA warns the zone map should not be used to decide whether an individual home needs testing.

**PA DEP test results:**
- Dataset: https://data.pa.gov/d/vkjb-sx3k
  - Socrata API: https://data.pa.gov/resource/vkjb-sx3k (JSON, CSV, SoQL)
  - License: Public Domain. Updated annually; the last update was 2026-07-13.
  - These are **record-level tests, not ZIP averages**. Each record has a ZIP (`address_postal_code`), county, municipality, census tract, building type, floor tested, method, `mitigation_system_indicator`, `measure_value` (pCi/L) and test start/end dates.
  - Allegheny County has about 356k records, 1987 to 2026. The dataset description still says "through March 2017", but the data runs to 2026.
- DEP also has a ZIP-code radon report viewer (SSRS): http://cedatareporting.pa.gov/Reportserver/Pages/ReportViewer.aspx?/Public/DEP/RP/SSRS/RadonZip
  - Linked from https://www.pa.gov/agencies/dep/programs-and-services/radiation-protection/radon-division/radon-in-the-home
  - Its aggregation method and date coverage are **UNCONFIRMED**.
- A ZIP or tract summary (median, share of tests ≥ 4 pCi/L) can be computed from the Socrata API with server-side SoQL aggregation, so there is no bulk download.

## 6. City steps and "steps-only / landlocked" access

**Steps datasets:**
- WPRDC "City of Pittsburgh Steps": https://data.wprdc.org/dataset/city-steps
  - License CC BY; publisher DPW; last modified 2024-02.
  - Formats: CSV with lat/long points (1,134 records), GeoJSON, and a data dictionary.
  - Fields include name, maintenance_responsibility, installed, material, length, number_of_steps, neighborhood, ward, and several scores.
- "PGHODSteps", a mirror of the City GIS Hub layer: https://data.wprdc.org/dataset/pghodsteps
  - REST: https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PittsburghSteps/FeatureServer/0
  - **Polyline** layer, 739 features, last edited around 2021-02.
  - Fields include street_nam, from_stree, to_street, hood, l_feet, width, steps.
  - License not stated.

**Street centerlines:**
- Pittsburgh Street Centerline (CC0): https://data.wprdc.org/dataset/pittsburgh-street-centerlines
  - REST: https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PavementPublic/FeatureServer/0 (19,683 segments)
  - Useful fields:

| Field | Values |
|---|---|
| `class` | PAPER (11), VACATED (3), INACTIVE (25), BARRICADED (31), PRIVATE (12), PARK ROAD, CITY MAINT |
| `owner` | CITY, STATE, PRIVATE, ... |
| `domi_class` | Local, Alley, Private, Private Road, Park Road, ... |
| `paveclass` | includes Unsurfaced |
| `roadwidth` | road width |

- Allegheny County Addressing Street Centerlines: https://data.wprdc.org/dataset/allegheny-county-addressing-street-centerlines
  - 82,218 segments. License not stated on WPRDC.
  - `fcc` follows Census CFCC codes: A72 stairway (274 segments), A71 walkway (48), A73 alley, A74 driveway/service, A41 local road.
  - CFCC appendix: https://www2.census.gov/geo/tiger/TIGER1992/Documentation/APPENDXE.txt

**Proposed test (not yet implemented):**
1. Build a vehicular-access line set:
   - City centerlines, excluding `class` in (PAPER, VACATED, INACTIVE, BARRICADED) and private-owner segments.
   - County centerlines, excluding `fcc` A71/A72.
2. Build a pedestrian-only set: county A71/A72 segments plus the City steps polylines.
3. Measure frontage. Buffer each set by about half the right-of-way width (from `roadwidth`, else about 25–30 ft), then measure the length of each parcel boundary that falls inside each buffer.
4. Flag parcels:
   - **Steps-only:** no vehicular frontage, but some pedestrian frontage.
   - **Landlocked:** no frontage of any class.
   - **Paper-street / alley-only / private-road-only:** the only frontage is to one of those classes.
5. Cross-check against address points, i.e. which segment the address hangs on.

**Limits:**
- Paper streets that were never built are mostly **absent** from centerlines. The only explicit flag is the city's 11 PAPER segments.
- So "no centerline" cannot tell an unopened right-of-way from no right-of-way at all. That would need a right-of-way or parcel-gap layer.

## 7. Underground storage tanks

**PA DEP data (via PASDA):**
- Active facilities: https://mapservices.pasda.psu.edu/server/rest/services/pasda/DEP/MapServer/27
  - 976 facilities in Allegheny County, filter `FACILITY_2='Allegheny'`.
  - PASDA page: https://www.pasda.psu.edu/uci/DataSummary.aspx?dataset=287 (shapefile, KMZ, spreadsheet, GeoJSON, WMS).
- Inactive facilities: https://mapservices.pasda.psu.edu/server/rest/services/pasda/DEP2/MapServer/20
  - 2,422 in Allegheny County, filter `FACILITY_C='Allegheny'`.
  - **The truncated field names differ between the two layers**, so map fields per layer.
- Both layers are facility-level points: DEP facility ID, name, address, municipality, owner, lat/long, and a `TANK_INFOR` link.
- Per-tank detail (capacity, substance, install date, status) is in DEP's SSRS reports:
  - Active: http://cedatareporting.pa.gov/Reportserver/Pages/ReportViewer.aspx?/Public/DEP/Tanks/SSRS/TANKS
  - Inactive: http://cedatareporting.pa.gov/Reportserver/Pages/ReportViewer.aspx?/Public/DEP/Tanks/SSRS/Tanks_Inactive
  - These are linked from https://www.pa.gov/agencies/dep/programs-and-services/land/storage-tanks/storage-tank-data
- PASDA license terms were not checked (**UNCONFIRMED**).

**Residential heating-oil tanks will not appear:**
- 25 Pa. Code §245.1 excludes from the definition of a regulated storage tank "tanks used for storing heating oil for consumptive use on the premises where stored". This applies to both underground and aboveground tanks, and there is **no gallon cap** on it.
  - https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/025/chapter245/s245.1.html
- The 1,100-gallon threshold in that section applies to farm and residential **motor-fuel** tanks, not heating oil.
- So a parcel's absence from these layers is **not** evidence that it has no buried oil tank. Older homes that once had oil heat remain a risk.

## 8. Reassessment after new construction, and the abatements that offset it

**How Allegheny County picks up new construction:**
- Municipalities send building, demolition and occupancy permits to the Office of Property Assessments (OPA). OPA reviews them and may reassess. The owner can appeal the new value with a **Special Appeal**.
  - https://www.alleghenycounty.us/Services/Property-Assessments-and-Real-Estate/Property-Assessments/Building-Permits

**Timing: County tax vs. interim bills:**
- Changes made after January 1 are not valued for **County** tax until the following year.
- A **school district or municipality** can still bill part of the current year through an **interim valuation**:
  - It must have an ordinance that allows interim assessment requests.
  - The request must be filed within 12 months of completion, with completion set by the final occupancy permit date.
  - The taxing body prorates the value and sends a partial-year bill.
  - The page cites 24 P.S. §6-677.1.
  - Source: https://www.alleghenycounty.us/Services/Property-Assessments-and-Real-Estate/Property-Assessments/Interim-Valuation
- Plan for this cost: a surprise partial-year school and/or municipal bill in the year the building is finished, then the full assessment on the next County bill.

**Appeal deadline:**
- The Board of Property Assessment Appeals and Review (BPAAR) 2026 rules define an "Interim Assessment" as any assessment of new or improved property made after the general certification of countywide values.
- A Special Appeal of an interim assessment, an administrative change notice, or an abatement or exemption determination must be filed **within 30 days of the mailing date of the OPA notice**.
  - https://www.alleghenycounty.us/files/assets/county/v/4/government/property-assessments-and-real-estate/documents/bpaar/2026-bpaar-board-rules-and-regs.pdf

**City of Pittsburgh abatements** (City Code Chapters 265, 267, 268 and 269; 2026 caps from the City Finance "Real Estate Forms" page, https://www.pittsburghpa.gov/City-Government/Finance-Budget/Taxes/Real-Estate-Taxes/Real-Estate-Forms):

| Chapter | Covers | Term: standard / enhanced | 2026 cap: standard / enhanced | Benefit | Enhanced requires |
|---|---|---|---|---|---|
| **265** (Act 42 residential) | Owner-occupied or for-sale residential | 3 yr / 10 yr | $247,786 / $250,000 per year | Assessment reduction | A CDBG-eligible area, or ≥10% of units affordable at ≤80% AMI |
| **267** (LERTA-type) | Rental residential and commercial/industrial | 3 yr / 10 yr | $125,000 / $250,000 | Tax credit | ≥10% of units at 50% AMI, or ≥60% at 80% AMI, or Lower Hill District location, or ≥50 FTE jobs |
| **268** | Downtown | 6 yr / 20 yr | 50% of the tax increase / none stated | Tax exemption | — |
| **269** | Northside | 6 yr / 20 yr | 50% of the tax increase / none stated | Tax exemption | — |

- Code links:
  - Ch. 265: https://ecode360.com/45440216
  - Ch. 267: https://ecode360.com/45440351
  - Ch. 268: https://ecode360.com/45440456
  - Ch. 269: https://ecode360.com/50892372
- The ordinance text was not read, because ecode360 blocks automated fetching. The per-year percentage schedules are **UNCONFIRMED**.

**City application rules** (Guidelines and Workflow for Abatement Applications, as of 2023-11-03, https://www.pittsburghpa.gov/files/assets/city/v/1/finance/documents/real-estate-forms/23216_guidelines_and_workflow_for_abatement_applications_as_of_11-3-2023.pdf):
- A building permit dated **within 180 days** of the application is required. **Missing this window forfeits the abatement.**
- The fee is $60 per property.
- The abatement starts only after the certificate of occupancy is issued and the County sets the new building value. It is always applied to the **January** annual bill.
- Enhanced affordability abatements need annual HUD certification. There is no abatement in any year of non-compliance, and that year is not added back to the term.

**Which taxing bodies take part:**
- Whether Pittsburgh Public Schools and Allegheny County join each Chapter 265/267 abatement is **UNCONFIRMED**. A City 311 knowledge-base article saying so is now a 404.
- The **Downtown LERTA** (County Council, February 2024) is joint between the City, Pittsburgh Public Schools and the County:
  - Up to $250,000 per taxing body per year for 10 years.
  - Requires 10% of units at 50% AMI or 60% at 80% AMI, or commercial/industrial projects with 50+ jobs.
  - Source: https://www.alleghenycounty.us/Projects-and-Initiatives/Economic-Development/LERTA

**County LERTA outside the City:**
- Allegheny County LERTA Program Guidelines (revised November 2024): https://www.alleghenycounty.us/files/assets/county/v/3/government/economic-development/documents/lerta-amp-tifs/allegheny-county-lerta-program-guidelines_revised-nov.-2024.pdf
- What it provides:
  - Covers commercial, industrial or other business property in municipally designated "deteriorated areas", under the LERTA Act 76 of 1977 (72 P.S. §4722 et seq.).
  - **"Exemptions cannot be granted for single-family owner-occupied residential development."**
  - Maximum term is 10 years from activation. The exemption does not end on sale.
  - There is a $3,000 County application fee.
- How it works:
  - Each taxing body must pass its own ordinance or resolution.
  - OPA separately assesses the improvement and computes the exempt portion.
  - Copies of the exemption request go to OPA when the building permit and the occupancy permit are issued.
- Suburban municipal Act 42/LERTA residential programs were **not surveyed**. Some municipalities and school districts have their own, so check them per municipality.

---

## Could not confirm

- **Point-of-sale rules:** rows marked `likely` rest only on the February 2024 title-company guide. Rows marked `unknown` had no usable source. Municipal rules change often, so re-verify before relying on a row for a live deal.
- **Whitehall Borough transfer tax:** 1.0% municipal (county) vs 0.75% (title-company lists).
- **Trafford Borough:** no school-district transfer tax (county table) not independently verified.
- **Pittsburgh City Code Ch. 255** (realty transfer tax) and **Chs. 265/267/268/269** (abatements): ecode360 returned HTTP 403 to automated fetches, so the rates, schedules and effective dates come from County, City Finance and secondary summaries rather than the code text.
- **Pittsburgh abatement per-year schedules**, and whether the County and Pittsburgh Public Schools join Ch. 265/267 abatements.
- **PWSA lead data:**
  - whether one `LocationID` is one service line or one premise;
  - whether the FeatureServer is the official LCRR inventory submitted to DEP;
  - whether a downloadable inventory file exists.
- **DEP radon ZIP report:** aggregation method and date coverage.
- **Centerline codes:** the meaning of city centerline `cltype`='V' and `class`='INACTIVE'. PavementPublic has no data dictionary.
- **Steps data:** how the 1,134-record steps CSV relates to the 739-feature polyline layer.
- **Licenses:** the county centerline license, and the PASDA storage-tank license terms.
- **Point-of-sale conflicts between the guide and official sources:**
  - Frazer: an official occupancy permit exists, but the guide says none is required.
  - Rankin: the guide says dye tests ended in 2021, but the Borough site may still offer a dye test form.
  - Harrison: the guide says an inspection is required on purchase and refinance, but the official affidavit covers only properties with a pending code notice.
  - Several fees differ from the guide: Fox Chapel $425 vs $350, Edgewood $40 vs $25, Homestead.
- **Robinson Township name collision:** robinsonpa.gov and the Midway authority belong to Robinson Township in Washington County. The Allegheny County sources are townshipofrobinson.com and robinsonwater.com.
- **Tap fees not found or not verified:**
  - Bethel Park (only an obsolete code figure)
  - Mt. Lebanon (not checked)
  - Shaler sewer (usage rates only)
  - Western Allegheny County MA (no tap fee published)
  - North Fayette sewer
  - Upper St. Clair (fee page 403)
  - ALCOSAN (rates page 404)
  - Pennsylvania American Water wastewater tariff
  - MAWC: the 2025 figures could not be checked for a 2026 update, so they are marked `likely`.
  - Moon, Robinson, Plum and Ross: rows are from official but possibly dated schedules (2023–2025), so they are marked `likely`.
