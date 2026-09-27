"use client";

// The "policy wave": every parcel that gains homes by right under the lever state, animated in from the
// city center outward when the state changes (instant under reduced motion). Before / after / what
// changed recolor the same parcels. Hover names the parcel, the lever that unlocked it and the homes
// gained; click opens it in the Developer view.

import { useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import MapPanel, { GeoJSONLayer, MapLegend, motionOK, useMapPanel } from "@/components/seats/MapPanel";
import { Segmented } from "@/components/seats";
import type { PolicyPoint } from "@/lib/policy/data";
import { leverComboLabel } from "@/lib/policy/model";

export type MapView = "before" | "after" | "difference";

const LEVER_COLOR: Record<string, string> = {
  attached: "#0f5a45",
  minLot: "#5fb892",
  "attached+minLot": "#1f8a64",
  parking: "#c7881f",
  "minLot+parking": "#8f9f3a",
  "attached+parking": "#7a6a1e",
  "attached+minLot+parking": "#3d7d2f",
  adu: "#2f6fb0",
  contextual: "#8a4fa3",
  height: "#b5543a",
};
const CENTER: [number, number] = [-80.0, 40.44];

function Wave({ points, view }: { points: PolicyPoint[]; view: MapView }) {
  const { map, ready } = useMapPanel();
  const raf = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; parid: string; lever: string; before: number; after: number; delta: number; newly: boolean } | null>(null);

  const fc = useMemo(() => {
    const maxD = Math.max(1e-6, ...points.map((p) => Math.hypot(p[1] - CENTER[0], (p[2] - CENTER[1]) * 1.3)));
    return {
      type: "FeatureCollection" as const,
      features: points.map((p) => ({
        type: "Feature" as const,
        id: p[0],
        geometry: { type: "Point" as const, coordinates: [p[1], p[2]] },
        properties: {
          parid: p[0], delta: p[3], levers: p[4], newly: p[5] ? 1 : 0, pencil: p[6] ? 1 : 0, before: p[7] ?? 0, after: (p[7] ?? 0) + p[3],
          rank: Math.hypot(p[1] - CENTER[0], (p[2] - CENTER[1]) * 1.3) / maxD,
        },
      })),
    };
  }, [points]);

  // Wave: reveal by distance from the center over ~2.4 s; instant under reduced motion.
  useEffect(() => {
    if (!map || !ready || !map.getLayer("policy-pts")) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!motionOK()) { map.setFilter("policy-pts", null); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 2400);
      if (!map.getLayer("policy-pts")) return;
      map.setFilter("policy-pts", ["<=", ["get", "rank"], k]);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else map.setFilter("policy-pts", null);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [map, ready, fc]);

  // Recolor for the view.
  useEffect(() => {
    if (!map || !ready || !map.getLayer("policy-pts")) return;
    const byLever: unknown[] = ["match", ["get", "levers"]];
    for (const [k, c] of Object.entries(LEVER_COLOR)) byLever.push(k, c);
    byLever.push("#1f8a64");
    const color = view === "difference" ? byLever
      : view === "after" ? ["step", ["get", "after"], "#b9d9ca", 1, "#7cc4a4", 2, "#3aa37a", 3, "#156b54", 5, "#0b3f31"]
        : ["step", ["get", "before"], "#ffffff", 1, "#c9d1ce", 2, "#9aa5a1", 3, "#6b7773"];
    map.setPaintProperty("policy-pts", "circle-color", color as maplibregl.ExpressionSpecification);
    map.setPaintProperty("policy-pts", "circle-stroke-color", view === "before" ? "#6b7773" : "#ffffff");
    map.setPaintProperty("policy-pts", "circle-radius", (view === "difference"
      ? ["interpolate", ["linear"], ["zoom"], 11, ["min", 5, ["+", 1.6, ["*", 0.6, ["get", "delta"]]]], 16, ["min", 11, ["+", 4, ["get", "delta"]]]]
      : ["interpolate", ["linear"], ["zoom"], 11, 2.2, 16, 6]) as maplibregl.ExpressionSpecification);
  }, [map, ready, view, fc]);

  // Hover card and click-through.
  useEffect(() => {
    if (!map || !ready) return;
    const move = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, unknown>;
      map.getCanvas().style.cursor = "pointer";
      const lever = leverComboLabel(String(p.levers));
      setTip({ x: e.point.x, y: e.point.y, parid: String(p.parid), lever, before: Number(p.before), after: Number(p.after), delta: Number(p.delta), newly: !!p.newly });
    };
    const leave = () => { map.getCanvas().style.cursor = ""; setTip(null); };
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.parid;
      if (typeof id === "string" && /^[0-9A-Z]{16}$/.test(id)) window.open(`/parcel/${id}`, "_blank", "noopener");
    };
    map.on("mousemove", "policy-pts", move);
    map.on("mouseleave", "policy-pts", leave);
    map.on("click", "policy-pts", click);
    return () => { map.off("mousemove", "policy-pts", move); map.off("mouseleave", "policy-pts", leave); map.off("click", "policy-pts", click); };
  }, [map, ready]);

  return (
    <>
      <GeoJSONLayer
        id="policy"
        data={fc}
        promoteId="parid"
        layers={[{
          id: "policy-pts", type: "circle",
          paint: { "circle-color": "#1f8a64", "circle-radius": 3, "circle-stroke-width": 0.6, "circle-stroke-color": "#ffffff", "circle-opacity": 0.92 },
        }]}
      />
      {tip ? (
        <div className="pol-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="status">
          <strong>{tip.parid}</strong>
          <br />Unlocked by: {tip.lever}
          <br />By-right yield: {tip.before} → {tip.after} (+{tip.delta})
          {tip.newly ? <><br />Newly buildable by right</> : null}
        </div>
      ) : null}
    </>
  );
}

export default function PolicyMap({ points, loading, levers }: { points: PolicyPoint[]; loading: boolean; levers: string[] }) {
  const [view, setView] = useState<MapView>("difference");
  const legend = view === "difference"
    ? Object.entries(LEVER_COLOR).filter(([k]) => levers.includes(k)).map(([k, c]) => ({ color: c, label: `Unlocked by ${leverComboLabel(k).toLowerCase()}` }))
    : view === "after"
      ? [{ color: "#7cc4a4", label: "1 home by right" }, { color: "#3aa37a", label: "2" }, { color: "#156b54", label: "3–4" }, { color: "#0b3f31", label: "5 or more" }]
      : [{ color: "#ffffff", label: "No home by right today" }, { color: "#c9d1ce", label: "1 today" }, { color: "#9aa5a1", label: "2 today" }, { color: "#6b7773", label: "3 or more today" }];
  return (
    <MapPanel
      ariaLabel="Map of parcels that gain homes by right under this rule change"
      minHeight={340}
      tools={
        <Segmented<MapView>
          label="Map view" hideLabel tone="dark" size="sm"
          options={[{ value: "before", label: "Before" }, { value: "after", label: "After" }, { value: "difference", label: "What changed" }]}
          value={view} onChange={setView}
        />
      }
      legend={<MapLegend title={loading ? "Loading parcels…" : `${points.length.toLocaleString()} parcels gain homes`} items={legend} />}
    >
      <Wave points={points} view={view} />
    </MapPanel>
  );
}
