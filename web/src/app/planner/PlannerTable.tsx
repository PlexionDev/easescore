"use client";

// Ranked table: sortable headers, a column chooser (remembered in this browser), pin checkboxes,
// hazard icons, row hover synced with the map, row click opens the parcel drawer.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BandPill, CheckboxField } from "@/components/seats";
import { BADGE_NOTE, FT_PER_M, bandLabel, MONTHS_RANGE_NOTE, duplicateAddresses, monthsRangeText, ownerShort, parcelLabel, titleCase, type Dir, type PlannerRow, type Sort } from "@/lib/planner";

type ColId = "neighborhood" | "zoning" | "lot" | "owner" | "score" | "blocker" | "byright" | "relief" | "hazards" | "months" | "badge" | "transit" | "rehab" | "district";
type Col = { id: ColId; label: string; title?: string; sort?: Sort; num?: boolean; cell: (r: PlannerRow) => ReactNode; always?: boolean };

const COLS: Col[] = [
  { id: "neighborhood", label: "Neighborhood", sort: "neighborhood", cell: (r) => r.neighborhood ?? "—" },
  { id: "zoning", label: "Zoning", sort: "zoning", cell: (r) => r.zoning ?? <span title="Zoning rules not loaded for this municipality">not loaded</span> },
  { id: "lot", label: "Lot sq ft", sort: "lot", num: true, cell: (r) => (r.lot_sqft != null ? Math.round(r.lot_sqft).toLocaleString("en-US") : "—") },
  { id: "owner", label: "Owner", cell: (r) => ownerShort(r) },
  {
    id: "score", label: "Score", sort: "score", always: true,
    cell: (r) => (
      <span className="pl-score">
        <b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} />
        {r.range_lo != null ? <span className="pl-muted" title={`${r.preliminary ? "Preliminary. " : ""}Some data is missing: the score could be ${r.range_lo} (missing factors at 0) to ${r.range_hi} (at 100)`}>{r.range_lo}-{r.range_hi}</span> : null}
        {r.red_flag_count ? <span className="pl-flag" title={r.red_flags.map((f) => f.title).join("; ")}>Blocked</span> : null}
      </span>
    ),
  },
  { id: "blocker", label: "Top blocker", cell: (r) => r.top_blocker ?? <span className="pl-muted">None major</span> },
  { id: "byright", label: "By right", title: "Most homes a new building fits with the use allowed by right and no dimensional variance", sort: "by_right_units", num: true, cell: (r) => r.by_right_units ?? (r.note ? <span title={r.note}>n/a</span> : "—") },
  { id: "relief", label: "Yield with approvals", title: "Most homes on any path short of a use variance", sort: "units_with_relief", num: true, cell: (r) => r.units_with_relief ?? (r.note ? <span title={r.note}>n/a</span> : "—") },
  {
    id: "hazards", label: "Hazards",
    cell: (r) => {
      const hz = [
        r.hz_floodway ? { k: "F", t: "In the FEMA floodway", red: true } : null,
        r.hz_landslide ? { k: "L", t: "Landslide-prone overlay" } : null,
        r.hz_undermined ? { k: "U", t: "Undermined (old mines)" } : null,
        (r.steep_share ?? 0) >= 0.25 ? { k: "S", t: `${Math.round((r.steep_share ?? 0) * 100)}% of the lot steeper than 25%` } : null,
      ].filter((x): x is { k: string; t: string; red?: boolean } => !!x);
      return hz.length ? <span className="pl-hz">{hz.map((h) => <span key={h.k} title={h.t} className={h.red ? "red" : undefined} aria-label={h.t}>{h.k}</span>)}</span> : <span className="pl-muted">—</span>;
    },
  },
  { id: "months", label: "Months to permit", title: `Predicted months to a building permit for the best option (estimate). ${MONTHS_RANGE_NOTE}`, sort: "months", num: true, cell: (r) => monthsRangeText(r.months_to_permit) },
  { id: "badge", label: "Planning badge", title: BADGE_NOTE, cell: (r) => r.planning_badge ?? <span className="pl-muted">None</span> },
  { id: "transit", label: "To frequent transit", sort: "transit", num: true, cell: (r) => (r.transit_m != null ? `${Math.round((r.transit_m * FT_PER_M) / 10) * 10} ft` : "—") },
  { id: "rehab", label: "Rehab existing", title: "Ease Score for rehabbing the existing building (not used for ranking)", cell: (r) => (r.rehab_score != null ? `${r.rehab_score} ${bandLabel(r.rehab_band, "")}` : <span className="pl-muted">{r.band === "Partial" && !r.vacant ? "Not scored" : "No building"}</span>) },
  { id: "district", label: "Council district", cell: (r) => r.council_district ?? "—" },
];
const DEFAULT_COLS: ColId[] = ["neighborhood", "zoning", "lot", "owner", "score", "blocker", "byright", "relief", "hazards", "months", "badge"];
const COLS_KEY = "easescore.planner.columns";

export default function PlannerTable({ rows, offset, sort, dir, onSort, hover, selected, pinned, onHover, onOpen, onPin, loading, badgeFor, head, actions, foot }: {
  /** Left side of the table bar (title, sort note). */
  head: ReactNode;
  /** Right side of the table bar (export buttons). */
  actions: ReactNode;
  /** Under the table (pagination, notes). */
  foot: ReactNode;
  rows: PlannerRow[];
  offset: number;
  sort: Sort;
  dir: Dir;
  onSort: (s: Sort) => void;
  hover: string | null;
  selected: string | null;
  pinned: string[];
  onHover: (p: string | null) => void;
  onOpen: (r: PlannerRow) => void;
  onPin: (r: PlannerRow) => void;
  loading: boolean;
  /** Badge tier under the active priority profile (default weights until planners set them). */
  badgeFor: (r: PlannerRow) => string | null;
}) {
  const [cols, setCols] = useState<ColId[]>(DEFAULT_COLS);
  const [chooser, setChooser] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  // Several parcels can share one street address (e.g. a front and back lot); label those by parcel ID too.
  const dupAddr = useMemo(() => duplicateAddresses(rows), [rows]);
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(COLS_KEY) ?? "null");
      if (Array.isArray(v) && v.every((x) => COLS.some((c) => c.id === x))) setCols(v as ColId[]);
    } catch { /* storage unavailable */ }
  }, []);
  const saveCols = (next: ColId[]) => { setCols(next); try { window.localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  useEffect(() => { if (hover) rowRefs.current.get(hover)?.scrollIntoView({ block: "nearest" }); }, [hover]);

  const shown = COLS.filter((c) => c.always || cols.includes(c.id)).map((c) => (c.id === "badge" ? { ...c, cell: (r: PlannerRow) => badgeFor(r) ?? <span className="pl-muted">None</span> } : c));
  const arrow = (s?: Sort) => (s && s === sort ? (dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <section className="pl-tablewrap" aria-label="Ranked sites">
      <div className="pl-tablehead">
        {head}
        <span className="pl-spacer" />
        <div className="pl-cols">
        <button type="button" className="es-btn" aria-expanded={chooser} onClick={() => setChooser((o) => !o)}>Columns</button>
        {chooser ? (
          <div className="pl-cols-menu" role="group" aria-label="Columns to show">
            {COLS.filter((c) => !c.always).map((c) => (
              <CheckboxField key={c.id} label={c.label} checked={cols.includes(c.id)}
                onChange={(on) => saveCols(on ? [...cols, c.id] : cols.filter((x) => x !== c.id))} />
            ))}
            <button type="button" className="es-btn es-btn-ghost" onClick={() => { saveCols(DEFAULT_COLS); setChooser(false); }}>Reset columns</button>
          </div>
        ) : null}
        </div>
        {actions}
      </div>
      <ul className="pl-cards" aria-label="Ranked parcels">
        {rows.map((r, i) => {
          const isPinned = pinned.includes(r.parid);
          return (
            <li key={r.parid} className={isPinned ? "is-pinned" : undefined}>
              <input type="checkbox" className="pl-pin" checked={isPinned} onChange={() => onPin(r)} disabled={!isPinned && pinned.length >= 5}
                aria-label={`Pin ${parcelLabel(r)} to compare`} />
              <button type="button" className="pl-card-btn" onClick={() => onOpen(r)}>
                <span className="pl-card-top"><span className="pl-rank">{offset + i + 1}</span> <b>{parcelLabel(r, dupAddr.has(titleCase(r.address)))}</b></span>
                <span className="pl-card-mid"><span className="pl-score"><b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} /></span> {r.top_blocker ?? "None major"}</span>
                <span className="pl-card-sub">{[r.neighborhood, r.zoning, `${r.by_right_units ?? "—"} by right, ${r.units_with_relief ?? "—"} with approvals`].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="pl-scroll">
        <TableBody rows={rows} offset={offset} shown={shown} arrow={arrow} onSort={onSort} hover={hover} selected={selected} pinned={pinned}
          onHover={onHover} onOpen={onOpen} onPin={onPin} loading={loading} rowRefs={rowRefs} sort={sort} dir={dir} dupAddr={dupAddr} />
      </div>
      {foot}
    </section>
  );
}

function TableBody({ rows, offset, shown, arrow, onSort, hover, selected, pinned, onHover, onOpen, onPin, loading, rowRefs, sort, dir, dupAddr }: {
  rows: PlannerRow[]; offset: number; shown: Col[]; arrow: (s?: Sort) => string; onSort: (s: Sort) => void;
  hover: string | null; selected: string | null; pinned: string[]; onHover: (p: string | null) => void; onOpen: (r: PlannerRow) => void;
  onPin: (r: PlannerRow) => void; loading: boolean; rowRefs: React.RefObject<Map<string, HTMLTableRowElement>>; sort: Sort; dir: Dir;
  dupAddr: Set<string>;
}) {
  return (
    <table className="pl-table">
      <caption className="es-sr">Ranked parcels, sorted by {sort} {dir === "asc" ? "ascending" : "descending"}</caption>
      <thead>
        <tr>
          <th scope="col"><span className="es-sr">Pin to compare</span></th>
          <th scope="col">#</th>
          <th scope="col" aria-sort={sort === "address" ? (dir === "asc" ? "ascending" : "descending") : undefined}><button type="button" onClick={() => onSort("address")}>Parcel{arrow("address")}</button></th>
          {shown.map((c) => (
            <th key={c.id} scope="col" className={c.num ? "num" : undefined} title={c.title} aria-sort={c.sort && c.sort === sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
              {c.sort ? <button type="button" onClick={() => onSort(c.sort!)}>{c.label}{arrow(c.sort)}</button> : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody style={loading ? { opacity: 0.55 } : undefined}>
        {rows.map((r, i) => {
          const isPinned = pinned.includes(r.parid);
          const focus = hover === r.parid || selected === r.parid;
          return (
            <tr key={r.parid} ref={(el) => { if (el) rowRefs.current.set(r.parid, el); else rowRefs.current.delete(r.parid); }}
              className={`${focus ? "is-focus" : ""}${isPinned ? " is-pinned" : ""}`}
              onMouseEnter={() => onHover(r.parid)} onMouseLeave={() => onHover(null)} onClick={() => onOpen(r)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="pl-pin" checked={isPinned} onChange={() => onPin(r)}
                  disabled={!isPinned && pinned.length >= 5} aria-label={`Pin ${parcelLabel(r)} to compare`} title={!isPinned && pinned.length >= 5 ? "Compare holds 5 parcels" : "Pin to compare"} />
              </td>
              <td className="pl-rank">{offset + i + 1}</td>
              <td className="pl-parcel">
                <Link href={`/parcel/${encodeURIComponent(r.parid.trim())}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(r); }}>{parcelLabel(r, dupAddr.has(titleCase(r.address)))}</Link>
              </td>
              {shown.map((c) => <td key={c.id} className={c.num ? "num" : undefined}>{c.cell(r)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
