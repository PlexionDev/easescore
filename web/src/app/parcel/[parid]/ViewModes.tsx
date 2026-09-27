"use client";

import { useState, type ReactNode } from "react";

export type ViewMode = "build" | "photoreal" | "terrain" | "analysis";
/** Left to right: the real place (default), the QuickFit clay model, lidar terrain, the flat analysis map. */
export const VIEW_MODES: ViewMode[] = ["photoreal", "build", "terrain", "analysis"];
const LABELS: Record<ViewMode, [string, string]> = {
  photoreal: ["3D (photoreal)", "3D"],
  build: ["QuickFit 3D", "QuickFit"],
  terrain: ["Terrain", "Terrain"],
  analysis: ["2D", "2D"],
};

/** Segmented control, top-center of the map area (between the left panel and the layers card). */
export function ViewSwitch({ mode, hasKey, onChange, extra, hide }: { mode: ViewMode; hasKey: boolean; onChange: (m: ViewMode) => void; /** Under the tabs (e.g. "Describe this view"). */ extra?: ReactNode; /** Tabs left out (QuickFit 3D when no building can be placed). */ hide?: ViewMode[] }) {
  const [hint, setHint] = useState(!hasKey);
  return (
    <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-2 md:left-[472px] md:top-4 md:translate-x-0 md:items-start xl:left-[calc(50%+92px)] xl:-translate-x-1/2 xl:items-center">
      <div className="flex items-center gap-1.5">
      <div role="tablist" aria-label="Map view" className="flex gap-1 rounded-full border border-white/40 bg-slate-900/75 p-1 text-sm shadow-xl backdrop-blur-md">
        {VIEW_MODES.filter((m) => !hide?.includes(m)).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => onChange(m)}
            className={`relative whitespace-nowrap rounded-full px-3 py-1.5 font-semibold transition-colors ${mode === m ? "bg-white text-slate-900 shadow" : "text-slate-200 hover:bg-white/10"}`}>
            <span className="hidden xl:inline">{LABELS[m][0]}</span><span className="xl:hidden">{LABELS[m][1]}</span>
            {m === "photoreal" && !hasKey && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" aria-label="needs a key" />}
          </button>
        ))}
      </div>
      {extra}
      </div>
      {hint && mode !== "photoreal" && mode !== "build" && (
        <div className="flex items-center gap-2 rounded-full bg-slate-900/75 px-3 py-1 text-xs text-slate-200 shadow-lg backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Photoreal 3D needs a Google Map Tiles key · showing lidar terrain
          <button onClick={() => setHint(false)} className="ml-1 text-slate-400 hover:text-white" aria-label="Dismiss">×</button>
        </div>
      )}
      {mode === "analysis" && (
        <p className="hidden rounded-full bg-white/85 px-3 py-1 text-xs text-slate-700 shadow backdrop-blur-md md:block">
          Flat plan · “Slope classes” shows lidar slope · click a neighboring lot to open it
        </p>
      )}
    </div>
  );
}

const BG = "radial-gradient(900px 500px at 60% 35%, #1e3a5f, #0f172a)";

/** Shown instead of a blank box when the photoreal view is picked but no key is configured. */
export function KeyNeeded({ onFallback }: { onFallback: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 pb-[50vh] md:pb-6 md:pl-[470px]" style={{ background: BG }}>
      <div className="max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-slate-100 shadow-2xl backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Setup needed</p>
        <p className="mt-1 text-lg font-semibold">Photoreal 3D needs a Google Map Tiles key</p>
        <p className="mt-2 text-sm text-slate-300">
          Add <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> to <code className="rounded bg-black/30 px-1">.env.local</code> with the Map Tiles API enabled, then restart the dev server.
          The lidar terrain and 2D analysis views work without it.
        </p>
        <button onClick={onFallback} className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">Show 3D Terrain</button>
      </div>
    </div>
  );
}
