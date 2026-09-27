// Plan view of a QuickFit v2 Scheme as SVG (front lot line at the bottom): street, curbs and sidewalks,
// neighbors, setback band, buildable area, floodway, lot line with edge labels, the footprint with unit
// and step lines, continuous driveways with curb cuts, garages and pads, entries, dimensions, north arrow
// and a 40 ft scale bar. Ported from the QuickFit v2 harness (harness/harness.ts plan()); edges carry
// data-edge so a click (or Enter on the focused edge) can set the front lot line.

import type { Pt, Ring, Scheme } from "./core";

export interface PlanInput {
  s: Scheme;
  localRing: Pt[];
  edges: { i: number; a: Pt; b: Pt; kind: string; setbackFt: number; alley?: boolean }[];
  buildable: Pt[][][] | null;
  streetName: string;
  /** World (lot-local) feet. */
  neighbors: { parcel?: Ring; building?: Ring }[];
  floodway: Ring[];
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function planSvg(p: PlanInput): { viewBox: string; body: string } {
  const { s } = p;
  const fr = s.frame;
  const L = (q: number[]) => { const d = [q[0]! - fr.origin[0], q[1]! - fr.origin[1]]; return [d[0]! * fr.ux[0] + d[1]! * fr.ux[1], d[0]! * fr.uy[0] + d[1]! * fr.uy[1]]; };
  const ring = p.localRing;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const q of ring) { minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]); maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]); }
  minx -= 36; maxx += 36; miny -= 44;
  const pad = 8, W = maxx - minx + pad * 2, H = maxy - miny + pad * 2;
  const X = (x: number) => x - minx + pad, Y = (y: number) => (maxy - y) + pad;
  const pts = (r: number[][]) => r.map((q) => `${X(q[0]!).toFixed(1)},${Y(q[1]!).toFixed(1)}`).join(" ");
  let o = `<defs><pattern id="qf2h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#000" stroke-width=".35"/></pattern><pattern id="qf2sb" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#9aa5a0" stroke-width=".5"/></pattern></defs>`;
  o += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  o += `<rect x="${X(minx)}" y="${Y(-5)}" width="${maxx - minx}" height="30" fill="#d9dcda"/><line x1="${X(minx)}" y1="${Y(-5)}" x2="${X(maxx)}" y2="${Y(-5)}" stroke="#000" stroke-width=".6"/><line x1="${X(minx)}" y1="${Y(-35)}" x2="${X(maxx)}" y2="${Y(-35)}" stroke="#000" stroke-width=".6"/><line x1="${X(minx)}" y1="${Y(-20)}" x2="${X(maxx)}" y2="${Y(-20)}" stroke="#555" stroke-width=".4" stroke-dasharray="10 3 2 3"/>`;
  o += `<rect x="${X(minx)}" y="${Y(0)}" width="${maxx - minx}" height="5" fill="#f1f2f1"/><rect x="${X(minx)}" y="${Y(-35)}" width="${maxx - minx}" height="5" fill="#f1f2f1"/>`;
  o += `<text x="${X((minx + maxx) / 2)}" y="${Y(-20) - 2}" class="el" text-anchor="middle">${esc(p.streetName.toUpperCase())}</text>`;
  for (const n of p.neighbors) {
    if (n.parcel) o += `<polygon points="${pts(n.parcel.map(L))}" fill="none" stroke="#7d8784" stroke-width=".5" stroke-dasharray="6 2 1 2"/>`;
    if (n.building) o += `<polygon points="${pts(n.building.map(L))}" fill="#e3e6e4" stroke="#4f5956" stroke-width=".6"/>`;
  }
  o += `<polygon points="${pts(ring)}" fill="url(#qf2sb)" stroke="none"/>`;
  if (p.buildable) for (const poly of p.buildable) o += `<polygon points="${pts(poly[0]!)}" fill="#fff" stroke="#156b54" stroke-width=".6" stroke-dasharray="1.5 1.5"/>`;
  for (const c of p.floodway) o += `<polygon points="${pts(c.map(L))}" fill="rgba(60,120,200,.18)" stroke="#3c78c8" stroke-width=".5"/>`;
  o += `<polygon points="${pts(ring)}" fill="none" stroke="#000" stroke-width="1.2" stroke-dasharray="8 2 1.5 2 1.5 2"/>`;
  const KIND: Record<string, string> = { front: "FRONT", rear: "REAR", side: "SIDE", streetSide: "STREET SIDE" };
  for (const e of p.edges) {
    const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
    o += `<text x="${X(mx)}" y="${Y(my) + (e.kind === "front" ? 11 : e.kind === "rear" ? -5 : 0)}" class="el" text-anchor="middle">${KIND[e.kind] ?? e.kind} ${e.setbackFt}'${e.alley ? " · ALLEY" : ""}</text>`;
  }
  if (s.footprintLocal) {
    const f = s.footprintLocal;
    o += `<polygon points="${pts(f)}" fill="url(#qf2h)" stroke="#000" stroke-width="1.6"/>`;
    const xs = new Set<number>();
    for (const b of s.massing) if ((b.kind === "unit" || b.kind === "core") && b.w < s.widthFt - 0.1) { xs.add(Math.round(b.x * 10) / 10); xs.add(Math.round((b.x + b.w) * 10) / 10); }
    for (const x of xs) if (x > f[0]![0] + 0.2 && x < f[1]![0] - 0.2) o += `<line x1="${X(x)}" y1="${Y(f[0]![1])}" x2="${X(x)}" y2="${Y(f[2]![1])}" stroke="#000" stroke-width="1"/>`;
    const site = s.site as { parking: { drives: { x: number; y: number; w: number; d: number }[]; curbCuts: [number, number][]; stalls: { x: number; y: number; w: number; d: number }[]; garages: unknown[] }; segments: { x0: number; x1: number; y0: number; y1: number; floorElev: number }[]; openings: { kind: string; x: number; y: number; w: number }[] } | undefined;
    if (site) {
      for (const dv of site.parking.drives) {
        o += `<rect x="${X(dv.x)}" y="${Y(dv.y + dv.d)}" width="${dv.w}" height="${dv.d}" fill="#e9ebea" stroke="#333" stroke-width=".45"/>`;
        const cx = X(dv.x + dv.w / 2), cy = Y(Math.max(1, dv.y + dv.d / 2));
        o += `<text x="${cx}" y="${cy}" class="el" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})">DRIVEWAY</text>`;
      }
      for (const [c0, c1] of site.parking.curbCuts) o += `<line x1="${X(c0)}" y1="${Y(-5)}" x2="${X(c1)}" y2="${Y(-5)}" stroke="#fff" stroke-width="1.6"/><path d="M${X(c0)} ${Y(-5)} l1.5 -1.5 M${X(c1)} ${Y(-5)} l-1.5 -1.5" stroke="#333" stroke-width=".5"/>`;
      for (const st of site.parking.stalls) {
        const gar = site.parking.garages.includes(st);
        o += `<rect x="${X(st.x)}" y="${Y(st.y + st.d)}" width="${st.w}" height="${st.d}" fill="${gar ? "none" : "#e3e6e4"}" stroke="#333" stroke-width=".5" ${gar ? 'stroke-dasharray="1.6 1"' : ""}/><text x="${X(st.x + st.w / 2)}" y="${Y(st.y + st.d / 2)}" class="el" text-anchor="middle">${gar ? "GARAGE" : "P"}</text>`;
      }
      for (const sg of site.segments) if (sg.x0 > f[0]![0] + 0.2) o += `<line x1="${X(sg.x0)}" y1="${Y(sg.y0)}" x2="${X(sg.x0)}" y2="${Y(sg.y1)}" stroke="#000" stroke-width="1.1"/>`;
      if (site.segments.length > 1 && s.typology !== "townhouse_row") for (const sg of site.segments.slice(1)) o += `<line x1="${X(sg.x0)}" y1="${Y(sg.y0)}" x2="${X(sg.x1)}" y2="${Y(sg.y0)}" stroke="#000" stroke-width=".7" stroke-dasharray="3 1.5"/><text x="${X(sg.x1) + 2}" y="${Y(sg.y0) + 1.5}" class="el">STEP ${Math.round((sg.floorElev - site.segments[0]!.floorElev) * 10) / 10}'</text>`;
      for (const op of site.openings.filter((q) => q.kind === "door")) o += `<path d="M${X(op.x + op.w / 2) - 1.8} ${Y(op.y) + 3.2} L${X(op.x + op.w / 2) + 1.8} ${Y(op.y) + 3.2} L${X(op.x + op.w / 2)} ${Y(op.y) + 0.6} Z" fill="#000"/>`;
    }
    const [x0, y0] = f[0]!, [x1] = f[1]!, y1 = f[2]![1];
    o += `<text x="${X((x0 + x1) / 2)}" y="${Y(y0) + 9}" class="dim" text-anchor="middle">${s.widthFt}'</text><text x="${X(x1) + 3}" y="${Y((y0 + y1) / 2)}" class="dim">${s.depthFt}'</text>`;
    o += `<rect x="${X((x0 + x1) / 2) - 26}" y="${Y((y0 + y1) / 2) - 8}" width="52" height="14" fill="#fff" stroke="#000" stroke-width=".4"/><text x="${X((x0 + x1) / 2)}" y="${Y((y0 + y1) / 2) + 2}" class="el" text-anchor="middle">${s.units.length} HOME${s.units.length > 1 ? "S" : ""} · ${s.stories} ST</text>`;
  }
  // clickable lot edges (set the front lot line)
  for (const e of p.edges) o += `<line data-edge="${e.i}" x1="${X(e.a[0])}" y1="${Y(e.a[1])}" x2="${X(e.b[0])}" y2="${Y(e.b[1])}" stroke="${e.kind === "front" ? "#b45309" : "transparent"}" stroke-width="${e.kind === "front" ? 2.2 : 6}" stroke-opacity="${e.kind === "front" ? 0.9 : 0}" pointer-events="stroke" class="qf2-edge" tabindex="0" role="button" aria-label="Lot edge ${e.i + 1} (${(KIND[e.kind] ?? e.kind).toLowerCase()}): make it the front"><title>Edge ${e.i + 1}: ${(KIND[e.kind] ?? e.kind).toLowerCase()}. Click to make it the front.</title></line>`;
  {
    const nx = W - 16, ny = 18;
    const ang = Math.atan2(-s.frame.uy[0], s.frame.uy[1]) * 180 / Math.PI;
    o += `<g transform="translate(${nx} ${ny}) rotate(${ang.toFixed(1)})"><circle r="7" fill="#fff" stroke="#000" stroke-width=".5"/><path d="M0 -9 L3 3 L0 1 L-3 3 Z" fill="#000"/></g><text x="${nx}" y="${ny + 13}" class="el" text-anchor="middle">N</text>`;
  }
  {
    const sx = pad + 4, sy = H - 12;
    for (let k = 0; k < 4; k++) o += `<rect x="${sx + k * 10}" y="${sy}" width="10" height="2" fill="${k % 2 ? "#fff" : "#000"}" stroke="#000" stroke-width=".3"/>`;
    o += `<text x="${sx}" y="${sy - 1.5}" class="dim">0</text><text x="${sx + 40}" y="${sy - 1.5}" class="dim" text-anchor="middle">40'</text>`;
  }
  return { viewBox: `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`, body: o };
}
