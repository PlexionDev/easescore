// Policy Analyst seat: shared types and pure helpers (client and server).
// Headline ranges, the fiscal ledger and goal seek are computed here from one lever state's summary
// (public.policy_summary) and the stored inputs (public.policy_meta). No number is invented: every
// value traces to a row, a stored input or a labeled assumption.

import {
  annualTax, ledger, normalize, OFF, parseKey, stateKey, activeLevers, LEVER_LABEL, TRANSIT_M,
  type Abatement, type LedgerRow, type LeverState, type TaxBody, type Triple,
} from "@easescore/engine/src/policy/index";

export { normalize, OFF, parseKey, stateKey, activeLevers, LEVER_LABEL, TRANSIT_M, type LeverState, type Triple };

export interface HoodRow { neighborhood: string; parcels: number; homes: number; newly: number; homes_pencil: number | null }

export interface Summary {
  key: string;
  eligible: number;
  parcels_gaining: number;
  newly_buildable: number;
  newly_no_split?: number;
  homes: number;
  homes_no_split?: number;
  homes_lost: number;
  homes_pencil: Triple;
  parcels_pencil: Triple;
  no_value_data: number;
  av_delta: Triple;
  av_before_gaining: number;
  by_neighborhood: HoodRow[];
  by_levers: { levers: string; parcels: number; homes: number }[];
  by_strategy?: Record<string, number>;
  computed_at: string | null;
  parcels_seen?: number;
  skipped?: number;
  buckets?: string;
}

export interface PolicyState {
  key: string;
  status: "queued" | "running" | "done" | "partial" | "failed" | "missing";
  done: number;
  total: number | null;
  summary: Summary | null;
  computed_at: string | null;
  config_version: string | null;
  /** Queued states only: how many states the background job runs first. */
  ahead?: number;
}

export interface MillageRow { jurisdiction_type: string; code: string; name: string; mills: number | string; year: number; source_url: string }
export type { LedgerRow };

export interface PolicyMeta {
  values: Record<string, { p25: number; p50: number; p75: number; n: number; radiusMi: number | null }>;
  citywide: { p25: number; p50: number; p75: number; n: number };
  ratio: { p25: number; p50: number; p75: number; n: number };
  sales_window: { earliest: string; latest: string };
  millage: MillageRow[];
  rule: string;
  cost_basis: { costPsf: Triple; softShare: Triple; contingencyShare: number; brokerShare: number; minMargin: number };
  policy_version: string;
  computed_at?: string;
}

/** Scenario settings the page keeps in the URL (levers) plus the fiscal-only abatement lever. */
export interface Scenario {
  levers: LeverState;
  abatement: { on: boolean; sharePct: number; years: number };
}

export const DEFAULT_ABATEMENT = { on: false, sharePct: 100, years: 10 };

/** The demo default: the two levers the core path turns on. */
export const DEMO_LEVERS: LeverState = normalize({ attached: { on: true, maxWidthFt: 35 }, minLot: { on: true, share: 0 }, parking: "current" });

export function scenarioToQuery(s: Scenario): URLSearchParams {
  const q = new URLSearchParams();
  q.set("s", stateKey(s.levers));
  if (s.abatement.on) q.set("abate", `${s.abatement.sharePct}x${s.abatement.years}`);
  return q;
}

export function scenarioFromQuery(q: URLSearchParams | Record<string, string | string[] | undefined>): Scenario {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : typeof q[k] === "string" ? (q[k] as string) : null);
  const s = get("s");
  const levers = s ? parseKey(s) : DEMO_LEVERS;
  const m = /^(\d{1,3})x(\d{1,2})$/.exec(get("abate") ?? "");
  const abatement = m ? { on: true, sharePct: Math.min(100, Number(m[1])), years: Math.max(1, Math.min(30, Number(m[2]))) } : DEFAULT_ABATEMENT;
  return { levers, abatement };
}

// ---------------------------------------------------------------------------------- headline

const ord = (a: number, b: number, c: number): Triple => {
  const [low, likely, high] = [a, b, c].sort((x, y) => x - y) as [number, number, number];
  return { low, likely, high };
};

/**
 * Additional homes allowed by right, as a range.
 * low    = homes that need no lot split (townhouse rows need a subdivision plan first);
 * likely = every home the fit test finds;
 * high   = likely plus the lots the fit test could not finish in time, at the average gain per lot tested.
 */
export function homesRange(s: Summary): Triple {
  const likely = s.homes;
  const low = s.homes_no_split ?? likely;
  const tested = Math.max(1, s.eligible);
  const extra = s.skipped ? Math.round((s.skipped * likely) / tested) : 0;
  return ord(low, likely, likely + extra);
}

export function newlyRange(s: Summary): Triple {
  const likely = s.newly_buildable;
  const low = s.newly_no_split ?? likely;
  const tested = Math.max(1, s.eligible);
  const extra = s.skipped ? Math.round((s.skipped * likely) / tested) : 0;
  return ord(low, likely, likely + extra);
}

// ---------------------------------------------------------------------------------- fiscal

const BODY_ID: Record<string, TaxBody["id"]> = { county: "county", municipality: "municipality", school_district: "school" };
const BODY_NAME: Record<string, string> = { county: "Allegheny County", municipality: "City of Pittsburgh", school_district: "Pittsburgh Public Schools" };

/** The three taxing bodies for a City parcel, latest year per body. Empty when millage is not loaded. */
export function taxBodies(meta: PolicyMeta | null): TaxBody[] {
  const out: TaxBody[] = [];
  for (const t of ["county", "municipality", "school_district"]) {
    const r = (meta?.millage ?? []).filter((m) => m.jurisdiction_type === t).sort((a, b) => b.year - a.year)[0];
    if (r) out.push({ id: BODY_ID[t]!, name: BODY_NAME[t]!, mills: Number(r.mills), year: r.year, sourceUrl: r.source_url });
  }
  return out;
}

export interface Fiscal {
  rows: LedgerRow[];
  /** Assessed value added under each row's body (school rows: only parcels in that school district). */
  av: Triple[];
  total: Triple;
  abatementTotal: Triple;
  /** Tax the lots that gain homes pay today on their current assessed value (per year, all bodies). */
  doingNothing: number;
  totalMills: number;
  abatement: Abatement | null;
}

export interface SchoolAv { name: string; school_key: string | null; mills: number | null; year: number | null; source_url: string | null; low: number; likely: number; high: number; parcels: number }
export interface Places {
  by_district: { district: number | null; parcels: number; homes: number; newly: number; homes_pencil: number | null }[];
  by_school: SchoolAv[];
}

const SCHOOL_NAME: Record<string, string> = { PITTSBURGH: "Pittsburgh Public Schools" };
const titleCase = (x: string) => x.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s*-\s*/g, "-");

/**
 * Ledger rows: County and City on all added value; each school district on the value added inside it,
 * at that district's millage (a few City parcels pay a neighboring school district). `places` comes
 * from policy_places(key); without it the City's school district rate is applied to all of it.
 */
export function fiscal(s: Summary, meta: PolicyMeta | null, abate: Scenario["abatement"], places: Places | null = null): Fiscal | null {
  const bodies = taxBodies(meta);
  if (!bodies.length) return null;
  const ab: Abatement | null = abate.on ? { share: abate.sharePct / 100, years: abate.years } : null;
  const general = bodies.filter((b) => b.id !== "school");
  const schoolRows: { body: TaxBody; av: Triple }[] = places?.by_school?.length
    ? places.by_school.filter((x, i) => x.mills != null && (i === 0 || Number(x.high) > 0)).map((x) => ({
        body: { id: "school" as const, name: SCHOOL_NAME[x.school_key ?? ""] ?? `${titleCase(x.name)} School District`, mills: Number(x.mills), year: x.year ?? 0, sourceUrl: x.source_url ?? "" },
        av: { low: Number(x.low), likely: Number(x.likely), high: Number(x.high) },
      }))
    : bodies.filter((b) => b.id === "school").map((b) => ({ body: b, av: s.av_delta }));
  const rows: LedgerRow[] = [...ledger(s.av_delta, general, ab), ...schoolRows.flatMap((x) => ledger(x.av, [x.body], ab))];
  const av: Triple[] = [...general.map(() => s.av_delta), ...schoolRows.map((x) => x.av)];
  const sum = (f: (r: LedgerRow) => Triple): Triple => ({
    low: rows.reduce((t, r) => t + f(r).low, 0), likely: rows.reduce((t, r) => t + f(r).likely, 0), high: rows.reduce((t, r) => t + f(r).high, 0),
  });
  const mainSchool = schoolRows[0]?.body.mills ?? bodies.find((b) => b.id === "school")?.mills ?? 0;
  const totalMills = general.reduce((t, b) => t + b.mills, 0) + mainSchool;
  return {
    rows, av, total: sum((r) => r.revenue), abatementTotal: sum((r) => r.abatementPerYear),
    doingNothing: annualTax(s.av_before_gaining, totalMills), totalMills, abatement: ab,
  };
}

// ---------------------------------------------------------------------------------- where

/** Share of new capacity in the top five neighborhoods, for the concentration flag. */
export function concentration(s: Summary): { top: HoodRow[]; share: number } {
  const rows = [...s.by_neighborhood].sort((a, b) => b.homes - a.homes);
  const total = rows.reduce((t, r) => t + r.homes, 0);
  const top = rows.slice(0, 5);
  return { top, share: total ? top.reduce((t, r) => t + r.homes, 0) / total : 0 };
}

// ---------------------------------------------------------------------------------- goal seek

export interface GoalOption { key: string; levers: LeverState; changes: number; homes: Triple; pencil: Triple; summary: Summary }

/** How far a state moves the rules, for ordering options with the same number of levers. */
function intensity(l: LeverState): number {
  const n = normalize(l);
  return (n.attached.on ? (n.attached.maxWidthFt - 25) / 25 : 0) + (n.minLot.on ? 1 - n.minLot.share : 0) + (n.parking === "none" ? 1 : n.parking === "transit" ? 0.5 : 0);
}

/**
 * Smallest set of rule changes, among the states already computed, whose additional homes reach the goal
 * (the low end of the range when `conservative`, else the likely value). Fewest levers first, then the
 * gentlest change, then the most homes. Returns the qualifying options in that order.
 */
export function goalSeek(states: PolicyState[], goal: number, measure: "homes" | "pencil", conservative = false): GoalOption[] {
  const opts: GoalOption[] = [];
  for (const st of states) {
    if (!st.summary || st.status !== "done" || st.key === "base") continue;
    const levers = parseKey(st.key);
    const homes = homesRange(st.summary);
    const pencil = st.summary.homes_pencil;
    const v = measure === "homes" ? homes : pencil;
    if ((conservative ? v.low : v.likely) >= goal)
      opts.push({ key: st.key, levers, changes: activeLevers(levers).length, homes, pencil, summary: st.summary });
  }
  return opts.sort((a, b) => a.changes - b.changes || intensity(a.levers) - intensity(b.levers) || b.homes.likely - a.homes.likely);
}

// ---------------------------------------------------------------------------------- words

export function leverSentence(l: LeverState): string {
  const n = normalize(l);
  const parts: string[] = [];
  if (n.attached.on) parts.push(`two attached homes by right on lots up to ${n.attached.maxWidthFt} ft wide (R1D, R1A)`);
  if (n.minLot.on) parts.push(n.minLot.share === 0 ? "no minimum lot size or lot area per unit" : `minimum lot size and lot area per unit cut to ${Math.round(n.minLot.share * 100)}% of today's`);
  if (n.parking === "transit") parts.push(`no parking minimum within ¼ mile (${TRANSIT_M} m) of frequent transit`);
  if (n.parking === "none") parts.push("no parking minimums anywhere");
  return parts.length ? parts.join("; ") : "today's rules (no change)";
}

export const LEVERS_CODE_LABEL: Record<string, string> = {
  attached: "Attached homes",
  minLot: "Lot size",
  parking: "Parking",
  "attached+minLot": "Attached + lot size",
  "minLot+parking": "Lot size + parking",
  "attached+parking": "Attached + parking",
  "attached+minLot+parking": "All three",
};
