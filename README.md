# EaseScore.AI

EaseScore.AI shows what it takes to build housing on any lot in Allegheny County, Pennsylvania. Enter an address or parcel ID and it returns a Development Ease Score (0 to 100), the problems that could stop or slow a project, what the zoning allows, a rough budget with a "does it pencil?" answer, and a downloadable feasibility study. Every number traces to a public record or to a labeled, editable assumption. It is decision support, not legal, financial, zoning or engineering advice.

Built for the AI for Housing Hackathon 2026, Track 1 (Allegheny County parcels). Live site: [easescore.ai](https://easescore.ai).

## Who it is for

| User | What they do here |
|---|---|
| Municipal planner | Filter and rank City parcels by score and top blocker, compare a shortlist side by side, see blockers linked to a Policy scenario, export a CSV or a staff memo PDF (`/planner`). |
| Small or mid-size developer | Check one lot: score, what fits, whether it pencils, an instant 3D massing with hillside stepping, and the full Feasibility Study PDF (`/check`, `/parcel/<id>`). |
| Housing nonprofit or CDC | Start from a neighborhood's need (HUD income limits and the 30% rule), pick public sites, and size one project's funding gap and capital stack; export an advocacy brief PDF (`/nonprofit`). |
| Policy analyst | Turn zoning levers (attached homes on narrow lots, minimum lot size, parking minimums, a tax abatement) on and see homes gained, whether they pencil, and the fiscal impact by taxing body; export a council packet PDF (`/policy`). |

## Key features

- **Ease Score with red flags, review callouts and evidence.** Seven weighted factors (zoning, terrain, geohazards, access, approvals, lot readiness, market activity) scored per housing option: single-family, duplex, 3–4 units, townhouse row, ADU, and rehab of the existing building.
  - **Red flags** (floodway, no street access, active cleanup site on the lot) sit above the score and never change it.
  - **"Review required" callouts** (landslide-prone, undermined, historic district and others) name the code sections and the next step.
  - **Evidence and ranges.** A factor with no data is marked missing and left out of the average. The result then shows a range and, below 60% evidence, the label "Preliminary."
- **Plain-English answers.** Four answers (Can you build here? Does it pencil? What's in the way? What next?) and a two-sentence summary, built from the computed results. A validator rejects any sentence with a number that is not in the data.
- **"Pencils?" pro forma.** Budget from published Pittsburgh cost ranges plus hillside and mine adders, sale value from nearby new-construction sales (or after-repair value for a rehab), profit and margin, with the math written as sentences. Every assumption is editable on the page.
- **QuickFit v2 site planner ("QuickFit 3D").** Pick a building type (house, duplex, 3–4 units, townhouse row, backyard cottage), stories, width, depth, parking, the front lot line and setback what-ifs; the lot re-solves in a Web Worker (all five types in about 20–200 ms) and redraws as a three.js clay model on the lidar ground (level floors that step a full story on hills, driveways with curb cuts, garages, windows, parapets or gables, 2 ft contours, neighboring houses) or as a plan drawing. Each type says plainly whether it is allowed, needs approval (with past Zoning Board outcomes) or is not allowed, and which rule limits it. The same scheme drives the Ease Score fit, the pro forma, the report and its site plan. It has its own tab, "QuickFit 3D"; the default "3D (photoreal)" tab shows the real place in Google 3D with the lot outlined, and neighboring lots can be clicked to open them.
- **Feasibility Study PDF.** Site, zoning, process, market, costs, returns, risks and sources in one cited document, rendered serverless.
- **3D views.** Google Photorealistic 3D Tiles in CesiumJS, plus our own terrain and slope layers built from USGS 1-meter lidar, with lot lines drawn at lidar ground height. The lidar views work without a Google key.
- **Planner compare and rank.** Filter bar, synced map and ranked table, blocker summary linked to a Policy scenario, compare tray, CSV and staff memo PDF export.
- **Nonprofit need → sites → project.** Neighborhood affordability need from ACS and HUD CHAS, a shortlist of public sites, and one project's funding gap, capital stack (LIHTC, HOME, CDBG, PHARE, AHP, land write-down, tax abatement) and an advocacy brief PDF. Every source amount is labeled "typical, not an award."
- **Policy lever lab.** Turn zoning levers on one at a time or together, see the county-wide policy wave on the map, a for-sale pencil-test range, a fiscal ledger by taxing body (county, municipality, school district), and export a council packet PDF.

Details: [Data and methods](https://easescore.ai/methods) · [Limitations](https://easescore.ai/limitations) · [AI tools used](https://easescore.ai/ai-use)

## Architecture

```
web/        Next.js 16 App Router app (React 19). Pages, API routes, PDF rendering, maps.
engine/     @easescore/engine — TypeScript package: Ease Score, QuickFit lot-fit solver,
            requirements checklist, finance module, affordable-housing gap and capital-stack
            math, policy-lever rewriting and fiscal ledger, plain-English templates and
            validator. All weights and cost defaults live in engine/config/*.json.
supabase/   Postgres + PostGIS migrations (Row Level Security on for every table).
scripts/    Data pipeline: Python ingest scripts (run with uv), lidar slope and terrain,
            vector tiles, scripts/score_all.ts (planner scores), scripts/pane_all.ts
            (parcel page), and scripts/policy_batch.ts (policy lever states).
docs/       Data inventory, engine notes, code citations, geotech and hidden-cost research.
```

- **Map tiles.** Basemap, parcel and hazard layers, and slope classes are PMTiles files read through MapLibre GL, served from `web/public/tiles/` or a hosted bucket set by `NEXT_PUBLIC_TILES_BASE` (built by `scripts/vector_tiles.sh`; not committed). The lidar terrain tiles come from `scripts/terrain.py`.
- **3D views.** CesiumJS renders Google Photorealistic 3D Tiles and our own lidar terrain and slope layers, with lot lines drawn at lidar ground height so they sit on the real grade, not a flat plane.
- **Precomputed parcel results.** `scripts/score_all.ts` scores every parcel into `parcel_scores` for the Planner, `scripts/pane_all.ts` precomputes the Developer parcel pane, and `scripts/policy_batch.ts` precomputes Policy lever states into `policy_states` / `policy_results`, so those seats stay fast without scoring live on every request. A parcel without a precomputed row is still scored live.
- **QuickFit in a Web Worker.** The QuickFit v2 solver (`engine/src/quickfit2`, written during the event) runs off the main thread (`web/src/lib/qf2/worker.ts`); the server runs the same solve on the same inputs (`web/src/lib/qf2/core.ts`), so the page, the score and the report agree. The first QuickFit solver (`engine/src/quickfit`) is still used by the batch scorers and the policy simulator.
- **Deterministic engine.** Same parcel and same data give the same score and the same budget. No language model runs in the scoring or the financial math.
- **Serverless PDFs.** The Feasibility Study, staff memo, advocacy brief and council packet PDFs render with Puppeteer, using `@sparticuz/chromium` on Vercel and a local Chrome/Chromium install in development.
- **Server-only secrets.** Calls that need a secret key (Anthropic, Supabase secret key) run in server routes. The browser gets only the Supabase publishable key and the Google Map Tiles key.

## Data sources

Accessed 2026-09-26 unless noted. Full ledger with URLs and fields: [SOURCES.md](SOURCES.md). Row counts and gaps: [docs/DATA.md](docs/DATA.md).

| Dataset | Publisher | License | Vintage |
|---|---|---|---|
| Property Assessments | Allegheny County Office of Property Assessments, via WPRDC | CC0 | As of 2026-09-01 |
| Parcel Boundaries | Allegheny County, via WPRDC / PASDA | CC0 | 2026 download |
| Property Sale Transactions (valid sales only) | Allegheny County, via WPRDC | CC0 | 2012–2026 |
| School District Boundaries | Allegheny County, via WPRDC | CC0 | 2026 download |
| Pittsburgh Public Schools attendance boundaries | Pittsburgh Public Schools, via WPRDC | CC0 | Adopted 2012–13 |
| Zoning Districts, Landslide Prone Areas, Undermined Areas, Greenways, zoning overlays | City of Pittsburgh (ArcGIS) | CC0 by WPRDC/City policy; not confirmed per layer | Greenways ~2018; others current |
| PLI Permits; Condemned Properties | City of Pittsburgh, via WPRDC | CC-BY | Permits 2019-06 to 2026-09 |
| Permit review targets; permits pending review | City of Pittsburgh PLI / City Planning | Public government pages (no open-data license stated) | Targets page updated 2025-11-21; queue file 2026-09-21 |
| Zoning Board of Adjustment decisions; City Council conditional uses | City of Pittsburgh (decision PDFs; Legistar Web API) | Public records | ZBA 2025-02 to 2026-08; Council 2000–2026 |
| National Flood Hazard Layer (DFIRM 42003C); NFIP policy and claim aggregates | FEMA | U.S. Government work | 2026 download; NFIP snapshot 2026-08 |
| **Public Water Supplier Service Areas** | PA Department of Environmental Protection | **"Not for commercial use or resale."** Used for this non-commercial build; raw data not redistributed. Revisit before any commercial use. | Boundary edits 2003–2024 |
| Mined-out areas; Mine Subsidence Insurance risk map and rate chart; Land Recycling cleanup sites | PA DEP | Not yet recorded | Rate chart effective 2021-07-01 |
| Mine Map Atlas sheet index | PASDA | Not yet recorded | — |
| 3DEP 1 m lidar DEM (PA_WesternPA_2019) and 10 m DEM | USGS | U.S. Government work | 2019 lidar |
| Slope-movement inventory | Allegheny County (Pomeroy, 1982; USGS PP 1229 basis) | Not yet recorded | 1982 |
| Building footprints; addressing centerlines | Allegheny County GIS | Not yet recorded | 2026 download |
| Pavement centerlines; 311 flooding requests | City of Pittsburgh | Not yet recorded | 2026 download |
| Combined sewersheds | PWSA / 3 Rivers Wet Weather, via WPRDC | Not yet recorded | 2026 download |
| Static GTFS | Pittsburgh Regional Transit | Not yet recorded | Feed 2026-06-28 to 2026-10-14 |
| American Community Survey 5-year; tract and block group boundaries | U.S. Census Bureau | U.S. Government work | 2020–2024 |
| HUD CHAS (Comprehensive Housing Affordability Strategy) | U.S. Dept. of Housing and Urban Development, via HUD eGIS and the HUD User CHAS API | U.S. Government work | Tract data vintage 2016–2020; county and municipality data 2018–2022 |
| HUD LIHTC database | U.S. Dept. of Housing and Urban Development, via HUD eGIS | U.S. Government work | Projects placed in service through 2019 (HUD's newer national file is not accessible; see [KNOWN-ISSUES.md](KNOWN-ISSUES.md)) |
| HUD Income Limits; Fair Market Rents and Small Area Fair Market Rents (by ZIP); Qualified Census Tract / Difficult Development Area designations | U.S. Dept. of Housing and Urban Development | U.S. Government work | FY2026 |
| Ownership class (public agency, housing nonprofit, or private) | Derived: City-Owned Properties inventory, assessment class, and the owner's mailing address matched locally against verified public-agency and nonprofit office addresses | — | 2026 |
| Parcel geography (council district, tract, block group, municipality, school district) | Allegheny County, City of Pittsburgh and U.S. Census Bureau boundaries, joined to each parcel | — | 2026 |
| Property tax millage by taxing body (county, municipality, school district) | Allegheny County Treasurer | Public government record | 2025–2026 |
| National Hydrography Dataset; National Wetlands Inventory | USGS; U.S. Fish and Wildlife Service | U.S. Government work | 2026 download |
| ACRES brownfields | U.S. EPA | U.S. Government work | 2026 download |
| Bank Prime Loan Rate (DPRIME) | Federal Reserve, via FRED | See FRED terms | Latest at load |
| OpenStreetMap basemap (Protomaps build) | OpenStreetMap contributors, Protomaps | ODbL | 2026 build |
| **Photorealistic 3D Tiles** | Google Maps Platform (Map Tiles API) | **Google Maps Platform Terms of Service.** Tiles stream at view time with Google's attribution shown; they are not stored or redistributed. | Live |

Personal data is removed at ingest: no owner mailing addresses, deed references, or names from permits, condemnations or zoning decisions. Ownership class stores an agency name for a public agency only (e.g. Urban Redevelopment Authority, Housing Authority); nonprofit and private owners are never named. See [docs/DATA.md](docs/DATA.md#personal-data-removed-at-ingest).

## AI tools used

| Tool | Where | What it does |
|---|---|---|
| Claude Code (Anthropic; Claude Opus 5.5 and Claude Sonnet 5) | Building the project | Pair programming, planning, code generation, review passes, research notes. |
| oh-my-claudecode | Building the project | Multi-agent orchestration plugin for Claude Code. |
| ChatGPT (OpenAI) | Building the project | Homepage design and layout (HTML/CSS), later ported into the Next.js app. |
| ChatGPT image generation (OpenAI) | Homepage | Homepage images: AI-generated regional imagery, not photos of any lot and not copyrighted photography. |
| Claude API, model `claude-sonnet-5` | In the product | Rewords the plain-English answers and the two-sentence summary so they read naturally. |

How the in-product AI is fenced in:

1. The engine computes everything first: score, flags, budget, value, margin. It also writes a template sentence for every answer.
2. The server sends Claude only that computed JSON and the template sentences. The API key never reaches the browser.
3. A validator checks every sentence Claude returns. A sentence with a number that is not in the JSON is rejected. The summary check also rejects unknown zoning districts or code sections, banned words ("guaranteed", "risky" and others), and anything other than two sentences.
4. On rejection, error, or an 8-second timeout, the page uses the template sentence. With no API key set, the app runs on templates only.

No AI runs in the scoring, the lot-fit solver, the requirements checklist or the financial math.

## Run it locally

**Prerequisites**

- Node.js 20.9 or later (Next.js 16 requirement) and npm
- A Supabase project with PostGIS, with the migrations in `supabase/migrations/` applied and data loaded by the `scripts/ingest*.py` scripts (needs [uv](https://docs.astral.sh/uv/))
- Optional: map tiles in `web/public/tiles/` (`scripts/vector_tiles.sh` needs gdal, tippecanoe and pmtiles), Chrome or Chromium for the PDF, a Google Map Tiles key for the photoreal 3D view

**Environment variables** (names only; copy `.env.example` to `.env.local` in the repo root for the scripts and in `web/` for the app, then fill in values)

| Name | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Web app, scripts | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web app (browser-safe with RLS on) | Yes |
| `SUPABASE_SECRET_KEY` | Server-only writes | For data loading |
| `SUPABASE_ACCESS_TOKEN` | Pipeline scripts (Supabase SQL API) | For data loading |
| `ANTHROPIC_API_KEY` | `/api/narrative`, `/api/summary` (server only) | No: templates are used without it |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Photoreal 3D view (restrict it by HTTP referrer) | No: lidar views work without it |
| `NEXT_PUBLIC_TILES_BASE` | Map and terrain tiles, if served from a hosted bucket instead of `web/public/tiles/` | No: unset serves same-origin `/tiles` |
| `CHROME_PATH` | PDF rendering in development, if Chrome is not in a standard location | No |
| `FRED_API_KEY`, `CENSUS_API_KEY`, `HUD_API_TOKEN`, `RENTCAST_API_KEY` | Data scripts | For those loads |
| `RESEARCH_CONTACT` | User-Agent of the polite research collectors | For those loads |

Never commit `.env.local`. Never give a secret key the `NEXT_PUBLIC_` prefix.

**Start the web app** (from the repo root)

```bash
npm --prefix engine install
npm --prefix web install
npm --prefix web run dev -- --port 3100
```

Open http://localhost:3100, go to "Check a lot", and search by street address or 16-character parcel ID. Each parcel opens at `/parcel/<parcel ID>`.

**Run the engine tests**

```bash
cd engine && npx vitest run
```

**Type-check the web app**

```bash
cd web && npx tsc --noEmit -p .
```

## Limitations

Zoning covers the City of Pittsburgh only, sewer service is unknown everywhere, permit times are City targets rather than measured times, and costs are editable assumptions, not bids. The Nonprofit funding gap and the Policy pencil test are screening estimates, not an underwriting or a bond analysis, and Policy's capacity numbers are how many homes a rule change would allow, not how many would get built. The full list is on the [Limitations page](https://easescore.ai/limitations) and in [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## Roadmap

- **City permitting integration.** Pull application dates and review status from the City's permitting system so months-to-permit is measured, not a target.
- **Planner priority settings.** Let planning staff set the planning-badge weights and upload target areas as a named, dated profile.
- **Nonprofit: for-sale tenure and finer geography.** Model for-sale (not just rental) projects, and let a user draw a custom area or work at the block-group level instead of only the 90 City neighborhoods.
- **Rental verdicts.** A local market cap rate and hold period, so rentals get a yes/no answer and a stabilized value the way for-sale layouts do.
- **County-wide zoning.** Transcribe zoning for the other Allegheny County municipalities, starting with the largest, so the Planner, Nonprofit and Policy seats work outside the City.
- **RentEase.** A resident-facing rental search on the same parcel data.

## License

TODO (owner): choose a license for the code before the repo is published. Data keeps its publishers' licenses (see the table above); PA DEP water service areas and Google tiles carry use restrictions.

## Credits

Built by PlexionDev for the AI for Housing Hackathon 2026. Data from Allegheny County, the City of Pittsburgh, WPRDC, PASDA, PA DEP, FEMA, USGS, U.S. Census Bureau, U.S. Fish and Wildlife Service, U.S. EPA, Pittsburgh Regional Transit, PWSA, 3 Rivers Wet Weather and the Federal Reserve. Map data © OpenStreetMap contributors, Protomaps. 3D imagery © Google. Libraries include Next.js, React, CesiumJS, three.js, MapLibre GL, polygon-clipping, PMTiles, pdf-lib, Puppeteer, Turf, DuckDB, PostGIS and Vitest.

Not affiliated with Allegheny County or the City of Pittsburgh.
