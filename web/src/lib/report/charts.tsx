import type { ReactNode } from "react";

// Vector charts for the Feasibility Study. Hand-rolled SVG so they print crisply and render the same
// every time. No data is invented here: each chart draws exactly the values it is given.

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[];

const INK = "#1f2933";
const MUTED = "#6b7785";
const GRID = "#d9dee4";

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------------------------------------------------------------------------------------------
// Lot plan: parcel outline, buildable envelope, overlay masks, scheme footprints, north arrow, scale.

export function LotPlan({
  parcel,
  envelope,
  footprints,
  masks,
  frontEdges,
}: {
  parcel: Ring;
  envelope: Poly[];
  footprints: Ring[];
  masks: { label: string; mode: "cut" | "flag"; polygon: Poly }[];
  frontEdges: number[];
}) {
  const W = 640;
  const H = 420;
  const xs = parcel.map((p) => p[0]);
  const ys = parcel.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 36;
  const scale = Math.min((W - 2 * pad - 150) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = pad + ((W - 2 * pad - 150) - (maxX - minX) * scale) / 2;
  const oy = pad + ((H - 2 * pad) - (maxY - minY) * scale) / 2;
  const X = (x: number) => ox + (x - minX) * scale;
  const Y = (y: number) => oy + (maxY - y) * scale;
  const path = (r: Ring) => r.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ") + " Z";
  const n = parcel.length;

  // Scale bar: a round number of feet near 1/4 of the drawing width.
  const target = (maxX - minX) / 3;
  const nice = [5, 10, 20, 25, 50, 100, 200].reduce((b, v) => (Math.abs(v - target) < Math.abs(b - target) ? v : b), 10);
  const sbx = W - 150 - pad + 10;
  const legendX = W - 150;

  const legend: { swatch: ReactNode; label: string }[] = [
    { swatch: <rect width="14" height="10" fill="none" stroke="#8a6d1d" strokeWidth="2" />, label: "Lot line" },
    { swatch: <line x1="0" y1="5" x2="14" y2="5" stroke={INK} strokeWidth="4" />, label: "Street frontage" },
    { swatch: <rect width="14" height="10" fill="#2f855a" fillOpacity="0.18" stroke="#2f855a" strokeDasharray="3 2" />, label: "Buildable area" },
    ...(masks.some((mm) => mm.mode === "flag") ? [{ swatch: <rect width="14" height="10" fill="#c05621" fillOpacity="0.22" />, label: "Review overlay" }] : []),
    ...(masks.some((mm) => mm.mode === "cut") ? [{ swatch: <rect width="14" height="10" fill="#2b6cb0" fillOpacity="0.25" />, label: "Removed (floodway)" }] : []),
    ...(footprints.length ? [{ swatch: <rect width="14" height="10" fill="#234e70" />, label: "Scheme footprint" }] : []),
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Plan of the lot, its buildable area and the studied footprint" style={{ fontFamily: "inherit" }}>
      <rect x="0" y="0" width={W} height={H} fill="#fbfaf7" />
      {masks.map((mm, i) =>
        mm.polygon.map((r, j) => (
          <path key={`m${i}-${j}`} d={path(r)} fill={mm.mode === "cut" ? "#2b6cb0" : "#c05621"} fillOpacity={mm.mode === "cut" ? 0.25 : 0.14} stroke="none" />
        )),
      )}
      {envelope.map((poly, i) =>
        poly.map((r, j) => <path key={`e${i}-${j}`} d={path(r)} fill="#2f855a" fillOpacity="0.16" stroke="#2f855a" strokeDasharray="5 3" strokeWidth="1.2" />),
      )}
      <path d={path(parcel)} fill="none" stroke="#8a6d1d" strokeWidth="2.2" />
      {frontEdges.map((i) => {
        const a = parcel[i]!;
        const b = parcel[(i + 1) % n]!;
        return <line key={`f${i}`} x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} stroke={INK} strokeWidth="5" strokeLinecap="round" />;
      })}
      {footprints.map((r, i) => (
        <path key={`u${i}`} d={path(r)} fill="#234e70" fillOpacity={0.85} stroke="#fff" strokeWidth="1" />
      ))}
      {/* north arrow (the lot coordinates are State Plane, north up) */}
      <g transform={`translate(${pad - 8}, ${pad - 6})`}>
        <path d="M8 0 L14 18 L8 14 L2 18 Z" fill={INK} />
        <text x="8" y="30" fontSize="11" textAnchor="middle" fill={INK} fontWeight="600">N</text>
      </g>
      {/* scale bar */}
      <g transform={`translate(${sbx - nice * scale}, ${H - 18})`}>
        <rect x="0" y="-6" width={nice * scale} height="5" fill={INK} />
        <text x="0" y="-10" fontSize="10" fill={MUTED}>0</text>
        <text x={nice * scale} y="-10" fontSize="10" fill={MUTED} textAnchor="end">{nice} ft</text>
      </g>
      {/* legend */}
      <g transform={`translate(${legendX}, ${pad})`}>
        {legend.map((l, i) => (
          <g key={l.label} transform={`translate(0, ${i * 22})`}>
            {l.swatch}
            <text x="22" y="10" fontSize="11" fill={INK}>{l.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Slope classes: one stacked bar of the lot's 1 m cells by slope class.

export function SlopeBar({ over15, over25, over40 }: { over15: number; over25: number; over40: number }) {
  const parts = [
    { label: "Under 15%", share: Math.max(0, 1 - over15), color: "#c6dbb2" },
    { label: "15–25%", share: Math.max(0, over15 - over25), color: "#e8d18a" },
    { label: "25–40%", share: Math.max(0, over25 - over40), color: "#d9894a" },
    { label: "Over 40%", share: Math.max(0, over40), color: "#a33a26" },
  ];
  const W = 640;
  const barW = 600;
  let x = 20;
  const lineX = 20 + (1 - over25) * barW;
  return (
    <svg viewBox={`0 0 ${W} 110`} width="100%" role="img" aria-label="Share of the lot in each slope class">
      {parts.map((p) => {
        const w = p.share * barW;
        const el = (
          <g key={p.label}>
            <rect x={x} y="18" width={w} height="34" fill={p.color} />
            {w > 44 && (
              <text x={x + w / 2} y="40" fontSize="13" textAnchor="middle" fill={p.label === "Over 40%" ? "#fff" : INK} fontWeight="600">
                {fmt(p.share * 100)}%
              </text>
            )}
          </g>
        );
        x += w;
        return el;
      })}
      <line x1={lineX} y1="12" x2={lineX} y2="58" stroke={INK} strokeDasharray="3 2" />
      <text x={lineX} y="9" fontSize="10" textAnchor={lineX > W - 70 ? "end" : lineX < 70 ? "start" : "middle"} fill={INK}>
        25% slope: {fmt(over25 * 100)}% of the lot is steeper
      </text>
      {parts.map((p, i) => (
        <g key={`k${p.label}`} transform={`translate(${20 + i * 150}, 78)`}>
          <rect width="12" height="12" fill={p.color} />
          <text x="18" y="10" fontSize="11" fill={INK}>{p.label}: {fmt(p.share * 100, 1)}%</text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Sales comps: price per sq ft by sale date, with the median line.

export function CompsScatter({ comps, median }: { comps: { date: string; ppsf: number }[]; median: number | null }) {
  const W = 640;
  const H = 240;
  const L = 56;
  const R = 16;
  const T = 14;
  const B = 34;
  const pts = comps.filter((c) => Number.isFinite(c.ppsf));
  if (pts.length === 0) return null;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const t0 = Math.min(...pts.map((p) => t(p.date)));
  const t1 = Math.max(...pts.map((p) => t(p.date)));
  const vmax = Math.max(...pts.map((p) => p.ppsf), median ?? 0) * 1.1;
  const X = (d: string) => L + ((t(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / vmax) * (H - T - B);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => vmax / s <= 6) ?? 500;
  const ticks = Array.from({ length: Math.floor(vmax / step) + 1 }, (_, i) => i * step);
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((y) => t(`${y}-01-01`) >= t0 && t(`${y}-01-01`) <= t1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sale price per square foot of comparable sales over time">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke={GRID} />
          <text x={L - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" fill={MUTED}>${v}</text>
        </g>
      ))}
      {years.map((y) => (
        <text key={y} x={X(`${y}-01-01`)} y={H - 12} fontSize="10" textAnchor="middle" fill={MUTED}>{y}</text>
      ))}
      <text x="12" y={T + (H - T - B) / 2} fontSize="10" fill={MUTED} transform={`rotate(-90 12 ${T + (H - T - B) / 2})`} textAnchor="middle">$ per sq ft</text>
      {median !== null && (
        <g>
          <line x1={L} x2={W - R} y1={Y(median)} y2={Y(median)} stroke="#234e70" strokeDasharray="6 3" strokeWidth="1.5" />
          <text x={W - R} y={Y(median) - 5} fontSize="10" textAnchor="end" fill="#234e70">median ${fmt(median, median < 100 ? 2 : 0)}</text>
        </g>
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={X(p.date)} cy={Y(p.ppsf)} r="4" fill="#b7791f" fillOpacity="0.8" stroke="#fff" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Process sequence: phases in order, with the count of required and likely items in each.
// Durations are not drawn because no review-time data is loaded yet.

export function PhaseSequence({ phases }: { phases: { label: string; required: number; likely: number; other: number }[] }) {
  const W = 640;
  const H = 104;
  const gap = 8;
  const bw = (W - gap * (phases.length - 1)) / phases.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Project phases in order with counts of required items">
      {phases.map((p, i) => {
        const x = i * (bw + gap);
        return (
          <g key={p.label} transform={`translate(${x}, 10)`}>
            <path d={`M0 0 H${bw - 10} L${bw} 26 L${bw - 10} 52 H0 ${i ? `L10 26 Z` : "Z"}`} fill={p.required ? "#234e70" : "#9fb3c8"} />
            {p.label.split("\n").map((ln, k, all) => (
              <text key={k} x={bw / 2 + 3} y={30 + (k - (all.length - 1) / 2) * 12} fontSize="10.5" textAnchor="middle" fill="#fff" fontWeight="600">{ln}</text>
            ))}
            <text x={bw / 2} y="72" fontSize="11" textAnchor="middle" fill={INK}>{p.required} required</text>
            <text x={bw / 2} y="88" fontSize="10" textAnchor="middle" fill={MUTED}>{p.likely} likely · {p.other} other</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Sensitivity chart frame. With no cost data there are no bars to draw, so it lists the variables
// that will be tested and says so, instead of drawing made-up bars.

export function TornadoPending({ variables }: { variables: string[] }) {
  const W = 640;
  const rowH = 26;
  const H = 40 + variables.length * rowH;
  const cx = 360;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sensitivity chart awaiting cost data">
      <line x1={cx} x2={cx} y1="8" y2={H - 8} stroke={INK} />
      {variables.map((v, i) => (
        <g key={v} transform={`translate(0, ${20 + i * rowH})`}>
          <text x="10" y="14" fontSize="11.5" fill={INK}>{v}</text>
          <rect x={cx - 150} y="2" width="300" height="16" fill="none" stroke={GRID} strokeDasharray="4 3" />
        </g>
      ))}
      <rect x={cx - 150} y={H / 2 - 16} width="300" height="28" fill="#fff" stroke={GRID} />
      <text x={cx} y={H / 2 + 3} fontSize="12" textAnchor="middle" fill={MUTED} fontStyle="italic">No bars yet: awaiting local cost data</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Tornado: how far the result moves when each assumption is moved low and high.

export function Tornado({ rows, base, money }: { rows: { label: string; lowLabel: string; highLabel: string; valueAtLow: number | null; valueAtHigh: number | null }[]; base: number; money: (n: number) => string }) {
  const W = 640;
  const rowH = 30;
  const H = 48 + rows.length * rowH;
  const x0 = 200;
  const x1 = W - 20;
  const vals = rows.flatMap((r) => [r.valueAtLow, r.valueAtHigh]).filter((v): v is number => v !== null);
  const lo = Math.min(base, ...vals);
  const hi = Math.max(base, ...vals);
  const span = hi - lo || 1;
  const X = (v: number) => x0 + ((v - lo) / span) * (x1 - x0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Which assumption matters most">
      <line x1={X(base)} x2={X(base)} y1="14" y2={H - 20} stroke={INK} />
      <text x={X(base)} y="10" fontSize="10" textAnchor="middle" fill={MUTED}>base {money(base)}</text>
      {rows.map((r, i) => {
        const y = 22 + i * rowH;
        const a = r.valueAtLow ?? base;
        const b = r.valueAtHigh ?? base;
        return (
          <g key={r.label}>
            <text x="8" y={y + 13} fontSize="11" fill={INK}>{r.label}</text>
            {r.valueAtLow !== null && <rect x={Math.min(X(a), X(base))} y={y + 2} width={Math.max(1, Math.abs(X(a) - X(base)))} height="14" fill="#c4d3e0" />}
            {r.valueAtHigh !== null && <rect x={Math.min(X(b), X(base))} y={y + 2} width={Math.max(1, Math.abs(X(b) - X(base)))} height="14" fill="#234e70" />}
            <text x={x0 - 6} y={y + 26} fontSize="8.5" textAnchor="end" fill={MUTED}>{r.lowLabel} / {r.highLabel}</text>
          </g>
        );
      })}
      <text x={x0} y={H - 6} fontSize="9" fill={MUTED}>{money(lo)}</text>
      <text x={x1} y={H - 6} fontSize="9" textAnchor="end" fill={MUTED}>{money(hi)}</text>
    </svg>
  );
}
