// Site layout thumbnail for the parcel pane (server component): the lot, the setback band, the buildable
// area and the footprint of the option's QuickFit v2 Scheme, front lot line at the bottom. Drawn from the
// same solve the pro forma prices (lib/parcel-plan.ts), so it matches QuickFit and the report.

import { buildable as buildableOf, classify } from "@easescore/engine/src/quickfit2/src/geom";
import { solveFor, type AppControls, type Pt, type Qf2Data, type Scheme } from "@/lib/qf2/core";

type Geo = { localRing: Pt[]; buildable: Pt[][][] | null };

function geoOf(s: Scheme, input: Parameters<typeof classify>[0] | null): Geo | null {
  const d = (s as unknown as { debug?: { localRing: Pt[]; buildable: Pt[][][] } }).debug;
  if (d?.localRing) return { localRing: d.localRing, buildable: d.buildable ?? null };
  if (!input) return null;
  try {
    const c = classify(input, { typology: s.typology });
    return { localRing: c.localRing, buildable: buildableOf(c.localRing, c.edges, (input.floodway ?? []).map((r) => r.map(c.toLocal))).buildable as Pt[][][] };
  } catch {
    return null;
  }
}

export default function SiteThumb({ scheme, qf2, controls, label }: {
  /** The priced scheme (plan.v2), when the selected option is a new build. */
  scheme: Scheme | null;
  qf2: Qf2Data | null;
  /** Controls to solve when `scheme` is null (the best new-build option's priced layout). */
  controls: AppControls | null;
  /** Option name for the caption, e.g. "New single-family". */
  label: string | null;
}) {
  let s = scheme;
  let input = null as Parameters<typeof classify>[0] | null;
  if (qf2 && (!s || !(s as unknown as { debug?: unknown }).debug) && controls) {
    try { const r = solveFor(qf2, controls); if (r) { s = s ?? r.scheme; input = r.input; } } catch { /* thumbnail only */ }
  }
  const geo = s ? geoOf(s, input) : null;
  if (!s || !geo || geo.localRing.length < 3) {
    return (
      <figure className="m-0 min-w-0">
        <div className="grid h-[132px] place-items-center rounded-xl border border-dashed border-slate-300 bg-white/60 p-2 text-center text-[11px] text-slate-600">
          {!qf2 ? "No lot outline in our data, so no layout is drawn." : !qf2.rules ? "This municipality's zoning rules are not in our data (City of Pittsburgh only), so no layout is drawn." : "No layout fits this lot at code."}
        </div>
        <figcaption className="mt-0.5 truncate text-[10px] text-slate-600">Site layout</figcaption>
      </figure>
    );
  }
  const ring = geo.localRing;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const pad = Math.max(maxx - minx, maxy - miny) * 0.06 + 2;
  const street = Math.max(6, (maxy - miny) * 0.08);
  const W = maxx - minx + pad * 2, H = maxy - miny + pad * 2 + street;
  const X = (x: number) => (x - minx + pad).toFixed(1), Y = (y: number) => (maxy - y + pad).toFixed(1);
  const pts = (r: Pt[]) => r.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ");
  const fp = s.footprintLocal;
  const n = s.units.length;
  const what = fp ? `${label ?? s.typologyLabel}: ${n} home${n === 1 ? "" : "s"}, ${s.stories} stor${s.stories === 1 ? "y" : "ies"}, ${s.widthFt} by ${s.depthFt} ft footprint` : `${label ?? s.typologyLabel}: ${s.statusSentence}`;
  const sw = Math.max(W, H) / 160;
  return (
    <figure className="m-0 min-w-0">
      <div className="h-[132px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <svg viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img"
          aria-label={`Site layout: the lot with setbacks (hatched), the buildable area (dashed green) and the footprint (dark). ${what}.`}>
          <defs>
            <pattern id="st-sb" width={sw * 4} height={sw * 4} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2={sw * 4} stroke="#94a3b8" strokeWidth={sw * 0.7} />
            </pattern>
          </defs>
          <rect x="0" y={H - street} width={W} height={street} fill="#e2e8f0" />
          <polygon points={pts(ring)} fill="url(#st-sb)" />
          {geo.buildable?.map((poly, i) => poly[0] && <polygon key={i} points={pts(poly[0])} fill="#ecfdf5" stroke="#047857" strokeWidth={sw * 0.8} strokeDasharray={`${sw * 2} ${sw * 1.5}`} />)}
          <polygon points={pts(ring)} fill="none" stroke="#0f172a" strokeWidth={sw * 1.2} />
          {fp && <polygon points={pts(fp)} fill="#334155" stroke="#0f172a" strokeWidth={sw} />}
        </svg>
      </div>
      <figcaption className="mt-0.5 truncate text-[10px] text-slate-600" title={what}>{fp ? `Site layout · ${label ?? s.typologyLabel}, ${n} home${n === 1 ? "" : "s"}` : "Site layout · lot and setbacks"}</figcaption>
    </figure>
  );
}
