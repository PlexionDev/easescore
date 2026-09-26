"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers as pmLayers, namedFlavor } from "@protomaps/basemaps";
import mlcontour from "maplibre-contour";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
let protocolAdded = false;

type FC = { type: "FeatureCollection"; bbox: [number, number, number, number]; center: [number, number]; features: any[] };

const PEMA = "https://imagery.pasda.psu.edu/arcgis/rest/services/pasda/PEMAImagery2021_2023/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&layers=show:0&f=image";

// Hazard/zoning styles (vector). Colors tuned for both basemap and aerial.
const OVERLAYS: { kind: string; label: string; color: string; on: boolean }[] = [
  { kind: "floodway", label: "FEMA floodway", color: "#2563eb", on: true },
  { kind: "flood_100", label: "100-yr floodplain", color: "#60a5fa", on: true },
  { kind: "landslide_prone_pgh", label: "Landslide-prone (City)", color: "#ef4444", on: true },
  { kind: "undermined_pgh", label: "Undermined (City)", color: "#a855f7", on: true },
  { kind: "mined_out_dep", label: "Mined-out (PA DEP)", color: "#c084fc", on: false },
  { kind: "landslide_recorded", label: "Slope-movement (1982)", color: "#f97316", on: false },
  { kind: "historic_district_pgh", label: "Historic district", color: "#d97706", on: true },
  { kind: "wetland_nwi", label: "Wetlands", color: "#14b8a6", on: false },
];

export type Footprints = { rings: [number, number][][]; heightFt: number } | null;

export default function MapStage({ data, footprints, onReady }: { data: FC; footprints?: Footprints; onReady?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [aerial, setAerial] = useState(false);
  const [terrain3d, setTerrain3d] = useState(true);
  const [contours, setContours] = useState(true);
  const [slope, setSlope] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(OVERLAYS.map((o) => [o.kind, o.on])));
  const [zoning, setZoning] = useState(true);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const home = useRef<maplibregl.CameraOptions | null>(null);
  const present = new Set(data.features.map((f) => f.properties.kind));

  useEffect(() => {
    if (!el.current || map.current) return;
    const origin = window.location.origin;
    if (!protocolAdded) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocolAdded = true;
    }
    const dem = new mlcontour.DemSource({ url: `${origin}/tiles/terrain/{z}/{x}/{y}.webp`, encoding: "mapbox", maxzoom: 16, worker: true, cacheSize: 200 });
    dem.setupMaplibre(maplibregl as any);

    const parcel = data.features.find((f) => f.properties.kind === "parcel");
    const flavor = namedFlavor("light");
    const style: maplibregl.StyleSpecification = {
      version: 8,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
      sources: {
        protomaps: { type: "vector", url: `pmtiles://${origin}/tiles/basemap.pmtiles`, attribution: "© OpenStreetMap contributors · Protomaps" },
        aerial: { type: "raster", tiles: [PEMA], tileSize: 512, attribution: "PEMA imagery 2021–2023 (PASDA)", maxzoom: 20 },
        // Mesh at z15 (1.8 m/px at 512 px); hillshade reads a separate source at full 1 m (z16) for crisp relief.
        dem: { type: "raster-dem", tiles: [`${origin}/tiles/terrain/{z}/{x}/{y}.webp`], tileSize: 512, encoding: "mapbox", minzoom: 8, maxzoom: 15, bounds: [-80.37, 40.19, -79.68, 40.68], attribution: "USGS 3DEP 1 m lidar" },
        shade: { type: "raster-dem", tiles: [`${origin}/tiles/terrain/{z}/{x}/{y}.webp`], tileSize: 512, encoding: "mapbox", minzoom: 8, maxzoom: 16, bounds: [-80.37, 40.19, -79.68, 40.68] },
        contours: { type: "vector", tiles: [dem.contourProtocolUrl({ multiplier: 3.28084, thresholds: { 13: [20, 100], 14: [10, 50], 15: [5, 25], 16: [5, 25] }, elevationKey: "ele", levelKey: "level", contourLayer: "contours" })], maxzoom: 16 },
        slope: { type: "vector", url: `pmtiles://${origin}/tiles/slope.pmtiles` },
        site: { type: "geojson", data: markSubject(data, parcel) as any },
      },
      layers: [
        ...pmLayers("protomaps", flavor, { lang: "en" }) as maplibregl.LayerSpecification[],
        { id: "aerial", type: "raster", source: "aerial", layout: { visibility: "none" }, paint: { "raster-fade-duration": 200 } },
        { id: "hillshade", type: "hillshade", source: "shade", paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#1e293b", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#334155" } },
      ],
      sky: { "sky-color": "#bcd7f5", "horizon-color": "#eaf2fb", "fog-color": "#f1f5f9", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.9 },
    };

    const m = new maplibregl.Map({
      container: el.current, style, pixelRatio: window.devicePixelRatio, maxPitch: 80,
      bounds: parcel ? bboxOf(parcel.geometry) : data.bbox, fitBoundsOptions: { padding: { top: 80, bottom: 80, left: 480, right: 80 }, maxZoom: 19 },
      attributionControl: { compact: true },
    });
    map.current = m;
    if (process.env.NODE_ENV === "development") (window as any).__map = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

    m.on("load", () => {
      m.setTerrain({ source: "dem", exaggeration: 1.2 });
      // Slope classes (vector polygons), if generated
      m.addLayer({ id: "slope", type: "fill", source: "slope", "source-layer": "slope", layout: { visibility: "none" },
        paint: { "fill-color": ["match", ["get", "class"], 1, "#dcfce7", 2, "#fef08a", 3, "#fdba74", 4, "#ef4444", "#e5e7eb"], "fill-opacity": 0.45 } });
      // Hazards
      for (const o of OVERLAYS) {
        const f: maplibregl.FilterSpecification = ["==", ["get", "kind"], o.kind];
        m.addLayer({ id: `${o.kind}-fill`, type: "fill", source: "site", filter: f, layout: { visibility: o.on ? "visible" : "none" }, paint: { "fill-color": o.color, "fill-opacity": 0.04 } });
        m.addLayer({ id: `${o.kind}-line`, type: "line", source: "site", filter: f, layout: { visibility: o.on ? "visible" : "none" }, paint: { "line-color": o.color, "line-width": 2, "line-opacity": 0.85, "line-dasharray": [4, 2] } });
      }
      // Contours
      m.addLayer({ id: "contour-lines", type: "line", source: "contours", "source-layer": "contours",
        paint: { "line-color": "rgba(71,85,105,0.55)", "line-width": ["match", ["get", "level"], 1, 1.3, 0.6] } });
      m.addLayer({ id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours", filter: [">", ["get", "level"], 0],
        layout: { "symbol-placement": "line", "text-size": 11, "text-field": ["concat", ["number-format", ["get", "ele"], {}], " ft"], "text-font": ["Noto Sans Medium"] },
        paint: { "text-color": "#334155", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.4 } });
      // Zoning outlines + labels
      m.addLayer({ id: "zoning-line", type: "line", source: "site", filter: ["==", ["get", "kind"], "zoning"], paint: { "line-color": "#0f172a", "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": 0.8 } });
      m.addLayer({ id: "zoning-label", type: "symbol", source: "site", filter: ["==", ["get", "kind"], "zoning"],
        layout: { "text-field": ["get", "label"], "text-size": 13, "text-font": ["Noto Sans Medium"] }, paint: { "text-color": "#0f172a", "text-halo-color": "#fff", "text-halo-width": 2 } });
      // Neighboring lot lines
      m.addLayer({ id: "neighbors", type: "line", source: "site", filter: ["==", ["get", "kind"], "neighbor"], paint: { "line-color": "#64748b", "line-width": 0.8, "line-opacity": 0.7 } });
      // Buildings in 3D (height estimated; see receipt in the panel)
      // Neighbors are ghosted so the subject lot stays readable; the building on the subject lot is solid amber.
      m.addLayer({ id: "buildings-3d", type: "fill-extrusion", source: "site", filter: ["all", ["==", ["get", "kind"], "building"], ["!=", ["get", "subject"], true]],
        paint: { "fill-extrusion-color": "#e2e8f0", "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8], "fill-extrusion-opacity": 0.55, "fill-extrusion-vertical-gradient": true } });
      m.addLayer({ id: "subject-3d", type: "fill-extrusion", source: "site", filter: ["all", ["==", ["get", "kind"], "building"], ["==", ["get", "subject"], true]],
        paint: { "fill-extrusion-color": "#f59e0b", "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8], "fill-extrusion-opacity": 0.95, "fill-extrusion-vertical-gradient": true } });
      // The parcel: glowing outline + translucent lift
      m.addLayer({ id: "parcel-glow", type: "line", source: "site", filter: ["==", ["get", "kind"], "parcel"], paint: { "line-color": "#facc15", "line-width": 12, "line-blur": 8, "line-opacity": 0.7 } });
      m.addLayer({ id: "parcel-line", type: "line", source: "site", filter: ["==", ["get", "kind"], "parcel"], paint: { "line-color": "#ca8a04", "line-width": 3 } });
      // QuickFit scheme massing
      m.addSource("scheme", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "scheme-3d", type: "fill-extrusion", source: "scheme",
        paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.92 } });
      // Cinematic arrival
      if (parcel) {
        // Keep the lot clear of the floating panel (440 px + gutter) when there is room for it.
        const w = m.getContainer().clientWidth, h = m.getContainer().clientHeight;
        const left = w > 900 ? 480 : Math.round(w * 0.1), side = Math.round(w * 0.1), vert = Math.round(h * 0.2);
        m.fitBounds(bboxOf(parcel.geometry), { pitch: 58, bearing: 160, maxZoom: 19.2, duration: 2600, essential: true,
          padding: { top: vert, bottom: vert, left, right: side } });
      }
      m.once("moveend", () => {
        home.current = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
        // Auto-orbit on load; any drag, touch or wheel stops it.
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setOrbit(true);
      });
      // Any direct user drag or touch stops the auto-orbit.
      for (const ev of ["mousedown", "touchstart", "wheel"] as const) m.getCanvas().addEventListener(ev, () => setOrbit(false), { passive: true });
      setLoaded(true);
      onReady?.();
    });
    return () => { m.remove(); map.current = null; setLoaded(false); };
  }, [data]);

  // Scheme massing from QuickFit
  useEffect(() => {
    const m = map.current;
    const src = m?.getSource("scheme") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const colors = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"];
    src.setData({ type: "FeatureCollection", features: (footprints?.rings ?? []).map((r, i) => ({ type: "Feature", properties: { color: colors[i % colors.length], h: (footprints!.heightFt) * 0.3048 }, geometry: { type: "Polygon", coordinates: [[...r, r[0]!]] } })) });
  }, [footprints, loaded]);

  const vis = (id: string, show: boolean) => { if (loaded && map.current?.getLayer(id)) map.current.setLayoutProperty(id, "visibility", show ? "visible" : "none"); };
  useEffect(() => { vis("aerial", aerial); }, [aerial, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !map.current) return;
    map.current.setTerrain(terrain3d ? { source: "dem", exaggeration: 1.2 } : null);
    if (!terrain3d) map.current.easeTo({ pitch: 0, bearing: 0 });
  }, [terrain3d, loaded]);
  useEffect(() => { vis("contour-lines", contours); vis("contour-labels", contours); }, [contours, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { vis("slope", slope); }, [slope, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { vis("zoning-line", zoning); vis("zoning-label", zoning); }, [zoning, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { for (const o of OVERLAYS) { vis(`${o.kind}-fill`, on[o.kind]!); vis(`${o.kind}-line`, on[o.kind]!); } }, [on, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slow orbit around the current center (about one turn per 90 s).
  useEffect(() => {
    const m = map.current;
    if (!orbit || !m) return;
    let raf = 0, last = performance.now();
    const step = (t: number) => { m.setBearing(m.getBearing() + (t - last) * 0.004); last = t; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [orbit]);
  const turn = (deg: number) => { setOrbit(false); map.current?.easeTo({ bearing: map.current.getBearing() + deg, duration: 700 }); };
  const tilt = (deg: number) => { setOrbit(false); map.current?.easeTo({ pitch: Math.max(0, Math.min(80, map.current.getPitch() + deg)), duration: 500 }); };

  return (
    <div className="absolute inset-0">
      {/* Camera controls: spin, tilt, orbit, reset. Right-drag or Ctrl-drag also rotates; two-finger twist on touch. */}
      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/40 bg-white/85 p-1 text-sm shadow-xl backdrop-blur-md md:left-[calc(50%+230px)]">
        <CamBtn title="Rotate left 45°" onClick={() => turn(-45)}>↺ 45°</CamBtn>
        <CamBtn title={orbit ? "Stop orbit" : "Orbit"} active={orbit} onClick={() => setOrbit(!orbit)}>{orbit ? "❚❚ Orbit" : "▶ Orbit"}</CamBtn>
        <CamBtn title="Rotate right 45°" onClick={() => turn(45)}>45° ↻</CamBtn>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <CamBtn title="Tilt up" onClick={() => tilt(-15)}>▲</CamBtn>
        <CamBtn title="Tilt down" onClick={() => tilt(15)}>▼</CamBtn>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <CamBtn title="Reset view" onClick={() => { setOrbit(false); if (home.current) map.current?.easeTo({ ...home.current, duration: 1200 }); }}>Reset</CamBtn>
      </div>
      <div ref={el} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-label="3D parcel map" />
      <div className="absolute right-4 top-4 w-64 rounded-2xl border border-white/40 bg-white/80 p-3 text-sm shadow-xl backdrop-blur-md">
        <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between font-semibold text-slate-800">
          Map layers <span className="text-slate-400">{open ? "–" : "+"}</span>
        </button>
        {open && (
          <div className="mt-2 space-y-1.5 text-slate-700">
            <Toggle label="Aerial photo (2021–23)" checked={aerial} onChange={setAerial} />
            <Toggle label="3D terrain (1 m lidar)" checked={terrain3d} onChange={setTerrain3d} />
            <Toggle label="Contours (5 ft)" checked={contours} onChange={setContours} />
            <Toggle label="Slope classes" checked={slope} onChange={setSlope} />
            <Toggle label="Zoning" checked={zoning} onChange={setZoning} />
            <div className="my-1 border-t border-slate-200" />
            {OVERLAYS.map((o) => (
              <Toggle key={o.kind} label={o.label} swatch={o.color} dim={!present.has(o.kind)} checked={on[o.kind]!} onChange={(v) => setOn({ ...on, [o.kind]: v })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CamBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`h-9 min-w-9 rounded-full px-3 font-medium ${active ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-200/70"}`}>{children}</button>
  );
}

function Toggle({ label, checked, onChange, swatch, dim }: { label: string; checked: boolean; onChange: (v: boolean) => void; swatch?: string; dim?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 ${dim ? "opacity-45" : ""}`}>
      <input type="checkbox" className="accent-slate-800" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {swatch && <span className="h-3 w-3 rounded-sm" style={{ background: swatch }} />}
      <span>{label}{dim ? " · none here" : ""}</span>
    </label>
  );
}

// Tag buildings that sit mostly inside the subject parcel so the map can highlight them.
function markSubject(data: any, parcel: any) {
  if (!parcel) return data;
  const rings: number[][][] = parcel.geometry.type === "Polygon" ? [parcel.geometry.coordinates[0]] : parcel.geometry.coordinates.map((p: any) => p[0]);
  const inside = ([x, y]: number[]) => rings.some((r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  });
  // Footprints and lot lines come from different surveys, so use "most corners inside" rather than the centroid.
  const mostlyInside = (g: any) => {
    const ring: number[][] = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
    return ring.filter(inside).length >= ring.length * 0.4;
  };
  return { ...data, features: data.features.map((f: any) => f.properties.kind === "building" && mostlyInside(f.geometry)
    ? { ...f, properties: { ...f.properties, subject: true } } : f) };
}

function bboxOf(g: any): [number, number, number, number] {
  const pts: number[][] = g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2);
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
