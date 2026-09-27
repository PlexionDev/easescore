// QuickFit v2 in the app: the solver's input from the pane (same data on the server and in the browser
// worker, so both give the same Scheme), the map controls <-> URL, and the adapters to the pro forma.
// Pure: no I/O, no clock.

import { score } from "@easescore/engine";
import {
  DEFAULT_CONTROLS, scoreFits, solveAll, solveApp, steppingOf, toParcelInput, toV1Scheme, unknownUses,
  type AppControls, type AppParking, type AppSources, type QfParcel, type ReliefCounts,
} from "@easescore/engine/src/quickfit2/app";
import type { EdgeKind, ParcelInput, Pt, Ring, Scheme, Typology } from "@easescore/engine/src/quickfit2/src/types";
import type { TerrainGrid } from "@/lib/terrain-grid";

export type { AppControls, AppParking, AppSources, ParcelInput, Scheme, Typology, EdgeKind, Pt, Ring };
export { DEFAULT_CONTROLS, solveAll, solveApp, steppingOf, toParcelInput, toV1Scheme, unknownUses };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Building types in the order the controls show them. */
export const QF2_TYPES: { id: Typology; label: string; short: string; strategy: score.StrategyId }[] = [
  { id: "single_detached", label: "Single-family house", short: "House", strategy: "new_sf" },
  { id: "two_unit", label: "Duplex", short: "Duplex", strategy: "duplex" },
  { id: "three_four", label: "3–4 unit building", short: "3–4 units", strategy: "three_four_unit" },
  { id: "townhouse_row", label: "Townhouse row", short: "Townhouses", strategy: "townhouse_row" },
  { id: "adu", label: "Backyard cottage (ADU)", short: "ADU", strategy: "adu" },
];
export const typeOf = (t: Typology) => QF2_TYPES.find((x) => x.id === t)!;
export const typologyForStrategy = (s: score.StrategyId | null | undefined): Typology | null => QF2_TYPES.find((x) => x.strategy === s)?.id ?? null;

export const STATUS_WORDS: Record<Scheme["status"], string> = {
  allowed_by_right: "Allowed", needs_approval: "Needs approval", not_allowed: "Not allowed", does_not_fit: "Doesn't fit",
};

/** Everything the solver needs for one parcel, all serializable (the worker gets this once). */
export interface Qf2Data {
  parid: string;
  qf: QfParcel;
  zoneCode: string | null;
  rules: AppSources["rules"];
  terrain: TerrainGrid | null;
  zba: { by_relief?: Record<string, ReliefCounts> } | null;
  zbaCitywide: Record<string, ReliefCounts> | null;
  existing: Ring[];
}

/** The pane's data for the solver. Zoning rules are used for City parcels only (as the score does). */
export function qf2Data(a: { parid: string; qf: Json; facts: Json; terrain: TerrainGrid | null; zba: Json; zbaCitywide?: Json; existing?: Ring[] }): Qf2Data | null {
  const q = a.qf;
  if (!q || !Array.isArray(q.parcel) || q.parcel.length < 3) return null;
  const f = a.facts ?? {};
  const city = score.isCityParcel(f);
  return {
    parid: a.parid,
    qf: { parcel: q.parcel, edges: q.edges ?? [], frontEdges: q.frontEdges ?? [], streetSideEdges: q.streetSideEdges ?? [], masks: q.masks ?? [] },
    zoneCode: city ? (f.zoning?.code ?? null) : null,
    rules: city ? (f.zoning?.rules ?? null) : null,
    terrain: a.terrain ?? null,
    zba: a.zba ?? null,
    zbaCitywide: a.zbaCitywide ?? null,
    existing: a.existing ?? [],
  };
}

export const sourcesOf = (d: Qf2Data, frontEdgeIndex?: number | null): AppSources => ({ ...d, frontEdgeIndex: frontEdgeIndex ?? null });

// ------------------------------------------------------------------------------------ controls <-> URL

const Q_TYPE: Record<Typology, string> = { single_detached: "sf", two_unit: "duplex", three_four: "plex", townhouse_row: "townhouse", adu: "adu" };
const FROM_Q: Record<string, Typology> = Object.fromEntries(Object.entries(Q_TYPE).map(([k, v]) => [v, k as Typology]));
/** URL keys the controls use (a scenario / report reads the same keys). */
export const QF2_KEYS = ["qf", "qf_st", "qf_w", "qf_d", "qf_pk", "qf_f", "qf_s", "qf_r", "qf_ss", "qf_fe"] as const;
const SB_KEY: Record<EdgeKind, string> = { front: "qf_f", side: "qf_s", rear: "qf_r", streetSide: "qf_ss" };

export function controlsToQuery(c: AppControls): Record<string, string> {
  const q: Record<string, string> = { qf: Q_TYPE[c.typology] };
  if (c.stories != null) q.qf_st = String(c.stories);
  if (c.unitWidthFt != null) q.qf_w = String(c.unitWidthFt);
  if (c.depthFt != null) q.qf_d = String(c.depthFt);
  if (c.parking !== "auto") q.qf_pk = c.parking;
  for (const [k, v] of Object.entries(c.setbacks) as [EdgeKind, number][]) if (v != null) q[SB_KEY[k]] = String(v);
  if (c.frontEdgeIndex != null) q.qf_fe = String(c.frontEdgeIndex);
  return q;
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || !Number.isFinite(Number(s))) return null;
  return Math.max(lo, Math.min(hi, Math.round(Number(s))));
};

/** Controls from the URL when they are for this building type; null otherwise (= its default layout). */
export function controlsFromQuery(sp: Record<string, string | string[] | undefined>, t: Typology): AppControls | null {
  const qt = typeof sp.qf === "string" ? FROM_Q[sp.qf] : undefined;
  if (qt !== t) return null;
  const pk = typeof sp.qf_pk === "string" && ["none", "pad", "tuck"].includes(sp.qf_pk) ? (sp.qf_pk as AppParking) : "auto";
  const setbacks: AppControls["setbacks"] = {};
  for (const [k, key] of Object.entries(SB_KEY) as [EdgeKind, string][]) { const v = num(sp[key], 0, 100); if (v != null) setbacks[k] = v; }
  return {
    typology: t, stories: num(sp.qf_st, 1, 6), unitWidthFt: num(sp.qf_w, 10, 80), depthFt: num(sp.qf_d, 16, 90), parking: pk, setbacks,
    frontEdgeIndex: num(sp.qf_fe, 0, 500),
  };
}

export const sameControls = (a: AppControls | null | undefined, b: AppControls | null | undefined) =>
  !!a && !!b && JSON.stringify(controlsToQuery(a)) === JSON.stringify(controlsToQuery(b));

// ------------------------------------------------------------------------------------ server helpers

/** The score's fit runner (QuickFit v2) for scoreParcel, plus the controls that reproduce each priced scheme. */
export function fitRunnerFor(d: Qf2Data) {
  // scoreParcel calls the runner for the base rules first, then once per policy unlock: keep the first.
  let defaults: Partial<Record<score.StrategyId, AppControls>> | null = null;
  const run = (rules: NonNullable<AppSources["rules"]>, opts: { contextualFrontFt?: number; probeSetbacksFt: { front: number; rear: number; side: number } }) => {
    const r = scoreFits({ ...sourcesOf(d), rules }, opts);
    defaults ??= r.controls as Partial<Record<score.StrategyId, AppControls>>;
    return { fits: r.fits as unknown as Partial<Record<score.StrategyId, score.StrategyFit>>, notes: r.notes, schemes: r.schemes as unknown as NonNullable<score.EaseScoreResult["schemes"]> };
  };
  return { run, defaults: () => defaults ?? {} };
}

/** One solve for the app: the v2 Scheme, the pro forma's scheme shape and the hillside stepping. */
export function solveFor(d: Qf2Data, c: AppControls) {
  const src = sourcesOf(d, c.frontEdgeIndex);
  const input = toParcelInput(src);
  if (!input) return null;
  const s = solveApp(input, c, unknownUses(src));
  return { input, scheme: s, v1: s.footprintWorld && s.status !== "not_allowed" ? toV1Scheme(s, input) : null, stepping: steppingOf(s) };
}

/** Plain summary of a scheme for a screen reader and the "Describe this view" text. */
export function describeScheme(s: Scheme): string {
  if (!s.footprintWorld) return `${s.typologyLabel}: ${STATUS_WORDS[s.status]}. ${s.statusSentence}`;
  const g = s.ground;
  const levels = g ? new Set(g.steps.map((x) => x.elevFt)).size : 1;
  return [
    `${s.typologyLabel}: ${STATUS_WORDS[s.status]}.`,
    `${s.units.length} home${s.units.length === 1 ? "" : "s"}, ${s.stories} stor${s.stories === 1 ? "y" : "ies"}, footprint ${s.widthFt} by ${s.depthFt} feet, ${s.grossSqft.toLocaleString("en-US")} square feet gross, ${s.heightFt} feet tall.`,
    `Parking: ${s.parking.count} of ${s.parking.required} required (${s.parking.type.replace(/_/g, " ")}).`,
    g ? `Ground under the building slopes ${g.slopePct ?? 0}%; ${levels > 1 ? `floors step ${levels - 1} time${levels > 2 ? "s" : ""}` : "floors are level"}.` : "",
    s.bindingConstraint?.sentence ?? "",
  ].filter(Boolean).join(" ");
}
