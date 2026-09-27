// Scenario data loop (TODO item 6): pure helpers shared by the browser and the server route.
// No imports on purpose (runs in the browser, the route, and `node --test`).
//
// A scenario = one visitor's pro forma / QuickFit edits on a parcel: the pf_* and qf* URL parameters,
// the selected strategy and scheme, and a few computed summary numbers. The parcel ID is kept (the
// property is core); nothing that identifies the person is ever accepted. Everything the server
// stores is rebuilt here from an allowlist, so unknown fields (ip, user agent, cookies, session IDs,
// free text…) are dropped before the insert.

/** localStorage key for the visitor's choice. Only "share" sends anything. */
export const PREF_KEY = "easescore.scenarios.pref";
export type Pref = "share" | "dont" | null;

/** A group is shown only with at least this many scenarios (also enforced in SQL). */
export const MIN_N = 5;

const PARAM_KEY = /^(pf_[a-z0-9_]{1,40}|qf(_[a-z0-9]{1,12})?)$/;
const TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_PARAMS = 60;
const VERDICTS = new Set(["yes", "thin", "no"]);
const TENURES = new Set(["sale", "rent"]);
const SUMMARY_NUMBERS = ["units", "finishedSf", "tdc", "costPerSf", "costPerUnit", "marginPct", "yieldPct"] as const;

export interface ScenarioSummary {
  units?: number; finishedSf?: number; tdc?: number; costPerSf?: number; costPerUnit?: number;
  marginPct?: number; yieldPct?: number; verdict?: string; tenure?: string;
}
export interface ScenarioInput {
  parid: string;
  strategy: string;
  scheme: string;
  tier: string | null;
  params: Record<string, number | string>;
  summary: ScenarioSummary;
}
/** Exactly the columns the server inserts. dedupe_key is added by the server (SHA-256 of dedupeMaterial). */
export interface ScenarioRow {
  day: string;
  parid: string;
  strategy: string;
  scheme: string;
  tier: string | null;
  params: Record<string, number | string>;
  line_per_sf: Record<string, number>;
  summary: ScenarioSummary;
}
export const ROW_FIELDS = ["day", "parid", "strategy", "scheme", "tier", "params", "line_per_sf", "summary"] as const;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e10 ? n : null;
};
const token = (v: unknown): string | null => (typeof v === "string" && TOKEN.test(v) ? v : null);

/** Params allowlist: pf_* / qf* keys, numbers or short tokens only (free text is dropped), sorted keys. */
export function cleanParams(raw: unknown): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (!raw || typeof raw !== "object") return out;
  const keys = Object.keys(raw as object).filter((k) => PARAM_KEY.test(k)).sort().slice(0, MAX_PARAMS);
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k];
    const n = num(v);
    if (n != null) out[k] = n;
    else { const t = token(v); if (t != null) out[k] = t; }
  }
  return out;
}

function cleanSummary(raw: unknown): ScenarioSummary {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ScenarioSummary = {};
  for (const k of SUMMARY_NUMBERS) { const n = num(s[k]); if (n != null) out[k] = n; }
  if (typeof s.verdict === "string" && VERDICTS.has(s.verdict)) out.verdict = s.verdict;
  if (typeof s.tenure === "string" && TENURES.has(s.tenure)) out.tenure = s.tenure;
  return out;
}

/** Validate and rebuild a request body from the allowlist. null = reject. */
export function sanitizeScenario(body: unknown): ScenarioInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const parid = typeof b.parid === "string" ? b.parid.toUpperCase() : "";
  if (!/^[0-9A-Z]{16}$/.test(parid)) return null;
  const strategy = typeof b.strategy === "string" && /^[a-z0-9_]{1,40}$/.test(b.strategy) ? b.strategy : null;
  if (!strategy) return null;
  const scheme = b.scheme == null ? "none" : token(b.scheme);
  if (!scheme) return null;
  const tier = b.tier == null ? null : token(b.tier);
  const params = cleanParams(b.params);
  // A scenario is the visitor's edits: nothing edited, nothing to keep.
  if (!Object.keys(params).some((k) => k.startsWith("pf_"))) return null;
  return { parid, strategy, scheme, tier, params, summary: cleanSummary(b.summary) };
}

/** User-entered budget lines as $ per finished sq ft (pf_line_<id> ÷ finished SF). */
export function linePerSf(params: Record<string, number | string>, finishedSf: number | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!finishedSf || finishedSf <= 0) return out;
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("pf_line_") && typeof v === "number" && v >= 0) out[k.slice(8)] = Math.round((v / finishedSf) * 100) / 100;
  }
  return out;
}

/** The row to insert, and nothing else (no IP, user agent, cookie, session or request ID, no time finer than the day). */
export function buildRow(s: ScenarioInput, day: string): ScenarioRow {
  return {
    day, parid: s.parid, strategy: s.strategy, scheme: s.scheme, tier: s.tier,
    params: s.params, line_per_sf: linePerSf(s.params, s.summary.finishedSf), summary: s.summary,
  };
}

/** Canonical JSON: sorted keys at every level. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** What the dedupe hash covers: parcel + strategy + scheme + day + canonical params. */
export const dedupeMaterial = (r: Pick<ScenarioRow, "parid" | "strategy" | "scheme" | "day" | "params">) =>
  [r.parid, r.strategy, r.scheme, r.day, canonical(r.params)].join("|");

/** Calendar day in Pittsburgh (no finer time is stored). */
export const dayET = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

export interface MedianRow { line_id: string; scope: string; median_per_sf: number; n: number }
/** Defense in depth: drop any aggregate below MIN_N even if the SQL returned it. */
export const applyMinN = (rows: MedianRow[]) => rows.filter((r) => Number.isFinite(r.n) && r.n >= MIN_N);

/** Prefer the same-municipality median, else every area. */
export function pickMedians(rows: MedianRow[]): Record<string, MedianRow> {
  const out: Record<string, MedianRow> = {};
  for (const r of applyMinN(rows)) if (!out[r.line_id] || (r.scope === "area" && out[r.line_id].scope !== "area")) out[r.line_id] = r;
  return out;
}

/**
 * Browser send gate. Sends only when collection is on AND the visitor chose "share" after seeing the
 * notice. Anything else ("dont", no choice yet, collection off) sends nothing. Returns whether it sent.
 */
export async function maybeSend(opts: { enabled: boolean; pref: Pref; payload: ScenarioInput | null; fetchImpl: typeof fetch }): Promise<boolean> {
  if (!opts.enabled || opts.pref !== "share" || !opts.payload) return false;
  try {
    await opts.fetchImpl("/api/scenarios", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.payload),
      credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}
