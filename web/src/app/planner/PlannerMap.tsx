"use client";

// Planner map: the seat MapPanel (Protomaps basemap + parcel outlines from zoom 15) plus one point per
// matching parcel, colored by band or by top blocker, clustered at county zoom. Synced with the table:
// hovering a row rings its point (feature-state "focus"); hovering a point highlights its row.

import { useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import MapPanel, { MapLegend, PGH_BOUNDS, motionOK, useMapPanel } from "@/components/seats/MapPanel";
import { Segmented } from "@/components/seats";
import { BAND_COLOR, BANDS, NO_BAND_COLOR, parcelLabel, type PlannerPoint } from "@/lib/planner";

export type ColorBy = "band" | "blocker";
const BLOCKER_PALETTE = ["#1d4f86", "#a86514", "#7a3e9d", "#156b54", "#b42318", "#556619", "#2f7f8f", "#8a5a44"];
const SRC = "pl-sites";

function toGeoJSON(points: PlannerPoint[], blockerIdx: Map<string, number>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(([parid, lon, lat, score, band, blocker]) => ({
      type: "Feature",
      properties: { parid, score, band: band ?? "none", blk: blocker != null && blockerIdx.has(blocker) ? blockerIdx.get(blocker)! : -1 },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

function Sites({ points, colorBy, blockers, hover, selected, pinned, onHover, onSelect, fitKey }: {
  points: PlannerPoint[]; colorBy: ColorBy; blockers: string[]; hover: string | null; selected: string | null; pinned: string[];
  onHover: (p: string | null, xy?: { x: number; y: number }) => void; onSelect: (p: string) => void; fitKey: string;
}) {
  const { map, ready } = useMapPanel();
  const handlers = useRef({ onHover, onSelect });
  useEffect(() => { handlers.current = { onHover, onSelect }; }, [onHover, onSelect]);
  const blockerIdx = useMemo(() => new Map(blockers.map((b, i) => [b, i])), [blockers]);
  const data = useMemo(() => toGeoJSON(points, blockerIdx), [points, blockerIdx]);
  const prev = useRef<{ focus: string[]; pinned: string[] }>({ focus: [], pinned: [] });

  // Source + layers, once.
  useEffect(() => {
    if (!map || !ready) return;
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "parid", cluster: true, clusterMaxZoom: 12, clusterRadius: 38 });
    map.addLayer({ id: "pl-clusters", type: "circle", source: SRC, filter: ["has", "point_count"],
      paint: { "circle-color": "#156b54", "circle-opacity": 0.82, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
        "circle-radius": ["step", ["get", "point_count"], 12, 50, 16, 500, 21, 2000, 27] } });
    map.addLayer({ id: "pl-cluster-count", type: "symbol", source: SRC, filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Noto Sans Medium"] }, paint: { "text-color": "#fff" } });
    map.addLayer({ id: "pl-points", type: "circle", source: SRC, filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#156b54",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["case", ["boolean", ["feature-state", "focus"], false], 8, 3.5], 15, ["case", ["boolean", ["feature-state", "focus"], false], 11, 5.5], 18, ["case", ["boolean", ["feature-state", "focus"], false], 15, 9]],
        "circle-stroke-color": ["case", ["boolean", ["feature-state", "focus"], false], "#111b1a", ["boolean", ["feature-state", "pinned"], false], "#111b1a", "#ffffff"],
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "focus"], false], 2.5, ["boolean", ["feature-state", "pinned"], false], 2, 0.8],
      } });
    const move = (e: maplibregl.MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties?.parid as string | undefined;
      map.getCanvas().style.cursor = p ? "pointer" : "";
      handlers.current.onHover(p ?? null, p ? { x: e.point.x, y: e.point.y } : undefined);
    };
    const leave = () => { map.getCanvas().style.cursor = ""; handlers.current.onHover(null); };
    const click = (e: maplibregl.MapLayerMouseEvent) => { const p = e.features?.[0]?.properties?.parid as string | undefined; if (p) handlers.current.onSelect(p); };
    const zoomIn = async (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const z = await (map.getSource(SRC) as maplibregl.GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id as number);
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z, duration: motionOK() ? 500 : 0 });
    };
    map.on("mousemove", "pl-points", move);
    map.on("mouseleave", "pl-points", leave);
    map.on("click", "pl-points", click);
    map.on("click", "pl-clusters", zoomIn);
    return () => {
      map.off("mousemove", "pl-points", move); map.off("mouseleave", "pl-points", leave);
      map.off("click", "pl-points", click); map.off("click", "pl-clusters", zoomIn);
      if (!map.getStyle()) return;
      for (const l of ["pl-points", "pl-cluster-count", "pl-clusters"]) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, ready]);

  // Color by band or by top blocker.
  useEffect(() => {
    if (!map || !ready || !map.getLayer("pl-points")) return;
    const color = (colorBy === "band"
      ? ["match", ["get", "band"], "Easy", BAND_COLOR.Easy!, "Moderate", BAND_COLOR.Moderate!, "Hard", BAND_COLOR.Hard!, "Very hard", BAND_COLOR["Very hard"]!, NO_BAND_COLOR]
      : ["match", ["get", "blk"], ...BLOCKER_PALETTE.flatMap((c, i) => [i, c]), "#9aa6a1"]) as unknown as maplibregl.ExpressionSpecification;
    map.setPaintProperty("pl-points", "circle-color", color);
  }, [map, ready, colorBy]);

  // Data, then frame it when the filters change.
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !ready) return;
    (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    if (!points.length || lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [, lon, lat] of points) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
    if (e - w < 0.004) { w -= 0.004; e += 0.004; }
    if (n - s < 0.003) { s -= 0.003; n += 0.003; }
    map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 16.5, duration: motionOK() ? 600 : 0 });
  }, [map, ready, data, points, fitKey]);

  // Focus / pinned feature-state.
  useEffect(() => {
    if (!map || !ready || !map.getSource(SRC)) return;
    const set = (id: string, k: string, v: boolean) => { try { map.setFeatureState({ source: SRC, id }, { [k]: v }); } catch { /* not loaded yet */ } };
    for (const id of prev.current.focus) set(id, "focus", false);
    for (const id of prev.current.pinned) set(id, "pinned", false);
    const focus = [hover, selected].filter((x): x is string => !!x);
    for (const id of focus) set(id, "focus", true);
    for (const id of pinned) set(id, "pinned", true);
    prev.current = { focus, pinned };
  }, [map, ready, hover, selected, pinned, data]);

  // Selecting a row eases the map to it.
  useEffect(() => {
    if (!map || !ready || !selected) return;
    const p = points.find((x) => x[0] === selected);
    if (p) map.easeTo({ center: [p[1], p[2]], zoom: Math.max(map.getZoom(), 15.5), duration: motionOK() ? 600 : 0 });
  }, [map, ready, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && map) (window as unknown as { __plannerMap?: maplibregl.Map }).__plannerMap = map;
  }, [map]);
  return null;
}

export default function PlannerMap({ points, total, blockers, hover, selected, pinned, onHover, onSelect, fitKey }: {
  points: PlannerPoint[]; total: number; blockers: string[]; hover: string | null; selected: string | null; pinned: string[];
  onHover: (p: string | null) => void; onSelect: (p: string) => void; fitKey: string;
}) {
  const [colorBy, setColorBy] = useState<ColorBy>("band");
  const [card, setCard] = useState<{ parid: string; x: number; y: number } | null>(null);
  const byId = useMemo(() => new Map(points.map((p) => [p[0], p])), [points]);
  const topBlockers = useMemo(() => blockers.slice(0, BLOCKER_PALETTE.length), [blockers]);
  const legend = colorBy === "band"
    ? BANDS.map((b) => ({ color: BAND_COLOR[b]!, label: b }))
    : [...topBlockers.map((b, i) => ({ color: BLOCKER_PALETTE[i]!, label: b })), { color: "#9aa6a1", label: "Other or none" }];
  const p = card ? byId.get(card.parid) : undefined;
  return (
    <MapPanel
      ariaLabel={`Map of matching parcels colored by ${colorBy === "band" ? "score band" : "top blocker"}`}
      bounds={PGH_BOUNDS}
      basemap="light"
      minHeight={260}
      tools={<Segmented label="Color the map by" hideLabel size="sm" tone="dark" value={colorBy} onChange={setColorBy}
        options={[{ value: "band", label: "Color by score" }, { value: "blocker", label: "By top blocker" }]} />}
      legend={<MapLegend items={legend} title={colorBy === "band" ? "Score band" : "Top blocker"} />}
    >
      <Sites points={points} colorBy={colorBy} blockers={topBlockers} hover={hover} selected={selected} pinned={pinned} fitKey={fitKey}
        onHover={(id, xy) => { onHover(id); setCard(id && xy ? { parid: id, ...xy } : null); }} onSelect={onSelect} />
      {points.length > 0 && points.length < total ? (
        <p className="pl-mapnote">Map shows the top {points.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} by score. Narrow the filters to see all.</p>
      ) : null}
      {card && p ? (
        <div className="pl-hover" style={{ left: card.x + 14, top: card.y + 14 }}>
          <strong>{parcelLabel({ address: p[6], parid: p[0] })}</strong>
          <span>{p[3] ?? "—"} · {p[4] ?? "No score"}{p[5] ? ` · top blocker: ${p[5].toLowerCase()}` : ""}</span>
          <span className="pl-muted" style={{ display: "block" }}>{p[7] ?? "—"} home{p[7] === 1 ? "" : "s"} by right, {p[8] ?? "—"} with relief</span>
        </div>
      ) : null}
    </MapPanel>
  );
}
