"use client";

// Generic 2D analysis map for the seat pages: self-hosted Protomaps basemap (pmtiles) + our parcel
// outlines, with a context so child components add their own layers. Same tile setup as the parcel
// page's MapStage and the planner map, factored out without touching either.
//
// Import directly (not from the seats barrel) so pages that don't show a map don't pull in MapLibre:
//   import MapPanel, { GeoJSONLayer, useMapPanel } from "@/components/seats/MapPanel";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers as pmLayers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import "./seats.css";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
let protocolAdded = false;

/** City of Pittsburgh. */
export const PGH_BOUNDS: [number, number, number, number] = [-80.1, 40.36, -79.86, 40.51];
/** Allegheny County. */
export const COUNTY_BOUNDS: [number, number, number, number] = [-80.37, 40.19, -79.68, 40.68];

type Ctx = { map: maplibregl.Map | null; ready: boolean };
const MapCtx = createContext<Ctx>({ map: null, ready: false });

/** The map instance and whether its style has loaded. For custom layer components. */
export function useMapPanel(): Ctx {
  return useContext(MapCtx);
}

/** True unless the user asked for reduced motion. Use for fly/ease durations. */
export function motionOK(): boolean {
  return typeof window === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type Basemap = "analysis" | "light" | "grayscale" | "white" | "dark";

/**
 * "analysis" (default): Protomaps light, desaturated so colored parcels carry the meaning. Parks and woods
 * are a faint green-grey, water a muted blue, land near-white.
 */
function flavorFor(b: Basemap): Flavor {
  if (b !== "analysis") return namedFlavor(b);
  const base = namedFlavor("light");
  const green = "#e0e9e3";
  return {
    ...base,
    background: "#e9eeec", earth: "#f1f3f2", water: "#c4d9e1", buildings: "#dde2df",
    park_a: green, park_b: green, wood_a: green, wood_b: green, scrub_a: green, scrub_b: green, zoo: green,
    school: "#ebeceb", hospital: "#ebe7e6", industrial: "#e6eaeb", pedestrian: "#eceeec", sand: "#ecebe6", beach: "#ecebe6",
  };
}

export default function MapPanel({
  ariaLabel, bounds = PGH_BOUNDS, basemap = "analysis", parcelLines = true,
  onReady, tools, legend, children, className, minHeight = 320,
}: {
  /** Describes what the map shows, for screen readers ("Map of matching parcels colored by score band"). */
  ariaLabel: string;
  /** Initial view [west, south, east, north]. */
  bounds?: [number, number, number, number];
  basemap?: Basemap;
  /** Our parcel outlines (easescore.pmtiles, layer "parcels") from zoom 15. */
  parcelLines?: boolean;
  /** Called once when the style has loaded. */
  onReady?: (map: maplibregl.Map) => void;
  /** Top-right toolbar slot, e.g. a <Segmented tone="dark"> and a "3D" button. */
  tools?: ReactNode;
  /** Bottom-left legend slot. */
  legend?: ReactNode;
  /** Layer components (<GeoJSONLayer>) and absolutely positioned overlays (hover card). */
  children?: ReactNode;
  className?: string;
  minHeight?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Ctx>({ map: null, ready: false });
  const [failed, setFailed] = useState(false);
  const readyCb = useRef(onReady);
  useEffect(() => { readyCb.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!el.current) return;
    const origin = window.location.origin;
    if (!protocolAdded) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocolAdded = true;
    }
    const sprite = basemap === "dark" ? "dark" : "light";
    const style: maplibregl.StyleSpecification = {
      version: 8,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${sprite}`,
      sources: {
        protomaps: { type: "vector", url: `pmtiles://${origin}/tiles/basemap.pmtiles`, attribution: "© OpenStreetMap contributors · Protomaps" },
        easescore: { type: "vector", url: `pmtiles://${origin}/tiles/easescore.pmtiles`, promoteId: { parcels: "parid" } },
      },
      layers: [
        ...(pmLayers("protomaps", flavorFor(basemap), { lang: "en" }) as maplibregl.LayerSpecification[]),
        ...(parcelLines ? [{
          id: "es-parcel-lines", type: "line", source: "easescore", "source-layer": "parcels", minzoom: 15,
          paint: { "line-color": basemap === "dark" ? "rgba(148,163,184,0.35)" : "rgba(17,27,26,0.22)", "line-width": 0.6 },
        } as maplibregl.LayerSpecification] : []),
      ],
    };
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style, bounds, fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true } });
    } catch {
      // WebGL unavailable: report it once (an external-system result, not derived state).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");
    m.on("load", () => {
      setState({ map: m, ready: true });
      readyCb.current?.(m);
    });
    m.on("error", (e) => { if (process.env.NODE_ENV === "development") console.warn("[MapPanel]", e.error?.message); });
    return () => { setState({ map: null, ready: false }); m.remove(); };
    // The basemap and bounds are initial settings; changing them later does not rebuild the map.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MapCtx.Provider value={state}>
      <div className={`es-seat es-map${className ? ` ${className}` : ""}`} style={{ minHeight }}>
        {failed ? (
          <div className="es-map-fail" role="status">
            <p>The map could not start in this browser (WebGL is off or unavailable). The table and summary still work.</p>
          </div>
        ) : (
          <div ref={el} className="es-map-canvas" role="region" aria-label={ariaLabel} />
        )}
        {tools ? <div className="es-map-tools">{tools}</div> : null}
        {legend ? <div className="es-map-legend">{legend}</div> : null}
        {!state.ready && !failed ? <div className="es-map-loading" aria-hidden="true">Loading map…</div> : null}
        {children}
      </div>
    </MapCtx.Provider>
  );
}

/**
 * A GeoJSON source plus its layers, kept in sync with `data`. Layers are given without `source`.
 * Removed on unmount.
 */
export function GeoJSONLayer({ id, data, layers, promoteId, beforeId }: {
  id: string;
  data: GeoJSON.FeatureCollection | GeoJSON.Feature | string;
  layers: Omit<maplibregl.LayerSpecification, "source">[];
  promoteId?: string;
  /** Insert beneath this existing layer id (e.g. a label layer). */
  beforeId?: string;
}) {
  const { map, ready } = useMapPanel();
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  useEffect(() => {
    if (!map || !ready) return;
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data, ...(promoteId ? { promoteId } : {}) });
    const ids: string[] = [];
    for (const l of layersRef.current) {
      const spec = { ...l, source: id } as maplibregl.LayerSpecification;
      if (!map.getLayer(spec.id)) map.addLayer(spec, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
      ids.push(spec.id);
    }
    return () => {
      if (!map.getStyle()) return;
      for (const lid of ids) if (map.getLayer(lid)) map.removeLayer(lid);
      if (map.getSource(id)) map.removeSource(id);
    };
    // Source and layer ids are fixed for the component's life; data updates go through setData below.
  }, [map, ready, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map || !ready) return;
    (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
  }, [map, ready, id, data]);

  return null;
}

/** Legend row: colored swatches with labels. */
export function MapLegend({ items, title }: { items: { color: string; label: string }[]; title?: string }) {
  return (
    <div className="es-legend" role="group" aria-label={title ?? "Legend"}>
      {title ? <span className="es-legend-title">{title}</span> : null}
      {items.map((i) => (
        <span key={i.label} className="es-legend-item"><i style={{ background: i.color }} aria-hidden="true" />{i.label}</span>
      ))}
    </div>
  );
}
