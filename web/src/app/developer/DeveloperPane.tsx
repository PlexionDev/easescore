"use client";

// Developer parcel pane (right rail): the quick view's one-screen layout in compact form, from the
// precomputed parcel_scores row. Address or parcel ID (copy), photo (the quick view's PanePhoto),
// red flags above the score, Ease Score + band + one sentence, four buildability tiles, the best option,
// then Pro forma · Feasibility study, which open the parcel's quick view where the live pro forma runs
// (its layout is the map's QuickFit 3D tab). A parcel with no precomputed row (outside the scored area) still opens,
// with its parcel ID, zoning and owner type and a link to score it live.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BandPill, SeatButton } from "@/components/seats";
import { partialText, relabelBands, SCORE_CAPTION } from "@easescore/engine/src/score/bands";
import { ownerLabel, partialBest, partialNote, titleCase, type PlannerResult, type PlannerRow } from "@/lib/planner";
import { addressLine, briefs, type Brief } from "@/lib/parcel-brief";
import { MOST_BY_RIGHT, bestWithHomes } from "@/lib/best-option";
import PanePhoto from "../parcel/[parid]/PanePhoto";
import CopyParcelId from "../parcel/[parid]/CopyParcelId";

type FC = { type: "FeatureCollection"; bbox: [number, number, number, number]; center: [number, number]; features: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** The lot outline and its neighbors (the same parcel_map read the quick view streams), for the photo slot. */
function mapStage(parid: string): Promise<{ mapData: FC | null }> {
  return fetch(`${SUPA}/rest/v1/rpc/parcel_map`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_parid: parid }),
  }).then((r) => (r.ok ? r.json() : null)).then((mapData: FC | null) => ({ mapData })).catch(() => ({ mapData: null }));
}

const SENTENCE: Record<string, string> = {
  Easy: "Few barriers to building the best option that adds homes, on the data we have.",
  Moderate: "Some barriers to resolve first.",
  Hard: "Significant barriers; expect approvals, site work or both.",
  "Very hard": "Major barriers on the data we have.",
};

export function useParcelRow(parid: string | null, known: PlannerRow | null): { row: PlannerRow | null; state: "loading" | "ok" | "none" | "error" } {
  const [got, setGot] = useState<{ id: string; row: PlannerRow | null; err: boolean } | null>(null);
  useEffect(() => {
    if (!parid || known) return;
    let live = true;
    fetch(`/api/planner/query?ids=${encodeURIComponent(parid)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((r: PlannerResult) => { if (live) setGot({ id: parid, row: r.rows.find((x) => x.parid.trim() === parid) ?? null, err: false }); })
      .catch(() => { if (live) setGot({ id: parid, row: null, err: true }); });
    return () => { live = false; };
  }, [parid, known]);
  if (known) return { row: known, state: "ok" };
  if (!parid || got?.id !== parid) return { row: null, state: "loading" };
  return got.err ? { row: null, state: "error" } : got.row ? { row: got.row, state: "ok" } : { row: null, state: "none" };
}

export default function DeveloperPane({ parid, known, pinned, canPin, onPin, onClose }: {
  parid: string | null;
  /** The row when it is already on this page of the table. */
  known: PlannerRow | null;
  pinned: boolean;
  canPin: boolean;
  onPin: (row: PlannerRow) => void;
  onClose: () => void;
}) {
  const { row, state } = useParcelRow(parid, known);
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    if (!parid || row) return;
    let live = true;
    void briefs([parid]).then(([b]) => { if (live && b) setBrief(b); });
    return () => { live = false; };
  }, [parid, row]);
  // Not in the scores because it is not a housing lot (the Planner's "Other public land" list).
  const [otherLand, setOtherLand] = useState<{ id: string; reason: string | null } | null>(null);
  useEffect(() => {
    if (!parid || state !== "none") return;
    let live = true;
    fetch(`${SUPA}/rest/v1/planner_other_public_land?select=reason&parid=eq.${encodeURIComponent(parid)}`, { headers: { apikey: KEY } })
      .then((r) => (r.ok ? r.json() : [])).then((x: { reason: string }[]) => { if (live) setOtherLand({ id: parid, reason: x[0]?.reason ?? null }); })
      .catch(() => { if (live) setOtherLand({ id: parid, reason: null }); });
    return () => { live = false; };
  }, [parid, state]);
  const stage = useMemo(() => (parid ? mapStage(parid) : null), [parid]);
  const today = new Date().toISOString().slice(0, 10);

  if (!parid) {
    return (
      <div className="dv-pane dv-pane-empty">
        <h2>Parcel</h2>
        <p>Pick a lot in the table, search for an address or parcel ID, or click a parcel on the map (zoom in to street level to open any parcel, including lots with no address).</p>
      </div>
    );
  }
  const href = `/parcel/${encodeURIComponent(parid)}`;
  const address = row ? addressLine(row.address) : brief?.address ?? "Parcel";
  const r = row;
  const steepPct = r?.steep_share != null ? Math.round(r.steep_share * 100) : null;
  const hz = r ? [r.hz_floodway && "Floodway", r.hz_landslide && "Landslide", r.hz_undermined && "Undermined"].filter(Boolean) as string[] : [];
  const tiles: [string, string, string | null][] = r ? [
    ["Lot size", r.lot_sqft != null ? `${Math.round(r.lot_sqft).toLocaleString("en-US")} sq ft` : "Not on record", r.lot_sqft != null ? `${(r.lot_sqft / 43560).toFixed(2)} acre` : null],
    ["Steep land", steepPct != null ? `${steepPct}%` : "No data", steepPct != null ? "of lot over 25% slope" : null],
    ["Hazards", hz.length ? hz[0]! : "None mapped", hz.length > 1 ? `+${hz.length - 1} more` : "in our data"],
    ["Zoning", r.zoning ?? "Not loaded", titleCase(r.municipality) || null],
  ] : [];
  // The best option with its own home count; the most homes by right across all types is labeled separately.
  const best = r ? bestWithHomes(r) : null;

  return (
    <div className="dv-pane">
      <header>
        <div className="dv-pane-head">
          <h2 id="dv-pane-h">{address}</h2>
          <SeatButton variant="ghost" onClick={onClose} aria-label="Close parcel">Close</SeatButton>
        </div>
        <CopyParcelId parid={parid} />
        <p className="dv-sub">
          {r ? [r.neighborhood ?? (titleCase(r.municipality) || null), r.zoning ? `Zoning ${r.zoning}` : "Zoning not in our data", ownerLabel(r)].filter(Boolean).join(" · ")
            : brief ? [brief.zoning ? `Zoning ${brief.zoning}` : "Zoning not in our data", brief.owner].filter(Boolean).join(" · ") : ""}
        </p>
      </header>
      {stage ? <div className="dv-photo"><PanePhoto key={parid} stage={stage} date={today} /></div> : null}
      {state === "loading" ? <p className="dv-hint" role="status">Loading this parcel…</p> : null}
      {state === "error" ? <p className="pl-callout amber">Scores could not load right now. The quick view below computes this parcel live.</p> : null}
      {state === "none" ? (
        <p className="pl-callout amber">{otherLand?.id === parid && otherLand.reason ? `${partialText("not_housing", { use: otherLand.reason })}. No Ease Score and no pro forma.` : "This parcel is not in our precomputed scores (scores cover the City of Pittsburgh). Open the quick view to score it live."}</p>
      ) : null}
      {r ? (
        <>
          {r.red_flags.map((f) => <p key={f.id} className="pl-callout red"><strong>Blocked unless resolved:</strong> {f.title}</p>)}
          <div className="dv-score">
            <b>{r.score ?? "—"}</b>
            <div>
              <BandPill band={r.band} score={r.score} />
              <p>{r.band === "Partial" ? `${partialNote(r)}. No Ease Score; only the known facts below (lot, slope, hazards, existing building) apply.` : r.band ? SENTENCE[r.band] : "Not enough evidence to score this lot."}{r.range_lo != null ? ` Range with missing data: ${r.range_lo} to ${r.range_hi}.` : ""}</p>
              {r.band !== "Partial" && r.score != null ? <p className="dv-hint">{SCORE_CAPTION}</p> : null}
            </div>
          </div>
          <div className="dv-tiles">
            {tiles.map(([k, v, sub]) => (
              <div key={k} className="dv-tile"><span>{k}</span><b title={v}>{v}</b>{sub ? <small>{sub}</small> : null}</div>
            ))}
          </div>
          <p className="dv-best"><b>Best option:</b> {r.band === "Partial" ? partialBest(r) : best ?? "none scored"}{r.band !== "Partial" && best ? `. ${MOST_BY_RIGHT}: ${r.by_right_units ?? "—"}${r.units_with_relief != null && r.units_with_relief !== r.by_right_units ? ` (${r.units_with_relief} with relief)` : ""}` : ""}{r.top_blocker ? `. Top blocker: ${r.top_blocker.toLowerCase()}` : ""}.</p>
          {r.cap_label ? <p className="pl-callout amber">{relabelBands(r.cap_label)}</p> : null}
          {r.note ? <p className="pl-callout amber">{r.note}</p> : null}
        </>
      ) : null}
      {(() => {
        // Existing building or unverifiable lot: no Pro forma or Feasibility study (the parcel page shows the same note).
        const pr = (r as { partial_reason?: string | null } | null)?.partial_reason ?? null;
        const note = otherLand?.id === parid && otherLand.reason ? partialText("not_housing", { use: otherLand.reason }).replace(/^./, (m) => m.toLowerCase())
          : pr === "use" || pr === "footprint" || pr === "not_lot" ? "an existing major building stands on this lot"
          : pr === "no_outline" || pr === "lot_mismatch" || pr === "large_site" || pr === "not_housing" ? partialText(pr).replace(/^./, (m) => m.toLowerCase()) : null;
        return note ? <p className="pl-callout">Not modeled: {note}. EaseScore screens vacant and underused lots for new homes.</p> : (
          <div className="dv-actions">
            <Link className="es-btn" href={`${href}#drawer=pencils`}>Pro forma</Link>
            <a className="es-btn" href={`${href}/report`} target="_blank" rel="noopener">Feasibility study<span className="es-sr"> (opens in a new tab)</span></a>
          </div>
        );
      })()}
      <div className="dv-actions2">
        {r ? <SeatButton onClick={() => onPin(r)} disabled={!pinned && !canPin} title={!pinned && !canPin ? "My lots holds 10" : undefined}>{pinned ? "Remove from My lots" : "Pin to My lots"}</SeatButton> : null}
        <Link href={href} className="dv-link">Open the quick view</Link>
        {r?.band === "Partial" ? null : <Link href={`${href}#view=build`} className="dv-link">QuickFit 3D tab</Link>}
      </div>
      {r ? <p className="dv-hint">Precomputed with score config v{r.config_version} on {r.computed_at.slice(0, 10)}. The quick view recomputes it live with receipts, the pro forma and the checklist.</p> : null}
      <p className="dv-hint">Decision support only: not legal, financial, zoning or engineering advice.</p>
    </div>
  );
}
