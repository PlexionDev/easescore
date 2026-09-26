"use client";

// Full-bleed photoreal Pittsburgh behind the homepage search: a slow drift over the Point and the three
// rivers, seen from above Mt. Washington. Static camera under prefers-reduced-motion. On any failure it
// renders nothing and the page keeps its dark gradient.

import { useEffect, useMemo, useRef, useState } from "react";
import { acquire, groundHeights, prefersReducedMotion, release, sunTime, type Shared } from "@/lib/photoreal";

const TARGET: [number, number] = [-80.0045, 40.4402]; // the Golden Triangle, just east of the Point
const RANGE_M = 2600;
const PITCH_DEG = -21;
const HEADING_DEG = 12; // camera sits south-southwest of downtown, over Mt. Washington
const SWAY_DEG = 22, PERIOD_S = 150;

export default function PhotorealHero() {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const me = useMemo(() => Symbol("hero"), []);

  useEffect(() => {
    let dead = false, sh: Shared | null = null;
    const cleanups: (() => void)[] = [];
    const start = async () => {
      if (dead || !host.current) return;
      try { sh = await acquire(host.current, me); } catch { return; }
      if (dead) { release(sh, me); return; }
      const { C, viewer } = sh;
      const scene = viewer.scene;
      sh.credits.style.bottom = "8px";
      sh.credits.style.maxWidth = "calc(100% - 16px)";
      viewer.shadows = false;
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = sunTime(C);
      viewer.resolutionScale = (window.devicePixelRatio || 1) > 1.5 ? 0.75 : 1; // background under a scrim: lighter on retina
      scene.globe.show = false;
      scene.screenSpaceCameraController.enableInputs = false;
      const [h] = await groundHeights([TARGET]);
      if (dead) return;
      const target = C.Cartesian3.fromDegrees(TARGET[0], TARGET[1], h ?? 190);
      const still = prefersReducedMotion();
      const t0 = performance.now();
      const place = () => {
        const t = (performance.now() - t0) / 1000;
        const hd = HEADING_DEG + (still ? 0 : SWAY_DEG * Math.sin((2 * Math.PI * t) / PERIOD_S));
        viewer.camera.lookAt(target, new C.HeadingPitchRange(C.Math.toRadians(hd), C.Math.toRadians(PITCH_DEG), RANGE_M));
      };
      place();
      if (!still) cleanups.push(scene.preRender.addEventListener(place));
      cleanups.push(() => viewer.camera.lookAtTransform(C.Matrix4.IDENTITY));
      cleanups.push(() => { scene.screenSpaceCameraController.enableInputs = true; });

      let ts;
      try { ts = await sh.tileset; } catch { return; }
      if (dead) return;
      ts.maximumScreenSpaceError = 12;
      ts.customShader = undefined as never;
      if (ts.clippingPolygons) ts.clippingPolygons.enabled = false;
      await new Promise<void>((r) => {
        const t = setTimeout(done, 10000);
        const un = ts.allTilesLoaded.addEventListener(done);
        function done() { clearTimeout(t); un(); r(); }
        cleanups.push(done);
      });
      if (!dead) setShown(true);
    };
    // Let the search UI paint and settle first.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = idle ? idle(() => void start(), { timeout: 1500 }) : window.setTimeout(() => void start(), 300);
    return () => {
      dead = true;
      if (!idle) clearTimeout(handle);
      for (const c of cleanups.reverse()) { try { c(); } catch { /* viewer gone */ } }
      release(sh, me);
    };
  }, [me]);

  return (
    <div className={`pointer-events-none absolute inset-0 transition-opacity duration-[1500ms] ${shown ? "opacity-100" : "opacity-0"}`}>
      <div ref={host} className="absolute inset-0" />
      {/* Scrim keeps the glass search UI legible; the credit line (z-40 inside the viewer) stays above it. */}
      <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(2,6,23,0.72) 0%, rgba(2,6,23,0.45) 45%, rgba(2,6,23,0.8) 100%)" }} />
    </div>
  );
}
