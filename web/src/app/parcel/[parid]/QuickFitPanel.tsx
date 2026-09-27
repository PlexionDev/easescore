"use client";

// "Change the plan" drawer: a short summary of the scheme on the map (the QuickFit 3D generator's
// controls live on the map now) with a small plan thumbnail, the approvals it needs and the fit notes.

import { boxColor, type GenResult } from "@/lib/quickfit-gen";
import { controlsLabel } from "./MetricsBar";

function Thumb({ parcel, result }: { parcel: [number, number][]; result: GenResult }) {
  const xs = parcel.map((p) => p[0]), ys = parcel.map((p) => p[1]);
  const pad = 6;
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const path = (r: [number, number][]) => r.map((p, i) => `${i ? "L" : "M"}${(p[0] - minX).toFixed(1)},${(maxY - p[1]).toFixed(1)}`).join("") + "Z";
  const sw = Math.max(maxX - minX, maxY - minY) / 120;
  const ground = result.boxes.filter((b) => b.floor <= 0);
  return (
    <svg viewBox={`0 0 ${maxX - minX} ${maxY - minY}`} className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 bg-slate-50" role="img" aria-label="Small plan of the lot with the scheme's footprint">
      {result.envelope.map((poly, i) => poly.map((r, j) => <path key={`e${i}${j}`} d={path(r as [number, number][])} fill="#22c55e" fillOpacity={0.12} stroke="#16a34a" strokeDasharray={`${sw * 3} ${sw * 2}`} strokeWidth={sw} />))}
      <path d={path(parcel)} fill="none" stroke="#ca8a04" strokeWidth={sw * 1.6} />
      {ground.map((b, i) => <path key={i} d={path(b.ring)} fill={boxColor(b)} fillOpacity={0.85} />)}
    </svg>
  );
}

export default function QuickFitPanel({ parcel, result, notes }: { parcel: [number, number][] | null; result: GenResult | null; notes: string[] }) {
  if (!result) return <p className="text-sm text-slate-600">Loading the lot geometry…</p>;
  const s = result.scheme;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-3">
        {parcel && parcel.length >= 3 && <Thumb parcel={parcel} result={result} />}
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{s ? `${s.typologyLabel}: ${s.units} home${s.units === 1 ? "" : "s"}, ${s.stories} stor${s.stories === 1 ? "y" : "ies"}` : "Nothing fits with these settings"}</p>
          <p className="text-xs text-slate-500">{controlsLabel(result.controls)}</p>
          {s && <p className="text-xs text-slate-600">{s.unitWidthFt} ft wide × {s.unitDepthFt} ft deep · {Math.round(s.grossFloorAreaSf).toLocaleString("en-US")} sq ft gross · {s.lotCoveragePct}% coverage · {s.badge === "by_right" ? "by right" : s.badge === "needs_approval" ? "needs approval" : "not permitted"}</p>}
          <p className="mt-1 text-xs text-slate-700">{result.reason ?? result.binding}</p>
        </div>
      </div>
      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">Change the building type, stories, unit width, parking and setbacks with <b>Build it in 3D</b> on the map; the layout, the metrics bar, the score option and the pro forma follow.</p>
      {result.approvals.length > 0 && (
        <ul className="text-xs text-amber-900">{result.approvals.map((a, i) => <li key={i}>Needs: {a}</li>)}</ul>
      )}
      <ul className="text-[11px] text-slate-500">
        {[...new Set([...result.notes, ...notes])].map((r, i) => <li key={i}>• {r}</li>)}
        <li>• Buildable area {Math.round(result.envelopeSf).toLocaleString("en-US")} sq ft of a {Math.round(result.lotSf).toLocaleString("en-US")} sq ft lot; {result.tried} layouts checked.</li>
        <li>• Unit sizes, stories, stair cores, parking stalls and the stepping threshold are editable placeholders, not recommendations.</li>
      </ul>
    </div>
  );
}
