# QuickFit solver

A pure, deterministic TypeScript module that answers "what fits on this lot?" for small infill
housing. Given a parcel, its zoning rules and any unbuildable areas, it sweeps building types,
unit widths, story counts and parking options, and returns ranked schemes with units, floor
area, parking, zoning status and the rule that limits each one.

First version covers single-family detached, side-by-side duplex and townhouse rows. Presets
carry an `arrangement` (`detached`, `side_by_side`, `stacked`, `row`), so a stacked triplex or
fourplex, or an ADU, can be added as new presets.

## Units

Feet and square feet throughout. Coordinates must be planar and in feet (for example a
State Plane feet CRS), never longitude/latitude. The solver re-centers and rotates internally.

## Inputs (`QuickFitInput`)

- `parcel`: lot outline (simple polygon). `frontEdges`: street-frontage edge indices; edge `i`
  runs from vertex `i` to `i+1`, and the first one orients the row. Optional `rearEdges`
  (default: edges facing away from the front) and `streetSideEdges` (corner lots).
- `rules`: one row of the zoning rules table, plus optional single-unit-attached fields;
  `attachedRulesForDistrict(zone)` fills those for the residential districts.
- `setbackOverrides`: by-right adjustments such as a contextual front setback.
- `masks`: unbuildable polygons. `mode: "cut"` (default) removes them from the envelope;
  `"flag"` only warns when a footprint overlaps.
- `typologies`, `parkingOptions`, `assumptions`: all defaults in `presets.ts` are **editable
  placeholders**, not standards.
- `variances`: toggles that relax one dimensional rule (for example front setback 15 -> 5 ft).
- `zbaCounts`: granted/denied counts by relief type and code section. The solver never
  queries a database; it reports a rate only when at least 5 decided cases match, otherwise
  `insufficient_history`.
- `costs`, `revenue`: **user-supplied**. The module contains no cost, price or rent figures;
  any missing input makes the dependent outputs `null`.
- `goal`: `most_units`, `best_return`, `smallest_affordable_gap` or `by_right_only`.

## Method

1. Envelope = parcel minus a setback strip along each edge (front, rear, side, street side)
   minus cut masks. Polygon differences use `@turf/difference` / `@turf/intersect` (MIT,
   backed by `polyclip-ts`, MIT); areas use the shoelace formula.
2. Placement: unit rectangles are packed along the frontage, as far forward and left as the
   envelope allows, then made as deep as the preset allows. Unit width is swept in steps.
3. Checks: use permission by unit count (P/C/S/A/N), height and stories, minimum lot area and
   lot area per unit, parking minimum, FAR and coverage when the rules have them. Townhouse
   rows assume fee-simple lots along the frontage and carry a separate `needsSubdivision` flag;
   in districts that permit attached homes by right only on narrow lots, the widest new lot is
   checked against that width.
4. Binding constraint: each scheme names the rule that limits it in plain language
   ("Front setback is the limit"), found by relaxing each rule in turn and measuring the gain.
5. Variance value: schemes are rerun with the toggles; the report gives the unit and floor-area
   delta against the best by-right scheme, per toggle and combined.

## Determinism

No clock, randomness, network or database access. Sweeps run in a fixed order and ties break
on the scheme id, so the same input always gives the same output.

## Limits

Rectangular footprints only; one building per lot; setback strips are approximate at reflex
(inward) corners; overlay districts, compatibility standards, parking maximums and site
access are not modeled. Results are a feasibility screen, not a zoning determination.
