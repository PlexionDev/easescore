// Policy Analyst seat: shared types and pure helpers (client and server).
// Headline ranges, the fiscal ledger and goal seek are computed here from one lever state's summary
// (public.policy_summary) and the stored inputs (public.policy_meta). No number is invented: every
// value traces to a row, a stored input or a labeled assumption.

import {
  annualTax, ledger, normalize, OFF, parseKey, stateKey, activeLevers, LEVER_LABEL, TRANSIT_M, ADU_RULES, CONTEXTUAL_FRONT_FT, HEIGHT_ADD, MATCH_BLOCK,
  type Abatement, type LedgerRow, type LeverState, type TaxBody, type Triple,
} from "@easescore/engine/src/policy/index";
import costs from "@easescore/engine/config/cost-assumptions.v0.2.json";

export { normalize, OFF, parseKey, stateKey, activeLevers, LEVER_LABEL, TRANSIT_M, ADU_RULES, CONTEXTUAL_FRONT_FT, HEIGHT_ADD, MATCH_BLOCK, type LeverState, type Triple };

export interface HoodRow { neighborhood: string; parcels: number; homes: number; newly: number; homes_pencil: number | null; homes_pencil_high?: number; homes_no_split?: number }

export interface Summary {
  key: string;
  eligible: number;
  parcels_gaining: number;
  newly_buildable: number;
  newly_no_split?: number;
  newly_mid?: number;
  homes: number;
  homes_no_split?: number;
  homes_mid?: number;
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
  /** "cancelled" = taken off the demo queue (never computed); "missing" = nobody requested it. */
  status: "queued" | "running" | "done" | "partial" | "failed" | "missing" | "cancelled";
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
 * low    = homes that need no extra step: no lot split (townhouse rows need a subdivision plan first) and, for
 *          ADUs, only lots where the ADU footprint check passes;
 * likely = low plus the homes that need that extra step only where the scheme pencils at high prices (where the
 *          split could pay off at all);
 * high   = every home the fit test finds.
 * Lots the fit test could not finish in time are not counted (stated in the Method tab). Summaries computed before
 * migration 115 have no homes_mid: the likely value falls back to the high end, as before.
 */
export function homesRange(s: Summary): Triple {
  const high = s.homes;
  const low = s.homes_no_split ?? high;
  return ord(low, s.homes_mid ?? high, high);
}

export function newlyRange(s: Summary): Triple {
  const high = s.newly_buildable;
  const low = s.newly_no_split ?? high;
  return ord(low, s.newly_mid ?? high, high);
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
  /** What totalMills adds up, e.g. "Allegheny County 6.43 + City of Pittsburgh 9.67 + Pittsburgh Public Schools 10.25". */
  millsParts: string;
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
  const mainSchoolName = schoolRows[0]?.body.name ?? bodies.find((b) => b.id === "school")?.name;
  const cityMills = costs.propertyTax.cityMills.value;
  // Revenue here uses the Treasurer rows as loaded; say so when they predate the City's 2026 total.
  const staleNote = Math.abs(totalMills - cityMills) > 0.005
    ? `; computed at ${Math.round(totalMills * 1000) / 1000} mills (before the 2026 parks/library/school update; the City's 2026 total is ${cityMills})`
    : "";
  const millsParts = [...general.map((b) => `${b.name} ${b.mills}`), ...(mainSchoolName ? [`${mainSchoolName} ${mainSchool}`] : [])].join(" + ") + staleNote;
  return {
    rows, av, total: sum((r) => r.revenue), abatementTotal: sum((r) => r.abatementPerYear),
    doingNothing: annualTax(s.av_before_gaining, totalMills), totalMills, millsParts, abatement: ab,
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
  return (n.attached.on ? (n.attached.maxWidthFt - 25) / 25 : 0) + (n.minLot.on ? 1 - n.minLot.share : 0) + (n.parking === "none" ? 1 : n.parking === "transit" ? 0.5 : 0)
    + (n.adu ? 0.5 : 0) + (n.contextual ? 0.5 : 0) + (n.height ? 0.5 : 0) + (n.matchBlock ? 0.5 : 0);
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
  if (n.adu) parts.push(`one accessory dwelling unit (up to ${ADU_RULES.maxFloorAreaSf} sq ft) by right beside a detached single-family house (R1D, R1A, R2, R3, RM)`);
  if (n.contextual) parts.push(`front setback matching the neighbors by right (assumed ${CONTEXTUAL_FRONT_FT} ft; R1D, R1A, R2, R3, RM)`);
  if (n.height) parts.push(`one more story and ${HEIGHT_ADD.ft} ft more height (R1D, R1A, R2, R3, RM)`);
  if (n.matchBlock) parts.push("new buildings that match their block's existing pattern approved administratively (R1D, R1A, R2, R3, RM)");
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
  adu: "ADU",
  contextual: "Contextual setback",
  height: "One more story",
  matchBlock: "Match the block",
};

const SHORT: Record<string, string> = { attached: "attached", minLot: "lot size", parking: "parking", adu: "ADU", contextual: "contextual setback", height: "+1 story", matchBlock: "match the block" };
/** Label for a combination of levers as policy_results.touched joins them ("minLot+adu"). */
export function leverComboLabel(code: string): string {
  if (LEVERS_CODE_LABEL[code]) return LEVERS_CODE_LABEL[code]!;
  const parts = code.split("+").map((x) => SHORT[x] ?? x);
  return parts.length ? `${parts[0]!.charAt(0).toUpperCase()}${parts[0]!.slice(1)}${parts.length > 1 ? ` + ${parts.slice(1).join(" + ")}` : ""}` : code;
}

/** How each of the later levers is applied, in plain words (Method tab, council packet, receipts). */
export const LEVER_METHOD = {
  adu: `ADUs by right: lots in R1D, R1A, R2, R3 and RM with a detached single-family house (county use "single family"; rowhouses and townhouses excluded). Our zoning table has no ADU rules, so this scenario supplies them: one accessory dwelling up to ${ADU_RULES.maxFloorAreaSf} sq ft beside the house. Each eligible lot adds one home; the house stays and is not rescored. Low end: only lots where an area check says the smallest ADU (${ADU_RULES.minWidthFt} × ${ADU_RULES.minDepthFt} ft) fits behind the house with the district's side and rear yards and ${ADU_RULES.separationFt} ft from the house (lot area − house footprint − frontage × front setback). That is a proxy, not a drawn fit: the engine's lot-fit test has no priced ADU path yet. Pencil test: ${ADU_RULES.maxFloorAreaSf} sq ft at nearby new-construction prices per sq ft, with no land cost. Where another lever also adds homes on the same lot, the path with more homes counts (the ADU at a tie), never both.`,
  contextual: `Contextual front setback: lots in R1D, R1A, R2, R3 and RM whose front setback is deeper than ${CONTEXTUAL_FRONT_FT} ft. The citywide batch does not measure neighboring buildings; the engine's contextual-setback assumption (${CONTEXTUAL_FRONT_FT} ft, also used by the Planner scores) stands in for the neighbors' average and applies by right. Parcel pages now use the measured neighbors where the block face has them (Street precedent). Today's baseline already credits that setback where a lot needs it, so by-right gains are small; the lever mostly removes a step.`,
  matchBlock: `Match the block: lots in R1D, R1A, R2, R3 and RM on a block face with ${MATCH_BLOCK.minBuildings}+ buildings measured from county footprints (street precedent). A new building that matches the block's prevailing pattern is approved administratively: front setback down to the block's median minus ${MATCH_BLOCK.frontToleranceFt} ft, side setback down to the block's median (never under ${MATCH_BLOCK.sideFloorFt} ft), minimum lot area down to ${Math.round(MATCH_BLOCK.lotAreaShare * 100)}% of the block's median lot. Tolerances are scenario settings, not code. The screen counts lots where the block is looser than the code on at least one of those rules; homes unlocked need the rescoring batch.`,
  height: `One more story: lots in R1D, R1A, R2, R3 and RM with a height limit get +${HEIGHT_ADD.stories} story and +${HEIGHT_ADD.ft} ft. The lot-fit test's building types top out at three stories (placeholder sizes), so where a district already allows three the lever cannot add homes in this model; the result is a floor.`,
} as const;

/**
 * Lever states deliberately not computed for this submission, with why the result is expected to be about zero.
 * Shown instead of a queue banner.
 */
export const NOT_COMPUTED_NOTE: Record<string, string> = {
  cs: "Not computed for this submission (expected ~0 extra homes by right because today's baseline already credits the contextual front setback wherever a lot needs it, so the lever mostly removes a step, not a limit).",
  mb: "Not computed for this submission: homes unlocked need the rescoring batch (about 4 hours on the shared database).",
  h1: "Not computed for this submission (expected ~0 extra homes by right because the lot-fit test's building types top out at three stories and residential districts already allow three).",
};

/**
 * Why "Attached on narrow lots" (a35) alone adds no homes. Counts are from the stored a35 results
 * (policy_results, 35,057 parcels): 25,297 fit no new home by right under today's lot-size rules and the
 * other 9,760 fit one house but not the lot area per unit for a second. Today's code already permits
 * single-unit attached homes by right on R1D lots up to 35 ft (engine/src/quickfit/rules.ts) and in R1A.
 */
export const ATTACHED_ALONE_NOTE =
  "Why zero: on the narrow lots this lever reaches, the building type is not what limits homes. Today’s code already allows single-unit attached homes by right on R1D lots up to 35 ft wide (and in R1A); the minimum lot size and lot area per unit are the binding limits. Of the 35,057 lots it applies to, 25,297 fit no new home by right today and 9,760 fit one house but not the lot area for a second. Paired with no minimum lot size (the Starter homes scenario), attached homes add homes on about 510 parcels. This does not mean attached homes add nothing; it means this lever alone, at 35 ft, changes no limit that binds.";

/** Parking is modeled as geometry only (Method tab, receipts, packet). */
export const PARKING_NOTE =
  "Parking is modeled only as whether the building and its required spaces fit on the lot, not as a cost: the pencil test carries no parking construction or land cost. Parking reform mostly works through cost and feasibility, so the effect shown is a lower bound.";

/**
 * Runs made before the full-City policy batch fit-tested far fewer parcels (the Starter homes state came from
 * an earlier run: 36 batches, 21,497 parcels fit-tested vs 118,960 in the other scenarios). Returns a label,
 * or null when this state's run matches the others. `ref` = the most parcels any computed state fit-tested.
 */
export function earlierRunNote(s: Summary | null, ref: number): string | null {
  if (!s?.parcels_seen || !ref || s.parcels_seen >= 0.9 * ref) return null;
  return `From an earlier partial run: ${s.parcels_seen.toLocaleString("en-US")} parcels fit-tested (${s.buckets ?? "batches"}), vs ${ref.toLocaleString("en-US")} in the other scenarios. Compare with them with care.`;
}

/** Most parcels any finished state fit-tested (reference for earlierRunNote). */
export const fullRunSize = (states: PolicyState[]) => Math.max(0, ...states.filter((x) => x.status === "done").map((x) => x.summary?.parcels_seen ?? 0));
