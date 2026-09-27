# quickfit (v2) — standalone site-fit solver
Pure TypeScript, no UI, deterministic. Given a parcel (lot outline, streets, zoning rules, hazards, ground), it finds what fits for each building type and returns one `Scheme` object that the pane, pro forma, report, site plan and 3D all read.

## API
```ts
import { solve, solveAll } from "./src";
const scheme = solve(parcelInput, { typology: "two_unit", stories: null, unitWidthFt: null, parking: "auto", setbackOverridesFt: {} });
const { ordered, results, ms } = solveAll(parcelInput);   // one Scheme per building type, best first
```
Inputs: see `src/types.ts` (`ParcelInput`, `ZoningRules`, `Controls`). Coordinates in feet (any planar frame, e.g. PA South state plane). `terrain.elevAt(x, y)` returns bare-earth elevation in feet from lidar.

## What it does
- Finds the front lot line from street centerlines (corner lots: address street is the front; the other street side uses the street-side setback). User can override with `frontEdgeIndex`.
- Labels every edge (front, street side, side, rear, alley) and applies **that edge's own setback** (works on irregular and concave lots). Floodway is cut; landslide/undermined are flags, not cuts.
- 1-ft raster + summed-area table → "does this footprint fit" in O(1); every blocked cell remembers which rule blocked it, which produces the plain-English limit sentence.
- Building types: single-family, duplex (stacked or side by side), 3–4 units (stacked flats with a stair core; caps at 3 where 4+ isn't allowed), townhouse row (party walls, per-home lot check, subdivision flag; includes the single attached rowhouse on a narrow lot), backyard cottage (ADU).
- Checks: use permission (by right / special exception / conditional use / not allowed), minimum lot size, lot area per home, stories/height, parking (tuck-under, pad via alley or side drive, or none), setback what-ifs. Each problem becomes an `approvalsNeeded` entry with the code section and past Zoning Board stats when provided.
- "What if": re-solves with the limiting setback halved and reports homes/sq ft gained (marked as needing a variance).
- Ground: fits a plane under the footprint, steps floors in 2.5-ft increments on slopes over 15%, and returns foundation wall area and retaining wall length/height (use these for the hillside cost, not per finished sq ft).
- `massing`: boxes (foundation, units, core, tuck-under parking, roof) in the local frame; `frame` converts to world coordinates.

## Site planning (v2.1)
- **Parking a car can use:** tuck-under garage at street grade (default on hillsides and narrow lots; cut into the hill up to ~14 ft, reported as retaining walls), alley pad, or side driveway to a rear pad (continuous 10-ft strip inside the lot, driveway grade ≤ 15%, pad leveling ≤ 4 ft). Otherwise "none" with the reasons, and a parking approval flag. Side-by-side garages share one apron; one curb cut per driveway.
- **Hillside massing:** floors stay level; the slope goes into the foundation (walkout on the downhill side). Townhouses step unit by unit at party walls; other buildings step at most once, a full story, when the drop exceeds a floor.
- **Facades:** windows in bays per unit, 2.5 ft clear of party walls, none on party walls, none on side walls within 3 ft of a lot line; a door per unit (or at the stair core); garage doors where there are garages.
- Output in `scheme.site`: `parking` (drives, stalls, garages, curb cuts, notes), `segments`, `openings`.

## Tests
`npx esbuild test/run.ts --bundle --platform=node --outfile=/tmp/qf.js && node /tmp/qf.js`
11 synthetic lots (flat, narrow, wide row, steep, deep, LNC, Parks, alley, floodway, corner, irregular hillside). Checks: stories vs. limits, determinism, speed, Parks multi-unit = not allowed. **Replace synthetic lots and placeholder rules with the database fixture export before trusting outputs.**

## Harness
`quickfit-v2-harness.html` — open in a browser: pick a lot, switch building types, drag stories/width, set parking, type setback what-ifs; plan view + 3D preview + "best options" list.

## Known limits (v2.0)
- Footprints are rectangles aligned to the front lot line (no L-shapes yet).
- Unit sizes, floor heights, parking dimensions are editable placeholders.
- Height measured from average grade under the footprint; confirm the code's measurement method per district.
- Contextual (match-the-neighbors) setbacks not yet applied automatically; planned with the street-precedent module.
- Solve time: 1–40 ms per building type on typical lots; up to ~120 ms for all five on large irregular lots (the what-if re-solve is the main cost; cache the raster per parcel to cut it).
