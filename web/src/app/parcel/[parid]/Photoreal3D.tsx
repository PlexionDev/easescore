"use client";

// Photoreal 3D parcel view: Google Photorealistic 3D Tiles in CesiumJS with our own overlays draped on
// the mesh. Loaded only through next/dynamic (ssr: false); Cesium itself is a further dynamic import.
// All overlay geometry comes from our data (parcel_map RPC, QuickFit) and our lidar DEM, never from
// Google's mesh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as CesiumNS from "cesium";
import { acquire, groundHeights, prefersReducedMotion, release, sunTime, tileErrorOf, type Shared, type TileError } from "@/lib/photoreal";

type Ring = [number, number][];
type Geom = { type: string; coordinates: unknown };
type Feature = { properties: { kind: string; label?: string | null }; geometry: Geom };
export type MapFC = { type: "FeatureCollection"; bbox: number[]; center: [number, number]; features: Feature[] };
export type Massing = { rings: Ring[]; heightFt: number } | null;
export type Envelope = { rings: Ring[]; heightFt: number } | null;
export type Insets = { left: number; bottom: number };

const HEADING_DEG = 20; // a slightly rotated arrival reads better than dead north-up
const PITCH_DEG = -45;
const DESATURATE = 0.35; // share of luminance mixed into the surroundings; 0 turns it off
const SHADES = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"];

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

type Status = { phase: "engine" | "tiles" | "ready" } | { phase: "error"; error: TileError };

export default function Photoreal3D({ parcelKey, data, massing, envelope, insets, onFallback }: {
  parcelKey: string; data: MapFC; massing: Massing; envelope: Envelope; insets: Insets; onFallback: () => void;
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
  const [mode, setMode] = useState<"existing" | "buildable">("existing");
  const [orbit, setOrbit] = useState(false);
  const [heading, setHeading] = useState(0);
  const [ground, setGround] = useState<{ parcel: number[]; base: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [capturing, setCapturing] = useState(false);
  const me = useMemo(() => Symbol("parcel3d"), []);

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
  useEffect(() => { orbitRef.current = orbit; }, [orbit]);
  useEffect(() => { insetsRef.current = insets; }, [insets]);

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
      setGround({ parcel, base: Math.min(...parcel) });
    });
    return () => { dead = true; };
  }, [parcelRings]);

  // Mount the shared viewer, configure it for the parcel view, drape the parcel and overlays.
  useEffect(() => {
    if (!ground || !host.current) return;
    let dead = false;
    const cleanups: (() => void)[] = [];
    (async () => {
      let s: Shared;
      try { s = await acquire(host.current!, me); } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      if (dead) { release(s, me); return; }
      sh.current = s;
      const { C, viewer } = s;
      const scene = viewer.scene;
      setStatus({ phase: "tiles" });

      // Look: real sun, soft shadows, sky.
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = sunTime(C);
      viewer.shadows = true;
      viewer.shadowMap.softShadows = true;
      viewer.shadowMap.size = 2048;
      viewer.shadowMap.maximumDistance = 1500;
      viewer.resolutionScale = 1; // = full devicePixelRatio (browser-recommended resolution is off)
      scene.globe.show = false;
      scene.screenSpaceCameraController.enableInputs = true;
      scene.screenSpaceCameraController.enableCollisionDetection = true;

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
      const line = (r: Ring) => C.Cartesian3.fromDegreesArray([...r, r[0]!].flat());

      // Hazards and zoning, draped (classification) with crisp outlines.
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
            if (!zoning) ents.push(src.entities.add({ polygon: { hierarchy: hier(poly), material: col(color, 0.05), classificationType: CT } }));
            ents.push(src.entities.add({ polyline: { positions: line(open(poly[0])), width: zoning ? 2.5 : 2, material: col(zoning ? "#0f172a" : color, 0.95), clampToGround: true, classificationType: CT } }));
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
      const lh = await groundHeights(labelPts.map((p) => p.at));
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

      // The parcel: light fill, soft glow, crisp bright edge.
      for (const r of parcelRings) {
        src.entities.add({ polygon: { hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(r.flat())), material: col("#facc15", 0.07), classificationType: CT } });
        src.entities.add({ polyline: { positions: line(r), width: 12, material: col("#facc15", 0.22), clampToGround: true, classificationType: CT } });
        src.entities.add({ polyline: { positions: line(r), width: 3, material: col("#fde047", 1), clampToGround: true, classificationType: CT } });
      }

      // Camera: frame the parcel at ~45 degrees, clear of the floating panel.
      const pts = parcelRings.flat().map((p, i) => C.Cartesian3.fromDegrees(p[0], p[1], ground.parcel[i] ?? ground.base));
      const sphere = C.BoundingSphere.fromPoints(pts);
      pivot.current = sphere.center;
      const view = (rangeMul: number) => {
        const canvas = viewer.canvas;
        const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
        const ins = insetsRef.current;
        const fov = (viewer.camera.frustum as CesiumNS.PerspectiveFrustum).fov ?? C.Math.toRadians(60);
        const t = Math.tan(fov / 2);
        const halfW = W >= H ? 1 : W / H, halfH = W >= H ? H / W : 1; // per unit range, in units of tan(fov/2)
        const visW = Math.max(W - ins.left, W * 0.4), visH = Math.max(H - ins.bottom, H * 0.35);
        const fit = Math.max(sphere.radius, 12) * 2.4 / t / Math.min((halfW * visW) / W, (halfH * visH) / H);
        const R = Math.max(70, fit) * rangeMul;
        const h = C.Math.toRadians(HEADING_DEG), p = C.Math.toRadians(PITCH_DEG);
        const dir = new C.Cartesian3(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p));
        const right = new C.Cartesian3(Math.cos(h), -Math.sin(h), 0);
        const up = C.Cartesian3.cross(right, dir, new C.Cartesian3());
        const sx = R * t * halfW * (ins.left / W), sy = R * t * halfH * (ins.bottom / H);
        const local = C.Cartesian3.multiplyByScalar(dir, -R, new C.Cartesian3());
        C.Cartesian3.subtract(local, C.Cartesian3.multiplyByScalar(right, sx, new C.Cartesian3()), local);
        C.Cartesian3.subtract(local, C.Cartesian3.multiplyByScalar(up, sy, new C.Cartesian3()), local);
        const enu = C.Transforms.eastNorthUpToFixedFrame(sphere.center);
        return { destination: C.Matrix4.multiplyByPoint(enu, local, new C.Cartesian3()), orientation: { heading: h, pitch: p, roll: 0 } };
      };
      home.current = view(1);
      const remembered = lastView.get(parcelKey);
      const reduced = prefersReducedMotion();
      if (remembered) viewer.camera.setView({ destination: remembered.position, orientation: remembered });
      else viewer.camera.setView(reduced ? home.current : view(4));
      let arrived = !!remembered || reduced; // don't remember a half-finished fly-in
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
      const stop = () => setOrbit(false);
      for (const ev of ["pointerdown", "wheel", "touchstart"] as const) {
        viewer.canvas.addEventListener(ev, stop, { passive: true });
        cleanups.push(() => viewer.canvas.removeEventListener(ev, stop));
      }

      // Tiles: wait for the first full load, then reveal and fly in.
      let ts: CesiumNS.Cesium3DTileset;
      try { ts = await s.tileset; } catch (e) { if (!dead) setStatus({ phase: "error", error: tileErrorOf(e) }); return; }
      if (dead) return;
      tiles.current = ts;
      ts.maximumScreenSpaceError = 8;
      ts.shadows = C.ShadowMode.ENABLED;
      // Subtle desaturation away from the parcel so the lot pops.
      ts.customShader = new C.CustomShader({
        uniforms: {
          u_center: { type: C.UniformType.VEC3, value: sphere.center },
          u_radius: { type: C.UniformType.FLOAT, value: Math.max(sphere.radius * 1.4, 25) },
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

      const onProgress = (p: number, q: number) => setPending(p + q);
      cleanups.push(ts.loadProgress.addEventListener(onProgress));
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, 12000);
        const un = ts.allTilesLoaded.addEventListener(done);
        function done() { clearTimeout(t); un(); resolve(); }
        cleanups.push(done);
      });
      if (dead) return;
      if (s.failedTiles > 20 && !ts.tilesLoaded) { setStatus({ phase: "error", error: { kind: "network" } }); return; }
      setStatus({ phase: "ready" });
      setReady(true);
      if (!remembered && !reduced) {
        viewer.camera.flyTo({ ...home.current, duration: 4, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => { arrived = true; }, cancel: () => { arrived = true; } });
      }
    })();
    return () => {
      dead = true;
      setReady(false);
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
      const massRings = massing?.rings.filter((r) => r.length >= 3) ?? [];
      const hs = await groundHeights([...envRings.flat(), ...massRings.flat()]);
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
      // QuickFit massing: solid blocks that cast shadows.
      massRings.forEach((r, j) => {
        const hts = take(r.length);
        const base = Math.min(...hts);
        src.entities.add({ polygon: {
          hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(open(r).flat())), height: base,
          extrudedHeight: base + (massing?.heightFt ?? 30) * 0.3048 + (Math.max(...hts) - base),
          material: col(SHADES[j % SHADES.length]!, 1), show: shown, shadows: C.ShadowMode.ENABLED,
        } });
      });
    })();
    return () => { dead = true; };
  }, [ready, ground, envelope, massing, parcelRings]);

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
    <div className="absolute inset-0 bg-slate-900">
      <div ref={host} className="absolute inset-0" aria-label="Photoreal 3D view of the parcel" role="img" />

      {/* Loading skeleton: never a blank box */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${loading ? "opacity-100" : "opacity-0"}`}
           style={{ background: "radial-gradient(900px 500px at 60% 40%, #1e3a5f, #0f172a)" }} aria-hidden={!loading}>
        <div className="absolute inset-0 animate-pulse opacity-30" style={{ backgroundImage: "repeating-linear-gradient(115deg, transparent 0 38px, rgba(148,163,184,0.18) 38px 39px)" }} />
        <div className="absolute left-1/2 top-1/2 w-72 -translate-y-1/2 text-center text-slate-200 md:left-[calc(50%+220px)]" style={{ transform: "translate(-50%, -50%)" }}>
          <p className="text-sm font-semibold">{status.phase === "engine" ? "Starting the 3D engine…" : "Streaming photoreal 3D tiles…"}</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-[es-bar_1.4s_ease-in-out_infinite] rounded-full bg-sky-400" /></div>
          {status.phase === "tiles" && pending > 0 && <p className="mt-2 text-xs text-slate-400">{pending} tiles in flight</p>}
        </div>
        <style>{`@keyframes es-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      </div>

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
          <div className="absolute right-4 top-16 z-10 w-64 rounded-2xl border border-white/40 bg-white/85 p-3 text-sm shadow-xl backdrop-blur-md xl:top-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1 text-xs font-semibold" role="radiogroup" aria-label="Show">
              {(["existing", "buildable"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={`rounded-lg px-2 py-1.5 ${mode === m ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-900"}`}>
                  {m === "existing" ? "Existing" : "What can be built"}
                </button>
              ))}
            </div>
            {mode === "buildable" && (
              <p className="mt-2 text-xs text-slate-600">
                {massing?.rings.length ? "Green: buildable envelope · blocks: the selected QuickFit layout." : envelope?.rings.length ? "Green: buildable envelope. No layout fits by right; try the setback “what if” fields." : "QuickFit hasn't produced an envelope for this lot."}
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
          <div className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/40 bg-white/85 p-1 text-sm shadow-xl backdrop-blur-md"
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
