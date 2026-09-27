# Seat UI kit

Shared components for the seat pages: **Municipal Planner** (`/planner`), **Nonprofit / CDC** (`/nonprofit`) and **Policy Analyst** (`/policy`). The Developer seat (`/parcel/[parid]`) keeps its own shell, and every seat links to it.

It uses the homepage design tokens (green `#156b54`, ink `#111b1a`, muted `#596563`, line `#dce3df`, Inter through `next/font/local`) at a denser size: 13–14px UI text. Styles live in `seats.css`, scoped under `.es-seat`, so no other page is affected.

```tsx
import { SeatLayout, SeatHeader, SeatSelect, ExportMenu, EmptyState, RangeValue, ReceiptButton } from "@/components/seats";
import MapPanel, { GeoJSONLayer, MapLegend } from "@/components/seats/MapPanel"; // separate: pulls in MapLibre
```

## Rules the kit enforces

- **No fake numbers.** When a dataset is missing, show `<EmptyState dataset="Census income data" />`, which reads "Census income data not loaded yet".
- **Ranges, not false precision.** `RangeValue` rounds the whole range with one step (two significant figures by default) and always orders it low ≤ likely ≤ high.
- **Every number has a receipt.** `ReceiptButton` opens a drawer that shows the source, the data date, how the number was computed and its limits.
- **Accessible by default.** Text meets AA contrast. Focus rings are 2px green. Every control works by keyboard. Motion is turned off under `prefers-reduced-motion`.

## Layout

### `SeatLayout` (client)
| prop | type | notes |
|---|---|---|
| `header` | node | usually `<SeatHeader>` |
| `left` / `right` | node? | rails (filters or levers / summary); each scrolls on its own |
| `children` | node | main column, a flex column (put a `MapPanel` with `flex:1` and a table under it) |
| `bottom` | node? | tray under the main column (compare tray); dark ink background |
| `footer` | node? | under the main content, e.g. `<DataDateFooter>` |
| `leftLabel` / `rightLabel` | string | default "Filters" / "Summary" (sheet titles and mobile buttons) |
| `leftWidth` / `rightWidth` | number | default 280 / 320 |
| `mainLabel` | string? | accessible name of `<main>` |

The layout fills the viewport (`100dvh`). **Under 900px** the rails become bottom sheets, opened from a bar under the header. The sheet takes focus, Escape or "Done" closes it, focus goes back to the button that opened it, and the rest of the page is inert while it is open. `useSeatLayout()` returns `{ isSheet, open, openSheet("left"|"right"), closeSheet }`, for example for a "Show filters" link inside an empty state. `useMediaQuery(q)` is also exported.

### `SeatHeader` (client)
| prop | type | notes |
|---|---|---|
| `seat` | `"planner"|"developer"|"nonprofit"|"policy"`? | defaults to the seat that matches the URL |
| `controls` | node? | left-aligned after the switcher: geography picker, scenario |
| `actions` | node? | right-aligned: saved lists, `<ExportMenu>` |
| `hrefs` | `Partial<Record<SeatId,string>>`? | rare overrides |

All four seats are always reachable, and the current one is marked with `aria-current="page"`. Below 1180px the switcher shows short labels. Below 900px it wraps onto its own full-width row.

Helpers: `SeatSelect {label, value, options[{value,label,disabled?}], onChange, hideLabel=true}` is a native select, and `SeatButton {variant: "default"|"primary"|"ghost", ...buttonProps}` is a header or tool button. Use one primary action per header.

### Keeping context across seats
`selection.ts` stores one sessionStorage key, **`es.selection`**: `{ municipality?, neighborhood?, parids: string[], focus? }`. It is kept per tab and never goes into a URL or to the server.

- `useSeatSelection()` is a hook. It returns empty on the server and during hydration.
- `setSelection(patch)` merges the patch. `parids` replaces the list, deduplicated and capped at 25. Only 16-character parcel ids are accepted.
- `getSelection()` and `clearSelection()` are also available.

The **Developer** link opens `/parcel/<focus ?? parids[0]>`, or `/#parcel-search` when nothing is pinned. So a parcel pinned in the Planner (`setSelection({ parids: pinned })`) opens in the Developer view. The other seats read `municipality` and `neighborhood` on mount and preselect them.

## Numbers

### `RangeValue`
`{ value: {low, likely, high} | null, format?: "count"|"money"|"pct"|"acres"|(n)=>string, sig?: number|false (2), signed?, size?: "sm"|"md"|"lg", showLikely? (true), unit?, label? }`

It renders "2,900 to 3,600" (money renders as "$3.1M–$4.4M") with "likely 3,200" underneath. Screen readers hear one sentence. `null` shows a dash, read as "not available".

Helpers in `format.ts`: `roundRange`, `roundSig`, `orderRange`, `formatRange(r, {format, sig, signed})` for plain text (CSV, PDF, aria), `fmtCount`, `fmtMoney`, `fmtPct`, `fmtAcres`.

### `StatCard`
`{ label, value, sub?, receipt?, variant?: "card"|"band", children? }`. Use `band` for the Policy headline row, which is flat with a green sub-line.

### `BandPill`
`{ band: "Easy"|"Moderate"|"Hard"|"Very hard"|null, score? }`. Any other value shows "No score".

## Receipts, dates, empty states, export

- **`ReceiptButton`** takes `{ receipt? | receipts?, title?, children="Receipt" }` and renders a small green link that opens the drawer.
- **`ReceiptDrawer`** takes `{ open, onClose, receipts, title }`. It is a right-side modal `<dialog>`: focus is trapped, Escape closes it, and focus returns to the opener. A `Receipt` is `{ label, value?, source, url?, date, method, kind?: "data"|"assumption"|"input"|"sample", notes? }`, and `kind` shows a tag such as "Assumption, editable".
- **`DataDateFooter`** takes `{ sources: [{name, date, url?}], note?, methodsHref? }`. It adds the decision-support disclaimer and links to Methods and Limitations.
- **`EmptyState`** takes `{ dataset?, title?, children?, action?, tone?: "pending"|"empty"|"error", compact? }`.
- **`ExportMenu`** takes `{ actions: [{ id, label, format: "CSV"|"PDF"|"GeoJSON"|"JSON", description?, onSelect, disabled?, disabledReason? }], label="Export", variant?: "primary"|"default", align?: "start"|"end" }`. It is a menu button: arrow keys, Home and End move; Enter chooses; Escape closes. While an async `onSelect` runs, the button shows "Preparing…".

## Filter rail controls (`FilterRail.tsx`)
- `FilterRail {children, footer?, intro?}`: the container. `footer` sticks to the bottom (for "Clear all").
- `FilterSection {title, hint?, collapsible?, defaultOpen?, action?}`. Collapsible sections use `<details>`.
- `CheckboxField {label, checked, onChange, hint?, count?, disabled?}`: a native checkbox with a custom box.
- `Switch {label, checked, onChange, hint?, disabled?, hideLabel?}`: `role="switch"`, for policy levers and layers.
- `Segmented {label, options[{value,label,title?}], value, onChange, hideLabel?, size?: "sm"|"md", tone?: "light"|"dark"}`: a radiogroup with roving tabindex; arrow keys and Home/End move the selection. Use `tone="dark"` on map toolbars.
- `RangeSlider {label, min, max, step?, value: number | [lo, hi], onChange, format?, ends?: [left, right], hint?, disabled?}`: built on native range inputs, so arrow keys, Page Up/Down and Home/End work. In the two-thumb version the thumbs cannot cross. `format` sets `aria-valuetext`.

## Map (`MapPanel.tsx`, client)
It is a 2D MapLibre analysis map on the self-hosted tiles: `basemap.pmtiles` (Protomaps) plus our parcel outlines from `easescore.pmtiles` from zoom 15. It follows the same setup as `parcel/[parid]/MapStage.tsx` and `planner/PlannerMap.tsx`, factored out without changing either.

`MapPanel` props:

| prop | type | notes |
|---|---|---|
| `ariaLabel` | string | required |
| `bounds` | [w,s,e,n] | default `PGH_BOUNDS`; `COUNTY_BOUNDS` is also exported |
| `basemap` | `"analysis"|"light"|"grayscale"|"white"|"dark"` | default `analysis`, a desaturated light basemap so colored parcels carry the meaning |
| `parcelLines` | boolean | default true |
| `onReady(map)` | function? | called once the style loads |
| `tools` | node? | top-right toolbar: `Segmented tone="dark"`, a "3D" button |
| `legend` | node? | bottom-left: `<MapLegend items={[{color,label}]} />` |
| `children` | node? | layer components and overlays |
| `minHeight` | number | default 320 |
| `className` | string? | |

Layers:
```tsx
<MapPanel ariaLabel="Matching parcels colored by score band" legend={<MapLegend items={...} />}>
  <GeoJSONLayer id="sites" data={fc} promoteId="parid" layers={[{ id: "sites", type: "circle", paint: { ... } }]} />
</MapPanel>
```
`GeoJSONLayer {id, data, layers (without source), promoteId?, beforeId?}` adds the source and layers once, calls `setData` when `data` changes, and removes both on unmount. For anything custom, `useMapPanel()` returns `{ map, ready }`. `motionOK()` returns false under reduced motion; use it to set fly and ease durations to 0. If WebGL is unavailable, the panel says so in plain text instead of crashing.

The 3D photoreal view stays on the Developer page, available on demand. Put a "3D" button in `tools` that links there.
