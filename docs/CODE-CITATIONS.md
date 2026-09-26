# Code Citations: Pittsburgh Development Requirements

This file lists where each development requirement comes from and its threshold. Each item gives the section, a short paraphrase of the threshold, and a confidence level.

**Sources and currency.** City of Pittsburgh Code of Ordinances on ecode360. The code says it "Includes legislation through 09-16-2026" and was read on 2026-09-26. Titles used: 1 (Ch. 178E), 4, 9 (Zoning), 10 (Building), 11 (Historic Preservation) and 13 (Stormwater). The Municode library no longer lists Pittsburgh, so all City sections here come from ecode360. State and federal cites come from the PA Code and Bulletin, PA agency pages and ACHD materials, as noted.

**Confidence levels:**
- **confirmed**: the section text was read directly.
- **partial**: the section was read but a detail (subsection letter, current edition, or how it applies) was not fully verified.
- **unconfirmed**: a standard citation that was not re-read in this pass.

The per-district dimensional rules are in `data/seed/pgh_zoning_rules.csv`.

---

## 1. Steep slopes

| Requirement | Citation | Threshold (paraphrased) | Confidence |
|---|---|---|---|
| Steep Slope Overlay (SS-O) scope | §906.08.A.1, §906.08.C.1 | Covers land with a natural slope of **25% or more**. All uses in the base district need Planning Commission review and approval. | confirmed |
| SS-O procedure | §906.08.C.2–4 | Application to the Zoning Administrator. Planning Commission public hearing with at least **21 days** notice to owners within **150 ft** (at least 25 owners). Decision within **45 days** of the hearing. Approval lapses after **1 year** if work has not substantially started (§906.08.C.7). | confirmed |
| SS-O design standards | §906.08.C.5 | 14 standards. Development must be set back **50 ft** from the SS-O edge at a ridgeline or base. Impervious surface must be minimized, natural drainage kept, and runoff collected on site. The Commission may waive standards if other mitigation is provided. | confirmed |
| Grading: cut and fill slopes | §915.02.A.1.c | Finished grades of **15% or less** are strongly encouraged. Cut or fill slopes may not exceed **25%** unless (1) a **geotechnical investigation report** certifies the slope is safe, and (2) walls or terraces are used at intervals of at least **10 ft**, approved in that report. | confirmed |
| Grading: setbacks and walls | §915.02.A.1.d–f | The top and bottom of a cut or fill slope must be at least **5 ft** from property lines, streets, buildings and parking. Retaining walls and gabions supporting steep slopes may be at most **10 ft** tall and should follow the contours. | confirmed |
| Revegetation | §915.02.B | Slopes steeper than **15%** that are exposed during construction must be replanted. Minimum per 150 sf: 1 canopy tree, 2 evergreens, 2 understory trees and 5 shrubs. | confirmed |
| Tree survey and protection | §915.02.C–D | A tree survey is required on sites larger than **¼ acre (10,890 sf)**. Trees **12 in** or more in diameter (measured 4 ft above grade) are protected. Removed trees must be replaced by total diameter. | confirmed |
| Hillside (H) district | §911.04.A.69(a); §905.02.C | The primary structure must sit on contiguous land with less than **30%** existing slope. The Zoning Administrator may require a soils engineering report; triggers include natural slopes over **20%**, landslide-prone areas and high shrink-swell soils. Maximum disturbance is **50%** of the lot. | confirmed |
| Land operations permit on slopes | §1003.03(a)(1)B–C, (a)(3)B | A permit is needed for excavation or fill **5 ft or deeper** on a slope of **25% or more**. It is also needed for basement or foundation excavation on a lot averaging **25%** or more, and for clearing vegetation on slopes over **25%** when stability could be affected. | confirmed |
| Finished slope ratios | §1003.17(a); §1003.22 | Cuts no steeper than **1.5H:1V** and fills no steeper than **2H:1V**, unless a registered professional recommends otherwise and the Code Official approves. Slopes of 2:1 or steeper may not be used for building construction without authorization. | confirmed |

**Note on Ch. 915.** The current Ch. 915 ("Environmental Performance Standards") contains only the grading, revegetation and tree rules in §915.02. The steep-slope permit process itself is in the §906.08 SS-O overlay. The only code-stated triggers for a geotechnical report are: the §915.02.A.1.c cut/fill exception (over 25%), the LS-O and UM-O overlays (below), and H-district discretion (§911.04.A.69).

## 2. Landslide-prone areas

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| LS-O overlay | §906.04.B.1 | All new or changed uses and structures in LS-O must meet the Hillside Development Standards of the Subdivision Regulations. A development plan must be submitted before a Certificate of Occupancy. | confirmed |
| Geotechnical evidence | §906.04.B.2 | No CO is approved for work involving excavation, fill or vegetation removal until a field investigation shows the work will not increase landslide risk. The investigation must be done by a registered professional or a qualified geotechnical consultant. | confirmed |
| Bureau of Building Inspection sign-off | §906.04.B.3 | Building or land-operations permits need construction and land-operations plans approved by the BBI Chief, based on the site investigation. | confirmed (the text cross-references "§906.03.B.2", a stale number; the requirement is §906.04.B.2) |

## 3. Undermined areas

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| UM-O mine data | §906.05.B.1 | For new construction or enlargement, the applicant must submit PA DEP (Bureau of Mining and Reclamation) data on mines under the site and adjacent properties. | confirmed |
| Single-unit allowance | §906.05.B.2 | A single-unit (or comparable) dwelling may be approved with evidence of more than **100 ft of overburden** above the mine and no known subsidence history nearby. | confirmed |
| Other development | §906.05.B.3 | Sites with less than 100 ft of overburden, sites with a subsidence history, buildings larger than a typical single-unit dwelling, and hazardous uses need a site investigation by a registered professional or geotechnical consultant showing the site is reasonably safe. | confirmed |

## 4. Grading / earth disturbance permit (Land Operations)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Land operations permit triggers | §1003.03(a) (Title 10, Ch. 1003 "Land Operations Control"; not Ch. 1004, which adopts the Property Maintenance Code) | A permit is required for any of the following: grading of **50 cubic yards** or more; 5 ft or deeper cut or fill on a slope of 25% or more; foundation excavation on a lot averaging 25% or more; easements for sewer, water, storm or power lines; altering a drainage channel; surface mining of 50 cy or more; clearing vegetation over **10,000 sf** (or on slopes over 25%); paving over **10,000 sf** (not streets); hauling more than **1,500 cy** for disposal; any "major excavating, grading or filling" conditional use. | confirmed |
| Exemptions | §1003.03(b) | Exempt: street work covered by a City street improvement permit, and ordinary basement or foundation excavation on lots averaging under 25%. The full list was not reproduced. | partial |
| Plans | §1003.05 | Drawings other than plot plans, and soils analysis, must be prepared under a registered professional. | confirmed |

## 5. Retaining walls

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Engineered design | IRC 2021 §R404.4, adopted statewide by 34 Pa. Code §403.21 (UCC adopts the 2021 IRC) | Engineered design is required for retaining walls that are not braced at the top and hold back more than **48 in** of unbalanced fill. It is also required for walls over **24 in** that carry loads other than soil (surcharge). Safety factor is 1.5 against sliding and overturning. Does not apply to foundation walls. | partial (read from ICC and search summaries; the PA regulation was not checked for any R404.4 amendment) |
| City height cap on slope walls | §915.02.A.1.e | Retaining walls or gabions supporting steep slopes: maximum **10 ft** tall. | confirmed |
| Walls in setbacks | §925.06.A.12 | Retaining walls are allowed in required setbacks if they do not block vehicle sight lines. | confirmed |

## 6. Contextual setbacks and height

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Contextual front setback | §925.06.B | The front setback may fall anywhere between the district requirement and either the setback of an adjacent lot on the same side of the street, or a build-to line set by at least **50%** of primary structures on the block face (applicant must document it). It cannot require more than the district setback, cannot shrink the right-of-way below minimums, and cannot be used in the RIV riparian buffer. Applies to primary structures only. | confirmed |
| Contextual side setback | §925.06.C | May fall between the required side setback and the adjacent lot's side setback, but not less than **3 ft**. | confirmed |
| Contextual rear setback | §925.06.I | May fall between the required rear setback and the adjacent same-street lot's rear setback. If both neighbors are vacant, the district setback applies. | confirmed |
| Contextual height | §925.07.D | May fall between the district maximum height and the average height of adjoining same-side buildings. It cannot exceed Ch. 916 compatibility limits. Excluded in UC-MU, UC-E and R-MU (§904.08–.10). | confirmed |
| District authorization | §903.03.A–E.2(a); §904.01–.07.C; §905.01–.02.C | Each residential density subdistrict, the neighborhood/commercial districts, and P and H expressly allow Contextual Setbacks and Heights. | confirmed |

## 7. Variance and special exception (Zoning Board of Adjustment)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Variance | §922.09 | ZBA public hearing with at least **21 days** notice by mail and posting to at least the 6 nearest owners, including abutting and facing owners (§922.09.C). Decision within **45 days** of the hearing (§922.09.D). The ZBA must find all 5 conditions: unique physical hardship, no reasonable use without relief, hardship not self-created, no harm to neighborhood character, and minimum variance needed (§922.09.E). Extra conditions apply in FP-O (§922.09.F). | confirmed |
| Special exception | §922.07 | ZBA public hearing with at least **21 days** notice to abutting and facing owners and City Council members. Decision within **45 days**, based on written findings of fact. | confirmed |
| Administrator exception | §922.08 | Zoning Administrator approval for uses marked "A" in the Use Table. | partial (procedure text not read) |
| State enabling law | PA Municipalities Planning Code, 53 P.S. §10910.2 (variances), §10912.1 (special exceptions), §10913.2 (conditional uses) | These are the statutory bases for the local procedures. | unconfirmed (standard citations, not re-read) |

## 8. Conditional use (City Council)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Two-step review | §922.06.B–D | First a Planning Commission hearing with at least **21 days** notice to owners within **150 ft** (at least 25 notices); the Commission recommends within 45 days. Then a City Council hearing within **45 days** of the Commission's action; Council decides within **45 days** of its hearing using the §922.06.E criteria. Missing a deadline counts as a denial. | confirmed |

## 9. Historic Review Commission: Certificate of Appropriateness

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| COA required | Title 11, §1101.05(a) | Any exterior alteration of a designated Historic Structure, Site or Object, or of any structure in a Historic District, needs HRC review and a Certificate of Appropriateness. Routine work the Commission has pre-authorized can be approved by staff. | confirmed |
| Permit hold | §1101.05(b) | BBI must notify the HRC before issuing building, demolition or sign permits for new construction or exterior alteration of historic properties. | confirmed |
| Timing | §1101.05(c) | The applicant gets at least **7 days** notice of the meeting. No HRC action within **60 days** of first consideration counts as approval. | confirmed |
| Hardship relief | §1101.06 | A Certificate of Economic Hardship may be requested within **30 days** of a COA denial. | confirmed |

## 10. Inclusionary Housing overlay (IZ-O)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Applicability | §907.04.A.5 | Inside the mapped IZ-O only. Applies to new construction or Substantial Improvement of buildings with **20 or more dwelling units** (or 20+ sleeping rooms, or 20+ combined), including groups marketed as one project, sharing financing, or part of a planned development. For this purpose, Substantial Improvement means work costing **100%** or more of market value within 5 years. | confirmed |
| Set-aside | §907.04.A.6(e) | At least **10%** of units must be inclusionary, rounded up. | confirmed |
| Affordability | §907.04.A.4 (definitions); §907.04.A.6(f) | Rental units: households at or below **50% AMI**, with rent plus fees and utilities at most 30% of income at 50% AMI. Owner units: households at or below **80% AMI**, priced for 70% AMI at 28% of income. Term is **35 years**, renewing on sale. Off-site units must be within ¼ mile (§907.04.A.4, A.7). | confirmed |

The section number §907.04 is confirmed. The IZ-O boundary map was not reviewed.

## 11. Registered Community Organization (RCO) meeting

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Development Activities Meeting | Title 1, §178E.08(c) | Required for any development that **needs a public hearing** and involves any of the following: a new structure of **2,400 sf** or more; an enlargement of **2,400 sf** or more; **4 or more new dwelling units**; a new or enlarged parking area with **10 or more stalls**; a use variance; a zoning map amendment; a Project Development Plan; a Planned Development (PDP or FLDP); a Master Development Plan; an Institutional Master Plan; any HRC application; or any Art Commission application. The applicant schedules the meeting with the RCO(s) at least **30 days** before the first public hearing and must attend. | confirmed |

## 12. Riparian buffers

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Riverfront (RIV) buffer | §905.04.E.4.a | No development within **125 ft** of the river's Project Pool Elevation. Performance-point bonuses can reduce this to **95 ft**, and to as little as **50 ft** next to an existing encroaching neighbor if extra conditions are met. Water-dependent and water-enhanced uses are exempt. | confirmed |
| Stream buffer | Title 13, §1303.05.b; §1303.01.d | Streams with a contributing watershed over **10 acres** need a riparian buffer easement of at least **35 ft** from the top of bank on each side, except where 25 Pa. Code Ch. 102 requires more. Applies even when stormwater plan thresholds are not met. | confirmed |

No standalone "riparian buffer overlay" zoning district exists in Ch. 906. Buffers come from the RIV base district and Title 13.

## 13. Parking

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Residential minimums and maximums | §914.02.A Parking Schedule A | Single-unit detached: minimum **1** per unit, maximum 4. Single-unit attached: minimum **0**, maximum 4. Two-, three- and multi-unit: minimum **1** per unit, maximum 2. Housing for the elderly needs a Parking Demand Analysis. An Alternative Access and Parking Plan may replace the schedule (§914.07). | confirmed |
| Exempt and reduced areas | §914.04 | Downtown, SP-11, Uptown Public Realm and UC-E: 100% reduction. Riverfront districts, UC-MU and R-MU: 50%. East Liberty and North Side: reductions for non-residential only. SP districts and PUDs: Parking Demand Analysis. | confirmed |
| UC-MU, UC-E, R-MU | §922.15.A.1 | Minimum is **50%** of Schedule A, and the maximum equals the Schedule A minimum. This section controls in a conflict; it conflicts with the §914.04 figure for UC-E. | confirmed (conflict noted) |
| Infill exception | §914.11.B.4 | The Zoning Administrator may waive parking for single-unit detached and two-unit homes on lots under **2,500 sf** when parking cannot fit within setbacks and on-street supply is adequate. | confirmed |
| Bicycle parking | §914.05.D | Multi-unit with **12 or more** units: 1 space per 3 units, at least 60% protected. Fewer than 12 units: none. | confirmed |

## 14. Stormwater management (City)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Stormwater site plan | Title 13, §1303.01.a | A City-approved stormwater (SWM) Site Plan is required when cumulative earth disturbance is **10,000 sf or more**, or new impervious area is **5,000 sf or more**, or the Zoning Code sets a lower threshold. No regulated work may start before approval. Exemptions are in §1303.02. | confirmed |
| Applicability | §1301.05 | All regulated activities and anything that may affect stormwater runoff. | confirmed |
| Flows onto neighbors | §1303.01.g | Stormwater flow onto adjacent property may not be changed without the owner's written permission. Proof of notice goes with the plan. | confirmed |
| Volume and rate controls | §1303.03, §1303.04 | Controls exist, including a fee-in-lieu option; details not tabulated. | partial |
| PWSA requirements | Pittsburgh Water developer and permit pages | PWSA reviews sewer and water connections and stormwater items separately. Its own numeric thresholds were not confirmed. | unconfirmed |

## 15. Erosion and sediment control (state and county)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| E&S plan | 25 Pa. Code §102.4(b) | A written E&S Plan is required for total earth disturbance of **5,000 sf or more**. Best practices (BMPs) are required below that. | partial (threshold confirmed; exact subparagraph not re-read) |
| NPDES construction permit | 25 Pa. Code §102.5(a) | Required for **1 acre or more** of earth disturbance, including smaller parts of a larger common plan that totals 1 acre or more. | confirmed |
| Local administration | Allegheny County Conservation District (ACCD), Chapter 102 program | ACCD reviews E&S plans and NPDES submittals in the county. The delegation agreement was not reviewed. | partial |
| City tie-in | §1303.01.e | E&S BMPs are required on all regulated earth disturbance per 25 Pa. Code and the Clean Streams Law. | confirmed |

## 16. Fire sprinklers: townhouses (PA)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| UCC base code | 34 Pa. Code §403.21 | Adopts the 2021 IRC. No exclusion of IRC §R313 (including §R313.1 for townhouses) was found in the adoption text. | partial |
| One- and two-family exemption | Act of April 25, 2011 (P.L. 1, No. 1) | Removes the automatic sprinkler requirement for one- and two-family dwellings. Per L&I and PA Bulletin notices, it applies retroactively to 1/1/2010 and remains unchanged. | partial |
| Townhouses | IRC 2021 §R313.1 (as adopted) | New IRC townhouses appear to require sprinklers, since the Act 1 exemption covers one- and two-family dwellings. Current L&I guidance was not confirmed. | partial (see Could not confirm) |

## 17. Accessibility

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Fair Housing Act design and construction | 42 U.S.C. §3604(f)(3)(C), (f)(7); 24 CFR §100.205 | "Covered multifamily dwellings" first occupied after March 13, 1991. In buildings of **4 or more units** with an elevator, all units are covered. In non-elevator buildings of 4 or more units, ground-floor units are covered. | unconfirmed (standard federal citation, not re-read) |
| PA UCC accessibility | 34 Pa. Code §403.21 (IBC Ch. 11 and ICC A117.1 as adopted) | Accessible and Type A/B unit counts for Group R occupancies follow the adopted IBC. | unconfirmed (unit-count thresholds not verified) |

## 18. Asbestos (ACHD Article XXI)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Survey | ACHD Art. XXI §2105.62.b | An asbestos survey is required before renovation or demolition of a "facility". | partial (subsection taken from ACHD enforcement orders) |
| Demolition notice | §2105.62.f.1 | Every facility demolition needs a notice at least **10 days** in advance, even if there is no asbestos. | partial |
| Abatement permit | §2105.62.h | A permit is needed when ACM is **260 linear ft** of pipe or more, or **160 sf** or more. | partial |
| Residential exemption | ACHD fact sheet (Jan. 2022) | Residential buildings with **4 or fewer units** are not "facilities" unless part of a larger project, such as several adjoining homes demolished within one year, urban renewal, or conversion to commercial use. | partial |
| Federal NESHAP | 40 CFR Part 61 Subpart M | Federal asbestos rules, incorporated locally. | unconfirmed |

## 19. Lead Renovation, Repair and Painting (RRP)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| RRP rule | 40 CFR Part 745, Subpart E | Applies to paid renovation of target housing built **before 1978** and child-occupied facilities. Requires an EPA-certified firm and renovator, lead-safe work practices and pre-renovation disclosure. Minor-repair exclusion (about 6 sf interior / 20 sf exterior) as stated in the rule. | unconfirmed (standard federal citation, not re-read) |

## 20. PA Mine Subsidence Insurance

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| MSI program | Act of Aug. 23, 1961, P.L. 1068 (Coal and Clay Mine Subsidence Insurance Fund); 25 Pa. Code Ch. 401 | Voluntary state insurance for damage from abandoned coal and clay mine subsidence, run by PA DEP. Allegheny County is a promoted county. Not a permit requirement. The zoning trigger is UM-O (§906.05). | partial |

## 21. Floodplain (FP-O)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Approval required | §906.02.B; §906.02.D.2 | Any construction or development in the floodplain needs Zoning Administrator approval and a BBI permit. The Administrator also checks for state and federal permits (Act 537, Dam Safety and Encroachments Act, Clean Streams Law, CWA §404) (§906.02.D.3(b)). | confirmed |
| Elevation | §906.02 (definitions; AE-zone standards) | The Regulatory Flood Elevation is the base flood elevation plus **1½ ft** of freeboard. In AE zones, the lowest floor of new construction or substantial improvements (including basements) must be at or above it. | confirmed |
| Substantial improvement and damage | §906.02 (definitions) | Work or damage costing **50%** or more of pre-work market value. | confirmed |
| Floodway | §906.02.E.2.a | No encroachment unless a hydrologic and hydraulic analysis shows **no increase** in flood levels, and a DEP permit is obtained. In AE zones without a floodway, the limit is a cumulative rise of 1 ft or less. | confirmed |
| Variances | §922.09.F | Extra conditions apply to FP-O variances. | confirmed |
| State law | PA Flood Plain Management Act (Act 166 of 1978); NFIP (44 CFR 59–60) | Referenced in §906.02.A. | partial |

## 22. Sewage facilities planning (Act 537)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Planning module | PA Sewage Facilities Act (Act 537 of 1966), 35 P.S. §750.1 et seq.; 25 Pa. Code Ch. 71 | New land development needs a DEP Sewage Facilities Planning Module or an exemption. In the City, Pittsburgh Water (PWSA) takes modules through its permit portal, with ALCOSAN, City Planning and ACHD reviewing parts. | partial |
| Exemptions | 25 Pa. Code §71.51(b) | Exemption criteria were not verified. | unconfirmed |

## 23. Contractor registration (HICPA)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Registration | Home Improvement Consumer Protection Act, Act 132 of 2008, 73 P.S. §517.1 et seq. | Contractors doing **$5,000 or more** of home improvement work per year must register with the PA Attorney General. The fee is $100 every 2 years. The registration number must appear on contracts and ads. | confirmed (AG site) |
| New-home construction | 73 P.S. §517.2 (definition of "home improvement") | Whether building a new home counts as "home improvement" was not verified. | unconfirmed |

## 24. Right-of-way permits (DOMI)

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Street opening | Title 4, §415.01 | Any excavation in a street, sidewalk or public place needs a permit and bond. | confirmed |
| Sidewalk, curb, driveway (curb cut) | §413.02 | Building, rebuilding, repairing, cutting, altering or grading any sidewalk, curb or driveway in the right-of-way needs a DOMI permit. The DOMI curb cut info sheet gives a **6-month** permit period. Zoning curb-cut rules for single-unit attached homes are in §914.09.J. | confirmed (6-month period partial) |
| Street pavement | §413.01 | Paving any public street or way needs a bond and DOMI permit. | confirmed |
| Obstructions | §416.01 | Any right-of-way obstruction (temporary traffic obstruction, minor encroachment, encroachment, outdoor dining) needs a permit first. Obstructions of **17 days or less** vs. **18 days or more** have separate rules (§416.05–.06). | confirmed |
| Encroachment | §416.10 | A permanent structure in the right-of-way needs DOMI approval **and a City Council resolution**. Minor encroachments are handled under §416.09. | confirmed |

## 25. Demolition

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Permit | PLI demolition permit; Building Code scope §1002.01 (UCC adoption) and IBC §101.2 as amended in §1002.02 | All full or partial demolitions need a PLI permit. Per PLI's page, an asbestos survey and ACHD/EPA notice are required **10 days** before demolition even if no asbestos is found, and a party-wall repair permit is separate. §1002.01 still names the 2003 ICC editions; the statewide UCC now adopts 2021 editions (34 Pa. Code §403.21). | partial |
| Historic properties | §1101.05(b) | Demolition permits for historic properties need HRC review. | confirmed |
| Demolition-only PDPs | §904.08 (UC-MU) | Project Development Plans filed for demolition without new construction must include a future-use report meeting §922.10.E.2. | confirmed |
| Utility disconnects and bonds | PLI program requirements | Not verified. | unconfirmed |

## 26. PA One Call

| Requirement | Citation | Threshold | Confidence |
|---|---|---|---|
| Excavator notice | Underground Utility Line Protection Law, Act 287 of 1974 as amended (incl. Act 50 of 2017), 73 P.S. §176 et seq. | Notify at least **3** and no more than **10 business days** before excavation or demolition. | confirmed (PA One Call materials) |
| Design notice | Same act | Designers notify **10 to 90 business days** before final design. | confirmed (PA One Call materials) |

## 27. "Red beds" landslide geology

- **City Code:** the loaded chapters (Titles 1, 4, 9, 10, 11 and 13) contain no mention of "red beds". Landslide control in the City is through the LS-O (§906.04), SS-O (§906.08) and H (§905.02; §911.04.A.69) provisions.
- **County:** the Allegheny County Landslide Portal (ArcGIS open data) maps landslide-prone areas. Its own text on the Pittsburgh Red Beds was not reviewed.
- **Other sources:** press sources (WPXI; PublicSource) and USGS 1974 open-file reports describe the Pittsburgh Red Beds as clay-rich rock that is prone to landslides. These are not regulatory sources.

## Other items found during review

- **Site Plan Review** (§922.04.A) is required for:
  - new or enlarged multi-unit buildings with **4 or more units**;
  - construction on lots of **2,400 sf** or more in NDO, LNC, NDI, UNC and P;
  - lots of **8,000 sf** or more in HC, UI and GI;
  - parking lots with more than **10 spaces** or **2,500 sf** in the listed districts;
  - all construction in H.
- **Residential Compatibility** (Ch. 916) adds height and setback limits for High and Very-High density and non-residential development near residential and H districts. The limits were not tabulated.
- **Current residential minimum lot sizes** under §903.03: 6,000 / 3,000 / 2,400 / 1,200 sf for VL / L / M / H, with none listed for VH. There is no per-unit lot area. The section history cites Ord. 10-2025.

---

## Could not confirm

1. Whether current PA L&I guidance requires sprinklers in new IRC **townhouses**. The 2021 IRC §R313.1 is adopted with no exclusion found, and Act 1 of 2011 covers only one- and two-family dwellings; this was not confirmed with L&I.
2. PA UCC accessibility unit-count thresholds for Group R-2 (IBC Ch. 11 as adopted).
3. The exact text of FHA 42 U.S.C. §3604(f) and 24 CFR §100.205, the RRP rule 40 CFR 745 Subpart E, and 40 CFR 61 Subpart M. All are standard cites that were not re-read.
4. ACHD Article XXI §2105.62 subsection letters (b, f.1, h). These came from ACHD enforcement documents, not the regulation text.
5. Act 537 planning-module exemption criteria (25 Pa. Code §71.51(b)) and PWSA's own stormwater and sewer thresholds.
6. The Allegheny County Conservation District's delegation scope, and the exact subparagraph for the 5,000 sf E&S plan trigger in §102.4.
7. Whether HICPA covers new-home construction.
8. PLI demolition utility-termination and bond requirements. The Building Code chapter (§1002.01) still names 2003 ICC editions, and it is unclear how the City applies the current UCC edition.
9. Whether IRC R105.2 permit exemptions (e.g. retaining walls 4 ft or less) apply as adopted in Pittsburgh.
10. MPC section numbers for variance, special exception and conditional use (53 P.S. §10910.2, §10912.1, §10913.2).
11. Mapped boundaries: the IZ-O, Downtown Parking Exempt Area, UC-MU/UC-E/R-MU/RIV height maps and SS-O/LS-O/UM-O overlays were not reviewed. The CSV leaves height blank where it comes from a map.
12. Residential permissions and dimensional rules for each SP district subdistrict (SP-4, SP-5, SP-8, SP-9, SP-10), and whether SP-1 multi-unit is by right.
13. Any City or County guidance document that uses the term "red beds".
14. The GPR-C per-unit lot area for single-unit detached, two- and three-unit. The code text says 300 sf, which is likely a drafting error for 3,000 sf.
15. Which figure controls UC-E parking: the §914.04 100% reduction or the §922.15.A.1 50% minimum.
16. Mount Oliver Borough (MTOBOR) zoning. It is a separate municipality and was not reviewed.
