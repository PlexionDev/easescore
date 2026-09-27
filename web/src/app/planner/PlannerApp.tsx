"use client";

// Planner seat, "Compare and rank sites": filter rail, map + ranked table (synced), summary rail,
// compare tray, exports (CSV, sources CSV, staff memo PDF), saved lists and planning-badge settings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DataDateFooter, EmptyState, ExportMenu, SeatButton, SeatHeader, SeatLayout, SeatSelect, Segmented, setSelection, type ExportAction,
} from "@/components/seats";
import {
  BADGE_PRIVATE_NOTE, CITY, DEFAULT_DIR, PAGE_SIZE, clean, describeFilters, filtersToQuery, parseDir, parseFilters, parseSort, titleCase,
  type Dir, type Filters, type PlannerOptions, type PlannerPoint, type PlannerResult, type PlannerRow, type Sort,
} from "@/lib/planner";
import PlannerFilters from "./PlannerFilters";
import PlannerSummary from "./PlannerSummary";
import PlannerTable from "./PlannerTable";
import CompareTray from "./CompareTray";
import ParcelDrawer from "./ParcelDrawer";
import BadgeSettings, { badgeTier, loadProfile, type BadgeConfig, type BadgeProfile } from "./BadgeSettings";
import SavedLists, { type SavedList } from "./SavedLists";
import "./planner.css";

const PlannerMap = dynamic(() => import("./PlannerMap"), { ssr: false, loading: () => <div className="es-map" style={{ position: "absolute", inset: 0 }} aria-hidden="true" /> });

const MAX_PINS = 5;
const PIN_KEY = "easescore.planner.pins";
const SORT_TEXT: Record<Sort, string> = {
  score: "score", months: "months to permit", by_right_units: "by-right yield", units_with_relief: "yield with approvals",
  lot: "lot size", transit: "distance to transit", address: "address", neighborhood: "neighborhood", zoning: "zoning",
};

function queryString(f: Filters, sort: Sort, dir: Dir, page = 0) {
  const q = filtersToQuery(f);
  if (sort !== "score") q.set("sort", sort);
  if (dir !== DEFAULT_DIR[sort]) q.set("dir", dir);
  if (page) q.set("page", String(page));
  return q.toString();
}

async function download(url: string, fallbackName: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function PlannerApp({ options, initial, initialFilters, initialSort, initialDir, initialPage, badgeConfig, dataDates }: {
  options: PlannerOptions | null;
  initial: PlannerResult | null;
  initialFilters: Filters;
  initialSort: Sort;
  initialDir: Dir;
  initialPage: number;
  badgeConfig: BadgeConfig;
  dataDates: { name: string; date: string }[];
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<Sort>(initialSort);
  // "Table only" hides the map: the ranked table lists the same parcels and is the map's equal.
  const [tableOnly, setTableOnly] = useState(false);
  const [dir, setDir] = useState<Dir>(initialDir);
  const [page, setPage] = useState(initialPage);
  const [result, setResult] = useState<PlannerResult | null>(initial);
  const [points, setPoints] = useState<PlannerPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<PlannerRow | null>(null);
  const [pins, setPins] = useState<PlannerRow[]>([]);
  const [profile, setProfile] = useState<BadgeProfile | null>(null);
  const [dialog, setDialog] = useState<"badge" | "lists" | null>(null);
  const [listCount, setListCount] = useState(0);
  const first = useRef(true);

  useEffect(() => { setProfile(loadProfile()); }, []);
  // Privacy: the planning-priority badge (its "vacant and tax-delinquent" criterion can reveal a private
  // owner's tax status) is shown only for publicly owned land.
  const badgeFor = useCallback((r: PlannerRow) => (r.owner_class === "public" ? badgeTier(r, badgeConfig, profile) : BADGE_PRIVATE_NOTE), [badgeConfig, profile]);

  // Table + summary: refetch on filter / sort / page change (the first render uses the server result).
  useEffect(() => {
    const qs = queryString(filters, sort, dir, page);
    window.history.replaceState(null, "", qs ? `/planner?${qs}` : "/planner");
    if (first.current) { first.current = false; if (initial) return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/planner/query?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((r: PlannerResult) => setResult(r))
      .catch((e) => { if ((e as Error).name !== "AbortError") setResult(null); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [filters, sort, dir, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map points: only the filters matter. One automatic retry, then a visible "Retry".
  const filterKey = filtersToQuery(filters).toString();
  const [pointsState, setPointsState] = useState<"loading" | "ok" | "error">("loading");
  const [pointsTry, setPointsTry] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setPointsState("loading");
    const load = (attempt: number): Promise<void> =>
      fetch(`/api/planner/points?${filterKey}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((p: PlannerPoint[]) => { setPoints(Array.isArray(p) ? p : []); setPointsState("ok"); })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          if (attempt === 0) return new Promise<void>((res) => setTimeout(res, 1500)).then(() => load(1));
          setPointsState("error");
        });
    void load(0);
    return () => ctrl.abort();
  }, [filterKey, pointsTry]);

  // Pins: restore once, remember in this browser, and share with the other seats.
  const restorePins = useCallback((ids: string[]) => {
    if (!ids.length) { setPins([]); return; }
    fetch(`/api/planner/query?ids=${encodeURIComponent(ids.slice(0, MAX_PINS).join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: PlannerResult | null) => {
        if (!r) return;
        const byId = new Map(r.rows.map((x) => [x.parid.trim(), x]));
        setPins(ids.map((id) => byId.get(id)).filter((x): x is PlannerRow => !!x));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let ids: unknown = [];
    try { ids = JSON.parse(window.localStorage.getItem(PIN_KEY) ?? "[]"); } catch { ids = []; }
    if (Array.isArray(ids)) restorePins(ids.filter((x): x is string => typeof x === "string"));
  }, [restorePins]);
  const pinned = useMemo(() => pins.map((p) => p.parid), [pins]);
  useEffect(() => {
    const ids = pins.map((p) => p.parid.trim());
    try { window.localStorage.setItem(PIN_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
    setSelection({ parids: ids, municipality: filters.muni ? titleCase(filters.muni) : undefined, neighborhood: filters.hoods?.length === 1 ? filters.hoods[0] : undefined });
  }, [pins, filters.muni, filters.hoods]);
  const togglePin = useCallback((row: PlannerRow) => {
    setPins((ps) => (ps.some((p) => p.parid === row.parid) ? ps.filter((p) => p.parid !== row.parid) : ps.length >= MAX_PINS ? ps : [...ps, row]));
  }, []);

  const set = useCallback((patch: Partial<Filters>) => { setFilters((f) => clean({ ...f, ...patch })); setPage(0); }, []);
  const reset = () => { setFilters(clean({ muni: filters.muni })); setPage(0); };
  const activeFilters = describeFilters(filters).slice(1); // [0] is the municipality
  const onSort = (s: Sort) => {
    if (s === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(s); setDir(DEFAULT_DIR[s]); }
    setPage(0);
  };

  // Map clicks open the drawer; the row comes from this page or is fetched.
  const openParcel = useCallback((parid: string) => {
    const row = result?.rows.find((r) => r.parid === parid);
    if (row) { setOpen(row); return; }
    fetch(`/api/planner/query?ids=${encodeURIComponent(parid.trim())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: PlannerResult | null) => { if (r?.rows[0]) setOpen(r.rows[0]); })
      .catch(() => {});
  }, [result]);

  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const qsNoPage = queryString(filters, sort, dir);
  const shortlist = pinned.length ? pinned.map((p) => p.trim()) : rows.slice(0, 10).map((r) => r.parid.trim());
  const memoUrl = `/api/planner/memo?${qsNoPage}${qsNoPage ? "&" : ""}shortlist=${shortlist.join(",")}${pinned.length ? "&pinned=1" : ""}`;
  const csvUrl = `/api/planner/export?${qsNoPage}`;

  const exportActions: ExportAction[] = [
    { id: "csv", label: "Filtered table", format: "CSV", description: `${total.toLocaleString("en-US")} rows, same order as the table`, onSelect: () => download(csvUrl, "easescore-planner.csv"), disabled: !total, disabledReason: "No rows match" },
    { id: "sources", label: "Sources and data dates", format: "CSV", description: "Every dataset behind the scores, with dates", onSelect: () => download("/api/planner/export?kind=sources", "easescore-planner-sources.csv") },
    { id: "memo", label: "Staff memo", format: "PDF", description: pinned.length ? `Cover + ${pinned.length} pinned parcel${pinned.length === 1 ? "" : "s"}` : "Cover + the top 10 in this list", onSelect: () => download(memoUrl, "easescore-staff-memo.pdf"), disabled: !total && !pinned.length, disabledReason: "No rows match" },
  ];

  const muniOptions = useMemo(() => {
    // Only label a municipality "not scored yet" when the options loaded and it has no rows at all.
    const scored = options ? new Set(options.municipalities) : null;
    const names = [...new Set([CITY, ...(options?.all_municipalities ?? []).map((m) => m.name)])];
    return names.map((n) => ({ value: n, label: `${n === CITY ? "City of Pittsburgh" : titleCase(n)}${scored && !scored.has(n) && n !== filters.muni ? " (not scored yet)" : ""}` }));
  }, [options, filters.muni]);
  const versions = Object.entries(options?.version_counts ?? {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const rescoring = versions.length > 1 ? `Rescoring under score config v${versions[0]![0]}: ${versions[0]![1].toLocaleString("en-US")} of ${versions.reduce((t, [, n]) => t + n, 0).toLocaleString("en-US")} parcels done; the rest still show v${versions.slice(1).map(([v]) => v).join(", v")}. ` : "";
  const muniScored = !filters.muni || (options?.municipalities ?? []).includes(filters.muni) || total > 0;

  const header = (
    <SeatHeader
      seat="planner"
      controls={<SeatSelect label="Municipality" value={filters.muni ?? CITY} options={muniOptions} onChange={(v) => set({ muni: v, hoods: v === CITY ? filters.hoods : undefined })} />}
      actions={<>
        <SeatButton onClick={() => setDialog("lists")}>Saved lists{listCount ? ` (${listCount})` : ""}</SeatButton>
        <SeatButton onClick={() => setDialog("badge")}>Priority settings</SeatButton>
        <ExportMenu actions={exportActions} />
      </>}
    />
  );

  return (
    <>
      <SeatLayout
        header={header}
        mainLabel="Map and ranked sites"
        left={<PlannerFilters f={filters} options={options} set={set} reset={reset} counts={result ? { total } : null} />}
        right={<PlannerSummary s={muniScored ? result : null} f={filters} set={set} loading={loading} />}
        bottom={pins.length ? <CompareTray rows={pins} onRemove={(id) => setPins((ps) => ps.filter((p) => p.parid !== id))} onClear={() => setPins([])} onFocus={(r) => setOpen(r)} badgeFor={badgeFor} /> : null}
        footer={<DataDateFooter sources={dataDates}
          note={`${rescoring}Scores precomputed for ${(options?.total ?? 0).toLocaleString("en-US")} parcels (${["City of Pittsburgh", ...(options?.municipalities ?? []).filter((m) => m !== CITY).map(titleCase)].join(", ")}) with score config v${(options?.config_versions ?? []).join(", v")}${options?.computed_at ? ` (latest ${options.computed_at.slice(0, 10)})` : ""}; policy what-ifs off. Score and band describe the best option that adds homes. Outside the City, zoning rules are not loaded, so scores are ranges.`} />}
      >
        <div className="pl-top">
          <p className="es-sr" role="status">{result ? `${total.toLocaleString("en-US")} parcel${total === 1 ? "" : "s"} match these filters, sorted by ${SORT_TEXT[sort]}.` : ""}</p>
          <div className="pl-viewbar">
            <Segmented<"map" | "table"> label="View" size="sm" value={tableOnly ? "table" : "map"} onChange={(v) => setTableOnly(v === "table")}
              options={[{ value: "map", label: "Map and table" }, { value: "table", label: "Table view" }]} />
            <span className="pl-sub">The ranked table lists the same parcels as the map, in score order, with every value as text.</span>
          </div>
          {tableOnly ? null : <div className="pl-map">
            <PlannerMap points={points} total={total} blockers={(result?.top_blockers ?? []).map((b) => b.blocker)} hover={hover} selected={open?.parid ?? null}
              pinned={pinned} onHover={setHover} onSelect={openParcel} fitKey={filterKey} />
            {pointsState !== "ok" ? (
              <div className="pl-mapstate" role="status">
                {pointsState === "loading" ? "Loading map points…" : <>Map points could not load. <button type="button" className="es-btn es-btn-ghost" onClick={() => setPointsTry((n) => n + 1)}>Retry</button></>}
              </div>
            ) : null}
          </div>}
          {!muniScored ? (
            <div style={{ padding: 16 }}>
              <EmptyState dataset={`Scores for ${titleCase(filters.muni)}`}>
                Only City of Pittsburgh parcels are scored so far. Outside the City, zoning rules are not loaded, so scores there will show as ranges with a
                &ldquo;zoning not loaded&rdquo; note. Pick the City of Pittsburgh to rank sites now.
              </EmptyState>
            </div>
          ) : (
            <PlannerTable
              head={<><h2>Ranked sites</h2><span className="pl-sub">sorted by {SORT_TEXT[sort]}{dir !== DEFAULT_DIR[sort] ? " (reversed)" : ""} · {pinned.length} pinned</span>
                {activeFilters.length ? <span className="pl-sub">Showing: {activeFilters.join(" · ")} · <button type="button" className="pl-linkbtn" onClick={reset}>Clear filters</button></span> : null}</>}
              actions={<>
                <SeatButton onClick={() => void download(csvUrl, "easescore-planner.csv")} disabled={!total}>Export CSV</SeatButton>
                <SeatButton variant="primary" onClick={() => void download(memoUrl, "easescore-staff-memo.pdf")} disabled={!total && !pinned.length}>Staff memo PDF</SeatButton>
              </>}
              foot={<>
                <div className="pl-foot">
                  <span className="pl-spacer" />
                  <span className="tabular">{from.toLocaleString("en-US")}-{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
                  <SeatButton variant="ghost" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</SeatButton>
                  <SeatButton variant="ghost" disabled={to >= total || loading} onClick={() => setPage((p) => p + 1)}>Next</SeatButton>
                </div>
                <p className="pl-note">Hazards: F floodway, L landslide-prone, U undermined, S a quarter or more of the lot steeper than 25%. Months to permit are estimates. Planning badge: {profile ? `profile “${profile.name}”` : "default weights, awaiting planning input"}; it never changes the score.</p>
              </>}
              rows={rows} offset={page * PAGE_SIZE} sort={sort} dir={dir} onSort={onSort} hover={hover} selected={open?.parid ?? null}
              pinned={pinned} onHover={setHover} onOpen={setOpen} onPin={togglePin} loading={loading} badgeFor={badgeFor}
            />
          )}
        </div>
      </SeatLayout>
      <ParcelDrawer row={open} onClose={() => setOpen(null)} pinned={!!open && pinned.includes(open.parid)} onPin={() => { if (open) togglePin(open); }} badge={open ? badgeFor(open) : null} />
      <BadgeSettings open={dialog === "badge"} onClose={() => setDialog(null)} cfg={badgeConfig} profile={profile} onChange={setProfile} />
      <SavedLists open={dialog === "lists"} onClose={() => setDialog(null)} query={qsNoPage} pinned={pinned.map((p) => p.trim())} onCount={setListCount}
        onOpen={(l: SavedList) => {
          const q = new URLSearchParams(l.query);
          const s = parseSort(q.get("sort"));
          setFilters(parseFilters(q)); setSort(s); setDir(parseDir(q.get("dir"), s)); setPage(0);
          restorePins(l.pinned);
        }} />
    </>
  );
}
