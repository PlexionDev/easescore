"use client";

import { useEffect, useRef, useState } from "react";
import type { quickfit } from "@easescore/engine";
import type { ViewMode } from "./ViewModes";

// "Describe this view": the map and 3D views in words, built from the same numbers they draw (lot, hazards,
// setbacks, the studied building). A screen-reader or keyboard user gets what the picture shows, and
// anyone can read it. Changes to the layout are also announced (aria-live) once the visitor edits the plan.

/** Server facts for the description (from the parcel pane). */
export interface ViewFacts {
  address: string;
  parid: string;
  zoning: string | null;
  lotSf: number | null;
  slopeMeanPct: number | null;
  over25Share: number | null;
  /** Hazard and rule overlays with the share of the lot inside each (0-1). */
  overlays: { label: string; share: number }[];
  floodwayShare: number | null;
  floodZoneShare: number | null;
}

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (s: number) => `${Math.round(s * 100)}%`;

const MODE_TEXT: Record<ViewMode, string> = {
  photoreal: "3D Photoreal view: Google's photoreal 3D city with the lot outlined in yellow and the studied building as blocks",
  terrain: "3D Terrain view: the ground from 1 m lidar with 5 ft contour lines, the lot outlined in yellow and the studied building as blocks",
  analysis: "2D Analysis view: a flat plan of the lot with the map layers you turn on (slope classes, hazards, zoning)",
};

/** One short summary of the studied building (also what is announced when it changes). */
export function schemeSentence(s: quickfit.Scheme | null, reason: string | null, lotSf: number | null): string {
  if (!s) return reason ? `No building fits with these settings: ${reason}` : "No building is drawn for this option.";
  const cover = lotSf ? `, ${Math.round((100 * s.footprintSf) / lotSf)}% of the lot` : "";
  return `${s.typologyLabel}, ${s.units} home${s.units === 1 ? "" : "s"}, ${s.stories} ${s.stories === 1 ? "story" : "stories"} (about ${n0(s.heightFt)} ft tall), each home ${n0(s.unitWidthFt)} by ${n0(s.unitDepthFt)} ft, footprint about ${n0(s.footprintSf)} sq ft${cover}; ${s.byRight ? "allowed by right" : "needs zoning approval"}.`;
}

export function describeParcelView(p: {
  mode: ViewMode;
  facts: ViewFacts;
  scheme: quickfit.Scheme | null;
  reason: string | null;
  binding: string | null;
  envelopeSf: number | null;
  code: { front: number | null; side: number | null; rear: number | null };
  existingOnLot: number;
  neighborBuildings: number;
}): string[] {
  const f = p.facts;
  const out: string[] = [];
  out.push(`${MODE_TEXT[p.mode]}. ${f.address}, parcel ${f.parid}${f.zoning ? `, zoned ${f.zoning}` : ""}.`);
  const lot: string[] = [];
  if (f.lotSf) lot.push(`The lot is ${n0(f.lotSf)} sq ft`);
  if (f.slopeMeanPct != null) lot.push(`average slope ${Math.round(f.slopeMeanPct)}%`);
  if (f.over25Share != null) lot.push(`${pct(f.over25Share)} of it steeper than 25%`);
  if (lot.length) out.push(`${lot.join(", ")}.`);
  const haz = f.overlays.filter((o) => o.share > 0).map((o) => `${pct(o.share)} of the lot is in ${o.label}`);
  if (f.floodwayShare) haz.push(`${pct(f.floodwayShare)} is in the FEMA floodway`);
  else if (f.floodZoneShare) haz.push(`${pct(f.floodZoneShare)} is in the FEMA 100-year flood zone`);
  out.push(haz.length ? `${haz.join("; ")}.` : "No mapped hazard or rule overlay covers the lot.");
  out.push(p.existingOnLot ? `${p.existingOnLot} existing building${p.existingOnLot === 1 ? "" : "s"} on the lot (amber in 3D Terrain).` : "No existing building on the lot.");
  const sb = [p.code.front != null ? `front ${n0(p.code.front)} ft` : null, p.code.side != null ? `sides ${n0(p.code.side)} ft` : null, p.code.rear != null ? `rear ${n0(p.code.rear)} ft` : null].filter(Boolean);
  if (sb.length) out.push(`Setbacks by code: ${sb.join(", ")} (green dashed line).`);
  if (p.envelopeSf) out.push(`Area left to build on inside the setbacks: about ${n0(p.envelopeSf)} sq ft.`);
  out.push(`Studied building: ${schemeSentence(p.scheme, p.reason, f.lotSf)}`);
  if (p.binding) out.push(p.binding.endsWith(".") ? p.binding : `${p.binding}.`);
  if (p.neighborBuildings) out.push(`${p.neighborBuildings} neighboring building${p.neighborBuildings === 1 ? "" : "s"} are shown around the lot for context.`);
  return out;
}

/** The toggle, placed in the view switch row (never under the floating panels). */
export function DescribeButton({ open, onToggle, controls, btnRef }: { open: boolean; onToggle: () => void; controls: string; btnRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <button ref={btnRef} type="button" aria-label={open ? "Hide description" : "Describe this view"} aria-expanded={open} aria-controls={controls} onClick={onToggle}
      className="min-h-8 whitespace-nowrap rounded-full border border-white/40 bg-slate-900/75 px-3 py-1.5 text-sm font-semibold text-slate-100 shadow-xl backdrop-blur-md hover:bg-slate-900/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
      {open ? "Hide description" : <>Describe<span className="hidden lg:inline"> this view</span></>}
    </button>
  );
}

/** The text panel (placed by the page above the floating panels) and the polite live region for layout changes. */
export default function DescribeView({ id, open, onClose, lines, announce, className = "" }: {
  id: string; open: boolean; onClose: () => void; lines: string[]; announce: string | null; className?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);
  const [live, setLive] = useState("");
  // Announce the new layout a moment after it settles (not every intermediate step of a slider drag).
  useEffect(() => {
    if (!announce) return;
    const t = setTimeout(() => setLive(`Layout updated. ${announce}`), 900);
    return () => clearTimeout(t);
  }, [announce]);
  return (
    <>
      {open && (
        <section id={id} ref={panel} aria-label="Description of the map view" tabIndex={-1}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          className={`max-h-[55vh] overflow-y-auto rounded-2xl border border-white/50 bg-white/95 p-3 text-left text-sm leading-snug text-slate-800 shadow-xl backdrop-blur-md focus:outline-none ${className}`}>
          {lines.map((l, i) => <p key={i} className={i ? "mt-1.5" : "font-medium"}>{l}</p>)}
          <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
            Keyboard: Tab to the map, then arrow keys move (in 3D Photoreal they orbit and tilt), + and − zoom. The panel on the left and the Feasibility Study have the same numbers as text. Esc closes this.
          </p>
        </section>
      )}
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </>
  );
}
