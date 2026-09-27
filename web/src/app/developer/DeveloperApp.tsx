"use client";

// Developer seat, "Find and check lots": filter rail (with parcel search) · map + ranked table · parcel
// pane, plus "My lots" (up to 10 pinned in this browser, compared side by side). Reads the Planner's
// precomputed scores through the same routes (/api/planner/query, /api/planner/points).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BandPill, SeatButton, SeatHeader, SeatLayout, SeatSelect, Segmented, setSelection, useSeatLayout } from "@/components/seats";
import {
  CITY, DEFAULT_DIR, PAGE_SIZE, clean, describeFilters, duplicateAddresses, filtersToQuery, ownerShort, parcelLabel, titleCase,
  partialBest, type Dir, type Filters, type PlannerOptions, type PlannerPoint, type PlannerResult, type PlannerRow, type Sort,
} from "@/lib/planner";
import { MOST_BY_RIGHT, bestWithHomes } from "@/lib/best-option";
import DeveloperFilters from "./DeveloperFilters";
import DeveloperPane from "./DeveloperPane";
import "../planner/planner.css";
import "./developer.css";

const DeveloperMap = dynamic(() => import("./DeveloperMap"), { ssr: false, loading: () => <div className="es-map" style={{ position: "absolute", inset: 0 }} aria-hidden="true" /> });

const MAX_LOTS = 10;
const LOTS_KEY = "easescore.developer.lots";
const SORTS: { value: Sort; label: string }[] = [
  { value: "score", label: "Ease Score" },
  { value: "by_right_units", label: "Most homes by right, any type" },
  { value: "lot", label: "Lot size" },
];
const SORT_TEXT: Partial<Record<Sort, string>> = { score: "Ease Score", by_right_units: "most homes by right (any type)", lot: "lot size" };

function queryString(f: Filters, sort: Sort, dir: Dir, page: number, parcel: string | null) {
  const q = filtersToQuery(f);
  if (sort !== "score") q.set("sort", sort);
  if (dir !== DEFAULT_DIR[sort]) q.set("dir", dir);
  if (page) q.set("page", String(page));
  if (parcel) q.set("parcel", parcel);
  return q.toString();
}

// The best option with its own home count ("Duplex · 2 homes"); the most homes by right across all types is its own column.
const bestText = (r: PlannerRow) => (r.band === "Partial" ? partialBest(r) : bestWithHomes(r) ?? "—");

/** Opens the pane's sheet on phones when a parcel is picked (must sit inside SeatLayout). */
function SheetOnPick({ parid }: { parid: string | null }) {
  const { isSheet, openSheet } = useSeatLayout();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (parid && parid !== last.current && isSheet) openSheet("right");
    last.current = parid;
  }, [parid, isSheet, openSheet]);
  return null;
}

export default function DeveloperApp({ options, initial, initialFilters, initialSort, initialDir, initialParcel }: {
  options: PlannerOptions | null;
  initial: PlannerResult | null;
  initialFilters: Filters;
  initialSort: Sort;
  initialDir: Dir;
  initialParcel: string | null;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<Sort>(initialSort);
  const [dir, setDir] = useState<Dir>(initialDir);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PlannerResult | null>(initial);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<PlannerPoint[]>([]);
  const [pointsGot, setPointsGot] = useState<{ key: string; ok: boolean } | null>(null);
  const [pointsTry, setPointsTry] = useState(0);
  const [tableOnly, setTableOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(initialParcel);
  const [lots, setLots] = useState<PlannerRow[]>([]);
  const lotsRestored = useRef(false);
  const first = useRef(true);

  // Table: refetch on filter / sort / page change (the first render uses the server result).
  useEffect(() => {
    if (first.current) { first.current = false; if (initial) return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/planner/query?${queryString(filters, sort, dir, page, null)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((r: PlannerResult) => setResult(r))
      .catch((e) => { if ((e as Error).name !== "AbortError") setResult(null); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [filters, sort, dir, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL keeps filters, sort and the open parcel (shareable; the seat bar reads the parcel from the selection).
  useEffect(() => {
    const qs = queryString(filters, sort, dir, page, open);
    window.history.replaceState(null, "", qs ? `/developer?${qs}` : "/developer");
    setSelection({ focus: open ?? undefined, municipality: filters.muni ? titleCase(filters.muni) : undefined, neighborhood: filters.hoods?.length === 1 ? filters.hoods[0] : undefined });
  }, [filters, sort, dir, page, open]);

  // Map points: only the filters matter. One automatic retry, then a visible "Retry".
  const filterKey = filtersToQuery(filters).toString();
  const pointsKey = `${filterKey}#${pointsTry}`;
  const pointsState = pointsGot?.key !== pointsKey ? "loading" : pointsGot.ok ? "ok" : "error";
  useEffect(() => {
    const ctrl = new AbortController();
    const load = (attempt: number): Promise<void> =>
      fetch(`/api/planner/points?${filterKey}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((p: PlannerPoint[]) => { setPoints(Array.isArray(p) ? p : []); setPointsGot({ key: pointsKey, ok: true }); })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          if (attempt === 0) return new Promise<void>((res) => setTimeout(res, 1500)).then(() => load(1));
          setPointsGot({ key: pointsKey, ok: false });
        });
    void load(0);
    return () => ctrl.abort();
  }, [filterKey, pointsKey]);

  // My lots: restore once from this browser, then remember every change.
  useEffect(() => {
    let ids: unknown = [];
    try { ids = JSON.parse(window.localStorage.getItem(LOTS_KEY) ?? "[]"); } catch { ids = []; }
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[0-9A-Z]{16}$/.test(x)).slice(0, MAX_LOTS) : [];
    if (!list.length) { lotsRestored.current = true; return; }
    fetch(`/api/planner/query?ids=${encodeURIComponent(list.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: PlannerResult | null) => {
        const byId = new Map((r?.rows ?? []).map((x) => [x.parid.trim(), x]));
        lotsRestored.current = true;
        setLots(list.map((id) => byId.get(id)).filter((x): x is PlannerRow => !!x));
      })
      .catch(() => { lotsRestored.current = true; });
  }, []);
  useEffect(() => {
    if (!lotsRestored.current) return;
    try { window.localStorage.setItem(LOTS_KEY, JSON.stringify(lots.map((l) => l.parid.trim()))); } catch { /* storage unavailable */ }
  }, [lots]);
  const pinnedIds = useMemo(() => lots.map((l) => l.parid.trim()), [lots]);
  const togglePin = useCallback((row: PlannerRow) => {
    setLots((ls) => (ls.some((l) => l.parid === row.parid) ? ls.filter((l) => l.parid !== row.parid) : ls.length >= MAX_LOTS ? ls : [...ls, row]));
  }, []);

  const set = useCallback((patch: Partial<Filters>) => { setFilters((f) => clean({ ...f, ...patch })); setPage(0); }, []);
  const reset = () => { setFilters(clean({ muni: filters.muni })); setPage(0); };
  const rows = result?.rows ?? [];
  // Same-address rows (e.g. two "501 Market St" parcels) show their parcel IDs, as in the Planner.
  const dupAddr = useMemo(() => duplicateAddresses(rows), [rows]);
  const label = (r: PlannerRow) => parcelLabel(r, dupAddr.has(titleCase(r.address)));
  const total = result?.total ?? 0;
  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const known = open ? rows.find((r) => r.parid.trim() === open) ?? lots.find((r) => r.parid.trim() === open) ?? null : null;
  const activeFilters = describeFilters(filters).slice(1);
  const openParcel = useCallback((parid: string) => setOpen(parid.trim().toUpperCase()), []);

  const muniOptions = useMemo(() => {
    const scored = options ? new Set(options.municipalities) : null;
    const names = [...new Set([CITY, ...(options?.all_municipalities ?? []).map((m) => m.name)])];
    return names.map((n) => ({ value: n, label: `${n === CITY ? "City of Pittsburgh" : titleCase(n)}${scored && !scored.has(n) && n !== filters.muni ? " (not scored yet)" : ""}` }));
  }, [options, filters.muni]);

  const header = (
    <SeatHeader
      seat="developer"
      controls={<SeatSelect label="Municipality" value={filters.muni ?? CITY} options={muniOptions} onChange={(v) => set({ muni: v, hoods: v === CITY ? filters.hoods : undefined })} />}
    />
  );

  return (
    <SeatLayout
      header={header}
      mainLabel="Map and ranked lots"
      leftLabel="Find lots"
      rightLabel="Parcel"
      rightWidth={360}
      left={<DeveloperFilters f={filters} options={options} set={set} reset={reset} total={result ? total : null} onPick={(h) => openParcel(h.parid)} />}
      right={<DeveloperPane parid={open} known={known} pinned={!!open && pinnedIds.includes(open)} canPin={lots.length < MAX_LOTS} onPin={togglePin} onClose={() => setOpen(null)} />}
      bottom={<MyLots lots={lots} onOpen={openParcel} onRemove={(id) => setLots((ls) => ls.filter((l) => l.parid.trim() !== id))} onClear={() => setLots([])} />}
    >
      <SheetOnPick parid={open} />
      <div className="pl-top">
        <p className="es-sr" role="status">{result ? `${total.toLocaleString("en-US")} lot${total === 1 ? "" : "s"} match these filters, ranked by ${SORT_TEXT[sort] ?? sort}.` : ""}</p>
        <div className="pl-viewbar">
          <Segmented<"map" | "table"> label="View" size="sm" value={tableOnly ? "table" : "map"} onChange={(v) => setTableOnly(v === "table")}
            options={[{ value: "map", label: "Map and table" }, { value: "table", label: "Table view" }]} />
          <span className="pl-sub">The table lists the same lots as the map, with every value as text.</span>
        </div>
        {tableOnly ? null : (
          <div className="pl-map">
            <DeveloperMap points={points} total={total} selected={open} pinned={pinnedIds} onSelect={openParcel} fitKey={filterKey} />
            {pointsState !== "ok" ? (
              <div className="pl-mapstate" role="status">
                {pointsState === "loading" ? "Loading map points…" : <>Map points could not load. <button type="button" className="es-btn es-btn-ghost" onClick={() => setPointsTry((n) => n + 1)}>Retry</button></>}
              </div>
            ) : null}
          </div>
        )}
        <section className="pl-tablewrap" aria-labelledby="dv-ranked-h">
          <div className="pl-tablehead">
            <h2 id="dv-ranked-h">Ranked lots</h2>
            <span className="pl-sub">{activeFilters.length ? `${activeFilters.join(" · ")} · ` : ""}{activeFilters.length ? <button type="button" className="pl-linkbtn" onClick={reset}>Clear filters</button> : null}</span>
            <span className="pl-spacer" />
            <label className="es-field-label dv-sort">
              Rank by
              <select className="pl-multi" value={sort} onChange={(e) => { const s = e.target.value as Sort; setSort(s); setDir(DEFAULT_DIR[s]); setPage(0); }}>
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <ul className="pl-cards" aria-label="Ranked lots">
            {rows.map((r, i) => (
              <li key={r.parid}>
                <button type="button" className="pl-card-btn" onClick={() => openParcel(r.parid)}>
                  <span className="pl-card-top"><span className="pl-rank">{page * PAGE_SIZE + i + 1}</span> <b>{label(r)}</b></span>
                  <span className="pl-card-mid"><span className="pl-score"><b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} /></span> {bestText(r)}</span>
                  <span className="pl-card-sub">{[r.neighborhood, r.zoning, `${MOST_BY_RIGHT}: ${r.by_right_units ?? "—"}`, ownerShort(r)].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="pl-scroll">
            <table className="pl-table">
              <caption className="es-sr">Ranked lots, by {SORT_TEXT[sort] ?? sort}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Parcel</th>
                  <th scope="col">Neighborhood</th>
                  <th scope="col">Zoning</th>
                  <th scope="col" className="num">Lot sq ft</th>
                  <th scope="col">Owner type</th>
                  <th scope="col">Ease Score</th>
                  <th scope="col">Best option</th>
                  <th scope="col" className="num">{MOST_BY_RIGHT}</th>
                  <th scope="col">My lots</th>
                </tr>
              </thead>
              <tbody style={loading ? { opacity: 0.55 } : undefined}>
                {rows.map((r, i) => {
                  const id = r.parid.trim();
                  const pinned = pinnedIds.includes(id);
                  return (
                    <tr key={r.parid} className={`${open === id ? "is-focus" : ""}${pinned ? " is-pinned" : ""}`} onClick={() => openParcel(id)}>
                      <td className="pl-rank">{page * PAGE_SIZE + i + 1}</td>
                      <td className="pl-parcel"><button type="button" className="pl-linkbtn" onClick={(e) => { e.stopPropagation(); openParcel(id); }}>{label(r)}</button></td>
                      <td>{r.neighborhood ?? "—"}</td>
                      <td>{r.zoning ?? "not loaded"}</td>
                      <td className="num">{r.lot_sqft != null ? Math.round(r.lot_sqft).toLocaleString("en-US") : "—"}</td>
                      <td>{ownerShort(r)}</td>
                      <td><span className="pl-score"><b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} />{r.red_flag_count ? <span className="pl-flag" title={r.red_flags.map((f) => f.title).join("; ")}>Blocked</span> : null}</span></td>
                      <td>{bestText(r)}</td>
                      <td className="num">{r.by_right_units ?? "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="es-btn es-btn-ghost dv-pin" aria-pressed={pinned} disabled={!pinned && lots.length >= MAX_LOTS}
                          onClick={() => togglePin(r)} aria-label={`${pinned ? "Remove" : "Pin"} ${label(r)} ${pinned ? "from" : "to"} My lots`}>{pinned ? "Pinned" : "Pin"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!loading && result && !rows.length ? <p className="pl-note">No lots match these filters. <button type="button" className="pl-linkbtn" onClick={reset}>Clear filters</button></p> : null}
          {!result && !loading ? <p className="pl-note">Scores could not load right now. Try again in a moment.</p> : null}
          <div className="pl-foot">
            <span className="pl-spacer" />
            <span className="tabular">{from.toLocaleString("en-US")}-{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
            <SeatButton variant="ghost" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</SeatButton>
            <SeatButton variant="ghost" disabled={to >= total || loading} onClick={() => setPage((p) => p + 1)}>Next</SeatButton>
          </div>
          <p className="pl-note">Ease Score (measures barriers to building, not whether it's a good investment) is precomputed for the best option that adds homes; where a municipality's zoning is not loaded the lot reads Partial, has no score and sorts last (score config v{(options?.config_versions ?? []).join(", v") || "—"}). Homes by right come from our lot-fit test under the zoning rules. Money columns (margin, residual land value) are not stored per lot; open a lot and use its Pro forma. Decision support only.</p>
        </section>
      </div>
    </SeatLayout>
  );
}

function MyLots({ lots, onOpen, onRemove, onClear }: { lots: PlannerRow[]; onOpen: (id: string) => void; onRemove: (id: string) => void; onClear: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const dupAddr = useMemo(() => duplicateAddresses(lots), [lots]);
  const label = (r: PlannerRow) => parcelLabel(r, dupAddr.has(titleCase(r.address)));
  return (
    <section className="dv-lots" aria-labelledby="dv-lots-h">
      <div className="dv-lots-head">
        <h2 id="dv-lots-h">My lots <span className="pl-sub">({lots.length} of {MAX_LOTS})</span></h2>
        <span className="pl-sub">Saved in this browser only. No account.</span>
        <span className="pl-spacer" />
        {lots.length ? <SeatButton variant="ghost" aria-expanded={expanded} aria-controls="dv-lots-body" onClick={() => setExpanded((x) => !x)}>{expanded ? "Hide comparison" : "Compare side by side"}</SeatButton> : null}
        {lots.length ? <SeatButton variant="ghost" onClick={onClear}>Clear</SeatButton> : null}
      </div>
      {!lots.length ? <p className="pl-sub dv-lots-empty">Pin up to {MAX_LOTS} lots from the table or the parcel pane to compare them here.</p> : null}
      {lots.length && expanded ? (
        <div id="dv-lots-body" className="dv-lots-scroll">
          <table className="pl-table dv-compare">
            <caption className="es-sr">My lots compared side by side</caption>
            <thead>
              <tr><th scope="col">Lot</th><th scope="col">Ease Score</th><th scope="col">Best option</th><th scope="col" className="num">{MOST_BY_RIGHT}</th><th scope="col" className="num">Lot sq ft</th><th scope="col">Zoning</th><th scope="col">Owner type</th><th scope="col"><span className="es-sr">Actions</span></th></tr>
            </thead>
            <tbody>
              {lots.map((r) => {
                const id = r.parid.trim();
                return (
                  <tr key={id}>
                    <th scope="row"><button type="button" className="pl-linkbtn" onClick={() => onOpen(id)}>{label(r)}</button></th>
                    <td><span className="pl-score"><b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} />{r.red_flag_count ? <span className="pl-flag">Blocked</span> : null}</span></td>
                    <td>{bestText(r)}</td>
                    <td className="num">{r.by_right_units ?? "—"}</td>
                    <td className="num">{r.lot_sqft != null ? Math.round(r.lot_sqft).toLocaleString("en-US") : "—"}</td>
                    <td>{r.zoning ?? "not loaded"}</td>
                    <td>{ownerShort(r)}</td>
                    <td><button type="button" className="es-btn es-btn-ghost" onClick={() => onRemove(id)} aria-label={`Remove ${label(r)} from My lots`}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pl-note">Margin and residual land value are priced per lot in each lot&apos;s Pro forma; they are not stored, so they are not compared here.</p>
        </div>
      ) : null}
    </section>
  );
}
