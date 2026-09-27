// Shared CesiumJS + Google Photorealistic 3D Tiles runtime (browser only).
//
// Cesium is loaded with a dynamic import so it never lands in a route's initial JS. One Viewer and one
// Google tileset are created per page session and handed from consumer to consumer (homepage hero,
// parcel view). Each tileset creation is a billed root request, so moving between pages or view modes
// re-parents the same canvas instead of building a new one.
//
// Nothing here logs request URLs or error bodies: Google tile URLs carry the API key.

import type * as CesiumNS from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

export type Cesium = typeof CesiumNS;

/** Inlined at build time. Empty string when the key isn't configured. */
export const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
export const hasGoogleKey = () => GOOGLE_KEY.length > 0;

let cesiumP: Promise<Cesium> | null = null;
export function loadCesium(): Promise<Cesium> {
  if (!cesiumP) {
    // Versioned path (see next.config.ts), served with immutable cache headers.
    (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = process.env.NEXT_PUBLIC_CESIUM_BASE_URL ?? "/cesium";
    cesiumP = import("cesium").then((C) => {
      C.Ion.defaultAccessToken = ""; // never touch Cesium ion
      // Cesium's stock Google credit loads its logo from Cesium ion's CDN; use Google's own hosted logo instead.
      (C.GoogleMaps as unknown as { getDefaultCredit: () => CesiumNS.Credit }).getDefaultCredit = () => new C.Credit(
        '<img alt="Google" src="https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png" style="height:20px;width:auto;vertical-align:-6px">', true);
      return C;
    });
    cesiumP.catch(() => { cesiumP = null; });
  }
  return cesiumP;
}

export type TileError = { kind: "key" | "network" | "webgl" | "engine"; status?: number };

export type Shared = {
  C: Cesium;
  viewer: CesiumNS.Viewer;
  /** Re-parented between consumers. Holds the Cesium canvas and the credit line. */
  root: HTMLDivElement;
  credits: HTMLDivElement;
  tileset: Promise<CesiumNS.Cesium3DTileset>;
  /** Tiles that failed after the root loaded (network or quota); the root failure rejects `tileset`. */
  failedTiles: number;
  /** A view is still streaming in: keep load-time detail. Starts true; cleared by the tileset's first full load.
   *  Consumers set it again while a new place loads. Call `refreshQuality` after changing it or `steady`. */
  loading: boolean;
  /** Treat the camera as at rest even while it moves (the slow presentation orbit). */
  steady: boolean;
  refreshQuality: () => void;
};

// Detail while the camera moves or tiles first stream in, and at rest. Google tiles look right at SSE 8;
// 16 loads roughly a quarter of the tiles, so it is used only when nobody is looking closely.
const SSE_MOVING = 16, SSE_REST = 8, IDLE_MS = 600, MOVING_DPR_CAP = 1.5;
// The very first view of the session (until the tileset's first full load) streams coarser still: measured
// 0.6-1.1 s sooner to first 3D on three parcels, and the settle that follows refines it to SSE 16, then 8 at rest.
const SSE_FIRST = 24;

let sharedP: Promise<Shared> | null = null;
let owner: symbol | null = null;

function statusOf(e: unknown): number | undefined {
  const s = (e as { statusCode?: unknown })?.statusCode;
  return typeof s === "number" ? s : undefined;
}

export function tileErrorOf(e: unknown): TileError {
  if ((e as TileError)?.kind) return e as TileError;
  const status = statusOf(e);
  if (status === 400 || status === 401 || status === 403) return { kind: "key", status };
  if (status) return { kind: "network", status };
  const msg = e instanceof Error ? e.message : "";
  if (/webgl/i.test(msg)) return { kind: "webgl" };
  return { kind: "network" };
}

async function create(): Promise<Shared> {
  const C = await loadCesium();
  const root = document.createElement("div");
  root.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  const stage = document.createElement("div");
  stage.style.cssText = "position:absolute;inset:0;";
  const credits = document.createElement("div");
  credits.className = "es-credits";
  // Google logo + data attributions: always on screen, bottom-right, above every floating control.
  credits.style.cssText = "position:absolute;right:8px;bottom:8px;z-index:40;max-width:calc(100% - 16px);display:flex;" +
    "flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px;padding:3px 8px;border-radius:8px;" +
    "background:rgba(15,23,42,0.62);color:#f8fafc;font:11px/1.5 system-ui,sans-serif;pointer-events:auto;";
  root.append(stage, credits);

  let viewer: CesiumNS.Viewer;
  try {
    viewer = new C.Viewer(stage, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, vrButton: false, creditContainer: credits, msaaSamples: 4, shadows: false,
      projectionPicker: false, navigationInstructionsInitiallyVisible: false, scene3DOnly: true,
      useDefaultRenderLoop: false, // started by acquire(); nothing renders while the viewer is detached
      // Off: the canvas is sized from window.devicePixelRatio x resolutionScale, so scale 1 is true full DPR.
      useBrowserRecommendedResolution: false,
      // Needed so "Capture view" can read the canvas after the frame is composited.
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
  } catch {
    throw { kind: "webgl" } satisfies TileError;
  }
  // widgets.css pins the credit block absolutely; let it flow inside our container instead, and keep
  // the renderer (Cesium) logo visibly apart from the Google logo, as the Map Tiles policy asks.
  const inner = credits.querySelector<HTMLElement>(".cesium-widget-credits");
  if (inner) inner.style.cssText = "position:static;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:2px 12px;";
  // The Cesium ion badge is only for ion-hosted content; we render with open-source CesiumJS (Apache-2.0)
  // and use no ion services, so hide it. Google's logo and data credits stay visible.
  const logo = credits.querySelector<HTMLElement>(".cesium-credit-logoContainer");
  if (logo) logo.style.display = "none";
  const s = viewer.scene;
  s.globe.show = false; // Google tiles cover the ground; no base imagery, no ion
  if (s.skyAtmosphere) s.skyAtmosphere.show = true;
  if (s.skyBox) s.skyBox.show = true;
  s.primitives.destroyPrimitives = false;
  if (process.env.NODE_ENV === "development") (window as unknown as { __cesium: unknown }).__cesium = viewer;

  const shared: Shared = {
    C, viewer, root, credits, tileset: Promise.resolve(null as never), failedTiles: 0, loading: true, steady: false, refreshQuality: () => {},
  };

  // Load fast, finish sharp: SSE 16 and at most 1.5x pixel density while tiles first stream in or the camera
  // moves; SSE 8 at full devicePixelRatio once the first view has loaded and the camera has been still ~600 ms.
  let idle = true, first = true, timer: ReturnType<typeof setTimeout> | undefined;
  let tsRef: CesiumNS.Cesium3DTileset | null = null;
  const apply = () => {
    const rest = !shared.loading && (idle || shared.steady);
    const dpr = window.devicePixelRatio || 1;
    const scale = rest ? 1 : Math.min(dpr, MOVING_DPR_CAP) / dpr;
    if (tsRef) tsRef.maximumScreenSpaceError = rest ? SSE_REST : first ? SSE_FIRST : SSE_MOVING;
    if (viewer.resolutionScale !== scale) viewer.resolutionScale = scale;
  };
  shared.refreshQuality = apply;
  // moveEnd already fires after Cesium's own quiet period (scene.cameraEventWaitTime); wait out the rest.
  const quietMs = Math.max(0, IDLE_MS - ((s as unknown as { cameraEventWaitTime?: number }).cameraEventWaitTime ?? 500));
  viewer.camera.moveStart.addEventListener(() => { clearTimeout(timer); idle = false; apply(); });
  viewer.camera.moveEnd.addEventListener(() => { clearTimeout(timer); timer = setTimeout(() => { idle = true; apply(); }, quietMs); });
  apply();

  shared.tileset = C.createGooglePhotorealistic3DTileset(
    // No geocoder is attached to this viewer, so there is nothing non-Google to mix with the tiles.
    { key: GOOGLE_KEY, onlyUsingWithGoogleGeocoder: true },
    {
      maximumScreenSpaceError: SSE_FIRST, showCreditsOnScreen: true,
      dynamicScreenSpaceError: true, foveatedScreenSpaceError: true, preloadFlightDestinations: true,
    },
  ).then((ts) => {
    // Having a listener also stops Cesium from logging failed tile URLs (which include the key).
    ts.tileFailed.addEventListener(() => { shared.failedTiles++; });
    tsRef = ts;
    ts.initialTilesLoaded.addEventListener(() => { first = false; shared.loading = false; apply(); });
    s.primitives.add(ts);
    return ts;
  }, (e) => { throw tileErrorOf(e); });
  shared.tileset.catch(() => { /* surfaced by consumers */ });
  return shared;
}

/** Start Cesium, the viewer and the tileset's root request now (detached, nothing drawn) so `acquire` finds them
 *  ready. Created once per page session; React StrictMode's double mount and later navigations reuse it. */
export function warm(): Promise<Shared> {
  if (!sharedP) {
    sharedP = create();
    sharedP.catch(() => { sharedP = null; });
  }
  return sharedP;
}

/** Borrow the shared viewer and mount it into `host`. Resolves after any previous owner is detached. */
export async function acquire(host: HTMLElement, me: symbol): Promise<Shared> {
  const sh = await warm();
  owner = me;
  host.appendChild(sh.root);
  sh.viewer.useDefaultRenderLoop = true;
  sh.viewer.resize();
  return sh;
}

/** Give the viewer back: stop drawing and detach the canvas (the tileset and its session stay alive). */
export function release(sh: Shared | null, me: symbol) {
  if (!sh || owner !== me) return;
  owner = null;
  sh.viewer.useDefaultRenderLoop = false;
  sh.root.remove();
}

export const isOwner = (me: symbol) => owner === me;

// ---------------------------------------------------------------------------------------------
// Ground heights from our own 1 m lidar DEM (Terrain-RGB tiles), so our overlays never depend on
// reading Google's mesh (the Map Tiles policy rules out non-visualization use of the content).
// DEM heights are NAVD88 (orthometric); Google tiles are WGS84 ellipsoid heights. Around Allegheny
// County the geoid sits about 33.7 m below the ellipsoid, so ellipsoid height ~= orthometric - 33.7.
export const GEOID_OFFSET_M = -33.7;
const DEM_Z = 16;
const DEM_BOUNDS = [-80.37, 40.19, -79.68, 40.68];
const demTiles = new Map<string, Promise<Uint8ClampedArray | null>>();

function demTile(x: number, y: number): Promise<Uint8ClampedArray | null> {
  const k = `${x}/${y}`;
  let p = demTiles.get(k);
  if (!p) {
    p = (async () => {
      const r = await fetch(`/tiles/terrain/${DEM_Z}/${x}/${y}.webp`);
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    })().catch(() => null);
    demTiles.set(k, p);
  }
  return p;
}

/** Ellipsoid heights (m) at [lon, lat] points, or null where the DEM has no coverage. */
export async function groundHeights(pts: [number, number][]): Promise<(number | null)[]> {
  const n = 2 ** DEM_Z, size = 512;
  return Promise.all(pts.map(async ([lon, lat]) => {
    if (lon < DEM_BOUNDS[0]! || lon > DEM_BOUNDS[2]! || lat < DEM_BOUNDS[1]! || lat > DEM_BOUNDS[3]!) return null;
    const fx = ((lon + 180) / 360) * n;
    const s = Math.sin((lat * Math.PI) / 180);
    const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const px = Math.min(size - 1, Math.floor((fx - tx) * size)), py = Math.min(size - 1, Math.floor((fy - ty) * size));
    const d = await demTile(tx, ty);
    if (!d) return null;
    const i = (py * size + px) * 4;
    const h = -10000 + (d[i]! * 65536 + d[i + 1]! * 256 + d[i + 2]!) * 0.1;
    return h < -500 ? null : h + GEOID_OFFSET_M;
  }));
}

/** Always light the scene with an early-afternoon sun (1 PM EDT on today's date). Google's photoreal imagery
 *  already has daylight baked in; a low real-time sun (evening) makes the whole scene look like dusk. */
export function sunTime(C: Cesium): CesiumNS.JulianDate {
  const now = new Date();
  return C.JulianDate.fromDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0)));
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
