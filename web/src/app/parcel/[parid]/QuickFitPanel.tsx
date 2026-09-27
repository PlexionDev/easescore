"use client";

import { useEffect, useMemo, useState } from "react";
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

/** The one scheme the score, pro forma and summary use (score.SelectedScheme, trimmed for the client). */
export interface PricedScheme {
  schemeId: string | null;
  label: string;
  units: number | null;
  stories: number | null;
  heightFt: number;
  finishedSf: number | null;
  path: string | null;
  variancesNeeded: string[];
  binding: string | null;
  footprints: [number, number][][];
  grossSf: number | null;
  unitWidthFt: number | null;
  unitDepthFt: number | null;
  lotCoveragePct: number | null;
  parking: { spaces: number | null; required: number | null } | null;
  /** Engine pro forma for this scheme: headline range and total cost range. */
  proForma: string | null;
  totalCost: string | null;
}

/** Engine pro forma for another option's scheme (matched to a QuickFit card by scheme id). */
export interface PricedOption {
  schemeId: string;
  label: string;
  proForma: string | null;
  totalCost: string | null;
}

const PATH_TEXT: Record<string, string> = {
  by_right: "by right", contextual: "by right with the contextual front setback", variance: "needs a variance", existing: "existing building", no_fit: "does not fit",
};

const SHADES = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"];

function Plan({ input, env, footprints }: { input: QFInput; env: [number, number][][][]; footprints: [number, number][][] }) {
  const all = input.parcel;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const pad = 10;
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const w = maxX - minX, h = maxY - minY;
  const path = (ring: [number, number][]) => ring.map((p, i) => `${i ? "L" : "M"}${p[0] - minX},${maxY - p[1]}`).join(" ") + " Z";
  const n = all.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full rounded-xl border border-slate-200 bg-slate-50" role="img" aria-label="Plan view of the lot, buildable area, and scheme footprints">
      {input.masks.map((m, i) => m.polygon.map((r, j) => (
        <path key={`m${i}${j}`} d={path(r)} fill={m.mode === "cut" ? "#3b82f6" : "#ef4444"} fillOpacity={0.18} stroke="none" />
      )))}
      {env.map((poly, i) => poly.map((r, j) => <path key={`e${i}${j}`} d={path(r)} fill="#22c55e" fillOpacity={0.15} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={Math.max(w, h) / 300} />))}
      <path d={path(all)} fill="none" stroke="#ca8a04" strokeWidth={Math.max(w, h) / 150} />
      {input.frontEdges.map((i) => {
        const a = all[i]!, b = all[(i + 1) % n]!;
        return <line key={`f${i}`} x1={a[0] - minX} y1={maxY - a[1]} x2={b[0] - minX} y2={maxY - b[1]} stroke="#111827" strokeWidth={Math.max(w, h) / 90} />;
      })}
      {footprints.map((r, i) => <path key={`u${i}`} d={path(r)} fill={SHADES[i % SHADES.length]} fillOpacity={0.75} stroke="#fff" strokeWidth={Math.max(w, h) / 400} />)}
    </svg>
  );
}

/** Legend with only the layers present on this lot; unit colors listed separately. */
function Legend({ input, envArea, units }: { input: QFInput; envArea: number; units: number }) {
  const cut = [...new Set(input.masks.filter((m) => m.mode === "cut").map((m) => m.label))];
  const flag = [...new Set(input.masks.filter((m) => m.mode !== "cut").map((m) => m.label))];
  const items: [string, string, string][] = [["#ca8a04", "line", "Lot line"]];
  if (input.frontEdges.length) items.push(["#111827", "line", "Street frontage"]);
  if (envArea > 0) items.push(["#16a34a", "dash", "Buildable envelope"]);
  for (const l of cut) items.push(["#3b82f6", "fill", `${l} (cut from the buildable area)`]);
  for (const l of flag) items.push(["#ef4444", "fill", `${l} (flagged, not cut)`]);
  return (
    <div className="mt-1 space-y-1 text-xs text-zinc-600">
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {items.map(([c, k, t]) => (
          <li key={t} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-sm" style={k === "fill" ? { background: c, opacity: 0.35 } : k === "dash" ? { border: `1.5px dashed ${c}` } : { borderBottom: `2.5px solid ${c}` }} />
            {t}
          </li>
        ))}
      </ul>
      {units > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Units:</span>
          {Array.from({ length: units }, (_, i) => (
            <span key={i} className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SHADES[i % SHADES.length] }} />{i + 1}</span>
          ))}
        </p>
      )}
    </div>
  );
}

export default function QuickFitPanel({ input, rules, zoneCode, priced, pricedOptions = [], onScheme, onEnvelope }: {
  input: QFInput; rules: Record<string, unknown> | null; zoneCode: string | null;
  pricedOptions?: PricedOption[];
  /** The priced scheme (score + pro forma + summary); shown first and drawn until another layout is picked. */
  priced?: PricedScheme | null;
  onScheme?: (s: { footprints: [number, number][][]; heightFt: number } | null, byUser: boolean) => void;
  onEnvelope?: (polygons: [number, number][][][] | null) => void;
}) {
  const [goal, setGoal] = useState<quickfit.Goal>("most_units");
  // What-if setbacks start blank (the placeholder shows the code value); only an entered value that
  // differs from the code creates a what-if.
  const [frontVar, setFrontVar] = useState<string>("");
  const [sideVar, setSideVar] = useState<string>("");
  // -1 = the priced scheme; 0.. = QuickFit's ranked layouts.
  const [pick, setPick] = useState(priced ? -1 : 0);

  const result = useMemo(() => {
    if (!rules || !zoneCode || input.frontEdges.length === 0) return null;
    const merged = { ...(rules as unknown as quickfit.QuickFitRules), ...quickfit.attachedRulesForDistrict(zoneCode) };
    const r = rules as { min_front_setback_ft?: number | null; min_side_setback_ft?: number | null };
    const num = (x: string, code: number | null | undefined) => (x.trim() !== "" && !Number.isNaN(Number(x)) && Number(x) !== code ? Number(x) : null);
    const front = num(frontVar, r.min_front_setback_ft), side = num(sideVar, r.min_side_setback_ft);
    const variances: quickfit.VarianceToggle[] = [];
    if (front != null) variances.push({ rule: "front_setback", value: front, reliefType: "dimensional_variance", codeSection: "903.03" });
    if (side != null) variances.push({ rule: "side_setback", value: side, reliefType: "dimensional_variance", codeSection: "903.03" });
    try {
      return quickfit.solveQuickFit({
        parcel: input.parcel, frontEdges: input.frontEdges, streetSideEdges: input.streetSideEdges,
        rules: merged, masks: input.masks, zbaCounts: input.zbaCounts, goal, variances,
      });
    } catch (e) {
      return { error: String(e) } as const;
    }
  }, [input, rules, zoneCode, goal, frontVar, sideVar]);

  // The priced layout is the top card; the rest are alternatives (the priced scheme's own building type is
  // not repeated, so the two never disagree). With a what-if entered, every card comes from the what-if run.
  const whatIf = frontVar.trim() !== "" || sideVar.trim() !== "";
  const pricedTyp = priced?.schemeId?.split("|")[0] ?? null;
  const showPriced = !!priced && !whatIf;
  const cards = useMemo(() => {
    if (!result || "error" in result) return [] as quickfit.Scheme[];
    const seen: quickfit.Scheme[] = [];
    for (const s of result.ranked) {
      if (showPriced && (s.id === priced!.schemeId || s.typology === pricedTyp)) continue;
      if (!seen.some((t) => t.typology === s.typology)) seen.push(s);
      if (seen.length === 3) break;
    }
    return seen;
  }, [result, showPriced, priced, pricedTyp]);
  const chosenForMap = useMemo(() => {
    if (pick < 0 && showPriced) return { footprints: priced!.footprints, heightFt: priced!.heightFt };
    const s = cards[Math.min(Math.max(pick, 0), cards.length - 1)];
    return s ? { footprints: s.footprints as [number, number][][], heightFt: s.heightFt } : null;
  }, [cards, pick, priced, showPriced]);
  useEffect(() => { onScheme?.(chosenForMap, pick >= 0); }, [chosenForMap]); // eslint-disable-line react-hooks/exhaustive-deps
  // Buildable envelope in the same local coordinates as the footprints (for the photoreal 3D view).
  useEffect(() => { onEnvelope?.(result && !("error" in result) ? (result.envelope.polygons as [number, number][][][]) : null); }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rules || !zoneCode) return <p className="text-sm text-zinc-600">QuickFit needs the district's zoning rules; they're only loaded for the City of Pittsburgh so far.</p>;
  if (input.frontEdges.length === 0) return <p className="text-sm text-zinc-600">No street frontage found near this lot, so QuickFit can't orient a building.</p>;
  if (!result || "error" in result) return <p className="text-sm text-red-700">QuickFit couldn't run: {result && "error" in result ? result.error : "no result"}</p>;

  const top = cards;
  const chosen = pick >= 0 ? top[Math.min(pick, top.length - 1)] ?? null : null;
  const drawn = pick < 0 && priced ? priced.footprints : ((chosen?.footprints ?? []) as [number, number][][]);
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
          <input type="number" min={0} value={frontVar} placeholder={`code: ${String((rules as any).min_front_setback_ft ?? "?")}`} onChange={(e) => { setFrontVar(e.target.value); setPick(e.target.value.trim() === "" && sideVar.trim() === "" && priced ? -1 : 0); }} className="w-40 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">…and the side setback (ft)
          <input type="number" min={0} value={sideVar} placeholder={`code: ${String((rules as any).min_side_setback_ft ?? "?")}`} onChange={(e) => { setSideVar(e.target.value); setPick(e.target.value.trim() === "" && frontVar.trim() === "" && priced ? -1 : 0); }} className="w-40 rounded border px-2 py-1" />
        </label>
        <p className="text-zinc-600">Lot {Math.round(result.lotAreaSf).toLocaleString()} sq ft · buildable envelope {Math.round(result.envelope.areaSf).toLocaleString()} sq ft · {result.all.length} layouts tried</p>
      </div>

      <div className="grid gap-4">
        <div>
          <Plan input={input} env={result.envelope.polygons as [number, number][][][]} footprints={drawn} />
          <Legend input={input} envArea={result.envelope.areaSf} units={drawn.length} />
        </div>
        <div className="space-y-2">
          {showPriced && (
            <button onClick={() => setPick(-1)} className={`block w-full rounded border px-3 py-2 text-left text-sm ${pick < 0 ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}>
              <div className="flex items-center justify-between">
                <b>Priced layout: {priced.label}{priced.units != null ? `, ${priced.units} unit${priced.units === 1 ? "" : "s"}` : ""}</b>
                <span className="rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-700">score + pro forma</span>
              </div>
              <p>
                {priced.unitWidthFt != null && priced.unitDepthFt != null ? `${priced.unitWidthFt} ft wide × ${priced.unitDepthFt} ft deep · ` : ""}
                {priced.stories != null ? `${priced.stories} stories · ` : ""}
                {priced.grossSf != null ? `${Math.round(priced.grossSf).toLocaleString()} sq ft gross · ` : ""}
                {priced.finishedSf != null ? `${Math.round(priced.finishedSf).toLocaleString()} sq ft finished · ` : ""}
                {priced.lotCoveragePct != null ? `${priced.lotCoveragePct}% coverage · ` : ""}
                {priced.parking?.spaces != null ? `parking ${priced.parking.spaces}${priced.parking.required ? ` of ${priced.parking.required} required` : priced.parking.required === 0 ? " (none required)" : ""} · ` : ""}
                {PATH_TEXT[priced.path ?? ""] ?? "zoning path unknown"}{priced.variancesNeeded.length ? ` (${priced.variancesNeeded.map((v) => v.replace(/_/g, " ")).join(", ")})` : ""}
              </p>
              {priced.binding && <p className="text-zinc-700">{priced.binding}.</p>}
              {priced.proForma && <p className="font-semibold text-slate-900">{priced.proForma}{priced.totalCost ? <span className="font-normal text-slate-600"> · total cost {priced.totalCost}</span> : null}</p>}
              <p className="text-xs text-zinc-500">The same building the Ease Score, the summary, the pro forma and the 3D view use.</p>
            </button>
          )}
          {showPriced && top.length > 0 && <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Alternatives (other building types)</p>}
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
              {(() => {
                const po = pricedOptions.find((o) => o.schemeId === s.id);
                return po?.proForma
                  ? <p className="text-slate-900"><span className="font-semibold">{po.proForma}</span>{po.totalCost ? <span className="text-slate-600"> · total cost {po.totalCost}</span> : null} <span className="text-xs text-zinc-500">({po.label}, same pro forma as the page)</span></p>
                  : <p className="text-xs text-zinc-500">Not priced: {whatIf ? "a what-if layout" : "a different layout from the one this building type is priced on"}. Pick its building type above the factor bars to price it.</p>;
              })()}
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
