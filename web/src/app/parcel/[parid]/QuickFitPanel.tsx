"use client";

// "Change the plan" drawer: a short summary of the QuickFit v2 scheme in "Build it in 3D" (the controls
// live over the view): size, status, the rule that limits it, the approvals it needs and the notes.

import { STATUS_WORDS, type Scheme } from "@/lib/qf2/core";

export default function QuickFitPanel({ scheme }: { scheme: Scheme | null }) {
  if (!scheme) return <p className="text-sm text-slate-700">Solving the lot…</p>;
  const s = scheme;
  const d = (s as unknown as { debug?: { buildableSqft?: number } }).debug;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold text-slate-900">{s.footprintWorld ? `${s.typologyLabel}: ${s.units.length} home${s.units.length === 1 ? "" : "s"}, ${s.stories} stor${s.stories === 1 ? "y" : "ies"}` : `${s.typologyLabel}: ${STATUS_WORDS[s.status]}`}</p>
      {s.footprintWorld && <p className="text-xs text-slate-700">{s.widthFt} ft wide × {s.depthFt} ft deep · {s.grossSqft.toLocaleString("en-US")} sq ft gross · {s.netSqft.toLocaleString("en-US")} sq ft livable · {s.lotCoverage}% coverage · {s.heightFt} ft tall · parking {s.parking.count} of {s.parking.required}</p>}
      <p className="text-xs text-slate-800">{STATUS_WORDS[s.status]}: {s.statusSentence}</p>
      {s.bindingConstraint && <p className="text-xs font-medium text-slate-900">{s.bindingConstraint.sentence}</p>}
      {s.unlock && <p className="text-xs text-slate-800">What if: {s.unlock.sentence}</p>}
      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">Change the building type, stories, width, depth, parking, the front lot line and setbacks with <b>Build it in 3D</b>; the layout, the metrics bar, the score option and the pro forma follow.</p>
      {s.approvalsNeeded.length > 0 && <ul className="text-xs text-amber-950">{s.approvalsNeeded.map((a, i) => <li key={i}>Needs {a.kind.replace(/_/g, " ")}: {a.detail}{a.code ? ` (${a.code})` : ""}</li>)}</ul>}
      <ul className="text-[11px] text-slate-700">
        {s.flags.map((r, i) => <li key={i}>• {r}</li>)}
        {d?.buildableSqft != null && <li>• Buildable area {d.buildableSqft.toLocaleString("en-US")} sq ft of a {s.lotSqft.toLocaleString("en-US")} sq ft lot; solved in {s.solveMs} ms ({s.solverVersion}).</li>}
        <li>• Unit sizes, floor heights, stair cores and parking dimensions are editable placeholders, not recommendations.</li>
      </ul>
    </div>
  );
}
