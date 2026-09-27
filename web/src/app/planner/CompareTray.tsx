"use client";

// Compare tray (up to 5 pinned parcels): score, top blockers, by-right vs. relief units, hazards,
// months to permit and the seven factor bars side by side, each linking to the Developer view.

import { useState } from "react";
import Link from "next/link";
import { FACTORS, bandLabel, partialBest, parcelLabel, titleCase, type PlannerRow } from "@/lib/planner";
import { bestWithHomes } from "@/lib/best-option";

export default function CompareTray({ rows, onRemove, onClear, onFocus, badgeFor }: {
  rows: PlannerRow[];
  onRemove: (parid: string) => void;
  onClear: () => void;
  onFocus: (r: PlannerRow) => void;
  badgeFor: (r: PlannerRow) => string | null;
}) {
  // Starts collapsed to a one-line bar (pins restored from an earlier visit shouldn't cover the map and the list).
  const [collapsed, setCollapsed] = useState(true);
  if (!rows.length) return null;
  return (
    <section className={`pl-tray${collapsed ? " is-collapsed" : ""}`} aria-label="Compare pinned parcels">
      <div className="pl-tray-head">
        <h2>Compare ({rows.length} of 5)</h2>
        {collapsed ? null : <p>Factor sub-scores 0-100, higher is easier.</p>}
        <span className="pl-spacer" />
        <button type="button" className="pl-tray-btn" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>{collapsed ? "Show" : "Hide"}</button>
        <button type="button" className="pl-tray-btn" onClick={onClear}>Clear all</button>
      </div>
      {collapsed ? null : <>
      <div className="pl-tray-cards">
        {rows.map((r) => {
          const hz = [r.hz_floodway && "floodway", r.hz_landslide && "landslide-prone", r.hz_undermined && "undermined", (r.steep_share ?? 0) >= 0.25 && "steep"].filter(Boolean).join(", ");
          return (
            <article key={r.parid} className="pl-cmp">
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <button type="button" className="pl-tray-btn" style={{ flex: 1, minWidth: 0, padding: 0, textAlign: "left" }} onClick={() => onFocus(r)}>
                  <h3>{parcelLabel(r)}</h3>
                  <span className="pl-cmp-sub">{r.neighborhood ?? titleCase(r.municipality)}{r.zoning ? `, ${r.zoning}` : ""}</span>
                </button>
                <button type="button" className="pl-tray-btn" onClick={() => onRemove(r.parid)} aria-label={`Unpin ${parcelLabel(r)}`}>✕</button>
              </div>
              <dl>
                <dt>Score</dt><dd><strong>{r.score ?? "—"}</strong> {r.band ? bandLabel(r.band) : ""}</dd>
                <dt>Top blockers</dt><dd style={{ whiteSpace: "normal", maxWidth: 140 }}>{r.blockers.slice(0, 2).join(", ") || "None major"}</dd>
                <dt>Best new homes</dt><dd>{r.band === "Partial" ? partialBest(r) : bestWithHomes(r) ?? "—"}</dd>
                <dt>Most homes by right, any type / with relief</dt><dd>{r.by_right_units ?? "—"} / {r.units_with_relief ?? "—"}</dd>
                <dt>Months to permit</dt><dd>{r.months_to_permit != null ? `~${r.months_to_permit}` : "—"}</dd>
                <dt>Hazards</dt><dd>{hz || "none mapped"}</dd>
                <dt>Rehab existing</dt><dd>{r.rehab_score != null ? `${r.rehab_score} ${bandLabel(r.rehab_band, "")}` : r.band === "Partial" && !r.vacant ? "not scored" : "no building"}</dd>
                <dt>Planning badge</dt><dd>{badgeFor(r) ?? "None"}</dd>
              </dl>
              <div className="pl-cmp-bars">
                {FACTORS.map((f) => {
                  const v = r.factor_scores?.[f.id] ?? null;
                  return (
                    <div key={f.id} className="pl-cmp-bar">
                      <div><span>{f.label}</span><span>{v == null ? "—" : Math.round(v)}</span></div>
                      <i aria-hidden="true">{v != null ? <b style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /> : null}</i>
                    </div>
                  );
                })}
              </div>
              <p style={{ marginTop: 8 }}><Link href={`/parcel/${encodeURIComponent(r.parid.trim())}`}>Open in Developer view →</Link></p>
            </article>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "#c9d4cf", marginTop: 6 }}>Whether a project pencils is in each parcel&apos;s Developer view; the planner table carries site ease, not the pro forma.</p>
      </>}
    </section>
  );
}
