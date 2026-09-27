"use client";

import { useEffect, useRef, useState } from "react";
import * as rents from "@easescore/engine/src/rents";

// Rents by bedroom count with a tap-open receipt. Loads after the page (never blocks it), and only
// once the pane is on screen, so closed drawers do not spend RentCast quota.
// Comp addresses are block-level here; the full address is only in the downloadable report.

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export default function RentReceipt({ parid, defaultBedrooms = 2 }: { parid: string; defaultBedrooms?: number }) {
  const [data, setData] = useState<rents.RentsByBedroom | null>(null);
  const [failed, setFailed] = useState(false);
  const [br, setBr] = useState(defaultBedrooms);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    fetch(`/api/rents/${encodeURIComponent(parid)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: rents.RentsByBedroom) => { if (live) setData(j); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [parid, seen]);

  if (failed) return <p className="text-sm text-zinc-600">Rents could not be loaded right now. The HUD and Zillow figures below still apply.</p>;
  if (!data) return <div ref={ref}><p className="text-sm text-zinc-600" role="status" aria-live="polite">Loading rents…</p></div>;

  const brs = Object.keys(data.byBedroom).map(Number).sort((a, b) => a - b);
  const e = data.byBedroom[br] ?? data.byBedroom[brs[0]!];
  if (!e) return null;
  const fromComps = e.basis === "rentcast_comps";

  return (
    <div className="mt-1">
      <div role="tablist" aria-label="Bedrooms" className="mb-1 flex gap-1">
        {brs.map((b) => (
          <button key={b} role="tab" aria-selected={b === e.bedrooms} onClick={() => setBr(b)}
            className={`rounded border px-2 py-0.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${b === e.bedrooms ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
            {b === 0 ? "Studio" : `${b} BR`}
          </button>
        ))}
      </div>
      <p className="text-sm">{rents.rentOneLiner(e)}</p>
      {!fromComps && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Benchmark, not listings: {e.note}</p>}
      <details className="mt-2 rounded border border-slate-200 p-2">
        <summary className="cursor-pointer text-sm font-medium">How this rent was found (receipt)</summary>
        <div className="mt-2 space-y-2 text-xs text-zinc-700">
          <p><span className="font-semibold">Comp rules. </span>{e.rules}{e.radiusMi != null ? ` Used: ${e.radiusMi} mi.` : ""}</p>
          {e.comps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left">
                <caption className="sr-only">Nearby {e.bedrooms}-bedroom asking rents</caption>
                <thead><tr className="border-b border-slate-200 text-zinc-500">
                  <th className="py-1 pr-2 font-medium">Where</th><th className="pr-2 font-medium">Type</th><th className="pr-2 font-medium">Baths</th>
                  <th className="pr-2 font-medium">Sq ft</th><th className="pr-2 font-medium">Asking</th><th className="pr-2 font-medium">Size-adjusted</th>
                  <th className="pr-2 font-medium">Miles</th><th className="font-medium">Last seen</th>
                </tr></thead>
                <tbody>
                  {e.comps.map((c, i) => (
                    <tr key={`${c.block}-${i}`} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{c.block}</td><td className="pr-2">{c.propertyType ?? "—"}</td><td className="pr-2">{c.bathrooms ?? "—"}</td>
                      <td className="pr-2">{c.squareFootage?.toLocaleString("en-US") ?? "—"}</td><td className="pr-2">{money(c.price)}</td>
                      <td className="pr-2">{money(c.adjusted)}</td><td className="pr-2">{c.distanceMi}</td><td>{c.lastSeen ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>No matching listings.</p>}
          <p><span className="font-semibold">How “likely” and the range are computed. </span>{e.method}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded bg-slate-50 p-2"><div className="text-zinc-500">This estimate</div><div className="text-sm font-semibold">{money(e.likely)}</div><div>{money(e.low)}–{money(e.high)}</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-zinc-500">HUD Small Area FMR FY{data.hud?.year ?? "?"}{data.hud?.zip ? `, ZIP ${data.hud.zip}` : ""}</div><div className="text-sm font-semibold">{money(e.hud)}</div><div>{e.bedrooms}-bedroom benchmark</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-zinc-500">Zillow rent index, ZIP {data.zori?.zip ?? "?"}</div><div className="text-sm font-semibold">{money(e.zori)}</div><div>all home sizes, {rents.monthYear(data.zori?.latest_month)}</div></div>
          </div>
          <p className="italic">{data.caveat}</p>
          <ul className="list-disc pl-4">
            {data.sources.map((s) => <li key={s.label}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>{s.asOf ? ` (${s.asOf.slice(0, 10)})` : ""}</li>)}
          </ul>
          <p className="text-zinc-500">Street numbers are shown to the block; full addresses appear only in the downloadable report. No owner or contact details are shown or stored.</p>
        </div>
      </details>
    </div>
  );
}
