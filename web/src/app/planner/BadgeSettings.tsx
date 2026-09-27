"use client";

// Planning priority badge settings (EASE-SCORE-SPEC §5): weight sliders per criterion and an optional
// target-area GeoJSON, saved in this browser as a named, dated profile. The badge never changes the
// Ease Score. Until a planner saves a profile the badge uses the default weights ("awaiting planning input").

import { useEffect, useRef, useState } from "react";
import { RangeSlider, SeatButton } from "@/components/seats";
import { BADGE_NOTE, type PlannerRow } from "@/lib/planner";

export type BadgeConfig = {
  criteria: { id: string; label: string; weight: number }[];
  tiers: { tier: string; min: number; requiresNoRedFlags: boolean }[];
};
export type BadgeProfile = {
  name: string;
  savedAt: string;
  weights: Record<string, number>;
  /** Target areas (polygons, lon/lat). */
  areas: GeoJSON.FeatureCollection | null;
  areaName?: string;
};
const KEY = "easescore.planner.badgeProfile";

export function loadProfile(): BadgeProfile | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as BadgeProfile | null;
    return v && typeof v.name === "string" && v.weights ? v : null;
  } catch { return null; }
}
function saveProfile(p: BadgeProfile | null) {
  try { if (p) window.localStorage.setItem(KEY, JSON.stringify(p)); else window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
function inAreas(lon: number, lat: number, fc: GeoJSON.FeatureCollection): boolean {
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) if (p[0] && inRing(lon, lat, p[0] as number[][]) && !p.slice(1).some((h) => inRing(lon, lat, h as number[][]))) return true;
  }
  return false;
}

/** Badge tier for a row under a profile (null profile = the stored default badge). */
export function badgeTier(r: PlannerRow, cfg: BadgeConfig, profile: BadgeProfile | null): string | null {
  if (!profile) return r.planning_badge;
  let points = 0;
  for (const c of cfg.criteria) {
    const w = profile.weights[c.id] ?? c.weight;
    let m = r.badge_matches?.[c.id] ?? null;
    if (c.id === "target_area") m = profile.areas && r.lon != null && r.lat != null ? inAreas(r.lon, r.lat, profile.areas) : null;
    if (m) points += w;
  }
  for (const t of [...cfg.tiers].sort((a, b) => b.min - a.min))
    if (points >= t.min && (!t.requiresNoRedFlags || r.red_flag_count === 0)) return t.tier;
  return null;
}

export default function BadgeSettings({ open, onClose, cfg, profile, onChange }: {
  open: boolean; onClose: () => void; cfg: BadgeConfig; profile: BadgeProfile | null; onChange: (p: BadgeProfile | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(profile?.name ?? "");
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(cfg.criteria.map((c) => [c.id, profile?.weights[c.id] ?? c.weight])));
  const [areas, setAreas] = useState<GeoJSON.FeatureCollection | null>(profile?.areas ?? null);
  const [areaName, setAreaName] = useState(profile?.areaName ?? "");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const upload = async (file: File | undefined) => {
    setErr(null);
    if (!file) return;
    if (file.size > 5_000_000) { setErr("That file is over 5 MB. Simplify the polygons and try again."); return; }
    try {
      const j = JSON.parse(await file.text()) as GeoJSON.GeoJSON;
      const fc: GeoJSON.FeatureCollection = j.type === "FeatureCollection" ? j : j.type === "Feature" ? { type: "FeatureCollection", features: [j] }
        : { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: j as GeoJSON.Geometry }] };
      const polys = fc.features.filter((f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon");
      if (!polys.length) { setErr("No polygons found. Upload GeoJSON polygons in longitude/latitude (EPSG:4326)."); return; }
      setAreas({ type: "FeatureCollection", features: polys });
      setAreaName(file.name);
    } catch { setErr("Could not read that file as GeoJSON."); }
  };
  const total = Object.values(weights).reduce((s, x) => s + x, 0);

  return (
    <dialog ref={ref} className="es-seat pl-dialog" aria-labelledby="pl-badge-h" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="pl-dialog-inner">
        <h2 id="pl-badge-h">Planning priority settings</h2>
        <p className="pl-hint">The badge shows what the City wants to see built. It never changes the Ease Score. {profile ? `Active profile: ${profile.name} (saved ${profile.savedAt.slice(0, 10)}).` : `${BADGE_NOTE}.`} Profiles are saved in this browser only.</p>
        <label className="es-field-label">Profile name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Housing priorities, fall draft" />
        </label>
        {cfg.criteria.map((c) => (
          <RangeSlider key={c.id} label={c.label} min={0} max={40} step={5} value={weights[c.id] ?? 0}
            onChange={(v: number) => setWeights((w) => ({ ...w, [c.id]: v }))} format={(n) => `${n} pts`}
            hint={c.id === "affordable_units" ? "Project input: not known for parcels in bulk, so it never matches here." : c.id === "target_area" ? (areas ? `Target areas: ${areaName || "uploaded"} (${areas.features.length} polygon${areas.features.length === 1 ? "" : "s"})` : "Upload target-area polygons below; until then this criterion does not match.") : undefined} />
        ))}
        <p className="pl-hint">Points available: {total}. Expedite candidate at {cfg.tiers.find((t) => t.requiresNoRedFlags)?.min ?? 70}+ with no red flags; Priority watch at {cfg.tiers.find((t) => !t.requiresNoRedFlags)?.min ?? 50}+.</p>
        <label className="es-field-label">Target areas (GeoJSON polygons)
          <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {err ? <p role="alert" className="pl-hint" style={{ color: "var(--es-red)" }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SeatButton variant="primary" onClick={() => {
            const p: BadgeProfile = { name: name.trim() || "Untitled profile", savedAt: new Date().toISOString(), weights, areas, areaName };
            saveProfile(p); onChange(p); onClose();
          }}>Save profile</SeatButton>
          <SeatButton onClick={() => { saveProfile(null); onChange(null); onClose(); }}>Use default weights</SeatButton>
          <SeatButton variant="ghost" onClick={onClose}>Cancel</SeatButton>
        </div>
      </div>
    </dialog>
  );
}
