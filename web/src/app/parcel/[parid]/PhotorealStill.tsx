"use client";

// Instant stand-in for the photoreal 3D view: the lot, its neighbors, streets and building footprints drawn
// from our own data (county parcels and footprints) through the same camera the 3D view starts from, so
// the live Google 3D tiles crossfade in over it without a jump. It is a drawing, not a photo, and no Google
// imagery is used, cached or stored.

import { useEffect, useMemo, useRef, useState } from "react";

type Ring = [number, number][];
type Geom = { type: string; coordinates: unknown };
type Feature = { properties: { kind: string; height_m?: number | null }; geometry: Geom };
export type StillData = { center: [number, number]; features: Feature[] };
export type Insets = { left: number; bottom: number };
type V3 = [number, number, number];

export const HEADING_DEG = 20; // a slightly rotated arrival reads better than dead north-up
export const PITCH_DEG = -45;
/** The 3D view opens this much wider than its resting framing, then settles in. */
export const START_RANGE = 1.3;
const FOV = Math.PI / 3; // Cesium's default perspective field of view

/** Local east/north metres per degree at a latitude (WGS84). */
function metresPerDegree(lat: number) {
  const a = 6378137, e2 = 0.00669437999014, s = Math.sin((lat * Math.PI) / 180);
  const w = 1 - e2 * s * s;
  return { x: ((a / Math.sqrt(w)) * Math.cos((lat * Math.PI) / 180) * Math.PI) / 180, y: ((a * (1 - e2)) / (w * Math.sqrt(w)) * Math.PI) / 180 };
}

/**
 * Camera framing shared by the 3D view and this still: the parcel at ~45 degrees, centred in the part of the
 * map not covered by the floating panel. Returns the camera position in east-north-up metres around the lot
 * centre (lon0, lat0) plus the view basis, so both renderers place the lot in the same spot on screen.
 */
export function frameParcel(rings: Ring[], W: number, H: number, ins: Insets, rangeMul: number) {
  const pts = rings.flat();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const lon0 = (x0 + x1) / 2, lat0 = (y0 + y1) / 2;
  const m = metresPerDegree(lat0);
  const radius = Math.max(0, ...pts.map(([x, y]) => Math.hypot((x - lon0) * m.x, (y - lat0) * m.y)));
  W = W || 1; H = H || 1;
  const t = Math.tan(FOV / 2);
  const halfW = W >= H ? 1 : W / H, halfH = W >= H ? H / W : 1; // per unit range, in units of tan(fov/2)
  const visW = Math.max(W - ins.left, W * 0.4), visH = Math.max(H - ins.bottom, H * 0.35);
  const fit = (Math.max(radius, 12) * 2.4) / t / Math.min((halfW * visW) / W, (halfH * visH) / H);
  const R = Math.max(70, fit) * rangeMul;
  const h = (HEADING_DEG * Math.PI) / 180, p = (PITCH_DEG * Math.PI) / 180;
  const dir: V3 = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  const right: V3 = [Math.cos(h), -Math.sin(h), 0];
  const up: V3 = [right[1] * dir[2] - right[2] * dir[1], right[2] * dir[0] - right[0] * dir[2], right[0] * dir[1] - right[1] * dir[0]];
  const sx = R * t * halfW * (ins.left / W), sy = R * t * halfH * (ins.bottom / H);
  const cam = [0, 1, 2].map((i) => -R * dir[i]! - sx * right[i]! - sy * up[i]!) as V3;
  return { lon0, lat0, m, radius, cam, dir, right, up, heading: h, pitch: p, t, halfW, halfH };
}

function ringsOf(g: Geom): Ring[] {
  const c = g.coordinates as never;
  switch (g.type) {
    case "Polygon": return c;
    case "MultiPolygon": return (c as Ring[][]).flat();
    case "LineString": return [c];
    case "MultiLineString": return c;
    default: return [];
  }
}

export default function PhotorealStill({ data, insets }: { data: StillData; insets: Insets }) {
  const box = useRef<HTMLDivElement>(null);
  // Server render assumes a desktop viewport; the client re-frames to the real size on mount.
  const [size, setSize] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth || 1440, h: el.clientHeight || 900 });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const svg = useMemo(() => {
    const { w: W, h: H } = size;
    const parcels = data.features.filter((f) => f.properties.kind === "parcel").flatMap((f) => ringsOf(f.geometry));
    if (!parcels.length) return null;
    const F = frameParcel(parcels, W, H, insets, START_RANGE);
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const proj = ([lon, lat]: [number, number], z = 0): [number, number] | null => {
      const v: V3 = [(lon - F.lon0) * F.m.x - F.cam[0], (lat - F.lat0) * F.m.y - F.cam[1], z - F.cam[2]];
      const d = dot(v, F.dir);
      if (d < 1) return null;
      return [W / 2 + (dot(v, F.right) / (d * F.t * F.halfW)) * (W / 2), H / 2 - (dot(v, F.up) / (d * F.t * F.halfH)) * (H / 2)];
    };
    const inView = (ps: [number, number][]) => ps.some(([x, y]) => x > -W * 0.25 && x < W * 1.25 && y > -H * 0.25 && y < H * 1.25);
    const path = (r: Ring, z = 0, close = true) => {
      const ps = r.map((p) => proj(p, z));
      if (ps.some((p) => !p)) return null;
      const q = ps as [number, number][];
      if (!inView(q)) return null;
      return `M${q.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}${close ? "Z" : ""}`;
    };
    const of = (kind: string) => data.features.filter((f) => f.properties.kind === kind);
    const streets = of("street").flatMap((f) => ringsOf(f.geometry).map((r) => path(r, 0, f.geometry.type.includes("Polygon")))).filter(Boolean) as string[];
    const neighbors = of("neighbor").flatMap((f) => ringsOf(f.geometry).map((r) => path(r))).filter(Boolean) as string[];
    // Buildings as simple blocks, far to near so nearer ones overlap farther ones.
    const camLL: [number, number] = [F.lon0 + F.cam[0] / F.m.x, F.lat0 + F.cam[1] / F.m.y];
    const blocks = of("building").flatMap((f) => ringsOf(f.geometry).map((r) => ({ r, hm: Math.max(3, f.properties.height_m ?? 8) })))
      .map((b) => ({ ...b, d: Math.hypot((b.r[0]![0] - camLL[0]) * F.m.x, (b.r[0]![1] - camLL[1]) * F.m.y) }))
      .sort((a, b) => b.d - a.d)
      .map(({ r, hm }) => {
        const roof = path(r, hm);
        if (!roof) return null;
        const walls: string[] = [];
        for (let i = 0; i + 1 < r.length; i++) {
          const q = [proj(r[i]!), proj(r[i + 1]!), proj(r[i + 1]!, hm), proj(r[i]!, hm)];
          if (q.every(Boolean)) walls.push(`M${(q as [number, number][]).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`);
        }
        return { roof, walls: walls.join("") };
      }).filter(Boolean) as { roof: string; walls: string }[];
    const lot = parcels.map((r) => path(r)).filter(Boolean).join("");
    return { W, H, streets, neighbors, blocks, lot };
  }, [data, insets, size]);

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(180deg, #2a3b4f 0%, #1e293b 60%, #172033 100%)" }} aria-hidden>
      {svg && (
        <svg viewBox={`0 0 ${svg.W} ${svg.H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <g fill="none" stroke="#3b4a5e" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
            {svg.streets.map((d, i) => <path key={i} d={d} />)}
          </g>
          <g fill="none" stroke="#64748b" strokeWidth={0.9} strokeOpacity={0.8}>
            {svg.neighbors.map((d, i) => <path key={i} d={d} />)}
          </g>
          {svg.blocks.map((b, i) => (
            <g key={i}>
              <path d={b.walls} fill="#7c8a9e" stroke="#475569" strokeWidth={0.5} />
              <path d={b.roof} fill="#b6c2d1" stroke="#475569" strokeWidth={0.6} />
            </g>
          ))}
          <path d={svg.lot} fill="#facc15" fillOpacity={0.12} stroke="#facc15" strokeOpacity={0.35} strokeWidth={12} strokeLinejoin="round" />
          <path d={svg.lot} fill="none" stroke="#fde047" strokeWidth={3} strokeLinejoin="round" />
        </svg>
      )}
      <p className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-200"
         style={{ top: 72, left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)` }}>
        Preview drawn from county parcel data · photoreal 3D loading
      </p>
    </div>
  );
}
