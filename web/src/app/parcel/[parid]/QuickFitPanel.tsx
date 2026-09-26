"use client";

import { useMemo, useState } from "react";
import { quickfit } from "@easescore/engine";

type QFInput = {
  parcel: [number, number][];
  frontEdges: number[];
  streetSideEdges: number[];
  masks: { label: string; mode: "cut" | "flag"; polygon: [number, number][][] }[];
  zbaCounts: quickfit.ZbaCountRow[];
  notes: (string | null)[];
};

const GOALS: { id: quickfit.Goal; label: string }[] = [
  { id: "most_units", label: "Most units" },
  { id: "by_right_only", label: "By-right only" },
];

const SHADES = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"];

function Plan({ input, env, scheme }: { input: QFInput; env: [number, number][][][]; scheme: quickfit.Scheme | null }) {
  const all = input.parcel;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const pad = 10;
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const w = maxX - minX, h = maxY - minY;
  const path = (ring: [number, number][]) => ring.map((p, i) => `${i ? "L" : "M"}${p[0] - minX},${maxY - p[1]}`).join(" ") + " Z";
  const n = all.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-72 w-full rounded border border-zinc-200 bg-zinc-50" role="img" aria-label="Plan view of the lot, buildable area, and scheme footprints">
      {input.masks.map((m, i) => m.polygon.map((r, j) => (
        <path key={`m${i}${j}`} d={path(r)} fill={m.mode === "cut" ? "#3b82f6" : "#ef4444"} fillOpacity={0.18} stroke="none" />
      )))}
      {env.map((poly, i) => poly.map((r, j) => <path key={`e${i}${j}`} d={path(r)} fill="#22c55e" fillOpacity={0.15} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={Math.max(w, h) / 300} />))}
      <path d={path(all)} fill="none" stroke="#ca8a04" strokeWidth={Math.max(w, h) / 150} />
      {input.frontEdges.map((i) => {
        const a = all[i]!, b = all[(i + 1) % n]!;
        return <line key={`f${i}`} x1={a[0] - minX} y1={maxY - a[1]} x2={b[0] - minX} y2={maxY - b[1]} stroke="#111827" strokeWidth={Math.max(w, h) / 90} />;
      })}
      {scheme?.footprints.map((r, i) => <path key={`u${i}`} d={path(r as [number, number][])} fill={SHADES[i % SHADES.length]} fillOpacity={0.75} stroke="#fff" strokeWidth={Math.max(w, h) / 400} />)}
    </svg>
  );
}

export default function QuickFitPanel({ input, rules, zoneCode }: { input: QFInput; rules: Record<string, unknown> | null; zoneCode: string | null }) {
  const [goal, setGoal] = useState<quickfit.Goal>("most_units");
  const [frontVar, setFrontVar] = useState<string>("");
  const [sideVar, setSideVar] = useState<string>("");
  const [pick, setPick] = useState(0);

  const result = useMemo(() => {
    if (!rules || !zoneCode || input.frontEdges.length === 0) return null;
    const merged = { ...(rules as unknown as quickfit.QuickFitRules), ...quickfit.attachedRulesForDistrict(zoneCode) };
    const num = (x: string) => (x !== "" && !Number.isNaN(Number(x)) ? Number(x) : null);
    const variances: quickfit.VarianceToggle[] = [];
    if (num(frontVar) != null) variances.push({ rule: "front_setback", value: num(frontVar)!, reliefType: "dimensional_variance", codeSection: "903.03" });
    if (num(sideVar) != null) variances.push({ rule: "side_setback", value: num(sideVar)!, reliefType: "dimensional_variance", codeSection: "903.03" });
    try {
      return quickfit.solveQuickFit({
        parcel: input.parcel, frontEdges: input.frontEdges, streetSideEdges: input.streetSideEdges,
        rules: merged, masks: input.masks, zbaCounts: input.zbaCounts, goal, variances,
      });
    } catch (e) {
      return { error: String(e) } as const;
    }
  }, [input, rules, zoneCode, goal, frontVar, sideVar]);

  if (!rules || !zoneCode) return <p className="text-sm text-zinc-600">QuickFit needs the district's zoning rules; they're only loaded for the City of Pittsburgh so far.</p>;
  if (input.frontEdges.length === 0) return <p className="text-sm text-zinc-600">No street frontage found near this lot, so QuickFit can't orient a building.</p>;
  if (!result || "error" in result) return <p className="text-sm text-red-700">QuickFit couldn't run: {result && "error" in result ? result.error : "no result"}</p>;

  // Best layout per building type (the ranked list has near-duplicates that differ only in parking).
  const top: quickfit.Scheme[] = [];
  for (const s of result.ranked) {
    if (!top.some((t) => t.typology === s.typology)) top.push(s);
    if (top.length === 3) break;
  }
  const chosen = top[Math.min(pick, top.length - 1)] ?? null;
  const v = result.variance;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col">Goal
          <select value={goal} onChange={(e) => { setGoal(e.target.value as quickfit.Goal); setPick(0); }} className="rounded border px-2 py-1">
            {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col">What if the front setback were… (ft)
          <input type="number" min={0} value={frontVar} placeholder={`code: ${String((rules as any).min_front_setback_ft ?? "?")}`} onChange={(e) => { setFrontVar(e.target.value); setPick(0); }} className="w-40 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">…and the side setback (ft)
          <input type="number" min={0} value={sideVar} placeholder={`code: ${String((rules as any).min_side_setback_ft ?? "?")}`} onChange={(e) => { setSideVar(e.target.value); setPick(0); }} className="w-40 rounded border px-2 py-1" />
        </label>
        <p className="text-zinc-600">Lot {Math.round(result.lotAreaSf).toLocaleString()} sq ft · buildable envelope {Math.round(result.envelope.areaSf).toLocaleString()} sq ft · {result.all.length} layouts tried</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <Plan input={input} env={result.envelope.polygons as [number, number][][][]} scheme={chosen} />
          <p className="mt-1 text-xs text-zinc-500">Yellow: lot · black: street frontage · green dashed: buildable envelope · blue: floodway (cut) · red: hazard overlay (flag) · colored boxes: units</p>
        </div>
        <div className="space-y-2">
          {top.length === 0 && (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Nothing fits by right: the buildable envelope is {Math.round(result.envelope.areaSf).toLocaleString()} sq ft
              {result.envelope.areaSf > 0 ? ", narrower than the smallest unit preset (16 ft wide)" : ""}. Try the setback "what if" fields to see what a variance would allow.
            </p>
          )}
          {top.map((s, i) => (
            <button key={s.id} onClick={() => setPick(i)} className={`block w-full rounded border px-3 py-2 text-left text-sm ${i === pick ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}>
              <div className="flex items-center justify-between">
                <b>{s.typologyLabel}: {s.units} unit{s.units > 1 ? "s" : ""}</b>
                <span className={`rounded px-1.5 text-[11px] font-semibold ${s.badge === "by_right" ? "bg-green-100 text-green-800" : s.badge === "needs_approval" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                  {s.badge.replace("_", " ")}
                </span>
              </div>
              <p>{s.unitWidthFt} ft wide × {s.unitDepthFt} ft deep · {s.stories} stories · {Math.round(s.grossFloorAreaSf).toLocaleString()} sq ft gross · {s.lotCoveragePct}% coverage · parking {s.parkingSpaces}{s.parkingRequired != null ? ` of ${s.parkingRequired} required` : ""}{s.needsSubdivision ? " · needs subdivision" : ""}</p>
              <p className="text-zinc-700">{s.binding.label}. <span className="text-zinc-500">{s.binding.detail}</span></p>
              {s.approvals.map((a, j) => (
                <p key={j} className="text-amber-800">Needs: {a.label}{a.odds ? (a.odds.status === "rate" ? ` — past ZBA: ${Math.round(a.odds.rate * 100)}% granted (${a.odds.granted}/${a.odds.n})` : ` — too few past cases (${a.odds.n})`) : ""}</p>
              ))}
              <p className="text-xs text-zinc-500">Cost & return: needs your cost table.</p>
            </button>
          ))}
        </div>
      </div>

      {v && v.perToggle.length > 0 && (
        <div className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <p>With the variance{v.perToggle.length > 1 ? "s" : ""}, the best layout changes by <b>{v.deltaUnits >= 0 ? "+" : ""}{v.deltaUnits} unit(s)</b> and <b>{v.deltaGrossFloorAreaSf >= 0 ? "+" : ""}{Math.round(v.deltaGrossFloorAreaSf).toLocaleString()} sq ft</b> (by right: {v.byRightBest ? `${v.byRightBest.units} unit(s)` : "nothing fits"}; with variance: {v.withVariancesBest ? `${v.withVariancesBest.units} unit(s)` : "nothing fits"}).</p>
          {v.perToggle.map((t, i) => (
            <p key={i}>{t.rule.replace(/_/g, " ")} {t.from ?? "?"} → {t.to} ft · {t.odds.status === "rate" ? `past ZBA dimensional variances under §903.03: ${Math.round(t.odds.rate * 100)}% granted of ${t.odds.n} decided` : `too few past ZBA cases for odds (${t.odds.n})`}</p>
          ))}
          <p className="text-xs text-sky-700">Past outcomes aren't a prediction for this lot. ZBA data covers 2025–2026 decisions.</p>
        </div>
      )}
      <ul className="text-xs text-zinc-500">
        {[...input.notes.filter(Boolean), ...result.receipts].map((r, i) => <li key={i}>• {r}</li>)}
        <li>• Unit sizes, stories, and parking presets are editable placeholders, not recommendations.</li>
      </ul>
    </div>
  );
}
