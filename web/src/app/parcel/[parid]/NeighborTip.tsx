"use client";

import { useEffect, useState } from "react";
import { briefs, type Brief } from "@/lib/parcel-brief";

/** Small hover card for a neighboring parcel (address, parcel ID, zoning, owner type). `x`/`y` are pixels in the view. */
export default function NeighborTip({ parid, x, y }: { parid: string; x: number; y: number }) {
  const [b, setB] = useState<Brief | null>(null);
  useEffect(() => {
    let live = true;
    briefs([parid]).then(([r]) => { if (live && r) setB(r); });
    return () => { live = false; };
  }, [parid]);
  const shown = b?.parid === parid ? b : null;
  return (
    <div role="tooltip" data-neighbor-tip className="pointer-events-none absolute z-30 max-w-64 rounded-lg bg-slate-900/90 px-2.5 py-1.5 text-xs leading-snug text-slate-100 shadow-lg"
         style={{ left: `min(${x + 14}px, calc(100% - 17rem))`, top: `min(${y + 14}px, calc(100% - 6rem))` }}>
      <p className="font-semibold">{shown ? shown.address : "Loading…"}</p>
      <p className="font-mono text-[11px] text-slate-300">{parid}</p>
      {shown && (shown.zoning || shown.owner) && <p className="text-slate-300">{[shown.zoning ? `Zoning ${shown.zoning}` : null, shown.owner].filter(Boolean).join(" · ")}</p>}
      <p className="mt-0.5 text-[11px] text-sky-300">Click to open this parcel</p>
    </div>
  );
}
