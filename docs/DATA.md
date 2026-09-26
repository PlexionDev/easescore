# EaseScore.AI — data inventory

Every table the app reads, where it came from, and what was removed. Join key everywhere: `parid`, the 16-character Allegheny County parcel ID (e.g. `0001C00123000000`). Loaded by `scripts/ingest.py`; raw downloads live in `data/raw/` (not committed).

| Table | Source | Coverage | Rows loaded | Notes |
|---|---|---|---|---|
| `assessments` | Allegheny County Property Assessments (WPRDC) | All of Allegheny County | 584,999 | One row per parcel, as of 2026-09-01. 175 municipality codes (Pittsburgh wards count separately), 46 school-district codes. Missing: lot area 3.8%, year built 23% (mostly vacant land/non-residential). 73,535 parcels coded vacant. |
| `parcels` | Allegheny County Parcel Boundaries (WPRDC / PASDA) | All of Allegheny County | 585,351 | Converted from PA State Plane South (ft) to WGS84; multi-piece parcels merged; all shapes valid. Join check: 865 assessed parcels have no shape (0.15%); 1,217 shapes have no assessment (mostly rights-of-way). |
| `sales_valid` | Allegheny County Property Sale Transactions (WPRDC) | All of Allegheny County, 2012–2026 | 99,176 | Only SALECODE `0` (valid arm's-length) kept — about 20% of 503,747 recorded transfers. 85,983 parcels; median $207,500. 12 sales priced $1 or less slipped through the county's own validity code — the engine ignores prices under $1,000. |
| `school_districts` | Allegheny County School District Boundaries (WPRDC, county GIS) | All of Allegheny County | 45 | Names differ in spelling from the assessment file (e.g. "Mt. Lebanon" vs "Mt Lebanon"); compared after normalizing. |
| `pps_attendance_zones` | Pittsburgh Public Schools Feeder Pattern Attendance Boundaries (WPRDC) | City of Pittsburgh only | 51 (28 elementary, 17 middle, 6 high) | **Adopted for the 2012–13 school year.** Always shown with "verify with the district". Charter, magnet, and special-education placements work differently. |
| `parcel_schools` | Computed: parcel point-on-surface in district / PPS zone | All parcels | 585,351 | District from the map agrees with the assessment for 583,034 parcels (99.8%). 1,026 disagree — 834 of those sit within 150 m of a district line. Largest real disagreement: 232 parcels mapped to Keystone Oaks but assessed as Bethel Park. 59,048 parcels are within 150 m of a district line (flag: confirm with the district). 20 parcels are assessed to Norwin SD (Westmoreland County), which the county map doesn't cover. 76 parcels fall outside every district polygon. |
| `zoning` | City of Pittsburgh — Zoning Districts (PGHWebZoning) | City of Pittsburgh only | 1,068 | 57 zone codes; ~59 sq mi. 1 source feature had no geometry. |
| `overlays` · `flood_fema_nfhl` | FEMA National Flood Hazard Layer, DFIRM 42003C | All of Allegheny County | 7,793 | Zones AE (4,285), A (182) = 1%-annual-chance floodplain; X (3,326) includes 0.2% and minimal-risk areas — use `attrs.subtype` to tell them apart. |
| `overlays` · `landslide_prone_pgh` | City of Pittsburgh — Landslide Prone Areas | City only | 37 | ~11.5 sq mi. Outside the city: unknown, not "no risk". |
| `overlays` · `undermined_pgh` | City of Pittsburgh — Undermined Areas | City only | 47 | ~15.2 sq mi. Outside the city: unknown. |
| `overlays` · `greenway_pgh` | City of Pittsburgh — Greenways | City only | 10 | ~0.4 sq mi. Looks low; source last substantively updated ~2018. |
| `overlays` · Pittsburgh zoning overlays | City of Pittsburgh GIS: CHD Historic Districts (21), Zoning Overlays (139), Inclusionary Housing Overlay (1), Riverfront (5), Uptown IPOD (1), Parking Reduction (9), Height Reduction (4) | City only | 180 | The general overlay layer combines Registered Community Organization (RCO) areas, inclusionary-housing, height caps, parking reductions, and riparian buffers in one label per area. |
| `permits` | City of Pittsburgh PLI Permits (WPRDC, CC-BY) | City only, 2019-06 → 2026-09 | 65,378 | 3,439 new construction; 1,300 demolition permits. Owner, contractor, and free-text description fields are never loaded. |
| `condemned` | City of Pittsburgh Condemned / Dead-End Properties (WPRDC, CC-BY) | City only | 2,895 | Source has 3,569 rows; duplicates collapsed to one per record number. Owner field never loaded. |
| `tracts` / `parcel_tract` | U.S. Census Bureau ACS 5-year 2024 (B19013, B25064, B25070, B25002, B01003) + 2024 cartographic tract boundaries | All of Allegheny County | 394 tracts; 585,351 parcels tagged | 14 tracts have no income estimate (13 no rent) — mostly zero-population 9800-series tracts plus one suppressed estimate. 75 parcels fall outside every tract polygon. |

## Personal data removed at ingest
- Assessments: owner mailing-address fields, legal descriptions, deed book/page, prior-sale history. The county does not publish owner names.
- Map layers: GIS editor user names (`created_user`, `last_edited_user`) are never loaded.
- Permits and condemned properties: owner, contractor, and description fields are never read.
- Sales: the county file has no buyer/seller names; deed book/page is not kept.
