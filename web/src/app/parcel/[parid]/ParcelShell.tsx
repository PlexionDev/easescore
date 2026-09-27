"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { preconnect } from "react-dom";
import { remoteTilesBase } from "@/lib/tiles";
import type { quickfit, score } from "@easescore/engine";
import MapStage, { markSubject, type MapMassing } from "./MapStage";
import QuickFitPanel from "./QuickFitPanel";
import BuildPanel from "./BuildPanel";
import MetricsBar, { type Pinned } from "./MetricsBar";
import { DrawerHost, type DrawerId } from "./Drawers";
import PhotorealStill from "./PhotorealStill";
import { ViewSwitch, KeyNeeded, VIEW_MODES, type ViewMode } from "./ViewModes";
import DescribeView, { DescribeButton, describeParcelView, schemeSentence, type ViewFacts } from "./DescribeView";
import type { BuildMode, Massing } from "./Photoreal3D";
import Clay3D, { type ClayMode } from "./Clay3D";
import type { FinanceInputs, GenMetrics } from "@/lib/quickfit-gen";
import {
  QF2_KEYS, controlsToQuery, sameControls, sourcesOf, toParcelInput, toV1Scheme, typeOf,
  type AppControls, type EdgeKind, type Qf2Data, type Ring, type Typology,
} from "@/lib/qf2/core";
import { useQf2 } from "@/lib/qf2/use-qf2";

// Cesium + Google tiles load only when the photoreal view is shown (never in the initial JS). Until the live
// view is ready, PhotorealStill (server-rendered, our own data) stands in for it.
const Photoreal3D = dynamic(() => import("./Photoreal3D"), { ssr: false, loading: () => null });

// Inlined at build time; true when a Google Map Tiles key is configured.
const HAS_KEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const NO_FEATURES = { type: "FeatureCollection" as const, bbox: [], center: [0, 0] as [number, number], features: [] };
const PANEL_W = 440, GUTTER = 16;
/** Height the metrics bar takes at the bottom of the map (desktop / phone). */
const BAR_H = 92, BAR_H_M = 76;
/** Width of the Build panel on desktop. */
const BUILD_W = 300;

type Affine = { lon0: number; lat0: number; lon_per_x: number; lat_per_x: number; lon_per_y: number; lat_per_y: number };
type Sheet = "peek" | "half" | "full";
// "half" matches the h-[45vh] the sheet is server-rendered with, so hydration does not shift the layout.
const SHEET_FRAC: Record<Sheet, number> = { peek: 0, half: 0.45, full: 0.8 };
const PEEK_PX = 104;

/** What the page hands QuickFit v2 (lib/qf2): the same data and controls the server priced. */
export interface GenProps {
  /** The selected option (the score's strategy). */
  strategy: score.StrategyId | null;
  /** Map controls for it (from the URL, or the ones that reproduce its priced scheme); null when it is not a new build. */
  controls: AppControls | null;
  /** Per building type: the controls that reproduce its priced scheme. */
  defaults: Record<Typology, AppControls>;
  /** The priced scheme per strategy (the score's fit scheme). */
  fixed: Partial<Record<score.StrategyId, quickfit.Scheme>>;
  fin: FinanceInputs;
  /** The solver's data for this parcel (lib/qf2/core.ts qf2Data); null without a lot outline. */
  qf2: Qf2Data | null;
  rulesRow: quickfit.QuickFitRules | null;
  /** The page's own pro forma metrics for the selected option (shown until the worker answers). */
  serverMetrics: GenMetrics | null;
  code: Partial<Record<EdgeKind, number | null>>;
  notApplicable: Partial<Record<Typology, string>>;
}

// Pinned schemes live in sessionStorage (this tab only); an in-memory copy covers private mode.
const PIN_EVENT = "easescore:qf-pins";
const pinMemory = new Map<string, string>();
function readPins(key: string): string {
  try { return sessionStorage.getItem(key) ?? pinMemory.get(key) ?? "[]"; } catch { return pinMemory.get(key) ?? "[]"; }
}
function writePins(key: string, v: string) {
  pinMemory.set(key, v);
  try { sessionStorage.setItem(key, v); } catch { /* private mode: memory only */ }
  window.dispatchEvent(new Event(PIN_EVENT));
}
function subscribePins(cb: () => void) {
  window.addEventListener(PIN_EVENT, cb);
  return () => window.removeEventListener(PIN_EVENT, cb);
}

/** Stable identity for props that arrive as new objects on every server render but rarely change. */
function useStable<T>(v: T): T {
  const key = JSON.stringify(v ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => v, [key]);
}

const TILES_ORIGIN = (() => { const b = remoteTilesBase(); return b ? new URL(b).origin : null; })();

export default function ParcelShell({ parid, pane, planExtras, drawers, stage, outline, center, gen, viewFacts }: {
  parid: string;
  /** The pane, top to bottom (server-rendered). */
  pane: ReactNode;
  /** Assumptions and project questions, shown in "Change the plan" under the scheme summary. */
  planExtras?: ReactNode;
  /** Other drawers (pro forma, process, details). */
  drawers: { id: DrawerId; title: string; content: ReactNode }[];
  /** Map data and lot geometry, streamed after the pane: the pane never waits for them. */
  stage: Promise<{ mapData: any; qfInput: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Lot outline in local feet, drawn as a still placeholder until the map data arrives. */
  outline: [number, number][] | null;
  /** Lot centroid [lon, lat] from the pane: the photoreal view aims there and starts tiles before the map data. */
  center?: [number, number] | null;
  gen: GenProps;
  /** Lot, hazard and zoning facts for "Describe this view" (same numbers as the pane). */
  viewFacts?: ViewFacts;
}) {
  const [loaded, setLoaded] = useState<{ mapData: any; qfInput: any } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  // The page re-renders (new stage promise) whenever the plan is committed to the URL; keep the map data of the
  // parcel already on screen so the maps are not rebuilt.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    stage.then((x) => {
      if (!live || (loadedFor.current === parid && x?.mapData)) return;
      loadedFor.current = x?.mapData ? parid : null;
      setLoaded(x);
    }, () => { if (live && loadedFor.current !== parid) setLoaded({ mapData: null, qfInput: null }); });
    return () => { live = false; };
  }, [stage, parid]);
  const mapData = loaded?.mapData ?? null;
  const qfInput = loaded?.qfInput ?? null;
  if (HAS_KEY) preconnect("https://tile.googleapis.com");
  // The terrain and 2D maps fetch (CORS) from the hosted tiles bucket and the basemap glyph/sprite host: open
  // those connections while the page loads, not when a map first asks.
  if (TILES_ORIGIN) preconnect(TILES_ORIGIN, { crossOrigin: "anonymous" });
  preconnect("https://protomaps.github.io", { crossOrigin: "anonymous" });
  const a: Affine | undefined = qfInput?.toLonLat;
  const toLonLat = (p: [number, number]): [number, number] =>
    a ? [a.lon0 + a.lon_per_x * p[0] + a.lon_per_y * p[1], a.lat0 + a.lat_per_x * p[0] + a.lat_per_y * p[1]] : p;

  // The site-fit solver needs a lot outline and the zoning rules, which we have for City of Pittsburgh parcels
  // only; elsewhere "Build it in 3D" cannot place a building, so the page opens in 3D Terrain and says why.
  const canSolve = !!(gen.qf2?.rules && gen.qf2.zoneCode);
  const noSolveNote = gen.qf2
    ? "This municipality's zoning rules are not in our data (City of Pittsburgh only), so Build it in 3D cannot place a building here."
    : "The lot outline is not in our data, so Build it in 3D cannot place a building here.";

  // View mode: kept in the URL hash (#view=build|photoreal|terrain|analysis). "Build it in 3D" (clay model) first.
  const [mode, setMode] = useState<ViewMode>(canSolve ? "build" : "terrain");
  const [clayMode, setClayMode] = useState<ClayMode>("3d");
  const [stageMounted, setStageMounted] = useState(!canSolve);
  useEffect(() => {
    const read = () => {
      const m = /view=(\w+)/.exec(window.location.hash)?.[1] as ViewMode | undefined;
      if (m && VIEW_MODES.includes(m)) { setMode(m); if (m !== "photoreal" && m !== "build") setStageMounted(true); }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const choose = (m: ViewMode) => {
    setMode(m);
    if (m !== "photoreal" && m !== "build") setStageMounted(true);
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
  // Desktop: the lot is framed right of the pane and (when open) the Build panel, above the metrics bar.
  const [buildOpenSet, setBuildOpen] = useState<boolean | null>(null);
  const buildOpen = buildOpenSet ?? !mobile;
  const insets = useMemo(() => (mobile ? { left: 0, bottom: sheetPx(sheet) + BAR_H_M } : { left: PANEL_W + GUTTER + (buildOpen ? BUILD_W + GUTTER : 0), bottom: BAR_H }), [mobile, sheet, vh, buildOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- QuickFit 3D generator: map controls -> worker solve -> massing + metrics.
  const router = useRouter();
  const pathname = usePathname();
  const [controls, setControls] = useState<AppControls | null>(gen.controls);
  const touched = useRef(false);
  // The strategy switcher in the pane (a server navigation) picks another option: follow it. Server renders that
  // answer the map's own commits (possibly late, after the visitor moved on) are not followed.
  const [lastStrategy, setLastStrategy] = useState(gen.strategy);
  const [ownCommits, setOwnCommits] = useState<string[]>([]);
  if (lastStrategy !== gen.strategy) {
    setLastStrategy(gen.strategy);
    const i = gen.strategy != null ? ownCommits.indexOf(gen.strategy) : -1;
    if (i >= 0) setOwnCommits(ownCommits.filter((_, k) => k !== i));
    const ours = i >= 0;
    if (!ours && (!controls || !gen.controls || controls.typology !== gen.controls.typology)) setControls(gen.controls);
  }
  const [buildMode, setBuildMode] = useState<BuildMode>("buildable");
  const change = (c: AppControls) => {
    touched.current = true;
    // A new building type starts from its own priced layout (keeping a front lot line the visitor picked).
    setControls(!controls || c.typology !== controls.typology ? { ...gen.defaults[c.typology], frontEdgeIndex: c.frontEdgeIndex } : c);
    setBuildMode("buildable");
  };
  // Commit the plan to the URL (?strategy= + qf_*) once the controls settle, so the score, summary and pro forma follow.
  useEffect(() => {
    if (!touched.current || !controls) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      for (const k of QF2_KEYS) q.delete(k);
      q.set("strategy", typeOf(controls.typology).strategy);
      if (!sameControls(controls, gen.defaults[controls.typology])) for (const [k, v] of Object.entries(controlsToQuery(controls))) q.set(k, v);
      const next = `${pathname}?${q.toString()}`;
      if (next === `${pathname}${window.location.search}`) return;
      // A commit that changes the option comes back as a server render with that strategy: remember it as ours.
      const st = typeOf(controls.typology).strategy;
      if (new URLSearchParams(window.location.search).get("strategy") !== st && lastStrategy !== st) setOwnCommits((xs) => [...xs, st]);
      router.replace(`${next}${window.location.hash}`, { scroll: false });
    }, 700);
    return () => clearTimeout(t);
  }, [controls]); // eslint-disable-line react-hooks/exhaustive-deps

  const fin = useStable(gen.fin);
  const rulesRow = useStable(gen.rulesRow);
  const qf2 = useStable(gen.qf2);
  const det = a ? a.lon_per_x * a.lat_per_y - a.lon_per_y * a.lat_per_x : 0;
  const toLocal = ([lon, lat]: [number, number]): [number, number] => {
    const dl = lon - a!.lon0, dt = lat - a!.lat0;
    return [(dl * a!.lat_per_y - dt * a!.lon_per_y) / det, (dt * a!.lon_per_x - dl * a!.lat_per_x) / det];
  };
  const ringOf = (g: { type: string; coordinates: unknown }): [number, number][] =>
    ((g.type === "Polygon" ? (g.coordinates as [number, number][][])[0] : (g.coordinates as [number, number][][][])[0]?.[0]) ?? []).map(toLocal);
  // Existing buildings on the lot, in the lot's local feet (a backyard cottage keeps clear of them).
  const existing = useMemo(() => {
    if (!mapData || !a || !det) return [];
    const parcel = (mapData.features as { properties: { kind: string } }[]).find((f) => f.properties.kind === "parcel");
    if (!parcel) return [];
    return (markSubject(mapData, parcel).features as { properties: { kind: string; subject?: boolean }; geometry: { type: string; coordinates: unknown } }[])
      .filter((f) => f.properties.kind === "building" && f.properties.subject).map((f) => ringOf(f.geometry));
  }, [mapData, a]); // eslint-disable-line react-hooks/exhaustive-deps
  // Neighboring lots and buildings for the clay model and the plan (context only; the solver never reads them).
  const neighbors = useMemo(() => {
    if (!mapData || !a || !det) return [];
    const feats = markSubject(mapData, (mapData.features as { properties: { kind: string } }[]).find((f) => f.properties.kind === "parcel")).features as { properties: { kind: string; subject?: boolean; height_m?: number | null }; geometry: { type: string; coordinates: unknown } }[];
    const near = (r: [number, number][]) => r.length >= 3 && r.some(([x, y]) => Math.hypot(x, y) < 260);
    return [
      ...feats.filter((f) => f.properties.kind === "neighbor").map((f) => ({ parcel: ringOf(f.geometry) })).filter((n) => near(n.parcel)),
      ...feats.filter((f) => f.properties.kind === "building" && !f.properties.subject).map((f) => ({ building: ringOf(f.geometry), heightFt: f.properties.height_m ? f.properties.height_m * 3.28084 : undefined })).filter((n) => near(n.building)),
    ] as { parcel?: Ring; building?: Ring; heightFt?: number }[];
  }, [mapData, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const streetName = useMemo(() => {
    const addr = (viewFacts?.address ?? "").replace(/^[0-9\-\s]+/, "").trim();
    return addr || "Street";
  }, [viewFacts?.address]);
  const data = useMemo<Qf2Data | null>(() => (qf2 ? { ...qf2, existing } : null), [qf2, existing]);
  const shownControls: AppControls = controls ?? gen.defaults.single_detached;
  const req = useMemo(() => ({ controls: shownControls, strategy: controls ? typeOf(controls.typology).strategy : null }), [JSON.stringify(shownControls), !!controls]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useQf2(data, fin, req);
  const scheme = run.scheme;
  const input = useMemo(() => (data ? toParcelInput(sourcesOf(data, run.controls?.frontEdgeIndex ?? shownControls.frontEdgeIndex)) : null), [data, run.controls?.frontEdgeIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const v1 = useMemo(() => (scheme && input && scheme.footprintWorld && scheme.status !== "not_allowed" ? toV1Scheme(scheme, input) : null), [scheme, input]);
  const reason = scheme && !scheme.footprintWorld ? scheme.statusSentence : null;
  const binding = scheme?.bindingConstraint?.sentence ?? null;
  const metrics = (controls ? run.metrics : null) ?? gen.serverMetrics;
  useEffect(() => { (window as unknown as { __qfLast?: unknown }).__qfLast = { ...(run.ms ?? {}), scheme: v1?.id ?? null, error: run.error }; }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same scheme for the Context (photoreal) and map views: boxes in lon/lat, feet NAVD88.
  const worldBoxes = useMemo(() => {
    if (!scheme || !a || !scheme.footprintWorld) return [];
    const f = scheme.frame;
    const W = (x: number, y: number): [number, number] => toLonLat([f.origin[0] + f.ux[0] * x + f.uy[0] * y, f.origin[1] + f.ux[1] * x + f.uy[1] * y]);
    const z0s = scheme.massing.map((b) => b.z0);
    const zmin = z0s.length ? Math.min(...z0s) : 0;
    return scheme.massing.filter((b) => b.h > 0.2).map((b) => ({
      ring: [W(b.x, b.y), W(b.x + b.w, b.y), W(b.x + b.w, b.y + b.d), W(b.x, b.y + b.d)] as [number, number][],
      z0: b.z0, z1: b.z0 + b.h, color: b.kind === "roof" ? "#8a8f8c" : b.color ?? "#b9dccd", floor: b.kind === "foundation" ? 0 : Math.max(0, Math.round((b.z0 - zmin) / 10)),
    }));
  }, [scheme, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const massing: Massing = useMemo(() => (worldBoxes.length ? { boxes: worldBoxes.map(({ floor: _f, ...b }) => b), zAbsolute: !!qf2?.terrain } : null), [worldBoxes, qf2]);
  const envelope = useMemo(() => {
    const d = (scheme as unknown as { debug?: { buildable?: [number, number][][][] } } | null)?.debug;
    if (!scheme || !a || !d?.buildable) return null;
    const f = scheme.frame;
    return d.buildable.map((p) => (p[0] ?? []).map(([x, y]) => toLonLat([f.origin[0] + f.ux[0] * x + f.uy[0] * y, f.origin[1] + f.ux[1] * x + f.uy[1] * y]))).filter((r) => r.length >= 3);
  }, [scheme, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapMassing: MapMassing = useMemo(() => (worldBoxes.length || envelope ? { boxes: worldBoxes, envelope: envelope ?? [] } : null), [worldBoxes, envelope]);
  const maxHeightFt = typeof rulesRow?.max_height_ft === "number" ? rulesRow.max_height_ft : 40;
  const photoEnvelope = useMemo(() => (envelope ? { rings: envelope, heightFt: maxHeightFt } : null), [envelope, maxHeightFt]);

  // Pinned schemes (this tab only), up to three.
  const pinKey = `es.qf.pins.${parid}`;
  const pinsRaw = useSyncExternalStore(subscribePins, () => readPins(pinKey), () => "[]");
  const pins = useMemo(() => { try { return JSON.parse(pinsRaw) as Pinned[]; } catch { return []; } }, [pinsRaw]);
  const savePins = (p: Pinned[]) => writePins(pinKey, JSON.stringify(p));
  const pin = () => {
    if (!controls || !run.metrics || pins.length >= 3) return;
    const key = JSON.stringify(controls);
    if (pins.some((p) => p.key === key)) return;
    const n = scheme?.units.length ?? 0;
    savePins([...pins, { key, controls, metrics: run.metrics, binding, label: `${typeOf(controls.typology).label}${n ? `: ${n} home${n === 1 ? "" : "s"}` : ""}` }]);
  };

  // Enough to aim the photoreal camera before the map data streams in: the centroid and the lot's radius.
  const early = useMemo(() => {
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null;
    let radiusM = 20;
    if (outline && outline.length >= 3) {
      const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      radiusM = Math.max(...outline.map(([x, y]) => Math.hypot(x - cx, y - cy))) * 0.3048;
    }
    return { lon: center[0], lat: center[1], radiusM };
  }, [center?.[0], center?.[1], outline]); // eslint-disable-line react-hooks/exhaustive-deps
  const parcelKey = String((mapData?.features as { properties?: { kind?: string; id?: string } }[] | undefined)?.find((f) => f.properties?.kind === "parcel")?.properties?.id ?? mapData?.center?.join(",") ?? "parcel");
  const overlaysOn = !(mobile && sheet === "full");
  const [descOpen, setDescOpen] = useState(false);
  const descBtn = useRef<HTMLButtonElement>(null);

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100">
      <section aria-label="Map and 3D view" className="absolute inset-0">
      {!loaded && mode !== "build" && <StagePlaceholder outline={outline} />}
      {mode === "build" && !canSolve && (
        <div className="absolute inset-0 z-10 grid place-items-center p-4 md:pl-[472px]">
          <div role="status" className="max-w-sm rounded-2xl border border-slate-300 bg-white p-4 text-sm text-slate-900 shadow-xl">
            <p>{noSolveNote}</p>
            <button type="button" onClick={() => choose("terrain")}
              className="mt-3 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">Show 3D Terrain</button>
          </div>
        </div>
      )}
      {mode === "build" && (
        <Clay3D scheme={scheme} input={input} terrain={qf2?.terrain ?? null} neighbors={neighbors} streetName={streetName}
          onPickFront={(i) => change({ ...shownControls, frontEdgeIndex: i })} mode={clayMode} onModeChange={setClayMode}
          insets={mobile ? { left: 0, bottom: sheetPx(sheet) + BAR_H_M } : { left: PANEL_W + GUTTER + (buildOpen ? BUILD_W + GUTTER : 0), bottom: BAR_H + 12 }} />
      )}
      {mapData && stageMounted && mode !== "build" && (
        <div className={`absolute inset-0 ${mode === "photoreal" ? "invisible" : ""}`} aria-hidden={mode === "photoreal"}>
          <MapStage data={mapData} massing={mapMassing} bottomInset={insets.bottom} leftInset={mobile ? 0 : PANEL_W + GUTTER + BUILD_W + GUTTER} />
        </div>
      )}
      {mode === "photoreal" && HAS_KEY && (mapData || early) && <>
        {mapData && <PhotorealStill data={mapData} insets={insets} />}
        <Photoreal3D parcelKey={parcelKey} data={mapData ?? NO_FEATURES} early={early} massing={massing} envelope={photoEnvelope} insets={insets}
          onFallback={() => choose("terrain")} mode={buildMode} onModeChange={setBuildMode} />
      </>}
      {mapData && mode === "photoreal" && !HAS_KEY && <KeyNeeded onFallback={() => choose("terrain")} />}
      {(mapData || mode === "build") && <ViewSwitch mode={mode} hasKey={HAS_KEY} onChange={choose}
        extra={viewFacts ? <DescribeButton open={descOpen} onToggle={() => setDescOpen(!descOpen)} controls="es-describe" btnRef={descBtn} /> : null} />}
      {mapData && viewFacts && (
        <DescribeView id="es-describe" open={descOpen} onClose={() => { setDescOpen(false); descBtn.current?.focus(); }}
          className="absolute left-3 right-3 top-28 z-40 md:left-[472px] md:right-auto md:top-16 md:w-[min(380px,calc(100%-490px))] xl:left-[calc(50%+92px)] xl:-translate-x-1/2"
          lines={describeParcelView({ mode, facts: viewFacts, scheme: v1 ?? (!scheme && gen.strategy ? gen.fixed[gen.strategy] ?? null : null), reason, binding,
            envelopeSf: (scheme as unknown as { debug?: { buildableSqft?: number } } | null)?.debug?.buildableSqft ?? null, code: { front: gen.code.front ?? null, side: gen.code.side ?? null, rear: gen.code.rear ?? null }, existingOnLot: existing.length,
            neighborBuildings: Math.max(0, ((mapData.features ?? []) as { properties?: { kind?: string } }[]).filter((f) => f.properties?.kind === "building").length - existing.length) })}
          announce={touched.current && scheme ? schemeSentence(v1, reason, viewFacts.lotSf) : null} />
      )}

      {(data || mapData) && overlaysOn && mode !== "analysis" && (
        <div className={`absolute left-3 top-16 z-20 md:left-[472px] md:right-auto md:top-16 md:w-[300px] ${buildOpen ? "right-3" : "w-[calc(100%-13.5rem)]"}`}>
          <BuildPanel controls={shownControls} onChange={change} onReset={() => { touched.current = true; setControls(gen.defaults[shownControls.typology]); }}
            isDefault={sameControls(shownControls, gen.defaults[shownControls.typology])} code={gen.code} scheme={scheme} all={run.all} ms={run.ms} unavailable={canSolve ? null : noSolveNote}
            open={buildOpen} onToggle={() => setBuildOpen(!buildOpen)} notApplicable={gen.notApplicable}
            edges={((scheme as unknown as { debug?: { edges?: { i: number; kind: string; lengthFt: number }[] } } | null)?.debug?.edges ?? []).map((e) => ({ i: e.i, kind: e.kind, lengthFt: e.lengthFt }))} />
        </div>
      )}
      {(data || mapData) && overlaysOn && (
        <div className="absolute left-2 right-2 z-20 md:left-[472px] md:right-4" style={{ bottom: mobile ? sheetH + 6 : 12 }}>
          <MetricsBar metrics={metrics} binding={binding} reason={reason} controls={controls} pins={pins}
            onPin={pin} onUnpin={(k) => savePins(pins.filter((p) => p.key !== k))} onRestore={(p) => { touched.current = true; setControls(p.controls); setBuildMode("buildable"); }}
            compact={mobile} busy={!!controls && !!run.controls && !sameControls(run.controls, controls)} />
        </div>
      )}
      </section>

      <main
        aria-label="Parcel details"
        className={`absolute inset-x-0 bottom-0 z-30 flex h-[45vh] flex-col overflow-hidden rounded-t-2xl border border-white/50 bg-white/90 shadow-2xl backdrop-blur-xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:h-auto md:w-[440px] md:rounded-2xl md:bg-white/85 ${dragH == null ? "transition-[height] duration-300" : ""}`}
        style={mobile ? { height: sheetH } : undefined}>
        <button type="button" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
          className="flex w-full touch-none justify-center pb-1 pt-2 md:hidden" aria-label={sheet === "full" ? "Collapse details" : "Expand details"}>
          <span className="h-1.5 w-10 rounded-full bg-slate-300" />
        </button>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-1 md:pt-5">{pane}</div>
      </main>
      <DrawerHost drawers={[
        ...drawers.filter((d) => d.id === "pencils"),
        { id: "plan", title: "Change the plan", content: <>
          <section>
            <h3 className="text-sm font-semibold text-slate-900">The layout in “Build it in 3D” (QuickFit)</h3>
            {data ? <QuickFitPanel scheme={scheme} />
              : <p className="text-sm text-slate-700">{loaded ? "No lot geometry available." : "Loading the lot geometry…"}</p>}
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
