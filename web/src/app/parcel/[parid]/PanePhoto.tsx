"use client";

// Photo slot of the parcel pane. A Google Street View Static image of the frontage when Google has a
// street-level panorama near the lot: the free Street View metadata endpoint is asked first, and the
// photo is shown only when a panorama exists within MAX_M of the lot's outline (the camera is then turned
// to face the lot). The image loads straight from Google in an <img> (never cached, proxied or stored by
// us) with Google's attribution. Otherwise (no key, API not enabled, no panorama, or too far away) the
// slot shows our own illustrative 3D map of the lot (ParcelThumb), labeled as not a photo, so it is never
// a photo of the wrong place.

import { useEffect, useState } from "react";
import ParcelThumb from "./ParcelThumb";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
/** A panorama farther than this from the lot outline is not "the frontage". */
const MAX_M = 60;

type FC = { type: "FeatureCollection"; bbox: [number, number, number, number]; center: [number, number]; features: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Pano = { lat: number; lng: number; pano: string; heading: number; date: string | null; copyright: string };

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
/** Local metres east/north of (lat0, lon0). */
const en = (lat0: number, lon0: number, lat: number, lon: number): [number, number] => [rad(lon - lon0) * R * Math.cos(rad(lat0)), rad(lat - lat0) * R];

/** Distance (m) from p to the ring's edges and the nearest point on them, in local metres around p. */
function nearestOnRing(p: { lat: number; lng: number }, ring: [number, number][]) {
  let best = { d: Infinity, x: 0, y: 0 };
  const q = ring.map(([lon, lat]) => en(p.lat, p.lng, lat, lon));
  for (let i = 0; i + 1 < q.length; i++) {
    const [ax, ay] = q[i]!, [bx, by] = q[i + 1]!;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(x, y);
    if (d < best.d) best = { d, x, y };
  }
  return best;
}

function outerRing(g: { type: string; coordinates: any } | undefined): [number, number][] { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!g) return [];
  if (g.type === "Polygon") return g.coordinates[0] ?? [];
  if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][]).map((p) => p[0] ?? []).sort((a, b) => b.length - a.length)[0] ?? [];
  return [];
}

export default function PanePhoto({ stage, date }: { stage: Promise<{ mapData: FC | null }>; date: string }) {
  const [pano, setPano] = useState<Pano | null>(null);
  const [state, setState] = useState<"checking" | "photo" | "none">(KEY ? "checking" : "none");
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!KEY) return;
    let live = true;
    const ac = new AbortController();
    stage.then(async (x) => {
      const parcel = x.mapData?.features.find((f) => f.properties?.kind === "parcel");
      const ring = outerRing(parcel?.geometry);
      if (!ring.length) { if (live) setState("none"); return; }
      const lon = ring.reduce((t, p) => t + p[0], 0) / ring.length, lat = ring.reduce((t, p) => t + p[1], 0) / ring.length;
      const u = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat.toFixed(6)},${lon.toFixed(6)}&radius=${MAX_M + 40}&source=outdoor&key=${encodeURIComponent(KEY)}`;
      const m = await fetch(u, { signal: ac.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { status?: string; pano_id?: string; location?: { lat: number; lng: number }; date?: string; copyright?: string } | null;
      if (!live) return;
      if (m?.status !== "OK" || !m.location || !m.pano_id) { setState("none"); return; }
      const near = nearestOnRing(m.location, ring);
      if (!(near.d <= MAX_M)) { setState("none"); return; }
      // Face the lot: toward its middle (a panorama on the lot line looks along the nearest edge otherwise).
      const [cx, cy] = en(m.location.lat, m.location.lng, lat, lon);
      const heading = (Math.atan2(cx, cy) * 180) / Math.PI;
      setPano({ lat: m.location.lat, lng: m.location.lng, pano: m.pano_id, heading: (heading + 360) % 360, date: m.date ?? null, copyright: m.copyright ?? "© Google" });
      setState("photo");
    }, () => { if (live) setState("none"); });
    return () => { live = false; ac.abort(); };
  }, [stage]);

  if (state === "photo" && pano && !imgFailed) {
    const src = `https://maps.googleapis.com/maps/api/streetview?size=400x264&scale=2&pano=${encodeURIComponent(pano.pano)}&heading=${pano.heading.toFixed(0)}&pitch=4&fov=80&source=outdoor&key=${encodeURIComponent(KEY)}`;
    return (
      <figure className="m-0 min-w-0">
        <div className="h-[132px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- loaded directly from Google, never through our servers */}
          <img src={src} alt="Google Street View photo of the street frontage of this lot" className="h-full w-full object-cover" referrerPolicy="strict-origin-when-cross-origin" onError={() => setImgFailed(true)} />
        </div>
        <figcaption className="mt-0.5 truncate text-[10px] text-slate-600" title={pano.copyright}>{`Street View${pano.date ? `, ${pano.date}` : ""} · Image © Google`}</figcaption>
      </figure>
    );
  }
  return <ParcelThumb stage={stage} date={date} compact />;
}
