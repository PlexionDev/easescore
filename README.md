# EaseScore.AI

EaseScore.AI shows what it takes to build housing on a lot in Allegheny County, Pennsylvania. Search an address or parcel ID and it returns a Development Ease Score (0 to 100) that measures the barriers to building, the problems that could stop or slow a project, what the zoning allows, a test fit of a building on the lot, a budget with a "does it pencil?" answer, and a downloadable feasibility study. It has four workspaces ("seats") — Municipal Planner, Developer, Nonprofit/CDC and Policy Analyst — plus a quick check on the homepage. Every number traces to a public record or to a labeled, editable assumption. It is decision support, not legal, financial, zoning or engineering advice.

Built for the AI for Housing Hackathon 2026, Track 1 (Allegheny County parcels). Live site: https://easescore.ai

Demo video: [link to be added]

Details on the site: [Data and methods](https://easescore.ai/methods) · [Limitations](https://easescore.ai/limitations) · [AI tools used](https://easescore.ai/ai-use) · [Accessibility](https://easescore.ai/accessibility)

## How it works

### Ease Score

- **What it measures.** Barriers to building, not whether the lot is a good investment. Every score says: "Measures barriers to building, not whether it's a good investment."
- **Seven weighted factors,** scored per housing option: zoning permission, terrain and buildable ground (USGS 1-meter lidar), geohazards, access and infrastructure, approval burden and time, lot and acquisition readiness, and recent sales and permit activity. Weights live in `engine/config/ease-score.v0.2.json`.
- **Bands:** Few barriers, Some barriers, Significant barriers, Major barriers.
- **Red flags** (floodway, no street access, active cleanup site on the lot) sit above the score and never change it. **"Review required" callouts** (landslide-prone, undermined, historic district and others) name the code section and the next step.
- **Missing evidence** is marked missing and left out of the average; the result then shows a range, and below 60% evidence it is labeled "Preliminary."
- **Partial.** No numeric score where zoning is not loaded (everywhere outside the City of Pittsburgh, and a few City parcels with no zoning district) or where the lot's building can't be verified (for example a condo unit or a building footprint over half the lot). The page shows the known facts only.

### QuickFit 3D (site test fit)

Pick a building type (house, duplex, 3–4 units, townhouse row, backyard cottage), stories, width, depth, parking, the front lot line and setback what-ifs. The lot re-solves in a Web Worker and redraws as a three.js clay model on the lidar ground, or as a plan drawing. Each type says whether it is allowed, needs approval (with past Zoning Board outcomes) or is not allowed, and which rule limits it. The same layout feeds the score, the pro forma and the report. A separate "3D (photoreal)" tab shows the real place in Google Photorealistic 3D Tiles with the lot outlined. QuickFit is a screening massing, not a design.

### Pro forma ("does it pencil?")

- **Cost model v0.2** (`engine/config/cost-assumptions.v0.2.json`): the cost to build per finished square foot with the builder's fee removed (published Pittsburgh builder ranges divided by about 1.20, the NAHB 2024 builder overhead and profit). Default tier: **Standard infill, $190/sq ft**. Other tiers: Basic $160, Mid-range $240, High-end $320, Custom $420.
- **Site and soft costs:** hillside adders from the lidar slope under the building, mine grouting or mine subsidence insurance on undermined lots, design, engineering, survey, geotechnical, insurance, permits (City: PLI 2026 fee schedule; elsewhere a flat $12,000 per house, labeled "confirm with the municipality"), contingency.
- **Financing:** construction loan at the latest bank prime rate in our data (Federal Reserve, FRED) plus 1.0 point.
- **Value:** nearby new-construction sales (at least 5, widening the search when there are too few).
- **Verdict** against a 15% target margin on cost (editable): **Pencils** at or above the target, **Thin margin** from zero up to the target, **Doesn't pencil** below zero. Rentals stop at yield on cost.
- Every line is a range (low–high, likely) with its source label, and every default is editable on the page. Items with no local cost yet are listed as "Not included," never counted as zero.

### Feasibility study PDF

Site, zoning, process, market, costs, returns, risks and sources in one cited document, with a true-scale screening site plan (not a survey). It uses the same numbers as the parcel page.

### The seats

| Seat | What it does |
|---|---|
| Homepage quick check | Search an address or parcel ID; each parcel opens at `/parcel/<parcel ID>`. |
| Municipal Planner (`/planner`) | Filter and rank City parcels by score and top blocker, compare a shortlist, export a CSV or a staff memo PDF. |
| Developer (`/developer`) | Work through lots: score, what fits, whether it pencils, QuickFit 3D and the Feasibility study PDF. |
| Nonprofit/CDC (`/nonprofit`) | Start from a neighborhood's need (HUD income limits, the 30% rule), pick public sites, size one project's funding gap and capital stack, export an advocacy brief PDF. Source amounts are labeled "typical, not an award." |
| Policy Analyst (`/policy`) | Turn zoning levers on and see homes a rule change would allow, a pencil-test range and the fiscal impact by taxing body; export a council packet PDF. |

### Where AI is and is not used in the product

AI never calculates scores, costs, values or returns. All numbers come from deterministic engine code (`engine/`): the same parcel and data give the same result. Claude (Anthropic, model `claude-sonnet-5`, set in `web/src/app/api/summary/route.ts` and `web/src/app/api/narrative/route.ts`) only rewords the plain-language answers and the two-sentence summary from the computed results:

1. The engine computes everything and writes a template sentence for every answer.
2. The server sends Claude only the computed JSON and the template sentences. The API key stays on the server.
3. A number validator (`engine/src/narrative/validate.ts`) checks every returned sentence: any number not in the computed data is rejected. The summary check also rejects unknown zoning districts or code sections, banned words ("guaranteed", "risky" and others), and anything other than two sentences.
4. On rejection, error or an 8-second timeout, the page shows the template sentence. With no API key set, the app runs on templates only.

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

PDFs render with Puppeteer (`@sparticuz/chromium` on Vercel). Calls that need a secret key run in server routes; the browser gets only the Supabase publishable key and the Google Maps key.

## Data sources

Full ledger with URLs, licenses, access dates and fields: [SOURCES.md](SOURCES.md). Row counts and gaps: [docs/DATA.md](docs/DATA.md). Most datasets were accessed 2026-09-26.

| Data | Where it came from |
|---|---|
| Property assessments, parcel boundaries, valid sales (2012–2026), school districts, building footprints | Allegheny County, via WPRDC and PASDA (CC0) |
| Zoning districts and overlays, landslide-prone and undermined areas, greenways | City of Pittsburgh ArcGIS services |
| PLI permits, condemned properties, City-owned properties | City of Pittsburgh, via WPRDC |
| Permit review targets and pending-review queue; PLI 2026 fee schedule | City of Pittsburgh PLI / City Planning web pages |
| Zoning Board of Adjustment decisions; City Council conditional uses | City of Pittsburgh decision PDFs and Legistar |
| 1-meter lidar (3DEP, 2019) and 10 m elevation | USGS |
| Flood zones (National Flood Hazard Layer) | FEMA |
| Mined-out areas, Mine Subsidence Insurance rate chart, cleanup sites, public water service areas | PA DEP; Mine Map Atlas index via PASDA |
| Fair Market Rents and Small Area FMRs by ZIP, Income Limits (FY2026), QCT/DDA, CHAS, LIHTC projects | HUD / HUD User |
| Median asking rent by bedroom count, by ZIP | RentCast market statistics API |
| Neighborhood income, rent, rent burden, vacancy | U.S. Census Bureau, ACS 5-year 2020–2024 |
| Construction cost ranges | Published Pittsburgh builder ranges; NAHB 2024 cost survey (builder overhead and profit) |
| Bank prime rate | Federal Reserve, via FRED |
| Tax millage by taxing body | Allegheny County Treasurer |
| Transit stops and frequency | Pittsburgh Regional Transit GTFS |
| Photoreal 3D and street photos | Google Photorealistic 3D Tiles and Street View Static API |
| Basemap | OpenStreetMap contributors (ODbL), via Protomaps |

**Terms respected**

- **RentCast:** called only when a parcel's ZIP is not cached; one call per ZIP, cached 30 days; hard database caps of 50 calls a day and 800 a month. Over the cap the site says so and falls back to HUD Small Area Fair Market Rent.
- **Google:** 3D Tiles stream at view time with Google's attribution and are not stored or redistributed. Street View photos show Google's attribution and are not cached.
- **PA DEP water service areas** are "not for commercial use or resale"; used here for a non-commercial project, raw data not redistributed.
- Research collectors followed robots.txt. HUD pages behind a bot challenge were not evaded; older HUD eGIS copies were used instead.

## Methods

Full rules: [easescore.ai/methods](https://easescore.ai/methods).

**Property tax model.** New assessed value = expected sale value × the county's assessment ratio for recent new-construction sales, minus the assessed value of anything the new home replaces. Tax = assessed value × the millage of each taxing body (county, municipality, school district). Inside the City, holding costs use the 2026 total of 27.307 mills: City 9.67 + parks 0.50 + library 0.25 + Pittsburgh Public Schools 10.457 + Allegheny County 6.43.

**Backtest.** We tested the cost model against 518 homes actually built and sold in Allegheny County since 2020. Three sales under $100 per square foot were set aside as likely non-market, leaving 515.

- The earlier model's cost estimates ran a median 53% above what those homes sold for.
- The current model is roughly break-even on single-lot infill: 96 homes, median margin −0.6%. Real builders earned a profit on those homes, so our estimates are likely conservative.
- Subdivision homes built by large production builders on pre-graded lots cost less to build than one-off infill: of 419 such homes, 78% show a loss under our costs. EaseScore is not calibrated for them.
- Run at a 7.75% construction loan rate; the current default is 8.0%.

## Limitations

The full list is in [KNOWN-ISSUES.md](KNOWN-ISSUES.md) and on the [Limitations page](https://easescore.ai/limitations). The main ones:

- **Zoning covers the City of Pittsburgh only.** Elsewhere the parcel is Partial (no Ease Score, no QuickFit); the pro forma prices a building you choose, labeled "Zoning not checked."
- **Lists use overnight scores; the parcel page is authoritative.** Planner and Developer lists read scores computed in one batch on 2026-09-27; the parcel page runs the newer site-fit solver, so the two can differ.
- **Small building types only:** single-family, duplex, 3–4 units, townhouse rows and backyard cottages. No mid-rise apartment buildings.
- **Costs are published ranges, not bids.** If you hire a builder, add their fee (often 15–25%).
- **Sale values can hinge on a handful of comps.** Two lots a block apart can draw different sale sets, which moves the margin a lot.
- **Rehab is not estimated automatically.** Enter your own budget; the inside condition of a building is unknown.
- **Landslide-prone and undermined-area layers cover the City only.** Outside the City those hazards are unknown, not absent. Mine maps are incomplete.
- **Permit times are City review targets,** not measured or guaranteed times.
- **Sewer service is unknown everywhere;** no public sewer service-area map exists for the county.
- Retired rail parcels are excluded as utility land; some may be buildable and would need individual review.

## Privacy

- **No private owner names** are stored or shown. Owner mailing addresses, deed references and names from permits, condemnations and zoning decisions are removed at ingest. An agency name is stored only for a public owner (for example the Urban Redevelopment Authority).
- **Tax-delinquency status and the planning badge are shown for publicly owned land only.** Database access to those fields is restricted (migrations `147_private_tax_status_access.sql` and `150_hide_private_badge.sql`), so a private owner's tax-lien status can't be read or inferred from the public API.
- **Scenario data is opt-in.** Nothing is sent unless the visitor chooses to share. The notice reads: "Scenarios you model help improve EaseScore's estimates. We keep the property and the numbers (like costs per square foot, rents and sale prices), never who entered them: no name, email, IP address or account." Requests omit cookies and the referrer.
- **No accounts.** Saved lists and preferences live in your browser only.

## Accessibility

- **Target:** WCAG 2.2 level AA (stated on the [Accessibility page](https://easescore.ai/accessibility)). No overlay widget.
- **Automated checks:** axe-core (WCAG 2.0, 2.1 and 2.2, A and AA) on the main pages — home, a parcel page, its report, Planner, Policy, Nonprofit, and the methods, limitations and AI pages.
- **Text alternatives:** "Describe this view" on the parcel page describes the map or 3D view in words from the same numbers; the Planner, Policy and Nonprofit maps have a Table view.
- **Keyboard:** the maps and the 3D view can be moved from the keyboard.
- **Not done:** no full screen-reader session by a disabled user, and the PDF has not been run through a PDF accessibility checker. Map dots can't be reached one by one with the keyboard (the tables list the same data). See [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## AI tools used

AI was used heavily to build this project. The same list is on [easescore.ai/ai-use](https://easescore.ai/ai-use).

| Tool | Where | What it did |
|---|---|---|
| Claude Code (Anthropic; Claude Opus 5.5 and Claude Sonnet 5) | Building the project | Anthropic's coding agent, including multi-agent workflows, wrote most of the code, tests, SQL migrations and docs, and ran QA and audit passes, under the team's direction. Also planning and research notes. |
| oh-my-claudecode | Building the project | Plugin that coordinates several Claude Code agents on separate tasks. |
| Claude Code (Anthropic) | Building the project | Drafted a Spanish translation of the interface and summary. It was removed before submission; the site is English only. |
| Claude API (Anthropic), model `claude-sonnet-5` | In the product | Rewords the plain-language answers and the two-sentence summary from computed results; checked by the number validator (see above). |
| ChatGPT (OpenAI) | Building the project | Homepage design and layout (HTML/CSS), later ported into the app. |
| ChatGPT image generation (OpenAI) | Homepage | Homepage images: AI-generated regional imagery, not photos of any lot and not copyrighted photography. |
| ChatGPT image generation (OpenAI) + Claude | Logo | Logo concept generated with ChatGPT, then redrawn as vector geometry by Claude. |
| OpenArt | Demo video | Video animations. |
| ElevenLabs | Demo video | Text-to-speech narration, read from the team's script. |

No AI runs in the scoring, the lot-fit solver, the requirements checklist or the financial math. The 3D views of a lot come from Google 3D Tiles and USGS lidar, not an image generator.

## Roadmap (not built)

None of the following exists in the submitted product.

- **Not built: zoning for other municipalities,** starting with Penn Hills, Mt. Lebanon, Bethel Park, Ross and Monroeville, so the score, QuickFit and the seats work outside the City.
- **Not built: user-entered municipal rules** (setbacks, height, lot size) to run QuickFit where zoning isn't loaded.
- **Not built: mid-rise building types.**
- **Not built: a month-by-month cash-flow pro forma** with IRR, equity multiple and peak equity.
- **Not built: an absorption study** (days on market, months of supply) from MLS listing data.
- **Not built: council-district and neighborhood boundaries** on the Planner map.
- **Not built: an inclusionary zoning / Affordable Housing Bonus lever** in the Policy seat.
- **Not built: money filters** (land price, margin, residual land value) in the Developer workspace.
- **Not built: a lot finder for tax-delinquent public land.**
- **Not built: measured permit times** from the City's permitting system.
- **Not built: rental verdicts** with a local cap rate and hold period.
- **Not built: an institutional-use classifier** (convention centers, campuses, stadiums and similar sites recorded without building value).
- **Not built: size-matched land pricing** (land comps matched to the lot's size and shape).

## Run it locally

**Prerequisites**

- Node.js 20.9 or later and npm
- A Supabase project with PostGIS, with the migrations in `supabase/migrations/` applied and data loaded by the `scripts/ingest*.py` scripts (needs [uv](https://docs.astral.sh/uv/))
- Optional: map tiles in `web/public/tiles/` (`scripts/vector_tiles.sh` needs gdal, tippecanoe and pmtiles), Chrome or Chromium for the PDF, a Google Map Tiles key for the photoreal 3D view

**Environment variables.** Copy `.env.example` to `.env.local` (repo root for the scripts, `web/` for the app) and fill in values. Never commit `.env.local`, and never give a secret key the `NEXT_PUBLIC_` prefix.

| Name | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web app, scripts | Yes |
| `SUPABASE_SECRET_KEY` | Server-only writes | For data loading |
| `SUPABASE_ACCESS_TOKEN` | Pipeline scripts | For data loading |
| `ANTHROPIC_API_KEY` | `/api/narrative`, `/api/summary` (server only) | No: templates are used without it |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Photoreal 3D view (restrict by HTTP referrer) | No: lidar views work without it |
| `NEXT_PUBLIC_TILES_BASE` | Hosted map tiles instead of `web/public/tiles/` | No |
| `RENTCAST_API_KEY` | `/api/rents` (server only) | No: falls back to HUD rents |
| `FRED_API_KEY`, `CENSUS_API_KEY`, `HUD_API_TOKEN` | Data scripts | For those loads |
| `RESEARCH_CONTACT` | User-Agent of the research collectors | For those loads |
| `CHROME_PATH` | PDF rendering in development | No |
| `POLICY_ALLOW_QUEUE`, `SCENARIO_COLLECTION` | Policy batch queue; scenario data loop | No |

**Start the web app** (from the repo root)

```bash
npm --prefix engine install
npm --prefix web install
npm --prefix web run dev -- --port 3100
```

Open http://localhost:3100 and search by street address or 16-character parcel ID on the homepage.

**Engine tests and type check**

```bash
cd engine && npx vitest run
cd web && npx tsc --noEmit -p .
```

## License

No open-source license has been chosen for the code yet, so all rights are reserved for now. Data keeps its publishers' licenses (see the table above); PA DEP water service areas and Google tiles carry use restrictions.

## Credits

Built by PlexionDev for the AI for Housing Hackathon 2026. Data from Allegheny County, the City of Pittsburgh, WPRDC, PASDA, PA DEP, FEMA, USGS, U.S. Census Bureau, U.S. Fish and Wildlife Service, U.S. EPA, Pittsburgh Regional Transit, PWSA, 3 Rivers Wet Weather and the Federal Reserve. Map data © OpenStreetMap contributors, Protomaps. 3D imagery © Google. Libraries include Next.js, React, CesiumJS, three.js, MapLibre GL, polygon-clipping, PMTiles, pdf-lib, Puppeteer, Turf, DuckDB, PostGIS and Vitest.

Not affiliated with Allegheny County or the City of Pittsburgh.
