"use client";

// Developer map: the seat MapPanel (Protomaps basemap + parcel outlines from zoom 15) with one point per
// matching lot, colored by score band. From zoom 15 every parcel outline is clickable too, including lots
// with no official address, so any parcel opens in the pane. Hover shows parcel ID, zoning and owner type
// (lib/parcel-brief: never an owner's name).

import { useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import MapPanel, { MapLegend, PGH_BOUNDS, motionOK, useMapPanel } from "@/components/seats/MapPanel";
import { BAND_COLOR, BANDS, NO_BAND_COLOR, PARTIAL_COLOR, bandLabel, type PlannerPoint } from "@/lib/planner";
import { briefs, type Brief } from "@/lib/parcel-brief";

const SRC = "dv-sites";
const HIT = "dv-parcel-hit";

type Hover = { parid: string; x: number; y: number; score: number | null; band: string | null };

function Layers({ points, selected, pinned, onSelect, onHover, fitKey }: {
  points: PlannerPoint[]; selected: string | null; pinned: string[];
  onSelect: (parid: string) => void; onHover: (h: Hover | null) => void; fitKey: string;
}) {
  const { map, ready } = useMapPanel();
  const cb = useRef({ onSelect, onHover });
  useEffect(() => { cb.current = { onSelect, onHover }; }, [onSelect, onHover]);
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: points.map(([parid, lon, lat, score, band]) => ({ type: "Feature", properties: { parid, score, band: band ?? "none" }, geometry: { type: "Point", coordinates: [lon, lat] } })),
  }), [points]);

  useEffect(() => {
    if (!map || !ready) return;
    // Every parcel outline from zoom 15: a near-invisible fill to hover and click, tinted when selected or pinned.
    map.addLayer({ id: HIT, type: "fill", source: "easescore", "source-layer": "parcels", minzoom: 15, paint: {
      "fill-color": ["case", ["boolean", ["feature-state", "sel"], false], "#156b54", ["boolean", ["feature-state", "pin"], false], "#1d4f86", "#156b54"],
      "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.35, ["boolean", ["feature-state", "pin"], false], 0.22, 0.01],
    } });
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "parid", cluster: true, clusterMaxZoom: 12, clusterRadius: 38 });
    map.addLayer({ id: "dv-clusters", type: "circle", source: SRC, filter: ["has", "point_count"], paint: {
      "circle-color": "#156b54", "circle-opacity": 0.82, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
      "circle-radius": ["step", ["get", "point_count"], 12, 50, 16, 500, 21, 2000, 27] } });
    map.addLayer({ id: "dv-cluster-count", type: "symbol", source: SRC, filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Noto Sans Medium"] }, paint: { "text-color": "#fff" } });
    map.addLayer({ id: "dv-points", type: "circle", source: SRC, filter: ["!", ["has", "point_count"]], paint: {
      "circle-color": ["match", ["get", "band"], "Easy", BAND_COLOR.Easy!, "Moderate", BAND_COLOR.Moderate!, "Hard", BAND_COLOR.Hard!, "Very hard", BAND_COLOR["Very hard"]!, "Partial", PARTIAL_COLOR, NO_BAND_COLOR] as unknown as maplibregl.ExpressionSpecification,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["case", ["boolean", ["feature-state", "sel"], false], 8, 3.5], 15, ["case", ["boolean", ["feature-state", "sel"], false], 10, 5], 18, ["case", ["boolean", ["feature-state", "sel"], false], 13, 8]],
      "circle-stroke-color": ["case", ["boolean", ["feature-state", "sel"], false], "#111b1a", ["boolean", ["feature-state", "pin"], false], "#1d4f86", "#ffffff"],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.5, ["boolean", ["feature-state", "pin"], false], 2.5, 0.8],
    } });

    const pick = (e: maplibregl.MapMouseEvent) => {
      const pt = map.queryRenderedFeatures(e.point, { layers: ["dv-points"] })[0];
      if (pt) return { parid: String(pt.properties?.parid), score: (pt.properties?.score as number | null) ?? null, band: (pt.properties?.band as string) ?? null };
      const cl = map.queryRenderedFeatures(e.point, { layers: ["dv-clusters"] })[0];
      if (cl) return null;
      const f = map.getLayer(HIT) ? map.queryRenderedFeatures(e.point, { layers: [HIT] })[0] : undefined;
      const id = f?.id ?? f?.properties?.parid;
      return id != null ? { parid: String(id), score: null, band: null } : null;
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      const h = pick(e);
      const overCluster = !h && map.queryRenderedFeatures(e.point, { layers: ["dv-clusters"] }).length > 0;
      map.getCanvas().style.cursor = h || overCluster ? "pointer" : "";
      cb.current.onHover(h ? { ...h, x: e.point.x, y: e.point.y } : null);
    };
    const click = async (e: maplibregl.MapMouseEvent) => {
      const cl = map.queryRenderedFeatures(e.point, { layers: ["dv-clusters"] })[0];
      if (cl) {
        const z = await (map.getSource(SRC) as maplibregl.GeoJSONSource).getClusterExpansionZoom(cl.properties!.cluster_id as number);
        map.easeTo({ center: (cl.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z, duration: motionOK() ? 500 : 0 });
        return;
      }
      const h = pick(e);
      if (h) cb.current.onSelect(h.parid);
    };
    const out = () => { map.getCanvas().style.cursor = ""; cb.current.onHover(null); };
    map.on("mousemove", move);
    map.on("click", click);
    map.on("mouseout", out);
    return () => {
      map.off("mousemove", move); map.off("click", click); map.off("mouseout", out);
      if (!map.getStyle()) return;
      for (const l of ["dv-points", "dv-cluster-count", "dv-clusters", HIT]) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, ready]);

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

  // Selected / pinned feature-state on both the points and the parcel outlines.
  const prev = useRef<{ sel: string[]; pin: string[] }>({ sel: [], pin: [] });
  useEffect(() => {
    if (!map || !ready) return;
    const set = (id: string, k: string, v: boolean) => {
      for (const target of [{ source: SRC, id }, { source: "easescore", sourceLayer: "parcels", id }]) {
        try { map.setFeatureState(target, { [k]: v }); } catch { /* not loaded yet */ }
      }
    };
    for (const id of prev.current.sel) set(id, "sel", false);
    for (const id of prev.current.pin) set(id, "pin", false);
    const sel = selected ? [selected] : [];
    for (const id of sel) set(id, "sel", true);
    for (const id of pinned) set(id, "pin", true);
    prev.current = { sel, pin: pinned };
  }, [map, ready, selected, pinned, data]);

  // Opening a lot from the table or search eases the map to it (when it is one of the points).
  useEffect(() => {
    if (!map || !ready || !selected) return;
    const p = points.find((x) => x[0].trim() === selected);
    if (p) map.easeTo({ center: [p[1], p[2]], zoom: Math.max(map.getZoom(), 16), duration: motionOK() ? 600 : 0 });
  }, [map, ready, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && map) (window as unknown as { __developerMap?: maplibregl.Map }).__developerMap = map;
  }, [map]);
  return null;
}

export default function DeveloperMap({ points, total, selected, pinned, onSelect, fitKey }: {
  points: PlannerPoint[]; total: number; selected: string | null; pinned: string[]; onSelect: (parid: string) => void; fitKey: string;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    if (!hover) return;
    let live = true;
    void briefs([hover.parid]).then(([b]) => { if (live && b) setBrief(b); });
    return () => { live = false; };
  }, [hover?.parid]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = hover && brief?.parid === hover.parid ? brief : null;
  return (
    <MapPanel
      ariaLabel="Map of matching lots colored by score band; from street zoom every parcel outline can be opened"
      bounds={PGH_BOUNDS}
      basemap="light"
      minHeight={260}
      legend={<MapLegend items={[...BANDS.map((x) => ({ color: BAND_COLOR[x]!, label: bandLabel(x) })), { color: PARTIAL_COLOR, label: "Partial (zoning not loaded)" }]} title="Ease Score band" />}
    >
      <Layers points={points} selected={selected} pinned={pinned} onSelect={onSelect} onHover={setHover} fitKey={fitKey} />
      <p className="pl-mapnote dv-mapnote">
        {points.length > 0 && points.length < total ? `Map shows the top ${points.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} by score. ` : ""}
        Zoom in to street level to open any parcel, including lots with no address.
      </p>
      {hover ? (
        <div className="pl-hover" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{b?.address ?? "Parcel"}</strong>
          <span className="dv-mono">Parcel {hover.parid.trim()}</span>
          <span className="pl-muted" style={{ display: "block" }}>
            {[b ? (b.zoning ? `Zoning ${b.zoning}` : "Zoning not in our data") : "…", b?.owner ?? null, hover.score != null ? `Score ${hover.score} · ${bandLabel(hover.band)}` : hover.band === "Partial" ? "Partial screen: zoning not loaded" : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : null}
    </MapPanel>
  );
}
