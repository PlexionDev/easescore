"use client";

// Side drawer with a compact parcel pane, from the precomputed planner row: score and band, red flags
// and caps, every blocker, key facts, the seven factor bars, and links to the full Developer view.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { BandPill, SeatButton } from "@/components/seats";
import { BAND_COLOR, FACTORS, FT_PER_M, NO_BAND_COLOR, STRATEGY_TEXT, ownerLabel, parcelLabel, titleCase, type PlannerRow } from "@/lib/planner";

export default function ParcelDrawer({ row, onClose, pinned, onPin, badge }: {
  row: PlannerRow | null; onClose: () => void; pinned: boolean; onPin: () => void; badge: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (row && !d.open) d.showModal();
    if (!row && d.open) d.close();
  }, [row]);
  const r = row;
  const color = r?.band ? BAND_COLOR[r.band] ?? NO_BAND_COLOR : NO_BAND_COLOR;
  return (
    <dialog ref={ref} className="es-seat pl-drawer" aria-labelledby="pl-drawer-h" onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {r ? (
        <div className="pl-drawer-inner">
          <div className="pl-drawer-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id="pl-drawer-h">{parcelLabel(r)}</h2>
              <p>{[r.neighborhood ?? titleCase(r.municipality), r.zoning ?? "zoning not loaded", ownerLabel(r), `parcel ${r.parid.trim()}`].join(" · ")}</p>
            </div>
            <SeatButton variant="ghost" onClick={onClose} autoFocus>Close</SeatButton>
          </div>
          <div className="pl-drawer-body">
            <div className="pl-bigscore">
              <b>{r.score ?? "—"}</b><BandPill band={r.band} score={r.score} />
              {r.range_lo != null ? <span className="pl-hint">{r.preliminary ? "Preliminary: " : "Range with missing data: "}{r.range_lo} to {r.range_hi}</span> : null}
            </div>
            {!r.zoning ? <p className="pl-callout amber">Zoning rules for {titleCase(r.municipality) || "this municipality"} are not loaded, so the zoning factor is left out and the score is shown as a range. Confirm zoning with {titleCase(r.municipality) || "the municipality"}.</p> : null}
            <p className="pl-hint" style={{ marginTop: -10 }}>Best option that adds homes: {r.best_strategy ? STRATEGY_TEXT[r.best_strategy] ?? r.best_strategy : "none scored"}. Rehab of the existing building: {r.rehab_score != null ? `${r.rehab_score} (${r.rehab_band})` : "no building"}.</p>
            {r.red_flags.map((f) => <p key={f.id} className="pl-callout red"><strong>Blocked unless resolved:</strong> {f.title}</p>)}
            {r.cap_label ? <p className="pl-callout amber">{r.cap_label}</p> : null}
            {r.note ? <p className="pl-callout amber">{r.note}</p> : null}
            <section>
              <h3 style={{ fontSize: 13, fontWeight: 650 }}>What holds it back</h3>
              {r.blockers.length ? <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{r.blockers.map((b) => <li key={b}>{b}</li>)}</ol>
                : <p className="pl-hint">Nothing costs a full point.</p>}
            </section>
            <div className="pl-facts">
              <div className="pl-fact"><span>Homes by right</span><b>{r.by_right_units ?? "—"}</b></div>
              <div className="pl-fact"><span>With relief</span><b>{r.units_with_relief ?? "—"}</b></div>
              <div className="pl-fact"><span>Months to permit (est.)</span><b>{r.months_to_permit != null ? `~${r.months_to_permit}` : "—"}</b></div>
              <div className="pl-fact"><span>Lot</span><b>{r.lot_sqft != null ? `${Math.round(r.lot_sqft).toLocaleString("en-US")} sq ft` : "—"}</b></div>
              <div className="pl-fact"><span>To frequent transit</span><b>{r.transit_m != null ? `${Math.round((r.transit_m * FT_PER_M) / 10) * 10} ft` : "—"}</b></div>
              <div className="pl-fact"><span>Planning badge</span><b style={{ fontSize: 13 }}>{badge ?? "None"}</b></div>
            </div>
            <section aria-label="Factor scores">
              <h3 style={{ fontSize: 13, fontWeight: 650 }}>Factors (0-100, higher is easier)</h3>
              {FACTORS.map((f) => {
                const v = r.factor_scores?.[f.id] ?? null;
                return (
                  <div key={f.id} className="pl-fbar">
                    <div><span>{f.label} <span className="pl-hint">({f.weight}%)</span></span><span>{v == null ? "no data" : Math.round(v)}</span></div>
                    <i aria-hidden="true">{v != null ? <b style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: color }} /> : null}</i>
                  </div>
                );
              })}
            </section>
            <p className="pl-hint">Precomputed with score config v{r.config_version} on {r.computed_at.slice(0, 10)}. The Developer view recomputes it live with the full receipts, pro forma and checklist.</p>
          </div>
          <div className="pl-drawer-foot">
            <Link className="es-btn es-btn-primary" href={`/parcel/${encodeURIComponent(r.parid.trim())}`}>Open in Developer view</Link>
            <SeatButton onClick={onPin}>{pinned ? "Unpin" : "Pin to compare"}</SeatButton>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
