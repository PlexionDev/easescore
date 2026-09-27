# EaseScore.AI — Development Ease Score engine (DRAFT v0.2 for review)

**Status: draft for project owner + housing SME review. Weights are proposals, not final.**

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

## Ease Score v0.1 (implemented in `engine/src/score/`)

**Config:** `engine/config/ease-score.v0.1.json` holds every weight, curve breakpoint, multiplier, band cutoff, evidence threshold, default ZBA grant rate, callout cost default and planning-badge default. It lives inside the engine package so the web bundle can import it. Every result carries `configVersion`. Pass a different config object as the third argument to try new weights.

**How to call it (web):** fetch the RPCs, then
```ts
import { score } from "@easescore/engine";
const result = score.scoreParcel(parcelFacts, {
  quickfitInput,        // parcel_quickfit_input(parid)
  easeInputs,           // parcel_ease_inputs(parid)   (migration 080)
  zba,                  // zba_grant_rates(district)    (migration 080)
  permitTimes,          // optional: permit_time_estimate rows, keyed "new_build" / "rehab"
  project,              // optional: { affordableUnitsProposed }
  unlocks: true,        // policy what-ifs rerun the lot-fit test (about 1 s on a large lot); false skips them
});
```
`score.toEaseInput` (facts adapter) and `score.computeEaseScore` (no solver; takes precomputed fits) are exported for callers that want the pieces.

**What it returns:** one result per strategy (new single-family, duplex, 3-4 units, townhouse row, ADU, rehab of the existing building) and the best one. Each has a 0-100 score, a band (Easy 75+, Moderate 55-74, Hard 35-54, Very hard under 35), red flags, amber "Review required" callouts, seven factors, predicted months to permit, a planning badge and policy unlocks.

**Rules in brief (our words):**
- Seven factors: zoning permission (25), terrain (20), geohazards (15), access and utilities (15), approval burden (15), lot readiness (5), market activity (5). Zoning = use permission (by right, administrator exception, special exception, conditional use, use variance) times how the building fits the lot (QuickFit: by right, with a contextual setback, with a dimensional variance weighted by that district's ZBA grant rate, or not at all).
- A factor without data is marked *missing* and left out of the average; the result then shows a range (missing factors at 0 and at 100). If factors with evidence carry under 60% of the weight, the result is labeled preliminary. Outside the City, zoning is missing and the note says to confirm with the municipality. City-only layers (landslide-prone, historic, combined sewer) are *unknown* outside the City, never "none".
- Red flags are only: FEMA floodway, no street access, an active cleanup site on the lot. They label the score "Blocked unless resolved" and name the way out; they never change the number.
- Landslide-prone and undermined ground lower the geohazard factor and always add a "Review required" callout with the code sections, a checklist, and cost notes (grouting uses the config's editable default; no geotech cost is invented).
- Months to permit adds heuristic time per discretionary approval to the City's building-permit median when permit-time records are supplied; otherwise it is labeled an estimate. When the median is empty but the row carries `target_calendar_days` (the City's published review target), that target is used for the building-permit part and the result carries `targetOnly: true` and `label: "City target, not measured"`.
- The planning badge is separate from the score and uses placeholder weights until planners set them.
- Unlocks rerun the score with one policy change at a time (no parking minimum, no minimum lot size, attached housing by right, contextual setback) and report score and by-right unit gains.

**Code sections encoded (checked against the official text):** §911.02 Use Table for the P and H districts; §905.01 P standards, contextual setbacks in P (§905.01.C.1) and Site Plan Review on P lots of 2,400 sf or more (§905.01.D.1, counted as an approval step in F5); Chapter 921 nonconformities: repair of a nonconforming building needs no relief (§921.03.A.1), compliant enlargement is allowed (§921.03.D.1), rebuilding after a disaster is a special exception (§921.03.C.2). Lots of record (§921.04.A): an undersized vacant lot is scored on the Administrator Exception path with partial evidence, because our data can't confirm the lot was vacant and separately owned on the date the Code became applicable (that date isn't in our data).

**Known limits (v0.1):** ADU rules are not transcribed (ADU zoning = missing). Townhouse permissions exist only for residential districts and H. Water/sewer service areas are not loaded yet, so utilities score as unknown (x0.85). Steep ground is not yet cut from the QuickFit envelope, so steep lots can "fit" on paper. The slope-movement input is the 1982 county inventory (on-lot areas only), so the geohazard factor is marked partial.

## Ease Score v0.2 (implemented; `engine/config/ease-score.v0.2.json`)

A credibility pass on top of v0.1. Same factors, weights and evidence rules; three changes:

- **Hazard band cap.** When at least `caps.hazardBand.landslideProneShareMin` of the lot is in the City's landslide-prone overlay, or at least `caps.hazardBand.steepShareOver25Min` of it is steeper than 25%, the result is held to `caps.hazardBand.maxBand` (Moderate) or lower, whatever the raw weighted average would say, and the score carries a `cap` with the reason. This is what `scripts/score_all.ts` reads to add "Steep slope" or the landslide label to a parcel's blocker list.
- **F1 variance cap.** A layout that only fits with a dimensional variance can no longer score as a sure thing: its dimensional factor (variance base rate weighted by the district's Zoning Board grant record) is itself capped at `caps.varianceF1Max`% of the permission score.
- **Variance-odds fallback chain.** A district's Zoning Board grant rate is used when it has at least `f1.zba.minCases` decided cases; below that, the citywide rate for the same kind of request is used instead, labeled with its own case count and year range; only when neither exists does the rate fall back to the config's labeled default (`f1.zba.defaultGrantRate`).

Both v0.1 and v0.2 config files ship in `engine/config/`; the app and the batches read v0.2 (`ease-score.v0.2.json`) as `score.DEFAULT_CONFIG`. Every result still carries `configVersion` so old and new rows can be told apart.

## SelectedScheme: one layout per option

Each strategy (new single-family, duplex, 3&ndash;4 units, townhouse row, ADU, rehab) can fit a lot several ways. `SelectedScheme` (`engine/src/score/strategies.ts`, `byMostUnits`) picks one QuickFit layout per strategy &mdash; ranked by unit count, then permission, then gross floor area, then id &mdash; and that single layout now feeds the score, the pro forma, the plain-English summary, QuickFit's "Priced layout" card and the 3D massing together, so they never describe two different buildings for the same parcel. The parcel page opens on the summary's featured by-right option; QuickFit shows the priced scheme as-is until a control is changed, at which point it re-solves.

## Ranges, not point estimates

Cost and value lines in the pro forma, the Nonprofit funding gap, and the Policy pencil test are never a single number: each carries a low, a likely and a high figure, ordered so low &le; likely &le; high even at rounding ties (`ordered()` in `engine/src/affordable/gap.ts`; the same pattern in `engine/src/policy/pencil.ts`'s three scenarios). Ranges come from each input's own documented spread (builder cost tiers, comps quartiles, financing terms) rather than one arbitrary percentage wherever a real range exists; where none does, the range is a labeled assumption (for example land and rent move &plusmn;25%/&plusmn;10% around one figure). Every range keeps its source label so the parcel page, the Nonprofit and Policy seats, and the PDFs can show a source badge without recomputing anything.

## `engine/src/affordable` &mdash; Nonprofit / CDC seat

- `limits.ts`: HUD Income Limits (30/50/80% published; 60% = 1.2&times; the 50% limit, HUD's MTSP convention; any other percentage is a labeled derived scale), the LIHTC 30%-of-income rent rule with an imputed 1.5-persons-per-bedroom household size, and a placeholder tenant-paid utility allowance by bedroom count.
- `gap.ts`: `supportableDebt` sizes a permanent loan off the restricted rents (NOI &divide; DSCR &divide; the annual mortgage constant); `evaluateProject` runs every configured capital source's eligibility checks (AMI band, tenure, site, project-size thresholds) and typical amount (`engine/config/capital-sources.v0.1.json`: LIHTC 4%/9% credit-equity, HOME, CDBG, PHARE, HOF, AHP, a land write-down, and a LERTA-style abatement), then nets the funding gap before and after the sources a user turns on. Every source amount is labeled "Typical, not an award" and capped so it can never overshoot what is left of the gap.
- No AI and no live pane call in this math: cost comes from a precomputed parcel-pane layout when one exists for the lot, otherwise a labeled standard bedroom-count program, never an unpriced guess.

## `engine/src/policy` &mdash; Policy Analyst seat

- `levers.ts`: three levers (attached homes by right on narrow single-unit lots, minimum lot size scaled to a share, parking minimums off or waived near transit) that rewrite one parcel's zoning-rules row before it is scored &mdash; the scoring engine itself is never edited, and with every lever off a parcel scores exactly as its own parcel page shows. `stateKey`/`parseKey` give every lever combination a short, readable, cacheable key (e.g. `a35.m0.pt`); `PRECOMPUTE_KEYS` lists the states `scripts/policy_batch.ts` computes ahead of time.
- `pencil.ts`: a screening-only "does the by-right scheme plausibly sell?" test in three scenarios (low quartile price / high cost, medians, high quartile price / low cost), reusing the same construction-cost tiers as the Developer pro forma so the two never disagree.
- `fiscal.ts`: a per-taxing-body ledger (county, municipality, school district) from each new home's added assessed value (sale value &times; the county's new-construction assessment ratio) times that body's current millage, with an optional abatement's break-even year.
- `evaluate.ts` (batch entry) ties the three together per lever state across the parcels a state applies to; capacity and pencil ranges widen (never silently guess) for parcels a batch run could not finish within its per-parcel time budget.
