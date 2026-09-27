# EaseScore.AI — status

_Plain-language build log. Newest first._

## Now
- Loading Allegheny County data into the database (assessments → parcel boundaries → zoning → hazards → sales).

## Done
- Credibility pass on the parcel page: the Ease Score is now v0.2. A lot that is at least half landslide-prone or 40% steeper than 25% scores no better than Moderate and says why; any layout that needs a variance tops out at 90 on zoning; variance odds use the district's record (5+ cases), else the citywide record with its case count and years, else a labeled default. One layout per option ("SelectedScheme") now feeds the score, the pro forma, the summary, QuickFit's "Priced layout" card and the 3D massing, and the page opens on the summary's featured by-right option. The pro forma shows every line and total as a range (low–high, likely), with a source badge per line (amber = our assumption, edit it), a small strip comparing sources (Pittsburgh builders, NAHB national, local projects), and the year of the land, value and rent data.
- Parcel page speed: the pane now reads one precomputed row per parcel (address, parcel ID with a copy button, then neighborhood and zoning at the top) and shows in under half a second on a production build, where it used to wait 4 to 16 seconds for every database call, the score and a county-wide sales download. The map and 3D view load alongside without holding up the pane. Parcels without a stored row are still computed live. Server step times are logged, and /api/pane/<parcel ID> reports them as a Server-Timing header.
- The photoreal 3D view works in production builds again (a Cesium module broke the minified bundle; dev mode was fine).
- Feasibility Study PDF: Figure "site plan" is now sheet EA-101, a true-scale engineering-style drawing on its own landscape page (standard scale 1" = 10' to 40', enlarged and noted when a lot is too big): lot lines with dimensions, zoning setbacks, buildable area, the studied footprint with party walls and an estimated floor elevation, neighboring buildings, curb/walk/right-of-way at typical widths (labeled as an assumption), 2-foot lidar contours, 25%+ slope hatch, hazard limits as lines, numbered keynotes, legend, north arrow and title block. When nothing fits, the sheet still draws and a keynote says why. The whole report was also reworked for printing: white pages, outlined callouts, gray charts with one accent color, fewer half-empty pages.
- "Does it pencil?" is live on the parcel page and in the Feasibility Study PDF. Cost defaults live in one versioned file (cost assumptions v0.1): five construction tiers from published Pittsburgh builder ranges (Good, $250 per sq ft, by default), hillside adders that fire from the lidar slope with a plain reason, the mine grouting or insurance path, soft costs, contingency (flat, hillside or rehab) and loan terms from the prime rate. Every value shows its source label and can be edited on the page. Items that apply but have no local cost yet (demolition, geotechnical report, dumpsters) are listed as "Not included" and the estimate is marked partial, never counted as zero. The page shows the budget, the sale value or rent, profit or yield on cost, the math as sentences, and a check against recent Allegheny County projects; the PDF fills sections 7 to 11 and Appendix C from the same code.
- Parcel page shows the Ease Score v0.1: score and band per housing option (best by default, switchable), red flags banner, the four plain-English answers, amber "Review required" items with citations and costs, factor bars with data receipts, months to a permit, the planning badge, and "What would unlock it".
- Water service: every parcel tagged with its public water system from PA DEP service-area maps (577,131 inside a service area, 4,866 clearly outside, 3,354 near a boundary). Sewer service marked unknown: no public sewer service-area map exists for the county.
- Permit timing: City review targets (business days) and the current PLI review queue loaded; one lookup gives target, queue size, and queue age by permit type.
- Zoning decisions: 227 ZBA cases (364 requests, outcomes by relief type) and 74 City Council conditional uses, tied to parcels; collected politely under robots.txt.
- Transit access loaded: 6,388 stops with weekday peak frequency; distance to nearest frequent stop for every parcel.
- Slope computed for every parcel from USGS elevation data (10 m).
- Requirements engine: 57-item checklist with plain-language reasons; 15 tests passing.
- Census neighborhood context loaded: 394 tracts (2024 ACS income, rent, rent burden, vacancy); every parcel tagged.
- Pittsburgh overlays (historic districts, inclusionary housing, height, parking, riverfront, RCO areas), PLI permits, and condemned properties loaded.
- School districts (45) and Pittsburgh Public Schools attendance zones (51) loaded; every parcel tagged.
- Parcel boundaries loaded: 585,351 parcel shapes, matched to assessments by parcel ID.
- Valid property sales loaded: 99,176 arm's-length sales, 2012–2026.
- Property assessments loaded: 584,999 parcels, personal data removed.
- Pittsburgh zoning and hazard layers loaded (FEMA flood zones countywide).
- Project accounts set up (GitHub, Vercel, Supabase, data APIs). All keys stay out of the repo.
- Safety checks on every commit: secrets scan, private-file check, personal-data check.
- Database: PostGIS available, Row Level Security switched on automatically for every new table.

## Blocked
- Nothing.

## Next
- Development Ease Score engine, then the single-parcel view.
