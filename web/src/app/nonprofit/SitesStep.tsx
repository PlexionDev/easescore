"use client";

// Step 2 — "Where could we build?": candidate lots in the area (public, vacant, no red flags by
// default), each with its owning agency, by-right homes, flags and a typical acquisition path.
// Scattered-site mode: tick several small lots to treat them as one project.

import dynamic from "next/dynamic";
import { BandPill, CheckboxField, EmptyState, Segmented } from "@/components/seats";
import { TYPICAL_NOTE, acquisitionPath, statusNote } from "@/lib/nonprofit/acquisition";
import { MAX_LOTS, STRATEGY_TEXT, shortParid, type Site, type SiteFilters, type SitesResult } from "@/lib/nonprofit/types";
import type { Layer } from "./AreaMap";

const AreaMap = dynamic(() => import("./AreaMap"), { ssr: false, loading: () => <div className="np-map-skel" aria-hidden="true" /> });

const title = (s: Site) => {
  const a = (s.address ?? "").trim();
  return a ? a.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : `Parcel ${shortParid(s.parid)}`;
};

export default function SitesStep({ hood, result, loading, filters, onFilters, selected, onToggle, perLot, onNext, tracts, layer, outline, bbox }: {
  hood: string;
  result: SitesResult | null;
  loading: boolean;
  filters: SiteFilters;
  onFilters: (f: SiteFilters) => void;
  selected: string[];
  onToggle: (parid: string) => void;
  perLot: number;
  onNext: () => void;
  tracts: GeoJSON.FeatureCollection | null;
  layer: Layer;
  outline: GeoJSON.Geometry | null;
  bbox: [number, number, number, number] | null;
}) {
  const rows = result?.rows ?? [];
  const chosen = selected.map((p) => rows.find((r) => r.parid.trim() === p)).filter(Boolean) as Site[];
  const full = selected.length >= MAX_LOTS;

  return (
    <div className="np-grid np-grid-sites">
      <div className="np-col">
        <div className="np-filters" role="group" aria-label="Which lots to show">
          <CheckboxField label="Publicly owned" checked={filters.public} onChange={(v) => onFilters({ ...filters, public: v })} />
          <CheckboxField label="Vacant" checked={filters.vacant} onChange={(v) => onFilters({ ...filters, vacant: v })} />
          <CheckboxField label="No red flags" checked={filters.clean} onChange={(v) => onFilters({ ...filters, clean: v })} />
          <Segmented<string> label="Homes allowed by right" size="sm" value={String(filters.minUnits)} onChange={(v) => onFilters({ ...filters, minUnits: Number(v) })}
            options={[{ value: "0", label: "Any" }, { value: "1", label: "1+" }, { value: "2", label: "2+" }, { value: "3", label: "3+" }]} />
        </div>
        <p className="np-sub" aria-live="polite">
          {loading ? "Loading lots…" : result ? `${result.total.toLocaleString("en-US")} lot${result.total === 1 ? "" : "s"} in ${hood} match${result.total === 1 ? "es" : ""}${result.total > rows.length ? `; showing the ${rows.length} highest-scoring` : ""}.` : ""}
          {" "}Scores are the Ease Score (how hard a lot is to build on), not a measure of need.
        </p>
        {!loading && result && !rows.length ? (
          <EmptyState tone="empty" title="No lots match these filters">Try allowing lots with 1 home by right, or turn off “No red flags”.</EmptyState>
        ) : null}
        <ul className="np-sites" aria-busy={loading || undefined}>
          {rows.map((s) => {
            const id = s.parid.trim();
            const on = selected.includes(id);
            const path = acquisitionPath(s.agency, s.tax_delinquent, s.owner_class);
            const st = statusNote(s.agency_status);
            const flags = s.red_flags ?? [];
            return (
              <li key={id} className={`np-site${on ? " is-on" : ""}`}>
                <label className="np-site-pick">
                  <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onToggle(id)} />
                  <span className="es-sr">Add {title(s)} to the project</span>
                </label>
                <div className="np-site-main">
                  <div className="np-site-top">
                    <strong>{title(s)} <span className="np-muted np-pid">{shortParid(id)}</span></strong>
                    <span className="np-site-score"><BandPill band={s.band} score={s.score} />{s.score != null ? <span className="np-muted" aria-hidden="true"> {s.score}</span> : null}</span>
                  </div>
                  <p className="np-site-meta">
                    {s.agency ?? (s.owner_class === "public" ? "Public owner" : "Private owner")}
                    {st ? <> · <span className={st.tone === "ok" ? "np-ok" : "np-warn"}>{st.text}</span></> : null}
                  </p>
                  <p className="np-site-facts">
                    <span><b>{s.by_right_units ?? "?"}</b> home{s.by_right_units === 1 ? "" : "s"} by right</span>
                    {s.lot_sqft ? <span>{Math.round(Number(s.lot_sqft)).toLocaleString("en-US")} sq ft lot</span> : null}
                    {s.zoning ? <span>Zoning {s.zoning}</span> : null}
                    {s.qct ? <span className="np-ok">QCT</span> : null}
                    <span className={flags.length ? "np-bad" : "np-ok"}>{flags.length ? `${flags.length} red flag${flags.length > 1 ? "s" : ""}: ${flags.map((f) => f.title).join("; ")}` : "No red flags"}</span>
                  </p>
                  {s.top_blocker ? <p className="np-site-meta">Biggest drag on the score: {s.top_blocker.toLowerCase()}{s.best_strategy ? ` · easiest build: ${STRATEGY_TEXT[s.best_strategy] ?? s.best_strategy}` : ""}</p> : null}
                  {path ? (
                    <details className="np-acq">
                      <summary>How to get this lot <span className="np-typical">Typical</span></summary>
                      <p className="np-acq-title">{path.title}</p>
                      <ol>{path.steps.map((x) => <li key={x}>{x}</li>)}</ol>
                      <p className="np-muted">Typical time: {path.typicalMonths[0]}–{path.typicalMonths[1]} months. {path.note} Contact: {path.where}.</p>
                      <p className="np-foot">{TYPICAL_NOTE}</p>
                    </details>
                  ) : null}
                  <a className="np-link" href={`/parcel/${id}`} target="_blank" rel="noreferrer">Open the full parcel check ↗</a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="np-col np-sticky">
        <div className="np-mapbox">
          <AreaMap tracts={tracts} layer={layer} outline={outline} bbox={bbox} sites={rows} selected={selected} onSite={onToggle} ariaLabel={`Map of candidate lots in ${hood}; selected lots are filled green`} minHeight={360} />
        </div>
        <section className="np-card np-scatter" aria-labelledby="scatter-h">
          <div className="np-card-head"><h3 id="scatter-h">Scattered-site project</h3><span className="np-muted">{selected.length} of up to {MAX_LOTS} lots</span></div>
          {chosen.length ? (
            <ul className="np-chosen">
              {chosen.map((s) => (
                <li key={s.parid}><span>{title(s)} <span className="np-muted np-pid">{shortParid(s.parid.trim())}</span></span><span className="np-muted">{s.agency ?? ""}</span><button type="button" className="es-btn es-btn-ghost" onClick={() => onToggle(s.parid.trim())}>Remove</button></li>
              ))}
            </ul>
          ) : <p className="np-muted">Tick lots in the list or on the map to group them into one project.</p>}
          <p className="np-muted">Treating several small lots as one project shares design, legal and financing costs and lets one application cover every home. {selected.length ? `${selected.length} lots × ${perLot} homes = ${selected.length * perLot} homes.` : ""}</p>
          <button type="button" className="es-btn es-btn-primary" disabled={!selected.length} onClick={onNext}>Next: what&apos;s the gap? →</button>
        </section>
      </div>
    </div>
  );
}
