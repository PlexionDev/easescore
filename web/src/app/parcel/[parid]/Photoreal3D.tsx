"use client";

// Photoreal 3D parcel view: Google Photorealistic 3D Tiles in CesiumJS with our own overlays draped on
// the mesh. Loaded only through next/dynamic (ssr: false); Cesium itself is a further dynamic import.
// All overlay geometry comes from our data (parcel_map RPC, QuickFit) and our lidar DEM, never from
// Google's mesh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as CesiumNS from "cesium";
import { acquire, GEOID_OFFSET_M, groundHeights, prefersReducedMotion, release, sunTime, tileErrorOf, warm, type Shared, type TileError } from "@/lib/photoreal";
import { frameParcel, START_RANGE } from "./PhotorealStill";

type Ring = [number, number][];
type Geom = { type: string; coordinates: unknown };
type Feature = { properties: { kind: string; label?: string | null }; geometry: Geom };
export type MapFC = { type: "FeatureCollection"; bbox: number[]; center: [number, number]; features: Feature[] };
/** QuickFit 3D boxes: lon/lat rings, bottom and top in feet (NAVD88 when zAbsolute, else above the ground), one color each. */
export type Massing = { boxes: { ring: Ring; z0: number; z1: number; color: string }[]; zAbsolute: boolean } | null;
export type BuildMode = "existing" | "buildable";
export type Envelope = { rings: Ring[]; heightFt: number } | null;
export type Insets = { left: number; bottom: number };
/** Where the lot is, known from the pane before the map data streams in: enough to aim the camera and start tiles. */
export type Early = { lon: number; lat: number; radiusM: number };

const SETTLE_S = 1.2; // short settle from the slightly wider opening framing (none under reduced motion)
const LIFT_M = 0.4; // lines ride just above the lidar ground so they don't flicker against the mesh
const DESATURATE = 0; // share of luminance mixed into the surroundings; 0 turns it off

const LAYERS: { id: string; label: string; kinds: Record<string, string> }[] = [
  { id: "landslide", label: "Landslide-prone (City)", kinds: { landslide_prone_pgh: "#ef4444" } },
  { id: "undermined", label: "Undermined (City)", kinds: { undermined_pgh: "#a855f7" } },
  { id: "flood", label: "FEMA flood zones", kinds: { floodway: "#1d4ed8", flood_100: "#3b82f6", flood_500: "#93c5fd" } },
  { id: "zoning", label: "Zoning districts", kinds: { zoning: "#f8fafc" } },
];

// Cache of the last camera per parcel, so switching view modes and coming back doesn't re-fly.
const lastView = new Map<string, { position: CesiumNS.Cartesian3; heading: number; pitch: number; roll: number }>();

function polysOf(g: Geom | null | undefined): Ring[][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as Ring[]];
  if (g.type === "MultiPolygon") return g.coordinates as Ring[][];
  return [];
}

function inRing([x, y]: [number, number], r: Ring) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segX(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function bbox(rings: Ring[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1] as const;
}
/** Does a feature's area touch the parcel? Outer rings only; good enough for "turn this layer on by default". */
function touches(parcel: Ring[], polys: Ring[][]) {
  const pb = bbox(parcel);
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const fb = bbox([outer]);
    if (fb[0] > pb[2] || fb[2] < pb[0] || fb[1] > pb[3] || fb[3] < pb[1]) continue;
    if (parcel.some((r) => r.some((p) => inRing(p, outer)))) return true;
    if (parcel.some((r) => outer.some((p) => inRing(p, r)))) return true;
    for (const r of parcel) for (let i = 0; i + 1 < r.length; i++) for (let j = 0; j + 1 < outer.length; j++)
      if (segX(r[i]!, r[i + 1]!, outer[j]!, outer[j + 1]!)) return true;
  }
  return false;
}
const open = (r: Ring): Ring => (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.slice(0, -1) : r);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/** Vertices every ~2 m along a ring (closed) or line, so a line drawn at lidar heights follows the ground. */
function densify(r: Ring, closed: boolean, stepM = 2): Ring {
  const pts = closed && r.length ? [...r, r[0]!] : r;
  const kx = 111320 * Math.cos(((pts[0]?.[1] ?? 40) * Math.PI) / 180), ky = 110950;
  const out: Ring = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const n = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) / stepM));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]!);
  return out;
}

/** A line's positions on bare earth: our 1 m lidar DTM sampled at every densified vertex. groundHeights() turns the
 *  DTM's NAVD88 orthometric heights into WGS84 ellipsoid heights (Google's frame) with a fixed county geoid offset
 *  (GEOID_OFFSET_M, about -33.7 m around Allegheny County). Never draped on Google's mesh, so it doesn't climb
 *  trees or roofs. */
async function groundLine(C: typeof CesiumNS, r: Ring, closed: boolean, fallback: number) {
  const d = densify(r, closed);
  const hs = await groundHeights(d);
  return d.map((p, i) => C.Cartesian3.fromDegrees(p[0], p[1], (hs[i] ?? fallback) + LIFT_M));
}

type Status = { phase: "engine" | "tiles" | "ready" } | { phase: "error"; error: TileError };

/** Fixed early-afternoon sun, soft shadows, sky; camera inputs on. */
function applyLook(s: Shared) {
  const { C, viewer } = s;
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = sunTime(C);
  viewer.shadows = true;
  viewer.shadowMap.softShadows = true;
  viewer.shadowMap.size = 2048;
  viewer.shadowMap.maximumDistance = 1500;
  viewer.scene.globe.show = false;
  viewer.scene.screenSpaceCameraController.enableInputs = true;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
}

/** Resolves once this view's tiles are in: the tileset's first full load, a later full load, requests draining back
 *  to zero, or the quiet frames after a fully cached view; after `fallbackMs`, whatever has loaded is shown. */
function viewLoaded(s: Shared, ts: CesiumNS.Cesium3DTileset, cleanups: (() => void)[], onPending: (n: number) => void, fallbackMs = 6000) {
  const scene = s.viewer.scene;
  let inFlight = -1;
  const unProgress = ts.loadProgress.addEventListener((p: number, q: number) => { inFlight = p + q; onPending(p + q); });
  cleanups.push(unProgress);
  const stats = (ts as unknown as { statistics: { numberOfCommands: number } }).statistics;
  return new Promise<void>((resolve) => {
    let frames = 0, fin = false;
    const t = setTimeout(done, fallbackMs);
    const un = [
      ts.initialTilesLoaded.addEventListener(done),
      ts.allTilesLoaded.addEventListener(done),
      scene.postRender.addEventListener(() => { if (++frames > 5 && (ts.tilesLoaded || inFlight === 0) && stats.numberOfCommands > 0) done(); }),
    ];
    function done() { if (fin) return; fin = true; clearTimeout(t); un.forEach((u) => u()); resolve(); }
    cleanups.push(done);
  });
}

export default function Photoreal3D({ parcelKey, data, early, massing, envelope, insets, onFallback, mode: modeProp, onModeChange }: {
  parcelKey: string; data: MapFC; early?: Early | null; massing: Massing; envelope: Envelope; insets: Insets; onFallback: () => void;
  /** Controlled "Existing / What can be built" (the map's Build panel turns the massing on). */
  mode?: BuildMode; onModeChange?: (m: BuildMode) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sh = useRef<Shared | null>(null);
  const tiles = useRef<CesiumNS.Cesium3DTileset | null>(null);
  const ds = useRef<CesiumNS.CustomDataSource | null>(null);
  const build = useRef<CesiumNS.CustomDataSource | null>(null);
  const layerEnts = useRef<Record<string, CesiumNS.Entity[]>>({});
  const home = useRef<{ destination: CesiumNS.Cartesian3; orientation: { heading: number; pitch: number; roll: number } } | null>(null);
  const pivot = useRef<CesiumNS.Cartesian3 | null>(null);
  const fade = useRef(0);
  const orbitRef = useRef(false);
  const insetsRef = useRef(insets);
  const [status, setStatus] = useState<Status>({ phase: "engine" });
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false); // viewer mounted + base entities placed
  const [modeState, setModeState] = useState<BuildMode>("existing");
  const mode = modeProp ?? modeState;
  const setMode = (m: BuildMode) => { setModeState(m); onModeChange?.(m); };
  const prim = useRef<CesiumNS.Primitive | null>(null);
  const [orbit, setOrbit] = useState(false);
  const [heading, setHeading] = useState(0);
  const [ground, setGround] = useState<{ parcel: number[]; base: number; rings: Ring[] } | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [capturing, setCapturing] = useState(false);
  const me = useMemo(() => Symbol("parcel3d"), []);
  // Early start (before the map data): the camera the early effect placed, whether the view is already showing,
  // whether the full parcel effect has taken over, and whether the visitor has moved the camera.
  const earlyCam = useRef(false);
  const revealed = useRef(false);
  const mainStarted = useRef(false);
  const userMoved = useRef(false);

  const parcelRings = useMemo(() => data.features.filter((f) => f.properties.kind === "parcel").flatMap((f) => polysOf(f.geometry).map((p) => open(p[0] ?? []))).filter((r) => r.length >= 3), [data]);
  const present = useMemo(() => {
    const out: Record<string, { any: boolean; touches: boolean }> = {};
    for (const L of LAYERS) {
      const polys = data.features.filter((f) => f.properties.kind in L.kinds).flatMap((f) => polysOf(f.geometry));
      out[L.id] = { any: polys.length > 0, touches: polys.length > 0 && touches(parcelRings, polys) };
    }
    return out;
  }, [data, parcelRings]);
  // Layers default ON only where they touch the parcel; the user's toggles override that.
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const on = useMemo(() => Object.fromEntries(LAYERS.map((L) => [L.id, override[L.id] ?? present[L.id]!.touches])), [override, present]);
  // Start Cesium, the viewer and the tileset root request while our ground heights load.
  useEffect(() => { warm().catch(() => { /* surfaced by acquire */ }); }, []);
  useEffect(() => {
    orbitRef.current = orbit;
    // The slow presentation orbit counts as "at rest" for detail: keep full quality while it turns.
    const s = sh.current;
    if (s) { s.steady = orbit; s.refreshQuality(); }
  }, [orbit]);
  useEffect(() => { insetsRef.current = insets; }, [insets]);
  const ringsRef = useRef<Ring[]>([]);
  useEffect(() => { ringsRef.current = parcelRings; }, [parcelRings]);

  // Early start: as soon as the pane knows where the lot is, aim the camera there and stream tiles, so the live view
  // can show while the map data (lot lines, overlays) is still on its way. The parcel effect below takes over.
  const eLon = early?.lon, eLat = early?.lat, eR = early?.radiusM;
  useEffect(() => {
    if (eLon == null || eLat == null || !host.current) return;
    let dead = false, mine = false;
    const cleanups: (() => void)[] = [];
    (async () => {
      let s: Shared;
      try { s = await acquire(host.current!, me); } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      const [h] = await groundHeights([[eLon, eLat]]);
      // Map data already here (or a remembered view): the parcel effect frames the lot itself.
      if (dead || mainStarted.current || ringsRef.current.length || lastView.has(parcelKey)) return;
      mine = true;
      sh.current = s;
      const { C, viewer } = s;
      setStatus({ phase: "tiles" });
      s.loading = true;
      s.steady = false;
      s.refreshQuality();
      applyLook(s);
      // A square of the lot's size around its centroid frames the same as the lot itself, within a few metres.
      const m = { x: 111320 * Math.cos((eLat * Math.PI) / 180), y: 110950 };
      const r = Math.max(eR ?? 20, 6) / Math.SQRT2;
      const ring: Ring = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([x, y]) => [eLon + x! / m.x, eLat + y! / m.y]);
      const f = frameParcel([ring], viewer.canvas.clientWidth, viewer.canvas.clientHeight, insetsRef.current, prefersReducedMotion() ? 1 : START_RANGE);
      const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(eLon, eLat, h ?? 300));
      viewer.camera.setView({ destination: C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(...f.cam), new C.Cartesian3()), orientation: { heading: f.heading, pitch: f.pitch, roll: 0 } });
      earlyCam.current = true;
      const moved = () => { userMoved.current = true; };
      for (const ev of ["pointerdown", "wheel", "touchstart"] as const) {
        viewer.canvas.addEventListener(ev, moved, { passive: true });
        cleanups.push(() => viewer.canvas.removeEventListener(ev, moved));
      }
      let ts: CesiumNS.Cesium3DTileset;
      try { ts = await s.tileset; } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      if (dead) return;
      await viewLoaded(s, ts, cleanups, setPending);
      if (dead || revealed.current) return;
      revealed.current = true;
      s.loading = false;
      s.refreshQuality();
      setStatus({ phase: "ready" });
    })();
    return () => {
      dead = true;
      for (const c of cleanups.reverse()) { try { c(); } catch { /* viewer already gone */ } }
      if (mine && !mainStarted.current) {
        earlyCam.current = false;
        revealed.current = false;
        userMoved.current = false;
        setStatus({ phase: "tiles" });
        release(sh.current, me);
        sh.current = null;
      }
    };
  }, [eLon, eLat, eR, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ground heights for the parcel ring, from our lidar DEM.
  useEffect(() => {
    let dead = false;
    const ring = parcelRings.flat();
    if (!ring.length) return;
    groundHeights(ring).then((hs) => {
      if (dead) return;
      const ok = hs.filter((h): h is number => h != null);
      const fallback = ok.length ? median(ok) : 300; // outside DEM coverage: a typical county ground height
      const parcel = hs.map((h) => Math.min(h ?? fallback, median(ok.length ? ok : [fallback]) + 6));
      setGround({ parcel, base: Math.min(...parcel), rings: parcelRings });
    });
    return () => { dead = true; };
  }, [parcelRings]);

  // Mount the shared viewer, configure it for the parcel view, drape the parcel and overlays.
  useEffect(() => {
    // Wait for this parcel's heights (after client-side navigation the previous parcel's are still in state).
    if (!ground || ground.rings !== parcelRings || !host.current) return;
    let dead = false;
    const hostEl = host.current;
    mainStarted.current = true;
    const cleanups: (() => void)[] = [];
    (async () => {
      let s: Shared;
      try { s = await acquire(host.current!, me); } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      if (dead) { release(s, me); return; }
      sh.current = s;
      const { C, viewer } = s;
      const scene = viewer.scene;
      if (!revealed.current) {
        setStatus({ phase: "tiles" });
        // A new place is streaming in: load-time detail until it is revealed.
        s.loading = true;
      }
      s.steady = false;
      s.refreshQuality();
      cleanups.push(() => { s.steady = false; s.refreshQuality(); });
      applyLook(s);

      // Parcel + overlay entities.
      const src = new C.CustomDataSource("easescore-parcel");
      await viewer.dataSources.add(src);
      ds.current = src;
      const bsrc = new C.CustomDataSource("easescore-buildable");
      await viewer.dataSources.add(bsrc);
      build.current = bsrc;
      cleanups.push(() => { viewer.dataSources.remove(src, true); viewer.dataSources.remove(bsrc, true); ds.current = null; build.current = null; });

      const CT = C.ClassificationType.CESIUM_3D_TILE;
      const col = (hex: string, a: number) => C.Color.fromCssColorString(hex).withAlpha(a);
      const hier = (poly: Ring[]) => new C.PolygonHierarchy(
        C.Cartesian3.fromDegreesArray(open(poly[0]!).flat()),
        poly.slice(1).map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(open(h).flat()))),
      );

      // Lines sit on the lidar ground (see groundLine); where trees or buildings hide them they show dashed and lighter.
      const lineOnGround = async (r: Ring, color: string, width: number, hidden: string, alpha = 1) => src.entities.add({ polyline: {
        positions: await groundLine(C, r, true, ground.base), width, arcType: C.ArcType.NONE, material: col(color, alpha),
        depthFailMaterial: new C.PolylineDashMaterialProperty({ color: col(hidden, 0.85), dashLength: 12 }),
      } });

      // Hazards and zoning: near-invisible draped fills (for picking out the area) and crisp outlines on the ground.
      const outlines: Promise<void>[] = [];
      const labelPts: { at: [number, number]; text: string; offsetUp: boolean }[] = [];
      const pc = data.center;
      for (const L of LAYERS) {
        const ents: CesiumNS.Entity[] = [];
        for (const f of data.features) {
          const color = L.kinds[f.properties.kind];
          if (!color) continue;
          const zoning = f.properties.kind === "zoning";
          for (const poly of polysOf(f.geometry)) {
            if (!poly[0] || poly[0].length < 3) continue;
            if (!zoning) ents.push(src.entities.add({ polygon: { hierarchy: hier(poly), material: col(color, 0.01), classificationType: CT } }));
            outlines.push(lineOnGround(open(poly[0]), zoning ? "#0f172a" : color, zoning ? 2.5 : 2, zoning ? "#94a3b8" : color, 0.95).then((e) => { ents.push(e); }));
            if (zoning && f.properties.label) {
              const outer = open(poly[0]);
              if (inRing(pc, outer)) labelPts.push({ at: pc, text: f.properties.label, offsetUp: true });
              else {
                let best = outer[0]!, bd = Infinity;
                for (const p of outer) { const d = (p[0] - pc[0]) ** 2 + (p[1] - pc[1]) ** 2; if (d < bd) { bd = d; best = p; } }
                labelPts.push({ at: best, text: f.properties.label, offsetUp: false });
              }
            }
          }
        }
        layerEnts.current[L.id] = ents;
      }
      // Declutter: the parcel's own district first, then neighbors within ~150 m, none closer than ~45 m to another.
      const m = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 84000, (a[1] - b[1]) * 111000);
      labelPts.sort((a, b) => Number(b.offsetUp) - Number(a.offsetUp));
      const kept: typeof labelPts = [];
      for (const p of labelPts) {
        if (!p.offsetUp && m(p.at, pc) > 150) continue;
        if (kept.some((k) => k.text === p.text || m(k.at, p.at) < 45)) continue;
        kept.push(p);
      }
      labelPts.splice(0, labelPts.length, ...kept);
      const [lh] = await Promise.all([groundHeights(labelPts.map((p) => p.at)), Promise.all(outlines)]);
      if (dead) return;
      layerEnts.current.zoning ??= [];
      labelPts.forEach((p, i) => {
        layerEnts.current.zoning!.push(src.entities.add({
          position: C.Cartesian3.fromDegrees(p.at[0], p.at[1], (lh[i] ?? ground.base) + 2),
          label: {
            text: `Zoning ${p.text}`, font: "600 13px system-ui, sans-serif", fillColor: C.Color.WHITE,
            showBackground: true, backgroundColor: col("#0f172a", 0.78), backgroundPadding: new C.Cartesian2(7, 4),
            pixelOffset: new C.Cartesian2(0, p.offsetUp ? -70 : 0), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            horizontalOrigin: C.HorizontalOrigin.CENTER, verticalOrigin: C.VerticalOrigin.BOTTOM,
          },
        }));
      });

      // The parcel: no fill; soft glow and a crisp bright edge, on the lidar ground.
      for (const r of parcelRings) {
        const positions = await groundLine(C, r, true, ground.base);
        if (dead) return;
        src.entities.add({ polyline: { positions, width: 12, arcType: C.ArcType.NONE, material: col("#facc15", 0.22) } });
        src.entities.add({ polyline: { positions, width: 3, arcType: C.ArcType.NONE, material: col("#fde047", 1),
          depthFailMaterial: new C.PolylineDashMaterialProperty({ color: col("#fef9c3", 0.9), dashLength: 12 }) } });
      }

      // Camera: frame the parcel at ~45 degrees, clear of the floating panel. Same framing as the still preview
      // (PhotorealStill), which the view opens on, so the live tiles fade in over it without a jump.
      const hs = ground.parcel;
      const frame0 = frameParcel(parcelRings, 1, 1, insetsRef.current, 1);
      const center = C.Cartesian3.fromDegrees(frame0.lon0, frame0.lat0, (Math.min(...hs) + Math.max(...hs)) / 2);
      const enu = C.Transforms.eastNorthUpToFixedFrame(center);
      pivot.current = center;
      const view = (rangeMul: number) => {
        const f = frameParcel(parcelRings, viewer.canvas.clientWidth, viewer.canvas.clientHeight, insetsRef.current, rangeMul);
        return { destination: C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(...f.cam), new C.Cartesian3()), orientation: { heading: f.heading, pitch: f.pitch, roll: 0 } };
      };
      home.current = view(1);
      const remembered = lastView.get(parcelKey);
      const reduced = prefersReducedMotion();
      // Already aimed by the early start: keep that camera (the settle below moves it to the exact framing).
      const fromEarly = earlyCam.current && !remembered;
      if (remembered) viewer.camera.setView({ destination: remembered.position, orientation: remembered });
      else if (reduced) viewer.camera.setView(home.current); // reduced motion: a jump cut, no settle
      else if (!fromEarly) viewer.camera.setView(view(START_RANGE));
      let arrived = !!remembered || reduced || userMoved.current; // don't remember a half-finished settle
      cleanups.push(() => {
        const c = viewer.camera;
        if (!arrived) return;
        lastView.set(parcelKey, { position: C.Cartesian3.clone(c.positionWC), heading: c.heading, pitch: c.pitch, roll: c.roll });
      });

      // Compass, orbit, stop-on-input.
      viewer.camera.percentageChanged = 0.01;
      const onCam = () => setHeading(C.Math.toDegrees(viewer.camera.heading));
      cleanups.push(viewer.camera.changed.addEventListener(onCam));
      onCam();
      let last = performance.now();
      cleanups.push(scene.preRender.addEventListener(() => {
        const now = performance.now(), dt = Math.min(now - last, 100);
        last = now;
        if (orbitRef.current && pivot.current) rotateAround(C, viewer.camera, pivot.current, -dt * 0.00007);
      }));
      const stop = () => { userMoved.current = true; setOrbit(false); };
      for (const ev of ["pointerdown", "wheel", "touchstart"] as const) {
        viewer.canvas.addEventListener(ev, stop, { passive: true });
        cleanups.push(() => viewer.canvas.removeEventListener(ev, stop));
      }

      // Tiles: wait for the first full load, then reveal and fly in.
      let ts: CesiumNS.Cesium3DTileset;
      try { ts = await s.tileset; } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      if (dead) return;
      tiles.current = ts;
      // Receive only: the mesh already has baked shadows; only our massing casts new ones onto it.
      ts.shadows = C.ShadowMode.RECEIVE_ONLY;
      // Subtle desaturation away from the parcel so the lot pops.
      ts.customShader = new C.CustomShader({
        uniforms: {
          u_center: { type: C.UniformType.VEC3, value: center },
          u_radius: { type: C.UniformType.FLOAT, value: Math.max(frame0.radius * 1.4, 25) },
          u_amount: { type: C.UniformType.FLOAT, value: DESATURATE },
        },
        fragmentShaderText: `
          void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
            float d = distance(fsInput.attributes.positionWC, u_center);
            float k = u_amount * smoothstep(u_radius, u_radius * 3.0, d);
            float l = dot(material.diffuse, vec3(0.2126, 0.7152, 0.0722));
            material.diffuse = mix(material.diffuse, vec3(l), k);
          }`,
      });
      // Clip the mesh inside the parcel in "What can be built"; enabled by the mode effect.
      ts.clippingPolygons = new C.ClippingPolygonCollection({
        polygons: parcelRings.map((r) => new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray(r.flat()) })),
        enabled: false,
      });
      cleanups.push(() => {
        if (ts.isDestroyed()) return;
        ts.customShader = undefined as unknown as CesiumNS.CustomShader;
        if (ts.clippingPolygons) ts.clippingPolygons.enabled = false;
      });

      // The shared tileset is warmed before the camera reaches this parcel, so its one-time initialTilesLoaded event
      // has usually fired already; reveal when this view's requests drain (skipped if the early start already showed it).
      if (!revealed.current) await viewLoaded(s, ts, cleanups, setPending);
      if (dead) return;
      if (s.failedTiles > 20 && !ts.tilesLoaded) { setStatus({ phase: "error", error: { kind: "network" } }); return; }
      revealed.current = true;
      s.loading = false;
      s.refreshQuality();
      setStatus({ phase: "ready" });
      setReady(true);
      // Settled: camera at rest at full detail and every tile for it loaded. Marked for measurement
      // (performance mark "es3d-settled", data-settled on the view) and only then does the slow orbit start,
      // after a short pause, so it doesn't keep tiles streaming while the first view finishes.
      const settle = () => {
        const t0 = performance.now();
        let since = 0;
        const un = scene.postRender.addEventListener(() => {
          const now = performance.now();
          if (now - t0 < 700) return; // let the idle switch to full detail happen first
          since = ts.tilesLoaded ? since || now : 0;
          if (!(since && now - since > 500) && now - t0 < 20000) return;
          un();
          performance.mark("es3d-settled");
          hostEl.setAttribute("data-settled", "1");
          if (!reduced) {
            const t = setTimeout(() => { if (!dead && !userMoved.current) setOrbit(true); }, 2500);
            cleanups.push(() => clearTimeout(t));
          }
        });
        cleanups.push(un);
      };
      if (!remembered && !reduced && !userMoved.current) {
        viewer.camera.flyTo({ ...home.current, duration: SETTLE_S, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => { arrived = true; if (!dead) settle(); }, cancel: () => { arrived = true; } });
      } else settle();
    })();
    return () => {
      dead = true;
      mainStarted.current = false;
      revealed.current = false;
      earlyCam.current = false;
      userMoved.current = false;
      hostEl.removeAttribute("data-settled");
      setReady(false);
      setStatus({ phase: "tiles" }); // hide the canvas; the still for the next place shows until its tiles are in
      for (const c of cleanups.reverse()) { try { c(); } catch { /* viewer already gone */ } }
      layerEnts.current = {};
      release(sh.current, me);
      sh.current = null;
      tiles.current = null;
    };
  }, [ground, data, parcelRings, parcelKey, me]);

  // Layer toggles.
  useEffect(() => {
    if (!ready) return;
    for (const L of LAYERS) showAll(layerEnts.current[L.id] ?? [], !!on[L.id]);
  }, [on, ready]);

  // Credit line and our attribution sit above the mobile bottom sheet.
  useEffect(() => {
    const s = sh.current;
    if (!s || !ready) return;
    s.credits.style.bottom = `${insets.bottom + 8}px`;
    s.credits.style.maxWidth = `calc(100% - ${insets.left + 16}px)`;
  }, [insets, ready]);
  // Stack our attribution and the camera bar above the credit line, however many lines it wraps to.
  const [creditsH, setCreditsH] = useState(24);
  useEffect(() => {
    const el = sh.current?.credits;
    if (!ready || !el) return;
    const ro = new ResizeObserver(() => setCreditsH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // "What can be built": clip the mesh, drop in a lot pad, the envelope volume, and QuickFit massing.
  useEffect(() => {
    const s = sh.current, src = build.current;
    if (!ready || !s || !src || !ground) return;
    let dead = false;
    const { C } = s;
    (async () => {
      src.entities.removeAll();
      const envRings = envelope?.rings.filter((r) => r.length >= 3) ?? [];
      const [hs, envLines] = await Promise.all([
        groundHeights(envRings.flat()),
        Promise.all(envRings.map((r) => groundLine(C, open(r), true, ground.base))),
      ]);
      if (dead) return;
      let k = 0;
      const take = (n: number) => hs.slice(k, (k += n)).map((h) => h ?? ground.base);
      const col = (hex: string, a: number) => C.Color.fromCssColorString(hex).withAlpha(a);
      const alpha = (hex: string, a: number) => new C.ColorMaterialProperty(new C.CallbackProperty(() => col(hex, a * fade.current), false));
      const shown = new C.CallbackProperty(() => fade.current > 0.02, false);

      // Lot pad: the parcel surface at lidar ground heights, as a shallow earth block that fills the clipped hole.
      let i = 0;
      for (const r of parcelRings) {
        const heights = r.map(() => ground.parcel[i++] ?? ground.base);
        src.entities.add({ polygon: {
          hierarchy: new C.PolygonHierarchy(r.map((p, j) => C.Cartesian3.fromDegrees(p[0], p[1], heights[j]!))),
          perPositionHeight: true, extrudedHeight: ground.base - 6, material: col("#b8a888", 1), show: shown,
          shadows: C.ShadowMode.RECEIVE_ONLY,
        } });
      }
      // Buildable envelope: translucent volume from the lowest ground to the height limit.
      for (const r of envRings) {
        const hts = take(r.length);
        const base = Math.min(...hts);
        const top = Math.max(...hts) + (envelope?.heightFt ?? 40) * 0.3048;
        src.entities.add({ polygon: {
          hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(open(r).flat())), height: base, extrudedHeight: top,
          material: alpha("#22c55e", 0.22), outline: true, outlineColor: new C.CallbackProperty(() => col("#16a34a", 0.9 * fade.current), false), show: shown,
        } });
      }
      // The setback line (envelope footprint) on the lidar ground; dashed where the mesh hides it.
      for (const positions of envLines) {
        src.entities.add({ polyline: {
          positions, width: 3, arcType: C.ArcType.NONE, material: alpha("#16a34a", 1), show: shown,
          depthFailMaterial: new C.PolylineDashMaterialProperty({ color: new C.CallbackProperty(() => col("#86efac", 0.9 * fade.current), false), dashLength: 12 }),
        } });
      }
    })();
    return () => { dead = true; };
  }, [ready, ground, envelope, parcelRings]);

  // QuickFit 3D massing: every floor/unit box, stair core and parking pad in ONE Primitive (GeometryInstances with a
  // per-instance color: one draw call), at our lidar ground heights converted to Google's ellipsoid frame the same way
  // as groundLine (NAVD88 + GEOID_OFFSET_M). Rebuilt synchronously on every change, so a slider never flickers.
  useEffect(() => {
    const s = sh.current;
    if (!ready || !s || !ground) return;
    const { C, viewer } = s;
    let dead = false;
    let mine: CesiumNS.Primitive | null = null;
    const boxes = massing?.boxes.filter((b) => b.ring.length >= 3) ?? [];
    const build = (baseM: number | null) => {
      if (dead || !boxes.length) return;
      const toM = (ft: number) => (baseM == null ? ft * 0.3048 + GEOID_OFFSET_M : baseM + ft * 0.3048);
      const instances = boxes.map((b) => new C.GeometryInstance({
        geometry: new C.PolygonGeometry({
          polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(open(b.ring).flat())),
          height: toM(b.z0), extrudedHeight: toM(b.z1), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(b.color)),
          // Where tree canopy or neighbors hide the building (common on wooded hillsides), it shows through as a ghost.
          depthFailColor: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(b.color).withAlpha(0.42)),
        },
      }));
      mine = new C.Primitive({
        geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ translucent: false, closed: true }),
        depthFailAppearance: new C.PerInstanceColorAppearance({ translucent: true, flat: true, closed: true }),
        asynchronous: false, shadows: C.ShadowMode.ENABLED, show: fade.current > 0.02,
      });
      viewer.scene.primitives.add(mine);
      const old = prim.current;
      prim.current = mine;
      if (old && old !== mine) { viewer.scene.primitives.remove(old); if (!old.isDestroyed()) old.destroy(); }
      viewer.scene.requestRender();
    };
    if (!boxes.length) {
      const old = prim.current;
      prim.current = null;
      if (old) { viewer.scene.primitives.remove(old); if (!old.isDestroyed()) old.destroy(); }
    } else if (massing!.zAbsolute) build(null);
    else groundHeights([boxes[0]!.ring[0]!]).then(([h]) => build(h ?? ground.base));
    return () => { dead = true; void mine; };
  }, [ready, ground, massing]);
  // Drop the massing when the view goes away.
  useEffect(() => () => {
    const p = prim.current, s = sh.current;
    prim.current = null;
    if (p && s && !s.viewer.isDestroyed()) { s.viewer.scene.primitives.remove(p); if (!p.isDestroyed()) p.destroy(); }
  }, []);

  useEffect(() => {
    const s = sh.current, ts = tiles.current;
    if (!ready || !s) return;
    const target = mode === "buildable" ? 1 : 0;
    if (ts?.clippingPolygons && target === 1) ts.clippingPolygons.enabled = true;
    // Driven from Cesium's preRender (not rAF) so the fade stays in step with rendered frames.
    const start = fade.current, t0 = performance.now(), ms = prefersReducedMotion() ? 0 : 600;
    const un = s.viewer.scene.preRender.addEventListener(tick);
    function tick() {
      const k = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
      fade.current = start + (target - start) * (k * k * (3 - 2 * k));
      if (prim.current && !prim.current.isDestroyed()) prim.current.show = fade.current > 0.02;
      if (k < 1) return;
      if (target === 0 && ts?.clippingPolygons && !ts.isDestroyed()) ts.clippingPolygons.enabled = false;
      un();
    }
    tick();
    return un;
  }, [mode, ready]);

  // Camera tools.
  const animate = useCallback((ms: number, fn: (dk: number) => void) => {
    if (prefersReducedMotion()) { fn(1); return; }
    const t0 = performance.now();
    let prev = 0;
    const ease = (k: number) => k * k * (3 - 2 * k);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
      fn(e - prev);
      prev = e;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  const spin = (deg: number) => {
    const s = sh.current, pv = pivot.current;
    if (!s || !pv) return;
    setOrbit(false);
    animate(700, (dk) => rotateAround(s.C, s.viewer.camera, pv, s.C.Math.toRadians(deg) * dk));
  };
  const tilt = (deg: number) => {
    const s = sh.current, pv = pivot.current;
    if (!s || !pv) return;
    setOrbit(false);
    const { C, viewer } = s;
    const lim = [C.Math.toRadians(-89.5), C.Math.toRadians(-8)] as const;
    animate(500, (dk) => {
      const cam = viewer.camera;
      const step = (a: number) => {
        cam.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(pv));
        cam.rotateUp(a);
        cam.lookAtTransform(C.Matrix4.IDENTITY);
      };
      step(C.Math.toRadians(deg) * dk);
      if (cam.pitch < lim[0] || cam.pitch > lim[1]) step(-C.Math.toRadians(deg) * dk); // stay between top-down and near-horizon
    });
  };
  const northUp = () => {
    const s = sh.current;
    if (!s) return;
    let d = -s.viewer.camera.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    spin(s.C.Math.toDegrees(d));
  };
  const reset = () => {
    const s = sh.current;
    if (!s || !home.current) return;
    setOrbit(false);
    s.viewer.camera.flyTo({ ...home.current, duration: prefersReducedMotion() ? 0 : 1.4, easingFunction: s.C.EasingFunction.QUADRATIC_IN_OUT });
  };
  const capture = async () => {
    const s = sh.current, ts = tiles.current;
    if (!s || capturing) return;
    setCapturing(true);
    const { viewer } = s;
    const prev = viewer.resolutionScale;
    try {
      const cw = viewer.canvas.clientWidth || 1;
      viewer.resolutionScale = Math.max(prev, Math.min(prev * 2, 8192 / (cw * (window.devicePixelRatio || 1))));
      viewer.resize();
      viewer.render();
      if (ts && !ts.tilesLoaded) await new Promise<void>((r) => { const t = setTimeout(done, 4000); const un = ts.allTilesLoaded.addEventListener(done); function done() { clearTimeout(t); un(); r(); } });
      viewer.render();
      const src = viewer.canvas;
      const out = document.createElement("canvas");
      out.width = src.width; out.height = src.height;
      const g = out.getContext("2d")!;
      g.drawImage(src, 0, 0);
      // Burn in the attributions: Google's line (as displayed) and ours, kept separate.
      const scale = out.width / cw;
      const google = (s.credits.textContent || "Google").replace(/\s+/g, " ").trim();
      const ours = "Overlays: EaseScore.AI (Allegheny County, City of Pittsburgh, FEMA, USGS lidar)";
      g.font = `${Math.round(12 * scale)}px system-ui, sans-serif`;
      g.textBaseline = "bottom";
      const pad = 8 * scale, lh = 18 * scale;
      for (const [i, text] of [ours, google].entries()) {
        const w = g.measureText(text).width;
        g.fillStyle = "rgba(15,23,42,0.7)";
        g.fillRect(out.width - w - pad * 2, out.height - lh * (2 - i) - pad, w + pad * 1.5, lh);
        g.fillStyle = "#f8fafc";
        g.fillText(text, out.width - w - pad * 1.25, out.height - lh * (1 - i) - pad - 2 * scale);
      }
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `easescore-${parcelKey}-3d.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally {
      viewer.resolutionScale = prev;
      viewer.resize();
      setCapturing(false);
    }
  };

  const err = status.phase === "error" ? status.error : null;
  const loading = status.phase === "engine" || status.phase === "tiles";

  return (
    <div className="absolute inset-0">
      {/* Transparent until the first view has loaded, then fades in over the still preview underneath. */}
      <div ref={host} className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${loading ? "opacity-0" : "opacity-100"}`}
           aria-label="Photoreal 3D view of the parcel" role="img" />

      {loading && (
        <div className="pointer-events-none absolute z-10 w-60 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-900/75 px-4 py-2.5 text-center text-slate-100 shadow-xl backdrop-blur-md"
             style={{ top: `calc((100% - ${insets.bottom}px) / 2)`, left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)` }}>
          <p className="text-xs font-semibold">{status.phase === "engine" ? "Starting the 3D engine…" : "Streaming photoreal 3D tiles…"}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-[es-bar_1.4s_ease-in-out_infinite] rounded-full bg-sky-400" /></div>
          {status.phase === "tiles" && pending > 0 && <p className="mt-1.5 text-[11px] text-slate-400">{pending} tiles in flight</p>}
          <style>{`@keyframes es-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
        </div>
      )}

      {err && (
        <div className="absolute inset-0 flex items-center justify-center p-6 md:pl-[470px]" style={{ background: "radial-gradient(900px 500px at 60% 40%, #1e293b, #0f172a)" }}>
          <div className="max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-slate-100 shadow-2xl backdrop-blur-xl">
            <p className="text-base font-semibold">{err.kind === "key" ? "Google rejected the Map Tiles key" : err.kind === "webgl" ? "This browser can't start WebGL 3D" : "Photoreal 3D tiles didn't load"}</p>
            <p className="mt-2 text-sm text-slate-300">
              {err.kind === "key"
                ? `The tile service answered ${err.status ?? "with an error"}. Check that the Map Tiles API is enabled for the key and that this site is an allowed referrer.`
                : err.kind === "webgl" ? "Hardware acceleration may be off. The lidar terrain view still works."
                : "The network or the tile service had a problem. The lidar terrain view still works."}
            </p>
            <button onClick={onFallback} className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">Switch to 3D Terrain</button>
          </div>
        </div>
      )}

      {!err && (
        <>
          {/* When the mobile sheet is fully open only a sliver of map shows: keep the credit lines, hide the tools. */}
          {!(insets.bottom > 0 && insets.left === 0 && typeof window !== "undefined" && insets.bottom > window.innerHeight * 0.6) && <>
          {/* Layers + Existing / What can be built */}
          <div className="absolute right-3 top-16 z-10 w-44 rounded-2xl border border-white/40 bg-white/85 p-2 text-sm shadow-xl backdrop-blur-md md:right-4 md:w-64 md:p-3 xl:top-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1 text-xs font-semibold" role="radiogroup" aria-label="Show">
              {(["existing", "buildable"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={`rounded-lg px-2 py-1.5 ${mode === m ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-900"}`}>
                  {m === "existing" ? "Existing" : "What can be built"}
                </button>
              ))}
            </div>
            {mode === "buildable" && (
              <p className="mt-2 hidden text-xs text-slate-600 md:block">
                {massing?.boxes.length ? "Green: buildable envelope and setback line · blocks: the layout from Build it in 3D." : envelope?.rings.length ? "Green: buildable envelope. Nothing fits with these settings; try the Build panel." : "QuickFit hasn't produced an envelope for this lot."}
              </p>
            )}
            <button onClick={() => setPanelOpen(!panelOpen)} className="mt-2 flex w-full items-center justify-between font-semibold text-slate-800">
              Overlays <span className="text-slate-400">{panelOpen ? "–" : "+"}</span>
            </button>
            {panelOpen && (
              <div className="mt-1.5 space-y-1.5 text-slate-700">
                {LAYERS.map((L) => (
                  <label key={L.id} className={`flex cursor-pointer items-center gap-2 ${present[L.id]!.any ? "" : "opacity-45"}`}>
                    <input type="checkbox" className="accent-slate-800" checked={!!on[L.id]} onChange={(e) => setOverride({ ...override, [L.id]: e.target.checked })} />
                    <span className="h-3 w-3 rounded-sm border border-slate-300" style={{ background: Object.values(L.kinds)[0] }} />
                    <span>{L.label}{present[L.id]!.any ? "" : " · none here"}</span>
                  </label>
                ))}
                <p className="pt-1 text-xs text-slate-500">Slope ≥25% (lidar) is in 2D Analysis.</p>
              </div>
            )}
          </div>

          {/* Camera controls, above the credit line */}
          <div className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border border-white/40 bg-white/85 p-1 text-sm shadow-xl backdrop-blur-md"
               style={{ bottom: insets.bottom + creditsH + 42, left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)` }}>
            <Btn title="Rotate left 45°" onClick={() => spin(-45)}>⟲</Btn>
            <Btn title={orbit ? "Stop orbit" : "Slow orbit"} active={orbit} onClick={() => setOrbit(!orbit)}>{orbit ? "❚❚" : "▶"}<span className="hidden xl:inline"> Orbit</span></Btn>
            <Btn title="Rotate right 45°" onClick={() => spin(45)}>⟳</Btn>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <Btn title="Tilt toward top-down" onClick={() => tilt(-15)}>▲</Btn>
            <Btn title="Tilt toward horizon" onClick={() => tilt(15)}>▼</Btn>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <Btn title="North up" onClick={northUp}>
              <span className="inline-block" style={{ transform: `rotate(${-heading}deg)` }} aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 L11 9 L8 7.5 L5 9 Z" fill="#dc2626" /><path d="M8 15 L5 9 L8 10.5 L11 9 Z" fill="#475569" /></svg>
              </span>
            </Btn>
            <Btn title="Reset view" onClick={reset}>Reset</Btn>
            <Btn title="Capture view as PNG" onClick={capture}>{capturing ? "…" : "📷"}</Btn>
          </div>

          </>}
          {/* Our own data attribution: its own line above Google's credit line, never overlapping it */}
          <p className="pointer-events-none absolute right-2 z-10 max-w-[calc(100%-16px)] rounded-md bg-slate-900/60 px-2 py-0.5 text-right text-[11px] text-slate-100"
             style={{ bottom: insets.bottom + creditsH + 14 }}>
            Overlays: EaseScore.AI<span className="hidden lg:inline"> · Allegheny County, City of Pittsburgh, FEMA, USGS lidar</span>
          </p>
        </>
      )}
    </div>
  );
}

function showAll(ents: CesiumNS.Entity[], v: boolean) {
  for (const e of ents) e.show = v;
}

function rotateAround(C: typeof CesiumNS, cam: CesiumNS.Camera, pv: CesiumNS.Cartesian3, rad: number) {
  cam.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(pv));
  cam.rotate(C.Cartesian3.UNIT_Z, rad);
  cam.lookAtTransform(C.Matrix4.IDENTITY);
}

function Btn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`h-9 min-w-9 rounded-full px-3 font-medium ${active ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-200/70"}`}>{children}</button>
  );
}
