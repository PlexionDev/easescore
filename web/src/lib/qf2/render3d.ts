// Clay model of a QuickFit v2 Scheme in three.js: level floors with one-story steps, continuous driveways
// with curb cuts, garage doors, windows in unit bays, parapets or gables, the lidar ground with 2 ft
// contours (10 ft index), and neighboring houses as context. Ported from the QuickFit v2 harness
// (harness/render3d.ts, delivered with the solver) with three changes for the app: one renderer per
// canvas (no module singleton) that is disposed on unmount, renders only when something changed, and
// orbit / zoom methods so keyboard controls and buttons can drive the camera.

import * as THREE from "three";
import type { Pt, Ring, Scheme } from "./core";

export interface Scene3dInput {
  /** Ground elevation (ft NAVD88) at world (lot-local) feet; null = flat. */
  elevAt: ((x: number, y: number) => number) | null;
  /** Neighboring buildings (world feet) as clay context. */
  neighbors: { footprint: Ring; heightFt?: number }[];
}
export interface SceneDebug { localRing: Pt[]; buildable?: Pt[][][] | null }

function marching(E: (x: number, y: number) => number, x0: number, y0: number, x1: number, y1: number, step: number, interval: number) {
  const segs: { a: number[]; b: number[]; z: number }[] = [];
  const nx = Math.ceil((x1 - x0) / step), ny = Math.ceil((y1 - y0) / step);
  const Z: number[][] = [];
  for (let j = 0; j <= ny; j++) { Z[j] = []; for (let i = 0; i <= nx; i++) Z[j]![i] = E(x0 + i * step, y0 + j * step); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => ({ x: x0 + a! * step, y: y0 + b! * step, z: Z[b!]![a!]! }));
    const lo = Math.min(...c.map((p) => p.z)), hi = Math.max(...c.map((p) => p.z));
    for (let lv = Math.ceil(lo / interval) * interval; lv <= hi; lv += interval) {
      const pts: number[][] = [];
      for (let k = 0; k < 4; k++) { const p = c[k]!, q = c[(k + 1) % 4]!; if ((p.z - lv) * (q.z - lv) < 0) { const t = (lv - p.z) / (q.z - p.z); pts.push([p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t]); } }
      if (pts.length >= 2) segs.push({ a: pts[0]!, b: pts[1]!, z: lv });
      if (pts.length === 4) segs.push({ a: pts[2]!, b: pts[3]!, z: lv });
    }
  }
  return segs;
}

export class ClayView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private group: THREE.Group | null = null;
  private theta = 1.2;
  private phi = 1.08;
  private dist = 175;
  private target = new THREE.Vector3();
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  /** Camera distance that frames the lot (set on the first draw of a parcel; Reset returns to it). */
  private fitDist = 175;
  private lotKey = "";

  constructor(private el: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(el.clientWidth || 1, el.clientHeight || 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    el.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.scene.background = new THREE.Color(0xe6eaec);
    this.scene.fog = new THREE.Fog(0xe6eaec, 420, 950);
    this.cam = new THREE.PerspectiveCamera(35, (el.clientWidth || 1) / (el.clientHeight || 1), 1, 3000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b8, 0.62 * Math.PI));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.05 * Math.PI);
    sun.position.set(-160, 260, 140);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 900 });
    this.scene.add(sun);
    this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.22 * Math.PI);
    fill.position.set(180, 120, -120);
    this.scene.add(fill);

    // Pointer orbit (mouse and one finger), wheel / pinch-free zoom via buttons.
    let drag = false, px = 0, py = 0;
    const cv = renderer.domElement;
    const down = (e: PointerEvent) => { drag = true; px = e.clientX; py = e.clientY; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag) return; this.orbit(-(e.clientX - px) * 0.008, -(e.clientY - py) * 0.008); px = e.clientX; py = e.clientY; };
    const up = () => { drag = false; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.zoom(1 + e.deltaY * 0.001); };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => { cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up); cv.removeEventListener("wheel", wheel); });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    const loop = () => { this.raf = requestAnimationFrame(loop); if (this.dirty) this.draw(); };
    loop();
  }

  orbit(dTheta: number, dPhi: number) { this.theta += dTheta; this.phi = Math.max(0.25, Math.min(1.42, this.phi + dPhi)); this.dirty = true; }
  zoom(f: number) { this.dist = Math.max(60, Math.min(700, this.dist * f)); this.dirty = true; }
  reset() { this.theta = 1.2; this.phi = 1.08; this.dist = this.fitDist; this.dirty = true; }
  /** PNG of the current view (for the report / screenshots). */
  snapshot(): string { this.draw(); return this.renderer.domElement.toDataURL("image/png"); }

  private resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.dirty = true;
  }

  private draw() {
    this.dirty = false;
    const t = this.target;
    this.cam.position.set(t.x + this.dist * Math.sin(this.phi) * Math.cos(this.theta), t.y + this.dist * Math.cos(this.phi), t.z + this.dist * Math.sin(this.phi) * Math.sin(this.theta));
    this.cam.lookAt(t);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clear() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.group = null;
  }

  /** Draw the scheme (or only the lot when nothing fits). */
  update(s: Scheme, input: Scene3dInput, debug: SceneDebug) {
    this.clear();
    const G = new THREE.Group();
    this.group = G;
    this.scene.add(G);
    this.dirty = true;
    const f = s.frame;
    const toW = (x: number, y: number): [number, number] => [f.origin[0] + f.ux[0] * x + f.uy[0] * y, f.origin[1] + f.ux[1] * x + f.uy[1] * y];
    const toL = (p: number[]) => { const q = [p[0]! - f.origin[0], p[1]! - f.origin[1]]; return [q[0]! * f.ux[0] + q[1]! * f.ux[1], q[0]! * f.uy[0] + q[1]! * f.uy[1]]; };
    const ring = debug.localRing;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of ring) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
    const Eraw = (x: number, y: number) => (input.elevAt ? input.elevAt(...toW(x, y)) : 0);
    // Frame the whole lot plus the street on the first draw of a parcel (the visitor's zoom is kept after that).
    const key = `${s.parcelId}|${ring.length}|${Math.round(minx)}|${Math.round(maxy)}`;
    if (key !== this.lotKey) { this.lotKey = key; this.fitDist = Math.max(120, Math.min(650, 1.9 * Math.max(maxx - minx, maxy - miny + 40))); this.dist = this.fitDist; }
    const site = s.site as unknown as ({ parking: { streetGrade?: number; drives: { x: number; y: number; w: number; d: number }[]; stalls: { x: number; y: number; w: number; d: number }[]; garages: unknown[]; curbCuts: [number, number][] }; segments: { x0: number; x1: number; y0: number; y1: number; floorElev: number; unitIdx?: number }[]; openings: { kind: string; face: string; x: number; y: number; z: number; w: number; h: number }[] }) | undefined;
    const street = site?.parking?.streetGrade ?? Eraw((minx + maxx) / 2, 0);
    const base = street;
    const E0 = (x: number, y: number) => (y < 0 ? Math.min(Eraw(x, y), Eraw(x, 0)) : Eraw(x, y)) - base;
    const carve: { x: number; y: number; w: number; d: number; z: number }[] = [];
    if (site) {
      const sgz = site.parking.streetGrade;
      for (const dv of site.parking.drives) carve.push({ x: dv.x - 0.5, y: Math.max(0, dv.y), w: dv.w + 1, d: dv.d, z: (sgz != null ? sgz : Eraw(dv.x + dv.w / 2, 0)) - base });
      for (const sg of site.segments) carve.push({ x: sg.x0 - 1.5, y: sg.y0 - 1.5, w: sg.x1 - sg.x0 + 3, d: sg.y1 - sg.y0 + 3, z: sg.floorElev - base - 0.2 });
    }
    const E = (x: number, y: number) => { let z = E0(x, y); for (const c of carve) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.d) z = Math.min(z, c.z); return z; };
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
    const mat = (c: number, rough = 0.95) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
    const CLAY = mat(0xf2efe9), CLAY_ROOF = mat(0xe7e3db), PLINTH = mat(0xd3cdc1), CONTEXT = mat(0xd4d0c7), CONTEXT_ROOF = mat(0xbdb7ac);
    const GLASS = new THREE.MeshStandardMaterial({ color: 0x8fa6b2, roughness: 0.25, metalness: 0.15 }), DOOR = mat(0x9c907e), GAR = mat(0xb7b1a6);
    const box = (x: number, y: number, w: number, d: number, z0: number, h: number, m: THREE.Material, cast = true) => {
      const mm = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)), m);
      mm.position.copy(P(x + w / 2, y + d / 2, z0 + h / 2)); mm.castShadow = cast; mm.receiveShadow = true; G.add(mm); return mm;
    };
    // terrain
    const m = 70, x0 = minx - m, x1 = maxx + m, y0 = -60, y1 = maxy + m, step = 3;
    const gx = Math.ceil((x1 - x0) / step), gy = Math.ceil((y1 - y0) / step);
    const geo = new THREE.PlaneGeometry(gx * step, gy * step, gx, gy);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    const cols: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + (x0 + x1) / 2, ly = -pos.getZ(i) + (y0 + y1) / 2;
      pos.setX(i, lx); pos.setZ(i, -ly);
      const z = E(lx, ly); pos.setY(i, z - 0.15);
      const g = Math.max(0, Math.min(1, (z + 10) / 60));
      cols.push(0.78 - 0.05 * g, 0.80 - 0.03 * g, 0.72 - 0.05 * g);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const ter = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ter.receiveShadow = true;
    G.add(ter);
    // contours (2 ft, index every 10 ft)
    const cs = marching((x, y) => E(x, y), x0, 2, x1, y1, 3, 2);
    const minor: number[] = [], major: number[] = [];
    for (const c of cs) (Math.round(c.z + base) % 10 === 0 ? major : minor).push(c.a[0]!, c.z + 0.08, -c.a[1]!, c.b[0]!, c.z + 0.08, -c.b[1]!);
    for (const [arr, col, op] of [[minor, 0xa79f90, 0.35], [major, 0x8c8474, 0.6]] as [number[], number, number][]) {
      const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      G.add(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })));
    }
    // street, curbs, walks
    const sw = x1 - x0;
    box(x0, -35, sw, 30, -0.4, 0.4, mat(0x9ea1a0), false);
    box(x0, -5, sw, 5, -0.4, 0.55, mat(0xe8e6e1), false);
    box(x0, -40, sw, 5, -0.4, 0.55, mat(0xe8e6e1), false);
    for (let x = x0 + 4; x < x1; x += 14) box(x, -20.25, 7, 0.5, 0.01, 0.05, mat(0xf5f3ec), false);
    const cuts: [number, number][] = site?.parking?.curbCuts ?? [];
    const lineOnGround = (pts: number[][], color: number, dashed = false, lift = 0.3) => {
      const dense: THREE.Vector3[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 2));
        for (let k = 0; k <= n; k++) { const x = a[0]! + (b[0]! - a[0]!) * k / n, y = a[1]! + (b[1]! - a[1]!) * k / n; dense.push(P(x, y, Math.max(E(x, y), y < 0 ? 0 : -99) + lift)); }
      }
      const g3 = new THREE.BufferGeometry().setFromPoints(dense);
      const ln = new THREE.Line(g3, dashed ? new THREE.LineDashedMaterial({ color, dashSize: 2.5, gapSize: 1.8 }) : new THREE.LineBasicMaterial({ color }));
      if (dashed) ln.computeLineDistances();
      G.add(ln);
    };
    lineOnGround(ring, 0x9a7b2f);
    if (debug.buildable) for (const poly of debug.buildable) lineOnGround(poly[0]!.slice(0, -1), 0x1f7a5c, true, 0.25);
    // neighbors (clay context, gable roofs)
    const gable = (x: number, y: number, w: number, d: number, z0: number, rise: number, m2: THREE.Material) => {
      const sh = new THREE.Shape([new THREE.Vector2(-0.6, 0), new THREE.Vector2(w + 0.6, 0), new THREE.Vector2(w / 2, rise)]);
      const rg = new THREE.ExtrudeGeometry(sh, { depth: d + 1.2, bevelEnabled: false });
      const rm = new THREE.Mesh(rg, m2); rm.position.set(x, z0, -y + 0.6); rm.scale.z = -1; rm.castShadow = true; rm.receiveShadow = true; G.add(rm);
    };
    for (const n of input.neighbors) {
      const pl = n.footprint.map(toL);
      if (pl.length < 3) continue;
      const xs = pl.map((p) => p[0]!), ys = pl.map((p) => p[1]!);
      const lx = Math.min(...xs), ly = Math.min(...ys), w = Math.max(...xs) - lx, d = Math.max(...ys) - ly;
      if (w < 4 || d < 4 || w > 200 || d > 200) continue;
      let gz = Infinity; for (const p of pl) gz = Math.min(gz, E(p[0]!, p[1]!));
      const h = Math.max(8, (n.heightFt ?? 26) - 7);
      const cb = box(lx, ly, w, d, gz - 3, h + 3, CONTEXT);
      const ce = new THREE.LineSegments(new THREE.EdgesGeometry(cb.geometry), new THREE.LineBasicMaterial({ color: 0x9d978c, transparent: true, opacity: 0.4 }));
      ce.position.copy(cb.position); G.add(ce);
      gable(lx, ly, w, d, gz + h, Math.min(8, w * 0.36), CONTEXT_ROOF);
    }
    // street trees (skip curb cuts)
    for (let x = x0 + 10; x < x1 - 5; x += 26) {
      if (cuts.some(([a, b]) => x > a - 4 && x < b + 4)) continue;
      if (x > minx - 2 && x < maxx + 2 && site?.parking?.drives?.some((d) => x > d.x - 4 && x < d.x + d.w + 4)) continue;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 9, 6), mat(0x9b9283)); tr.position.copy(P(x, -2.5, 4.5)); tr.castShadow = true; G.add(tr);
      const cn = new THREE.Mesh(new THREE.IcosahedronGeometry(5.2, 1), mat(0xc6d0bb)); cn.position.copy(P(x, -2.5, 12)); cn.castShadow = true; cn.receiveShadow = true; G.add(cn);
    }
    if (!s.footprintLocal || !site) { this.target.set((minx + maxx) / 2, 8, -(miny + maxy) / 2); return; }
    // drives + stalls, with retaining walls where the drive is cut into the hill
    for (const d of site.parking.drives) {
      const z = site.parking.streetGrade != null ? 0 : E(d.x + d.w / 2, 0);
      box(d.x, d.y, d.w, d.d, z - 0.3, 0.32, mat(0xc4c6c3), false);
      for (let y = Math.max(0, d.y); y < d.y + d.d - 1; y += 2) for (const sx of [d.x - 1.2, d.x + d.w + 0.6]) { const hgt = E0(sx + 0.3, y + 1) - z; if (hgt > 0.6) box(sx, y, 0.6, 2, z, hgt, PLINTH); }
    }
    for (const st of site.parking.stalls.filter((x) => !site.parking.garages.includes(x))) { const z = E(st.x + st.w / 2, st.y + st.d / 2); box(st.x, st.y, st.w, st.d, z - 0.1, 0.25, mat(0xc4c6c3), false); }
    // building: one clay volume per segment, plinth, roof
    const flat = s.typology === "townhouse_row" || s.typology === "three_four" || s.widthFt > 30;
    const F = 10, H = s.stories * F;
    for (const sg of site.segments) {
      const w = sg.x1 - sg.x0, d = sg.y1 - sg.y0, z0 = sg.floorElev - base;
      let gmin = Infinity; for (let x = sg.x0; x <= sg.x1; x += 2) for (let y = sg.y0; y <= sg.y1; y += 2) gmin = Math.min(gmin, E(x, y));
      if (gmin < z0 - 0.2) box(sg.x0 + 0.15, sg.y0 + 0.15, w - 0.3, d - 0.3, gmin - 1, z0 - gmin + 1, PLINTH);
      const body = box(sg.x0, sg.y0, w, d, z0, H, CLAY);
      const eg = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0x8e887d, transparent: true, opacity: 0.55 }));
      eg.position.copy(body.position); G.add(eg);
      for (let k = 1; k < s.stories; k++) box(sg.x0 - 0.05, sg.y0 - 0.12, w + 0.1, 0.12, z0 + k * F - 0.15, 0.3, mat(0xe2ddd4), false);
      if (flat) {
        box(sg.x0 - 0.3, sg.y0 - 0.3, w + 0.6, d + 0.6, z0 + H, 0.35, CLAY_ROOF);
        for (const [px, py, pw, pd] of [[sg.x0 - 0.3, sg.y0 - 0.3, w + 0.6, 0.8], [sg.x0 - 0.3, sg.y1 - 0.5, w + 0.6, 0.8], [sg.x0 - 0.3, sg.y0, 0.8, d], [sg.x1 - 0.5, sg.y0, 0.8, d]] as number[][]) box(px!, py!, pw!, pd!, z0 + H, 2.2, CLAY_ROOF);
      } else gable(sg.x0, sg.y0, w, d, z0 + H, Math.min(9, w * 0.38), CLAY_ROOF);
    }
    if (s.typology === "townhouse_row") for (const sg of site.segments.slice(1)) {
      const prev = sg.unitIdx != null ? site.segments[sg.unitIdx - 1] : undefined;
      const z0 = Math.max(sg.floorElev, prev?.floorElev ?? sg.floorElev) - base;
      box(sg.x0 - 0.3, sg.y0 - 0.5, 0.6, sg.y1 - sg.y0 + 1, z0, H + 2.4, mat(0xe0dbd2));
    }
    // openings
    for (const o of site.openings) {
      const m2 = o.kind === "window" ? GLASS : o.kind === "door" ? DOOR : GAR;
      const zz = o.z - base;
      if (o.face === "front" || o.face === "rear") {
        const y = o.face === "front" ? o.y - 0.08 : o.y - 0.04;
        box(o.x, y, o.w, 0.12, zz, o.h, m2, false);
        if (o.kind === "window") box(o.x - 0.25, y - 0.02, o.w + 0.5, 0.1, zz - 0.35, 0.3, mat(0xfbfaf6), false);
        if (o.kind === "garage") for (let k = 1; k < 4; k++) box(o.x, y - 0.03, o.w, 0.05, zz + k * o.h / 4, 0.08, mat(0xc9c4ba), false);
      } else { const x = o.face === "left" ? o.x - 0.08 : o.x - 0.04; box(x, o.y, 0.12, o.w, zz, o.h, m2, false); }
      if (o.kind === "door" && o.face === "front") {
        const gz = E(o.x + o.w / 2, o.y - 3), top = zz;
        if (top - gz > 0.4) { for (let k = 0; k < Math.min(8, Math.ceil((top - gz) / 0.6)); k++) box(o.x - 1, o.y - 1.1 - k * 0.9, o.w + 2, 0.9, gz + k * 0.6 - 0.3, top - gz - k * 0.6 + 0.3 > 0 ? 0.6 : 0.3, PLINTH); }
        else box(o.x - 1.2, o.y - 3, o.w + 2.4, 3, top - 0.35, 0.35, PLINTH);
      }
    }
    const fl = s.footprintLocal;
    this.target.set((fl[0]![0] + fl[1]![0]) / 2, H * 0.35 + (site.segments[0]!.floorElev - base), -(fl[0]![1] + fl[2]![1]) / 2 + 6);
  }
}
