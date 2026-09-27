"use client";

// Need / sites map: census tracts shaded by renter cost burden (or median income), the chosen
// neighborhood outlined, and candidate lots as points (selected lots ringed). Area context only.

import { useEffect, useMemo } from "react";
import type * as maplibregl from "maplibre-gl";
import MapPanel, { GeoJSONLayer, motionOK, useMapPanel } from "@/components/seats/MapPanel";
import type { Site } from "@/lib/nonprofit/types";

export type Layer = "rb30" | "rb50" | "income" | "poverty";

export const SCALE = ["#eef5f1", "#cfe6da", "#9fcdb6", "#5ea98a", "#2f7d63", "#174f3f"];
export const LAYER_STEPS: Record<Layer, { stops: number[]; labels: [string, string]; title: string; reverse?: boolean }> = {
  rb30: { stops: [20, 35, 45, 55, 65], labels: ["under 20%", "over 65%"], title: "Share of renters paying 30%+ of income" },
  rb50: { stops: [10, 20, 30, 40, 50], labels: ["under 10%", "over 50%"], title: "Share of renters paying 50%+ of income" },
  income: { stops: [25000, 40000, 55000, 75000, 100000], labels: ["under $25K", "over $100K"], title: "Median household income (darker = lower)", reverse: true },
  poverty: { stops: [10, 20, 30, 40, 50], labels: ["under 10%", "over 50%"], title: "Share of people below the poverty line" },
};

function fillExpr(layer: Layer): maplibregl.ExpressionSpecification {
  const s = LAYER_STEPS[layer];
  const colors = s.reverse ? [...SCALE].reverse() : SCALE;
  const expr: unknown[] = ["step", ["to-number", ["get", layer], -1], colors[0]];
  s.stops.forEach((v, i) => expr.push(v, colors[i + 1]));
  return ["case", ["==", ["get", layer], null], "#f1f3f2", expr] as unknown as maplibregl.ExpressionSpecification;
}

function Fit({ bbox }: { bbox: [number, number, number, number] | null }) {
  const { map, ready } = useMapPanel();
  useEffect(() => {
    if (!map || !ready || !bbox) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 48, maxZoom: 15.5, duration: motionOK() ? 700 : 0 });
  }, [map, ready, bbox]);
  return null;
}

function Clicks({ onSite }: { onSite?: (parid: string) => void }) {
  const { map, ready } = useMapPanel();
  useEffect(() => {
    if (!map || !ready || !onSite) return;
    const click = (e: maplibregl.MapLayerMouseEvent) => { const p = e.features?.[0]?.properties?.parid; if (p) onSite(String(p)); };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "np-sites-dot", click);
    map.on("mouseenter", "np-sites-dot", enter);
    map.on("mouseleave", "np-sites-dot", leave);
    return () => { map.off("click", "np-sites-dot", click); map.off("mouseenter", "np-sites-dot", enter); map.off("mouseleave", "np-sites-dot", leave); };
  }, [map, ready, onSite]);
  return null;
}

function Paint({ layer }: { layer: Layer }) {
  const { map, ready } = useMapPanel();
  useEffect(() => {
    if (!map || !ready || !map.getLayer("np-tracts-fill")) return;
    map.setPaintProperty("np-tracts-fill", "fill-color", fillExpr(layer));
  }, [map, ready, layer]);
  return null;
}

export default function AreaMap({ tracts, layer, outline, bbox, sites, selected, onSite, ariaLabel, legend, tools, minHeight = 420 }: {
  tracts: GeoJSON.FeatureCollection | null;
  layer: Layer;
  outline: GeoJSON.Geometry | null;
  bbox: [number, number, number, number] | null;
  sites?: Site[];
  selected?: string[];
  onSite?: (parid: string) => void;
  ariaLabel: string;
  legend?: React.ReactNode;
  tools?: React.ReactNode;
  minHeight?: number;
}) {
  const outlineFc = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features: outline ? [{ type: "Feature", properties: {}, geometry: outline }] : [] }), [outline]);
  const siteFc = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: (sites ?? []).filter((s) => s.lon != null && s.lat != null).map((s) => ({
      type: "Feature", properties: { parid: s.parid.trim(), on: (selected ?? []).includes(s.parid.trim()) }, geometry: { type: "Point", coordinates: [s.lon!, s.lat!] },
    })),
  }), [sites, selected]);
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  const b = bbox ?? [-80.1, 40.36, -79.86, 40.51];

  return (
    <MapPanel ariaLabel={ariaLabel} bounds={[b[0] - 0.01, b[1] - 0.006, b[2] + 0.01, b[3] + 0.006]} basemap="light" legend={legend} tools={tools} minHeight={minHeight}>
      <GeoJSONLayer id="np-tracts" data={tracts ?? empty} promoteId="geoid" layers={[
        { id: "np-tracts-fill", type: "fill", paint: { "fill-color": fillExpr(layer), "fill-opacity": 0.72 } },
        { id: "np-tracts-line", type: "line", paint: { "line-color": "#ffffff", "line-width": 0.8 } },
      ]} />
      <GeoJSONLayer id="np-outline" data={outlineFc} layers={[
        { id: "np-outline-halo", type: "line", paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.8 } },
        { id: "np-outline-line", type: "line", paint: { "line-color": "#111b1a", "line-width": 2, "line-dasharray": [2, 1.5] } },
      ]} />
      <GeoJSONLayer id="np-sites" data={sites ? siteFc : empty} layers={[
        { id: "np-sites-dot", type: "circle", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["case", ["get", "on"], 6, 3.5], 16, ["case", ["get", "on"], 11, 7]],
          "circle-color": ["case", ["get", "on"], "#156b54", "#ffffff"],
          "circle-stroke-color": ["case", ["get", "on"], "#ffffff", "#156b54"],
          "circle-stroke-width": ["case", ["get", "on"], 2.5, 1.8],
        } },
      ]} />
      <Paint layer={layer} />
      <Fit bbox={bbox} />
      <Clicks onSite={onSite} />
    </MapPanel>
  );
}
