# EaseScore.AI — sources, tools, and disclosures

Every AI tool, dataset, API, library, service, and asset this project uses. Maintained throughout the build (contest rule: disclose every AI tool; cite every dataset, API, and library). Datasets below were verified against their landing pages on 2026-09-26.

## Needs citation
- **City of Pittsburgh GIS layers** (Zoning, Landslide Prone Areas, Undermined Areas, Greenways) — pulled directly from the city's ArcGIS `PGHWeb*` FeatureServer endpoints (see Datasets below), not through a WPRDC dataset page. WPRDC's site-wide policy commits providers to CC0/ODC-PDDL, but no per-layer license statement was found on the ArcGIS Hub pages themselves. Treat as "CC0 by WPRDC/City of Pittsburgh policy, not independently confirmed per layer" until someone checks each ArcGIS Hub "About" tab directly.

## AI tools (development)
| Tool | Version / model | Used for |
|---|---|---|
| Claude Code (Anthropic) | Claude Opus 5.5 (`claude-opus-5-5`), Claude Sonnet 5 (`claude-sonnet-5`) | Pair-programming, planning, code generation, review agents, and this sources ledger |
| oh-my-claudecode | Claude Code plugin | Multi-agent orchestration inside Claude Code |

## AI in the product
_None yet._ (Rule: the LLM only explains; it never produces a number.)

## Datasets
| Dataset | Publisher | License | URL | Accessed | Fields used / notes |
|---|---|---|---|---|---|
| Allegheny County Property Assessments | Allegheny County Office of Property Assessments, via WPRDC | CC0 (Public Domain) | https://data.wprdc.org/dataset/property-assessments | 2026-09-26 | Loaded by `scripts/ingest.py:assessments`. Owner mailing address, legal description, deed book/page, and prior-sale history dropped before upload — the county does not publish owner names (excluded under County Ordinance 3478-07). See `docs/DATA.md` for row counts and gaps. |
| Allegheny County Parcel Boundaries | Allegheny County, via WPRDC / PASDA | CC0 (Public Domain) | https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1 (mirror/authoritative: https://www.pasda.psu.edu/uci/DataSummary.aspx?dataset=1214) | 2026-09-26 | Loaded by `scripts/ingest.py:parcels`. Source WKT reprojected from PA State Plane South (EPSG:2272) to WGS84 (EPSG:4326); multi-piece parcels merged; GIS editor username fields (`created_user`, `last_edited_user`) never loaded. |
| Allegheny County Property Sale Transactions | Allegheny County, via WPRDC | CC0 (Public Domain) | https://data.wprdc.org/dataset/real-estate-sales | 2026-09-26 | Loaded by `scripts/ingest.py:sales`. Only `SALECODE = 0` (valid arm's-length) rows kept. No buyer/seller names in the source file; deed book/page not retained. |
| Allegheny County School District Boundaries | Allegheny County, via WPRDC | CC0 (Public Domain) | https://data.wprdc.org/dataset/allegheny-county-school-district-boundaries | 2026-09-26 | Loaded by `scripts/ingest.py:schools`. Names normalized to match assessment file spelling differences (e.g. "Mt. Lebanon" vs "Mt Lebanon"). |
| Pittsburgh Public Schools Feeder Pattern Attendance Boundaries | Pittsburgh Public Schools, via WPRDC | CC0 (Public Domain) | https://data.wprdc.org/dataset/pittsburgh-public-schools-feeder-pattern-attendance-boundaries | 2026-09-26 | Loaded by `scripts/ingest.py:schools` (elementary/middle/high shapefiles). Adopted for the 2012–13 school year — shown in-app with "verify with the district." Reprojected from EPSG:2272. |
| City of Pittsburgh Zoning Districts | City of Pittsburgh | See "Needs citation" above | Service used by code: `PGHWebZoning` FeatureServer, `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0`; landing page: https://pghgishub-pittsburghpa.opendata.arcgis.com/datasets/pittsburghpa::zoning/about | 2026-09-26 | Loaded by `scripts/ingest.py:zoning`. Only planning attributes (`zon_new`, `full_zoning_type`, `legendtype`, `municode`) kept; GIS editor usernames dropped. City of Pittsburgh only — no county-wide zoning layer exists. |
| City of Pittsburgh Landslide Prone Areas | City of Pittsburgh | See "Needs citation" above | Service used by code: `PGHWebLandslideProne` FeatureServer, `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebLandslideProne/FeatureServer/0`; landing page: https://pghgishub-pittsburghpa.opendata.arcgis.com/maps/pittsburghpa::landslide-prone-areas | 2026-09-26 | Loaded by `scripts/ingest.py:overlays`. City of Pittsburgh only; outside the city the risk is unknown, not absent. |
| City of Pittsburgh Undermined Areas | City of Pittsburgh | See "Needs citation" above | Service used by code: `PGHWebUndermined` FeatureServer, `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebUndermined/FeatureServer/0` | 2026-09-26 | Loaded by `scripts/ingest.py:overlays`. City of Pittsburgh only. |
| City of Pittsburgh Greenways | City of Pittsburgh | See "Needs citation" above | Service used by code: `PGHWebGreenways` FeatureServer, `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebGreenways/FeatureServer/0`; landing page: https://data.wprdc.org/dataset/greenways | 2026-09-26 | Loaded by `scripts/ingest.py:overlays`. City of Pittsburgh only; source last substantively updated ~2018. |
| FEMA National Flood Hazard Layer (NFHL), DFIRM 42003C | Federal Emergency Management Agency | U.S. Government work — public domain | Service used by code: `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28`; landing page: https://www.fema.gov/flood-maps/national-flood-hazard-layer | 2026-09-26 | Loaded by `scripts/ingest.py:overlays`. Filtered to `DFIRM_ID LIKE '42003%'` (Allegheny County). Zones AE/A = 1%-annual-chance floodplain; Zone X includes 0.2%-annual-chance and minimal-risk areas (`attrs.subtype` distinguishes them). |
| PA DEP Public Water Supplier Service Areas | Pennsylvania Department of Environmental Protection (also mirrored by WPRDC as "Public Water Supplier Service Areas", `pa-public-water-systems`) | **"Not for commercial use or resale"** (PA DEP terms; WPRDC lists it as Creative Commons Non-Commercial). Used here for a non-commercial hackathon build; raw data is not redistributed in the repo. Revisit before any commercial use. | Service used by code: `https://gis.dep.pa.gov/depgisprd/rest/services/emappa/eMapPA_External/MapServer/302`; landing: https://newdata-padep-1.opendata.arcgis.com/datasets/fdf53cdeb2ec42b8a9422569f2e9531b_302 ; mirror: https://data.wprdc.org/dataset/pa-public-water-systems | 2026-09-26 | Loaded by `scripts/ingest_utilities.py`. Fields: PWS_ID, NAME, OWNERSHIP, GW/SW source, interconnect, LAST_DATE (boundary edits 2003–2024). Clipped to Allegheny County. Boundaries approximate per DEP. WPRDC's "Providers by parcel" CSV (2025-09-23, same license) used only as a cross-check, not loaded. |
| City of Pittsburgh PLI — Permit Application Review SLAs | City of Pittsburgh, Dept. of Permits, Licenses, and Inspections | Public government web page (no open-data license stated; facts cited with link) | https://www.pittsburghpa.gov/Business-Development/Permits-Licenses-and-Inspections/Permits/Permit-Process/Permit-Application-Review | 2026-09-26 (page last updated 2025-11-21) | Loaded by `scripts/ingest_permit_times.py targets` into `permit_targets`. Script re-reads the page and stops if the SLA wording changes. |
| City of Pittsburgh PLI/DCP — List of Permits Pending Review | City of Pittsburgh, PLI and Dept. of City Planning | Public government file linked from pittsburghpa.gov (no open-data license stated) | https://pittsburghpa.gov/files/assets/city/v/31/pli/documents/plidcp_pending_permits_20250519.xlsx (file replaced in place; "Date Created" inside = 2026-09-21) | 2026-09-26 | Loaded by `scripts/ingest_permit_times.py queue` into `permit_queue` as aggregate counts/ages only. Addresses and work descriptions not stored. The older link `apps.pittsburghpa.gov/bbi/Permits_Pending_Review.pdf` did not respond (connection timeout) and was not used. |
| City of Pittsburgh PLI Permits | City of Pittsburgh, via WPRDC | CC-BY | https://data.wprdc.org/dataset/pli-permits | 2026-09-26 | Checked for an application-date column (none: `issue_date` only), so permit application-to-issue times are not computed. Also checked: OneStopPGH Insights map layer (`pghbridgis.pittsburghpa.gov/.../OSPI_H/FeatureServer/0`, linked from pittsburghpa.gov) — `submitted_date`/`create_date` blank for PLI permit types; not loaded. |

See `docs/DATA.md` for the full table-by-table row counts, coverage notes, and known join discrepancies.

## APIs and services
| Service | Purpose | Notes |
|---|---|---|
| GitHub | Source hosting | Public repo at submission |
| Vercel | Web hosting and deploys | |
| Supabase | Postgres database (PostGIS 3.3 extension; Row Level Security on) | Browser uses publishable key only; server-only writes use the secret key (env var `SUPABASE_SECRET_KEY`, never committed) |
| Anthropic API | Plain-language explanations | Server-only; model TBD. Env var: `ANTHROPIC_API_KEY` |
| Census ACS API | — | Configured, not yet used in app code. Env var: `CENSUS_API_KEY` |
| HUD User Fair Market Rents (FMR) API | — | Configured, not yet used in app code. Env var: `HUD_API_TOKEN` |
| FRED (Federal Reserve Economic Data) API | — | Configured, not yet used in app code. Env var: `FRED_API_KEY` |
| RentCast API | — | Configured, not yet used in app code. Env var: `RENTCAST_API_KEY`. **Rule: RentCast API responses must never be stored in the repo** (see `PLANNING.md` §1). |

## Libraries and dev tools
| Name | Version | License | Used for |
|---|---|---|---|
| openpyxl | >=3.1 | MIT | Reads the City's pending-permits spreadsheet in `scripts/ingest_permit_times.py` |
| DuckDB | >=1.1 (`spatial` extension loaded) | MIT | In-process SQL transforms of raw downloads in `scripts/ingest.py` before upload (CSV/TSV/shapefile/GeoJSON reads, geometry reprojection and validity fixes via the spatial extension) |
| httpx | >=0.27 | BSD-3-Clause | HTTP client in `scripts/ingest.py` — paginated ArcGIS layer fetches and batched upserts to the Supabase REST API |
| uv | (locally installed; version not pinned in-repo) | Apache-2.0 / MIT | Runs `scripts/ingest.py` as a PEP 723 single-file script, resolving `duckdb`/`httpx` on the fly (`uv run scripts/ingest.py <dataset>`) |
| PostGIS | 3.3 | GPLv2 | Spatial extension on the Supabase Postgres project — geometry columns, `ST_MakeValid`, `ST_Intersects`, `ST_DWithin`, etc. used in `supabase/migrations/*.sql` for parcel/zoning/hazard/school tagging |
| gitleaks | 8.30.1 | MIT | Secrets scan in the pre-commit check and full-history scan |

## Assets
_None yet._

## Assumptions
_None yet._
