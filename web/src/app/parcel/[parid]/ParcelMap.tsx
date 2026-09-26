"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
type MLMap = maplibregl.Map;

// The bundler can't serve MapLibre's module worker, so it's copied to public/ and loaded from there.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
import "maplibre-gl/dist/maplibre-gl.css";

type FC = { type: "FeatureCollection"; bbox: [number, number, number, number]; center: [number, number]; features: unknown[] };

// USGS 3DEP (lidar-derived) rendered on the fly by the National Map ImageServer.
const DEP = (rule: string) =>
  `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: rule }))}`;

const BASEMAPS = {
  streets: { label: "Streets", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors" },
  topo: { label: "USGS Topo", tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"], attribution: "USGS The National Map" },
  aerial: { label: "Aerial", tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"], attribution: "USGS The National Map" },
} as const;

const TERRAIN = {
  hillshade: { label: "Lidar hillshade", rule: "Hillshade Multidirectional", opacity: 0.55 },
  slope: { label: "Slope shading", rule: "Slope Map", opacity: 0.55 },
  contours: { label: "5 ft contours", rule: "Preset 5ft Contour Interval", opacity: 0.9 },
} as const;

// Our data layers: kind → style + legend label.
const DATA: { kind: string; label: string; color: string; type: "fill" | "line"; on: boolean }[] = [
  { kind: "floodway", label: "FEMA floodway", color: "#1d4ed8", type: "fill", on: true },
  { kind: "flood_100", label: "100-yr flood (A/AE)", color: "#3b82f6", type: "fill", on: true },
  { kind: "flood_500", label: "500-yr flood", color: "#93c5fd", type: "fill", on: false },
  { kind: "landslide_prone_pgh", label: "Landslide-prone (City)", color: "#dc2626", type: "fill", on: true },
  { kind: "undermined_pgh", label: "Undermined (City)", color: "#7c3aed", type: "fill", on: true },
  { kind: "mined_out_dep", label: "Mined-out area (PA DEP)", color: "#a855f7", type: "fill", on: true },
  { kind: "landslide_recorded", label: "Slope-movement area (1982)", color: "#f97316", type: "fill", on: false },
  { kind: "historic_district_pgh", label: "Historic district", color: "#b45309", type: "fill", on: true },
  { kind: "wetland_nwi", label: "Wetlands", color: "#0d9488", type: "fill", on: false },
  { kind: "greenway_pgh", label: "Greenway", color: "#16a34a", type: "fill", on: false },
  { kind: "combined_sewer", label: "Combined-sewer area", color: "#64748b", type: "fill", on: false },
  { kind: "zoning", label: "Zoning districts", color: "#111827", type: "line", on: true },
  { kind: "building", label: "Buildings", color: "#52525b", type: "fill", on: true },
  { kind: "neighbor", label: "Neighboring lots", color: "#a1a1aa", type: "line", on: true },
  { kind: "stream", label: "Streams", color: "#0284c7", type: "line", on: true },
];

export default function ParcelMap({ data }: { data: FC }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [base, setBase] = useState<keyof typeof BASEMAPS>("streets");
  const [terrain, setTerrain] = useState<Record<string, boolean>>({ hillshade: true, slope: false, contours: false });
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(DATA.map((d) => [d.kind, d.on])));
  const present = new Set((data.features as { properties: { kind: string } }[]).map((f) => f.properties.kind));

  useEffect(() => {
    if (!el.current || map.current) return;
    const sources: Record<string, maplibregl.SourceSpecification> = {};
    for (const [k, b] of Object.entries(BASEMAPS)) sources[`base-${k}`] = { type: "raster", tiles: [...b.tiles], tileSize: 256, attribution: b.attribution, maxzoom: 19 };
    for (const [k, t] of Object.entries(TERRAIN)) sources[`dep-${k}`] = { type: "raster", tiles: [DEP(t.rule)], tileSize: 256, attribution: "USGS 3DEP lidar", minzoom: 12 };
    sources.data = { type: "geojson", data: data as unknown as GeoJSON.FeatureCollection };

    const layers: maplibregl.LayerSpecification[] = [
      ...Object.keys(BASEMAPS).map((k) => ({ id: `base-${k}`, type: "raster" as const, source: `base-${k}`, layout: { visibility: (k === "streets" ? "visible" : "none") as "visible" | "none" } })),
      ...Object.entries(TERRAIN).map(([k, t]) => ({ id: `dep-${k}`, type: "raster" as const, source: `dep-${k}`, paint: { "raster-opacity": t.opacity }, layout: { visibility: (k === "hillshade" ? "visible" : "none") as "visible" | "none" } })),
    ];
    for (const d of DATA) {
      const filter: maplibregl.FilterSpecification = ["==", ["get", "kind"], d.kind];
      const layout = { visibility: (d.on ? "visible" : "none") as "visible" | "none" };
      if (d.type === "fill") {
        layers.push({ id: `${d.kind}-fill`, type: "fill", source: "data", filter, layout, paint: { "fill-color": d.color, "fill-opacity": d.kind === "building" ? 0.45 : 0.28 } });
        layers.push({ id: `${d.kind}-line`, type: "line", source: "data", filter, layout, paint: { "line-color": d.color, "line-width": 1 } });
      } else {
        layers.push({ id: `${d.kind}-line`, type: "line", source: "data", filter, layout, paint: { "line-color": d.color, "line-width": d.kind === "zoning" ? 2 : 1, ...(d.kind === "zoning" ? { "line-dasharray": [3, 2] } : {}) } });
      }
    }
    layers.push({ id: "zoning-label", type: "symbol", source: "data", filter: ["==", ["get", "kind"], "zoning"], layout: { "text-field": ["get", "label"], "text-size": 12 }, paint: { "text-color": "#111827", "text-halo-color": "#fff", "text-halo-width": 1.5 } });
    layers.push({ id: "parcel-fill", type: "fill", source: "data", filter: ["==", ["get", "kind"], "parcel"], paint: { "fill-color": "#facc15", "fill-opacity": 0.25 } });
    layers.push({ id: "parcel-line", type: "line", source: "data", filter: ["==", ["get", "kind"], "parcel"], paint: { "line-color": "#ca8a04", "line-width": 3 } });

    const m = new maplibregl.Map({ container: el.current, style: { version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf", sources, layers }, bounds: data.bbox, fitBoundsOptions: { padding: 20 } });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [data]);

  const vis = (id: string, show: boolean) => map.current?.getLayer(id) && map.current.setLayoutProperty(id, "visibility", show ? "visible" : "none");
  useEffect(() => { for (const k of Object.keys(BASEMAPS)) vis(`base-${k}`, k === base); }, [base]);
  useEffect(() => { for (const k of Object.keys(TERRAIN)) vis(`dep-${k}`, !!terrain[k]); }, [terrain]);
  useEffect(() => { for (const d of DATA) { vis(`${d.kind}-fill`, on[d.kind]); vis(`${d.kind}-line`, on[d.kind]); } vis("zoning-label", on.zoning); }, [on]);

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_15rem]">
      <div ref={el} className="h-[28rem] w-full rounded border border-zinc-300" aria-label="Parcel map" />
      <div className="space-y-3 text-sm">
        <fieldset>
          <legend className="font-semibold">Base map</legend>
          {Object.entries(BASEMAPS).map(([k, b]) => (
            <label key={k} className="mr-3 inline-flex items-center gap-1">
              <input type="radio" name="base" checked={base === k} onChange={() => setBase(k as keyof typeof BASEMAPS)} />{b.label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="font-semibold">Terrain (USGS lidar)</legend>
          {Object.entries(TERRAIN).map(([k, t]) => (
            <label key={k} className="block"><input type="checkbox" checked={!!terrain[k]} onChange={(e) => setTerrain({ ...terrain, [k]: e.target.checked })} /> {t.label}</label>
          ))}
          <p className="text-xs text-zinc-500">Terrain appears when zoomed in to neighborhood level.</p>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">Layers</legend>
          <label className="block"><span className="mr-1 inline-block h-3 w-3 border-2 border-yellow-600 bg-yellow-200 align-middle" /> This parcel</label>
          {DATA.map((d) => (
            <label key={d.kind} className={`block ${present.has(d.kind) ? "" : "text-zinc-400"}`}>
              <input type="checkbox" checked={on[d.kind]} onChange={(e) => setOn({ ...on, [d.kind]: e.target.checked })} />{" "}
              <span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: d.color, opacity: d.type === "fill" ? 0.6 : 1 }} />
              {d.label}{present.has(d.kind) ? "" : " (none nearby)"}
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
