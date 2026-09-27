"use client";

// Property image for the top of the parcel pane: a small, non-interactive 3D view of the lot drawn
// from our own data (county parcels and building footprints, USGS 3DEP lidar terrain, OpenStreetMap
// basemap). Once the view has finished drawing it is turned into a still image and the map is removed,
// so it does not hold a second WebGL context. No Google imagery is used or stored.

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as pmLayers, namedFlavor } from "@protomaps/basemaps";
import { bboxOf, markSubject } from "./MapStage";
import { tilesBase } from "@/lib/tiles";

type FC = { type: "FeatureCollection"; bbox: [number, number, number, number]; center: [number, number]; features: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

let protocolAdded = false;

export default function ParcelThumb({ stage, date }: { stage: Promise<{ mapData: FC | null }>; date: string }) {
  const el = useRef<HTMLDivElement>(null);
  // The map data streams in after the pane; until then the frame stays empty (the pane never waits for it).
  const [data, setData] = useState<FC | null>(null);
  useEffect(() => {
    let live = true;
    stage.then((x) => { if (live) setData(x.mapData ?? null); }, () => undefined);
    return () => { live = false; };
  }, [stage]);
  const [img, setImg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current || !data || img) return;
    const parcel = data.features.find((f) => f.properties?.kind === "parcel");
    if (!parcel) { setFailed(true); return; }
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    if (!protocolAdded) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocolAdded = true;
    }
    // Hosted tiles in production (NEXT_PUBLIC_TILES_BASE), this site's /tiles locally.
    const tiles = tilesBase();
    let m: maplibregl.Map | null = null;
    try {
      m = new maplibregl.Map({
        container: el.current,
        interactive: false,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        bounds: bboxOf(parcel.geometry),
        fitBoundsOptions: { padding: 36, maxZoom: 19.3 },
        pitch: 50,
        bearing: 160,
        style: {
          version: 8,
          glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
          sources: {
            protomaps: { type: "vector", url: `pmtiles://${tiles}/basemap.pmtiles` },
            dem: { type: "raster-dem", tiles: [`${tiles}/terrain/{z}/{x}/{y}.webp`], tileSize: 512, encoding: "mapbox", minzoom: 8, maxzoom: 15, bounds: [-80.37, 40.19, -79.68, 40.68] },
            shade: { type: "raster-dem", tiles: [`${tiles}/terrain/{z}/{x}/{y}.webp`], tileSize: 512, encoding: "mapbox", minzoom: 8, maxzoom: 16, bounds: [-80.37, 40.19, -79.68, 40.68] },
            site: { type: "geojson", data: markSubject(data, parcel) },
          },
          layers: [
            ...(pmLayers("protomaps", namedFlavor("light"), { lang: "en" }) as maplibregl.LayerSpecification[]).filter((l) => l.type !== "symbol"),
            { id: "hillshade", type: "hillshade", source: "shade", paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#1e293b", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#334155" } },
            { id: "neighbors", type: "line", source: "site", filter: ["==", ["get", "kind"], "neighbor"], paint: { "line-color": "#64748b", "line-width": 0.8, "line-opacity": 0.7 } },
            { id: "buildings", type: "fill-extrusion", source: "site", filter: ["all", ["==", ["get", "kind"], "building"], ["!=", ["get", "subject"], true]],
              paint: { "fill-extrusion-color": "#e2e8f0", "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8], "fill-extrusion-opacity": 0.6 } },
            { id: "subject", type: "fill-extrusion", source: "site", filter: ["all", ["==", ["get", "kind"], "building"], ["==", ["get", "subject"], true]],
              paint: { "fill-extrusion-color": "#f59e0b", "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8], "fill-extrusion-opacity": 0.95 } },
            { id: "parcel-fill", type: "fill", source: "site", filter: ["==", ["get", "kind"], "parcel"], paint: { "fill-color": "#facc15", "fill-opacity": 0.18 } },
            { id: "parcel-glow", type: "line", source: "site", filter: ["==", ["get", "kind"], "parcel"], paint: { "line-color": "#facc15", "line-width": 9, "line-blur": 6, "line-opacity": 0.7 } },
            { id: "parcel-line", type: "line", source: "site", filter: ["==", ["get", "kind"], "parcel"], paint: { "line-color": "#ca8a04", "line-width": 2.5 } },
          ],
          terrain: { source: "dem", exaggeration: 1.2 },
        },
      });
    } catch {
      setFailed(true);
      return;
    }
    const map = m;
    let done = false;
    const snap = () => {
      if (done) return;
      done = true;
      try {
        setImg(map.getCanvas().toDataURL("image/jpeg", 0.85));
      } catch {
        setFailed(true);
      }
      map.remove();
    };
    // Snapshot once every tile has drawn; until then (or if it never settles) the live, non-interactive map stays.
    map.once("load", () => map.once("idle", snap));
    map.on("error", () => undefined);
    return () => { if (!done) { done = true; map.remove(); } };
  }, [data, img]);

  return (
    <figure className="m-0">
      <div className="relative h-40 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {img
          ? <img src={img} alt="3D map view of the lot outlined in yellow, with nearby buildings and terrain" className="h-full w-full object-cover" />
          : <>
              {data && <PlanSvg data={data} />}
              {!failed && <div ref={el} className="absolute inset-0" aria-hidden />}
            </>}
      </div>
      <figcaption className="mt-1 text-[11px] text-slate-500">Map view from EaseScore.AI data (county parcels, USGS lidar), {date}</figcaption>
    </figure>
  );
}

/** Flat plan of the lot from the same data (parcel, neighbors, building footprints); shown until the 3D view has drawn. */
function PlanSvg({ data }: { data: FC }) {
  const parcel = data.features.find((f) => f.properties?.kind === "parcel");
  if (!parcel) return null;
  const [x0, y0, x1, y1] = bboxOf(parcel.geometry);
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const W = 400, H = 160;
  const spanX = Math.max((x1 - x0) * k, 1e-6), spanY = Math.max(y1 - y0, 1e-6);
  const scale = Math.min((W * 0.7) / spanX, (H * 0.7) / spanY);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const pt = ([x, y]: number[]) => `${(W / 2 + (x! - cx) * k * scale).toFixed(1)},${(H / 2 - (y! - cy) * scale).toFixed(1)}`;
  const rings = (g: { type: string; coordinates: any }): number[][][] => (g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = (g: { type: string; coordinates: unknown }) => rings(g as { type: string; coordinates: any }).map((r) => `M${r.map(pt).join("L")}`).join(" "); // eslint-disable-line @typescript-eslint/no-explicit-any
  const marked = markSubject(data, parcel) as FC;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Plan of the lot outlined in yellow, with neighboring lots and buildings">
      <rect width={W} height={H} fill="#f1f5f9" />
      {marked.features.filter((f) => f.properties?.kind === "neighbor").map((f, i) => <path key={`n${i}`} d={d(f.geometry)} fill="none" stroke="#94a3b8" strokeWidth={0.8} />)}
      <path d={`${d(parcel.geometry)} Z`} fill="#facc15" fillOpacity={0.25} stroke="#ca8a04" strokeWidth={2.5} />
      {marked.features.filter((f) => f.properties?.kind === "building").map((f, i) => <path key={`b${i}`} d={`${d(f.geometry)} Z`} fill={f.properties?.subject ? "#f59e0b" : "#cbd5e1"} stroke="#64748b" strokeWidth={0.5} />)}
    </svg>
  );
}
