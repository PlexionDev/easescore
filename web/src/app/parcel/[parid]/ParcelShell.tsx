"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { preconnect } from "react-dom";
import MapStage, { type Footprints } from "./MapStage";
import QuickFitPanel from "./QuickFitPanel";
import { DrawerHost, type DrawerId } from "./Drawers";
import PhotorealStill from "./PhotorealStill";
import { ViewSwitch, KeyNeeded, VIEW_MODES, type ViewMode } from "./ViewModes";

// Cesium + Google tiles load only when the photoreal view is shown (never in the initial JS). Until the live
// view is ready, PhotorealStill (server-rendered, our own data) stands in for it.
const Photoreal3D = dynamic(() => import("./Photoreal3D"), { ssr: false, loading: () => null });

// Inlined at build time; true when a Google Map Tiles key is configured.
const HAS_KEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const PANEL_W = 440, GUTTER = 16;

type Affine = { lon0: number; lat0: number; lon_per_x: number; lat_per_x: number; lon_per_y: number; lat_per_y: number };
type Sheet = "peek" | "half" | "full";
const SHEET_FRAC: Record<Sheet, number> = { peek: 0, half: 0.45, full: 0.8 };
const PEEK_PX = 104;

export default function ParcelShell({ pane, planExtras, drawers, stage, outline, rules, zoneCode }: {
  /** The pane, top to bottom (server-rendered). */
  pane: ReactNode;
  /** Assumptions and project questions, shown in "Change the plan" under QuickFit. */
  planExtras?: ReactNode;
  /** Other drawers (pro forma, process, details). */
  drawers: { id: DrawerId; title: string; content: ReactNode }[];
  /** Map data and lot geometry, streamed after the pane: the pane never waits for them. */
  stage: Promise<{ mapData: any; qfInput: any }>;
  /** Lot outline in local feet, drawn as a still placeholder until the map data arrives. */
  outline: [number, number][] | null;
  rules: Record<string, unknown> | null; zoneCode: string | null;
}) {
  const [loaded, setLoaded] = useState<{ mapData: any; qfInput: any } | null>(null);
  useEffect(() => {
    let live = true;
    stage.then((x) => { if (live) setLoaded(x); }, () => { if (live) setLoaded({ mapData: null, qfInput: null }); });
    return () => { live = false; };
  }, [stage]);
  const mapData = loaded?.mapData ?? null;
  const qfInput = loaded?.qfInput ?? null;
  if (HAS_KEY) preconnect("https://tile.googleapis.com");
  const [footprints, setFootprints] = useState<Footprints>(null);
  const [envelope, setEnvelope] = useState<[number, number][][] | null>(null);
  const a: Affine | undefined = qfInput?.toLonLat;
  const toLonLat = (p: [number, number]): [number, number] =>
    a ? [a.lon0 + a.lon_per_x * p[0] + a.lon_per_y * p[1], a.lat0 + a.lat_per_x * p[0] + a.lat_per_y * p[1]] : p;

  // View mode: kept in the URL hash (#view=photoreal|terrain|analysis).
  const [mode, setMode] = useState<ViewMode>(HAS_KEY ? "photoreal" : "terrain");
  const [stageMounted, setStageMounted] = useState(!HAS_KEY);
  useEffect(() => {
    const read = () => {
      const m = /view=(\w+)/.exec(window.location.hash)?.[1] as ViewMode | undefined;
      if (m && VIEW_MODES.includes(m)) { setMode(m); if (m !== "photoreal") setStageMounted(true); }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const choose = (m: ViewMode) => {
    setMode(m);
    if (m !== "photoreal") setStageMounted(true);
    window.history.replaceState(null, "", `#view=${m}`);
  };

  // Mobile: the panel is a bottom sheet (peek / half / full), the map stays full-bleed.
  const [mobile, setMobile] = useState(false);
  const [vh, setVh] = useState(800);
  const [sheet, setSheet] = useState<Sheet>("half");
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const upd = () => { setMobile(mq.matches); setVh(window.innerHeight); };
    upd();
    mq.addEventListener("change", upd);
    window.addEventListener("resize", upd);
    return () => { mq.removeEventListener("change", upd); window.removeEventListener("resize", upd); };
  }, []);
  const sheetPx = (s: Sheet) => (s === "peek" ? PEEK_PX : Math.round(vh * SHEET_FRAC[s]));
  const sheetH = dragH ?? sheetPx(sheet);
  const insets = useMemo(() => (mobile ? { left: 0, bottom: sheetPx(sheet) } : { left: PANEL_W + GUTTER, bottom: 0 }), [mobile, sheet, vh]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHandleDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: sheetH, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragH(Math.max(PEEK_PX, Math.min(vh * 0.92, d.h + dy)));
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) { setSheet(sheet === "peek" ? "half" : sheet === "half" ? "full" : "peek"); setDragH(null); return; }
    const h = dragH ?? d.h;
    const best = (["peek", "half", "full"] as Sheet[]).reduce((b, s) => (Math.abs(sheetPx(s) - h) < Math.abs(sheetPx(b) - h) ? s : b), "half");
    setSheet(best);
    setDragH(null);
  };

  const photoFootprints = useMemo(() => (footprints ? { rings: footprints.rings, heightFt: footprints.heightFt } : null), [footprints]);
  const maxHeightFt = typeof rules?.max_height_ft === "number" ? (rules.max_height_ft as number) : 40;
  const photoEnvelope = useMemo(() => (envelope ? { rings: envelope, heightFt: maxHeightFt } : null), [envelope, maxHeightFt]);
  const parcelKey = String((mapData?.features as { properties?: { kind?: string; id?: string } }[] | undefined)?.find((f) => f.properties?.kind === "parcel")?.properties?.id ?? mapData?.center?.join(",") ?? "parcel");

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100">
      {!loaded && <StagePlaceholder outline={outline} />}
      {mapData && stageMounted && (
        <div className={`absolute inset-0 ${mode === "photoreal" ? "invisible" : ""}`} aria-hidden={mode === "photoreal"}>
          <MapStage data={mapData} footprints={footprints} />
        </div>
      )}
      {mapData && mode === "photoreal" && (HAS_KEY
        ? <>
            <PhotorealStill data={mapData} insets={insets} />
            <Photoreal3D parcelKey={parcelKey} data={mapData} massing={photoFootprints} envelope={photoEnvelope} insets={insets} onFallback={() => choose("terrain")} />
          </>
        : <KeyNeeded onFallback={() => choose("terrain")} />)}
      {mapData && <ViewSwitch mode={mode} hasKey={HAS_KEY} onChange={choose} />}

      <aside
        className={`absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border border-white/50 bg-white/90 shadow-2xl backdrop-blur-xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:w-[440px] md:rounded-2xl md:bg-white/85 ${dragH == null ? "transition-[height] duration-300" : ""}`}
        style={mobile ? { height: sheetH } : undefined}>
        <button type="button" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
          className="flex w-full touch-none justify-center pb-1 pt-2 md:hidden" aria-label={sheet === "full" ? "Collapse details" : "Expand details"}>
          <span className="h-1.5 w-10 rounded-full bg-slate-300" />
        </button>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-1 md:pt-5">{pane}</div>
      </aside>
      <DrawerHost drawers={[
        ...drawers.filter((d) => d.id === "pencils"),
        { id: "plan", title: "Change the plan", content: <>
          <section>
            <h3 className="text-sm font-semibold text-slate-900">What fits here (QuickFit)</h3>
            <p className="mb-2 text-xs text-slate-500">Single-family, duplex, townhouse row. The selected layout is drawn in 3D on the map.</p>
            {qfInput ? (
              <QuickFitPanel input={qfInput} rules={rules} zoneCode={zoneCode}
                onScheme={(s) => setFootprints(s ? { rings: s.footprints.map((r) => r.map(toLonLat)), heightFt: s.heightFt } : null)}
                onEnvelope={(polys) => setEnvelope(polys ? polys.map((p) => (p[0] ?? []).map(toLonLat)).filter((r) => r.length >= 3) : null)} />
            ) : <p className="text-sm text-slate-600">{loaded ? "No lot geometry available." : "Loading the lot geometry…"}</p>}
          </section>
          {planExtras}
        </> },
        ...drawers.filter((d) => d.id !== "pencils"),
      ]} />
    </div>
  );
}

/** Still stand-in for the map while its data loads: the lot outline on a plain ground. */
function StagePlaceholder({ outline }: { outline: [number, number][] | null }) {
  const W = 600, H = 400;
  let d = "";
  if (outline && outline.length >= 3) {
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((W * 0.5) / Math.max(x1 - x0, 1), (H * 0.5) / Math.max(y1 - y0, 1));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    d = `M${outline.map(([x, y]) => `${(W / 2 + (x - cx) * k).toFixed(1)},${(H / 2 - (y - cy) * k).toFixed(1)}`).join("L")}Z`;
  }
  return (
    <div className="absolute inset-0 bg-slate-200" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-y-0 right-0 h-full w-full md:w-[calc(100%-456px)]">
        {d && <path d={d} fill="#facc15" fillOpacity={0.25} stroke="#ca8a04" strokeWidth={2.5} />}
      </svg>
      <p className="absolute bottom-4 right-4 rounded-full bg-white/80 px-3 py-1 text-xs text-slate-600 shadow">Loading the map…</p>
    </div>
  );
}
