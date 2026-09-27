// Number validator: every number a sentence states must come from the facts JSON
// (or a documented derivation of it), exactly or rounded to the precision it is shown at.

import { derive } from "./derive";
import { NUMBER_WORDS_ES } from "./summary-es";
import type { NarrativeFacts, NarrativeResult, ValidationResult } from "./types";

export interface NumberToken {
  /** As written, e.g. "$412k", "10%", "twelve". */
  raw: string;
  value: number;
  /** Smallest unit the display implies, e.g. 1000 for "$412,000" or "$412k", 0.1 for "2.5". */
  precision: number;
  percent: boolean;
}

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

// Digits not glued to a letter or another number (so "R1D-H" and "v0.1" are not read as numbers).
const NUM_RE =
  /(?<![\w.,])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(k|K|M|million|thousand|mil)\b)?(\s?%|\s+percent\b|\s+por\s+ciento\b)?/g;
const WORD_RE = new RegExp(`\\b(${Object.keys(WORDS).join("|")})\\b(\\s+percent\\b)?`, "gi");
// Spanish: only when the text is Spanish ("once" is 11 in Spanish, a plain word in English).
const WORD_RE_ES = new RegExp(`(?<![\\p{L}])(${Object.keys(NUMBER_WORDS_ES).join("|")})(?![\\p{L}])(\\s+por\\s+ciento(?![\\p{L}]))?`, "giu");

function intPrecision(digits: string): number {
  // Trailing zeros set the precision, but keep at least two significant figures:
  // "$412,000" → 1,000; "400,000" → 10,000; "30" → 1.
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  if (/^0+$/.test(digits)) return 1;
  const cap = Math.max(0, digits.length - 2);
  return 10 ** Math.min(trailing, cap);
}

/** Every number in a piece of text, with the precision it is displayed at. */
export function extractNumbers(text: string, lang: "en" | "es" = "en"): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const digits = m[2]!.replace(/,/g, "");
    const dec = m[3] ?? "";
    const suffix = m[4];
    const percent = Boolean(m[5]);
    let value = Number(digits + dec);
    let precision = dec ? 10 ** -(dec.length - 1) : intPrecision(digits);
    const mult = suffix === "k" || suffix === "K" || suffix === "thousand" || suffix === "mil" ? 1e3 : suffix === "M" || suffix === "million" ? 1e6 : 1;
    if (mult !== 1) {
      value *= mult;
      precision = (dec ? 10 ** -(dec.length - 1) : 1) * mult;
    }
    out.push({ raw: m[0].trim(), value, precision, percent });
  }
  for (const m of text.matchAll(WORD_RE)) {
    out.push({ raw: m[0], value: WORDS[m[1]!.toLowerCase()]!, precision: 1, percent: Boolean(m[2]) });
  }
  if (lang === "es") {
    for (const m of text.matchAll(WORD_RE_ES)) {
      out.push({ raw: m[0], value: NUMBER_WORDS_ES[m[1]!.toLowerCase()]!, precision: 1, percent: Boolean(m[2]) });
    }
  }
  return out;
}

const SKIP_STRING_KEYS = new Set(["parid", "id", "configVersion"]);

/** All numbers in the facts: numeric fields, numbers inside strings, array lengths, and derived figures. */
export function factPool(facts: NarrativeFacts): number[] {
  const pool: number[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (typeof v === "number" && Number.isFinite(v)) pool.push(v);
    else if (typeof v === "string") {
      if (key && SKIP_STRING_KEYS.has(key)) return;
      for (const t of extractNumbers(v)) pool.push(t.value);
    } else if (Array.isArray(v)) {
      pool.push(v.length);
      v.forEach((x) => walk(x, null));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  walk(facts, null);
  pool.push(...derive(facts).values);
  return pool.map(Math.abs);
}

function roundTo(v: number, p: number): number {
  return Math.round(v / p) * p;
}

function matches(t: NumberToken, pool: number[]): boolean {
  const eps = (x: number) => Math.max(1e-9, Math.abs(x) * 1e-9);
  const fits = (v: number) => Math.abs(v - t.value) <= eps(t.value) || Math.abs(roundTo(v, t.precision) - t.value) <= eps(t.value);
  for (const v of pool) {
    if (fits(v)) return true;
    // Shares stored as 0–1 may be shown as percents.
    if (t.percent && v <= 1.5 && fits(v * 100)) return true;
  }
  return false;
}

/** Tooltip markers carry text too; check both the jargon and the plain words. */
function unmark(text: string): string {
  return text.replace(/\{\{term:([^|}]+)\|([^}]+)\}\}/g, (_, j: string, p: string) => `${p} (${j})`);
}

/** Reject any number in `text` that isn't derivable from `facts`. */
export function validateNarrative(text: string, facts: NarrativeFacts, pool: number[] = factPool(facts)): ValidationResult {
  const offending = extractNumbers(unmark(text))
    .filter((t) => !matches(t, pool))
    .map((t) => t.raw);
  return { ok: offending.length === 0, offending };
}

/** Validate every sentence of a result. */
export function validateResult(result: NarrativeResult, facts: NarrativeFacts): ValidationResult {
  const pool = factPool(facts);
  const texts = [result.canBuild, result.pencils, result.pencilsMath, ...result.barriers, ...result.nextSteps]
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => s.text);
  const offending = texts.flatMap((t) => validateNarrative(t, facts, pool).offending);
  return { ok: offending.length === 0, offending };
}
