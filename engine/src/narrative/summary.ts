// The two-sentence summary at the top of the parcel pane.
// Sentence 1 (by right): the option that makes the most financial sense without special approval,
// with its main cost driver. Sentence 2 (with approval): what zoning relief could allow and how past
// decisions on that kind of request have gone. Built only from SummaryInput (computed JSON).
// An AI rewrite may be used, but every number and every district/code in it must exist in the input,
// and it must avoid the banned words; otherwise it is retried once, then the template is used.

import { extractNumbers } from "./validate";
import { money, pct } from "./format";

export type ReliefType = "special_exception" | "dimensional_variance" | "use_variance" | "conditional_use" | "administrator_exception";

export interface SummaryPrecedent {
  granted: number;
  /** Granted + denied (withdrawn and pending requests are not counted). */
  decided: number;
  /** Year of the oldest decided case in the count, when known. */
  sinceYear: number | null;
}

export interface SummaryOption {
  strategyId: string;
  /** Noun phrase with its article or count, e.g. "one single-family home", "a duplex". */
  label: string;
  units: number | null;
  tenure: "sale" | "rent";
  /** The pro forma's verdict; null when it could not be computed. */
  verdict: "yes" | "thin" | "no" | null;
  /** Profit ÷ total cost × 100 (sale) or yield on cost × 100 (rent). */
  marginPct: number | null;
  /** Shortfall in dollars when the option loses money (positive number). */
  gap: number | null;
  /** Main cost driver, a plain phrase with no numbers not in this JSON, e.g. "the steep slope". */
  costDriver: string | null;
  /** What the driver does, e.g. "points to a stepped foundation that pushes cost toward the high end". */
  costDriverEffect: string | null;
  /** What the estimate still needs before it can say whether it pencils, e.g. "your rehab cost". */
  needs?: string | null;
}

export interface SummaryApprovalOption extends SummaryOption {
  /** Plain words with an article, e.g. "a special exception", "a variance for the side setback". */
  approval: string;
  reliefType: ReliefType | null;
  /** Past decisions on this relief type in the district; null when there is no record for it. */
  precedent: SummaryPrecedent | null;
}

export interface SummaryInput {
  parid: string;
  /** Zoning district code, e.g. "R1D-H"; null outside the City data. */
  district: string | null;
  municipality: string | null;
  byRight: SummaryOption | null;
  withApproval: SummaryApprovalOption | null;
  /**
   * The option the visitor selected, when it is not the featured by-right option. Sentence 1 then
   * describes it, and sentence 2 names the featured by-right option instead of the approval option.
   */
  lead?: SummaryApprovalOption | null;
  /** Red flag titles (floodway, no legal access, contamination on the lot). */
  redFlags: string[];
}

export interface SummaryResult {
  sentences: [string, string];
  text: string;
  source: "template" | "ai";
  /** How many AI drafts failed validation before this result (0 for a clean AI result or no AI). */
  failures: number;
}

export const SUMMARY_FINE_PRINT =
  "Summary of the calculated results. Decision support only, not legal, financial or engineering advice. Confirm zoning with the City and costs with local bids.";

/** Minimum decided cases before past decisions are described as a pattern. */
export const PRECEDENT_MIN_CASES = 5;

/** Fixed precedent language. Thresholds: at least 70% approved = usually approved; 40–69% = mixed; under 40% = usually denied. */
export function precedentPhrase(p: SummaryPrecedent | null, district: string | null): string {
  if (!p || p.decided === 0) return "there is no nearby precedent on record";
  if (p.decided < PRECEDENT_MIN_CASES) return "there are too few nearby cases to judge";
  const rate = p.granted / p.decided;
  const where = district ? ` in ${district}` : "";
  const since = p.sinceYear ? ` since ${p.sinceYear}` : "";
  const stat = `(${p.granted} of ${p.decided} approved${where}${since})`;
  if (rate >= 0.7) return `nearby requests like this have usually been approved ${stat}`;
  if (rate >= 0.4) return `nearby requests like this have been mixed ${stat}`;
  return `nearby requests like this have usually been denied ${stat}`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function pencilsClause(o: SummaryOption): string {
  const basis = o.tenure === "sale" ? "on current new-home sale comps" : "on current rents";
  if (o.verdict === "no" && o.gap != null && o.gap > 0) return `at current costs it comes up short by about ${money(o.gap)}`;
  if (o.verdict === "no") return "at current costs it does not pencil";
  if (o.marginPct == null) return o.needs ? `pricing it needs ${o.needs}` : "whether it pencils can't be told from our data yet";
  const what = o.tenure === "sale" ? "margin" : "yield on cost";
  if (o.verdict === "thin") return `it pencils only thinly, at about a ${pct(o.marginPct)} ${what} ${basis}`;
  if (o.verdict === "yes") return `it pencils at about a ${pct(o.marginPct)} ${what} ${basis}`;
  return `it earns about a ${pct(o.marginPct)} ${what} ${basis}`;
}

function sentenceOne(i: SummaryInput): string {
  const flag = i.redFlags.length ? `, but a red flag (${lc(i.redFlags[0]!)}) blocks building until it is resolved` : "";
  if (i.lead) {
    const l = i.lead;
    const driver = l.costDriver ? `; ${l.costDriver}${l.costDriverEffect ? ` ${l.costDriverEffect}` : " is the main cost driver"}` : "";
    const path = l.reliefType ? `would need ${l.approval}` : "is allowed by right";
    return `${cap(l.label)} ${path}, and ${pencilsClause(l)}${driver}${flag}.`;
  }
  const b = i.byRight;
  if (!b) {
    if (!i.district) {
      const m = i.municipality ?? "the municipality";
      return `Zoning for ${m} is not in our data, so what is allowed by right needs to be confirmed with ${m}${flag}.`;
    }
    return `Nothing fits by right under ${i.district} zoning in our site check${flag}.`;
  }
  const driver = b.costDriver ? `; ${b.costDriver}${b.costDriverEffect ? ` ${b.costDriverEffect}` : " is the main cost driver"}` : "";
  return `By right, this lot allows ${b.label}, and ${pencilsClause(b)}${driver}${flag}.`;
}

function sentenceTwo(i: SummaryInput): string {
  if (i.lead) {
    const b = i.byRight;
    if (b) return `By right, this lot allows ${b.label}, and ${pencilsClause(b)}.`;
    return i.district ? `Nothing fits by right under ${i.district} zoning in our site check.` : "What is allowed by right needs to be confirmed with the municipality.";
  }
  const w = i.withApproval;
  if (!w) {
    if (!i.district) return "Options that need zoning relief can't be checked until the zoning is confirmed.";
    return "Our site check found no larger option that zoning relief would allow.";
  }
  return `${cap(w.label)} would need ${w.approval}, and ${precedentPhrase(w.precedent, i.district)}.`;
}

/** The deterministic two sentences. Always passes validateSummary for its own input. */
export function generateSummary(i: SummaryInput): SummaryResult {
  const sentences: [string, string] = [sentenceOne(i), sentenceTwo(i)];
  return { sentences, text: sentences.join(" "), source: "template", failures: 0 };
}

// ---------------------------------------------------------------------------------------------
// Validator

/** Words the summary must never use (case-insensitive). "Risky" must be replaced by the specific risk. */
export const BANNED_PATTERNS: { word: string; re: RegExp }[] = [
  { word: "guaranteed", re: /\bguarantee(d|s)?\b/i },
  { word: "definitely", re: /\bdefinite(ly)?\b/i },
  { word: "perfect", re: /\bperfect(ly)?\b/i },
  { word: "great deal", re: /\bgreat\s+deal\b/i },
  { word: "avoid", re: /\bavoid(s|ed|ing)?\b/i },
  { word: "impossible", re: /\bimpossible\b/i },
  { word: "can't lose", re: /\b(can['’]?t|cannot|can not)\s+lose\b/i },
  { word: "should buy / should not buy", re: /\bshould(\s+not|n['’]t)?\s+buy\b/i },
  { word: "risky", re: /\brisk(y|ier|iest)\b/i },
];

// District and code tokens: capitals with a digit or hyphen (R1D-H, RM-M, R2, LNC-1), and code sections (§903.03).
const CODE_RE = /\b[A-Z][A-Z0-9]*(?:\d[A-Z0-9]*|-[A-Z0-9]+)(?:-[A-Z0-9]+)*\b/g;
const SECTION_RE = /§\s?\d+(?:\.\d+)*(?:\.[A-Z])?/g;

function walk(v: unknown, strings: string[], numbers: number[], key: string | null) {
  if (typeof v === "number" && Number.isFinite(v)) numbers.push(Math.abs(v));
  else if (typeof v === "string") {
    if (key === "parid" || key === "strategyId") return;
    strings.push(v);
    for (const t of extractNumbers(v)) numbers.push(Math.abs(t.value));
  } else if (Array.isArray(v)) v.forEach((x) => walk(x, strings, numbers, null));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, strings, numbers, k);
}

function numberOk(t: { value: number; precision: number; percent: boolean }, pool: number[]): boolean {
  const eps = (x: number) => Math.max(1e-9, Math.abs(x) * 1e-9);
  const fits = (v: number) => Math.abs(v - t.value) <= eps(t.value) || Math.abs(Math.round(v / t.precision) * t.precision - t.value) <= eps(t.value);
  return pool.some((v) => fits(v) || (t.percent && v <= 1.5 && fits(v * 100)));
}

export interface SummaryValidation {
  ok: boolean;
  /** Numbers not found in the input. */
  numbers: string[];
  /** District or code tokens not found in the input. */
  codes: string[];
  /** Banned words used. */
  banned: string[];
  /** Other problems (sentence count, length). */
  problems: string[];
}

/** Every number and every district/code must exist in the input JSON; no banned words; exactly two sentences. */
export function validateSummary(text: string, input: SummaryInput): SummaryValidation {
  const strings: string[] = [];
  const pool: number[] = [];
  walk(input, strings, pool, null);
  // Years named by the precedent phrase and the counts it prints come from the input already.
  const joined = strings.join(" \u0000 ");
  const numbers = extractNumbers(text).filter((t) => !numberOk(t, pool)).map((t) => t.raw);
  const codes = [...new Set([...(text.match(CODE_RE) ?? []), ...(text.match(SECTION_RE) ?? [])])].filter((c) => !joined.includes(c.replace(/\s/g, "")) && !joined.includes(c));
  const banned = BANNED_PATTERNS.filter((b) => b.re.test(text)).map((b) => b.word);
  const problems: string[] = [];
  const sentences = splitSentences(text);
  if (sentences.length !== 2) problems.push(`expected 2 sentences, got ${sentences.length}`);
  if (text.length > 600) problems.push("too long");
  problems.push(...proseProblems(text, sentences));
  return { ok: !numbers.length && !codes.length && !banned.length && !problems.length, numbers, codes, banned, problems };
}

// Plain prose only: letters, digits, spaces and ordinary punctuation (straight or curly quotes and
// apostrophes, dashes, $, %, §, /, &). Anything else (braces, brackets, backticks, *, #, _, <, >, |,
// \, =, ~, ^, @) means the draft is not a clean sentence.
const PROSE_CHARS = /^[\p{L}\p{N} .,;:!?'"’‘“”()\-–—$%§/&\n]*$/u;
const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|org|net|gov|io|ai|edu)\b/i;
const MARKDOWN_RE = /\*\*|__|`|^#+\s|^\s*[-*]\s|\]\(/m;
const JSON_RE = /[{}[\]]|"\s*:|:\s*"|\\n|\\"/;

/** Problems that make an AI draft unusable as plain prose (the template is used instead). */
export function proseProblems(text: string, sentences: string[] = splitSentences(text)): string[] {
  const out: string[] = [];
  if (!PROSE_CHARS.test(text)) out.push("characters outside plain prose");
  if (JSON_RE.test(text)) out.push("JSON-like fragment");
  if (MARKDOWN_RE.test(text)) out.push("markdown");
  if (URL_RE.test(text)) out.push("URL");
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  if (count(/\(/g) !== count(/\)/g)) out.push("unbalanced parentheses");
  if (count(/"/g) % 2 !== 0) out.push("unbalanced quotes");
  if (count(/“/g) !== count(/”/g)) out.push("unbalanced quotes");
  for (const s of sentences) if (!/[a-z0-9%)]\.$/i.test(s.trim())) { out.push("a sentence does not end with a period"); break; }
  return [...new Set(out)];
}

/** Split on sentence ends, ignoring decimals and "e.g."-style abbreviations. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=(?<!\b(?:Mt|St|Ft|Dr|No|Mr|Ms|Jr|Sr|Twp|[A-Z]))[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ask for AI drafts until one validates. After `maxFailures` failed drafts (or when `draft` returns null,
 * throws, or is not given), the template is used. Deterministic given the drafts.
 */
export async function resolveSummary(
  input: SummaryInput,
  draft?: (attempt: number, template: SummaryResult, lastProblems: SummaryValidation | null) => Promise<string | null>,
  maxFailures = 2,
): Promise<SummaryResult> {
  const tpl = generateSummary(input);
  if (!draft) return tpl;
  let failures = 0;
  let last: SummaryValidation | null = null;
  while (failures < maxFailures) {
    let text: string | null = null;
    try {
      text = await draft(failures + 1, tpl, last);
    } catch {
      text = null;
    }
    if (text == null) return { ...tpl, failures };
    const clean = text.replace(/\s+/g, " ").trim();
    last = validateSummary(clean, input);
    if (last.ok) {
      const [a, b] = splitSentences(clean) as [string, string];
      return { sentences: [a, b], text: clean, source: "ai", failures };
    }
    failures++;
  }
  return { ...tpl, failures };
}
