# Known issues and data gaps

- **Zoning covers the City of Pittsburgh only.** Allegheny County has ~130 municipalities that each set their own zoning, and no county-wide zoning layer exists. Parcels outside the city are flagged "zoning not available — needs review."
- **Landslide-prone and undermined-area layers cover the City of Pittsburgh only.** Outside the city these hazards are unknown, not absent.
- **City FEMA flood layer is a 2014 extract.** Countywide current flood zones come from FEMA's National Flood Hazard Layer instead.
- **Greenways data is old** (last substantive update around 2018).
- **Pittsburgh Public Schools attendance zones date from 2012–13.** Shown as a guide with "verify with the district"; charter, magnet, and special-education placements differ.
- **School district map vs. county assessment disagree for 1,026 parcels (0.18%)**, mostly within 150 m of a district line. The app shows both and asks the user to confirm with the district.
- **Sewer service is unknown for every parcel.** No public sewer service-area map exists for Allegheny County (WPRDC, PASDA, PA DEP, and county GIS searched). Sewersheds are drainage basins, not service areas, so they are not used. The app says "unknown — confirm with the municipality," never "served."
- **Water service-area maps are approximate, and many boundaries date from 2003.** "Outside" (4,866 parcels, mostly Marshall, Findlay, West Deer, Kilbuck, Collier) can also mean the map is out of date: Ben Avon Heights and Pennsbury Village show as outside although they are built-out suburbs. Parcels within 100 m of a boundary are marked unknown. The PA DEP license says "not for commercial use or resale."
- **Real permit processing times cannot be measured yet.** No public City dataset gives the date a permit application was filed (the WPRDC permits file has only the issue date). The app uses the City's published review targets and the current review queue instead, and says so.
- **The review-queue spreadsheet shows only permits waiting on the City**, and its "submitted" date resets on each resubmission, so queue ages look short (median 3–5 days). It does not show time spent waiting on applicants.
- **Months to a permit uses the City's review target for the building-permit part.** Measured permit times are not available, so the page uses the published target for one review round (labeled "City target, not measured"); revisions, zoning hearings and other reviews add time. Outside the City it falls back to a labeled 3-month estimate.
- **Construction costs are published ranges, not bids.** The pro forma uses published Pittsburgh builder ranges and labeled estimates. Demolition, geotechnical reports and dumpsters/street permits have no local cost yet; where they apply the estimate says "Not included" and is marked partial.
- **Vacant lots have no finished-home value until a database update is applied.** Pricing a new home on a vacant lot needs single-family sales comps; the comps function gains that option in migration 083, which is written but not yet applied. Until then those lots show "Can't tell yet" with the cost only.
- **Slope adders use slope across the whole lot**, not under the building footprint (the per-footprint slope is not computed yet).
- **Rental answers stop at yield on cost.** There is no local market cap rate, discount rate or hold period, so rental verdicts, stabilized value, IRR and the rental funding gap say what they still need.
- **Rehab costs use the new-build tier as a stand-in** on the existing living area.
