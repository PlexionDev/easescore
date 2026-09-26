# EaseScore.AI — Development Ease Score engine (DRAFT v0.2 for review)

**Status: draft for Paul + housing SME review. Weights are proposals, not final.**

## Result structure (v0.2 — decided)
Shown top to bottom, always in this order:

1. **RED FLAGS** — deal-breakers, shown *above* the score and **never averaged into it**. A red flag doesn't lower the score; it stands on its own with its reason and source. Examples: parcel in the FEMA floodway; no legal street access (landlocked, steps-only, paper street); undermined with no mitigation path; historic-district demolition restriction; zoned for a use that forbids housing.
2. **SITE EASE** (the Development Ease Score) — how easy the *site* is to develop: zoning fit, lot, slope, hazards, access. Physical/regulatory ease only.
3. **INSUFFICIENT EVIDENCE** — any factor whose data is missing for this parcel (e.g. suburban zoning not loaded) is shown as *insufficient evidence*, excluded from the average, and lowers coverage/confidence. It is never scored as zero or as "fine".
4. **FINANCIAL RESULT** — kept separate from site ease: comps, rents, costs, funding gap. A cheap-to-build site with weak rents is a different answer from a hard site in a strong market; the two are never blended.

## Comps (v0.2 — decided)
For every parcel:
- **Sales comps:** valid arm's-length sales only (county SALECODE `0`; prices under $1,000 excluded), similar property class, nearest first. Show **count and date range**.
- **Rent comps:** Zillow Observed Rent Index (ZORI) by ZIP, HUD Fair Market Rents (Small Area by ZIP), and RentEase listings when available (labeled sample where applicable). Show count/source and dates.
- **Minimum 5 comps.** If fewer than 5 are found, show **"insufficient comps"**, widen the search radius in steps, and say so in a note ("widened to 1 mile: 3 sales within ½ mile"). Never estimate silently.

## Principles
1. **Deterministic.** Same parcel + same data = same score. No randomness, no LLM in the math.
2. **Every number traces to a source.** Each factor records the dataset, the raw value, and the rule that turned it into points.
3. **Unknown is not zero.** If a factor can't be assessed for a parcel (e.g. zoning outside Pittsburgh), it is marked *not assessed*, removed from the average, and the parcel's **coverage** drops. The score never looks better because data is missing.
4. **Flags beat points.** Some conditions (e.g. floodway) are shown as a red flag regardless of the score.
5. **The AI only explains.** The language model receives the computed JSON and writes plain-language text; it never produces or changes a number.
6. **Decision support, not advice.** Every result says so.

## Output per parcel
```
score        0–100 (higher = easier to develop housing)
grade        A (80+) · B (65–79) · C (50–64) · D (35–49) · E (<35)
coverage     % of total factor weight actually assessed
confidence   High (coverage ≥ 85%) · Medium (60–84%) · Low (< 60%)
factors[]    id, label, weight, points 0–1, raw value, source, rule, assessed?
flags[]      severity (red/amber/info), category (zoning/environmental/infrastructure/policy/data), message, source
```
Score = Σ(weight × points) / Σ(weight of assessed factors) × 100.

## Factors (proposed weights sum to 100)

| # | Group | Factor | Weight | Rule (points 0–1) | Data | Coverage today |
|---|---|---|---|---|---|---|
| 1 | Zoning | Residential allowed by right | 15 | 1 if residential/mixed-use district; 0.5 if conditional/special exception; 0 if industrial/park/special-purpose | `zoning` | City only |
| 2 | Zoning | Density allowance | 10 | Scaled by district's max units per lot (from dimensional table) | zoning rules table *(to build)* | City only |
| 3 | Site | Lot size fits district minimum | 10 | 1 if lot ≥ district min; linear down to 0 at 50% of min | `assessments.lot_area_sqft`, rules | City only (county fallback: lot ≥ 3,000 sq ft) |
| 4 | Site | Lot shape | 5 | Compactness (4πA/P²) ≥ 0.5 → 1; < 0.2 → 0 | `parcels.geom` | County |
| 5 | Site | Already vacant / low building value | 10 | Vacant land → 1; building value < 25% of total → 0.7; else scaled | `assessments` | County |
| 6 | Site | Slope | 10 | < 15% → 1; 15–25% → 0.5; > 25% → 0.1 | slope layer *(to find)* | TBD |
| 7 | Environment | Flood zone | 10 | Outside A/AE → 1; partial (< 25% of lot) → 0.5; mostly in A/AE → 0 | `overlays` FEMA | County |
| 8 | Environment | Landslide-prone / undermined | 5 | Neither → 1; one → 0.4; both → 0.1 | `overlays` | City only |
| 9 | Access | Transit & infrastructure | 10 | Frequent-transit stop within 400 m → 1; within 800 m → 0.6; sewer service assumed in urbanized area | GTFS *(to load)* | TBD |
| 10 | Market | Market support | 10 | Median valid-sale $/sq ft within 800 m, last 3 yrs, vs. county median → scaled 0–1; needs ≥ 5 sales else not assessed | `sales_valid` | County |
| 11 | Ownership | Acquisition path | 5 | Public / land bank → 1; single owner, no abatement → 0.7; otherwise 0.5 | `assessments.owner_type` | County |

## Flags (examples)
- **Red — Environmental:** ≥ 50% of lot in FEMA A/AE flood zone.
- **Red — Zoning:** zoned park/open space or industrial-only.
- **Amber — Environmental:** in landslide-prone or undermined area; in a greenway.
- **Amber — Policy:** within 150 m of a school district line (confirm district).
- **Amber — Data:** zoning not available outside Pittsburgh — confirm with the municipality.
- **Info — Data:** building data missing (year built, lot area).

## Open questions for the SME
1. Which factors would a municipal planner add or weigh differently? (e.g. sewer capacity, historic district review, parking minimums)
2. Should zoning weigh 25% in total, or more?
3. Is "vacant land scores higher" right, or does demolition cost need its own factor?
4. What market signal do developers actually trust: sale $/sq ft, rents (HUD FMR), or days on market?
5. How should the score treat parcels outside Pittsburgh where zoning is unknown: exclude zoning (current plan) or impute from land use?
