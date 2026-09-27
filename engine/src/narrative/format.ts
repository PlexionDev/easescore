// Formatting helpers shared by the templates and the validator: money/percent display,
// tooltip markers, and the "A − B = C in words" math sentence.

/** Round money for display: nearest $1,000 from $100,000, nearest $100 from $10,000, whole dollars below. */
export function roundMoney(n: number): number {
  const a = Math.abs(n);
  const r = a >= 100_000 ? Math.round(a / 1000) * 1000 : a >= 10_000 ? Math.round(a / 100) * 100 : Math.round(a);
  return n < 0 ? -r : r;
}

/** "$412,000". Always positive; say "loss" or "gap" in words instead of a minus sign. */
export function money(n: number): string {
  return "$" + Math.abs(roundMoney(n)).toLocaleString("en-US");
}

/** "$3,000 to $6,000", or "$5,000" when low = high. */
export function moneyRange(low: number, high: number): string {
  return roundMoney(low) === roundMoney(high) ? money(low) : `${money(low)} to ${money(high)}`;
}

/** Whole percent; one decimal below 1%. */
export function pct(n: number): string {
  const a = Math.abs(n);
  return (a < 1 && a > 0 ? a.toFixed(1) : String(Math.round(a))) + "%";
}

/** "about 6 months", "about 1 month", "less than a month". */
export function months(n: number): string {
  const r = Math.round(n);
  if (r < 1) return "less than a month";
  return `about ${r} month${r === 1 ? "" : "s"}`;
}

/**
 * Months to a building permit as a range, the one rule used everywhere (pane, Planner, report, narrative):
 * the estimate ×0.75 to ×1.25, rounded to whole months, at least 1 month wide, always containing the
 * estimate. [0, 1] reads "under 1 month".
 */
export function permitRange(m: number): [number, number] {
  const lo = Math.max(0, Math.floor(m * 0.75));
  return [lo, Math.max(lo + 1, Math.ceil(m * 1.25))];
}
export function permitRangeText(m: number): string {
  const [lo, hi] = permitRange(m);
  return lo === 0 ? `under ${hi} month${hi === 1 ? "" : "s"}` : `${lo}-${hi} months`;
}

/** "about 4 weeks". */
export function weeks(n: number): string {
  const r = Math.round(n);
  return `about ${r} week${r === 1 ? "" : "s"}`;
}

/** Plain-English glossary for tooltip terms, keyed by lower-case jargon. No numbers in these on purpose. */
export const GLOSSARY: Record<string, string> = {
  variance: "Permission from the Zoning Board to bend a size or placement rule, like a setback or height limit.",
  "use variance": "Permission from the Zoning Board to use land in a way the district does not allow. Hard to get.",
  "special exception": "A use the district allows only after a Zoning Board hearing checks it against set standards.",
  "administrator exception": "A use the Zoning Administrator can approve without a full hearing, if set standards are met.",
  "conditional use": "A use the district allows only after a Planning Commission and City Council review.",
  "by right": "Allowed without a hearing. You still need normal permits.",
  setback: "The required open distance between a building and the lot line.",
  "contextual setback": "A front setback rule that lets you line up with the neighboring houses.",
  "geotechnical report": "A soil and slope study by an engineer, needed before building on steep or unstable ground.",
  "mine subsidence": "Ground sinking over old coal mines.",
  grouting: "Pumping cement-like material into old mine voids under a lot to keep it from sinking.",
  floodway: "The part of a flood zone where water flows fastest. New homes are almost never allowed there.",
  margin: "What is left after costs, as a share of the cost.",
  NOI: "Net operating income: rent collected minus the costs of running the building, before loan payments.",
  "yield on cost": "Yearly income after operating costs, divided by the total cost to build.",
  IRR: "Internal rate of return: the average yearly return over the life of the project.",
  "funding gap": "The money still missing after the loan and income, usually filled by grants or subsidies.",
  "red flag": "A problem that blocks building unless it is resolved.",
};

/** Tooltip marker: {{term:JARGON|plain words}}. Plain words show; the jargon and its definition go in the tooltip. */
export function term(jargon: string, plain?: string): string {
  return `{{term:${jargon}|${plain ?? jargon}}}`;
}

export type TermSegment = { kind: "text"; text: string } | { kind: "term"; jargon: string; text: string; definition: string | null };

const TERM_RE = /\{\{term:([^|}]+)\|([^}]+)\}\}/g;

/** Split marked-up text into plain and tooltip segments (for rendering). */
export function parseTerms(text: string): TermSegment[] {
  const out: TermSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: "text", text: text.slice(last, i) });
    const jargon = m[1]!.trim();
    out.push({ kind: "term", jargon, text: m[2]!, definition: GLOSSARY[jargon] ?? GLOSSARY[jargon.toLowerCase()] ?? null });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Text with markers replaced by their plain words (for PDFs, screen readers, word counts). */
export function stripTerms(text: string): string {
  return text.replace(TERM_RE, (_, _j, plain: string) => plain);
}

// ---------------------------------------------------------------------------------------------
// "A − B = C" in words.

export type MathOp = "plus" | "minus" | "times" | "divided by";

export interface MathTerm {
  value: number;
  /** Words after the number, e.g. "rent" or "in costs". */
  label?: string;
  /** Format as money (default true). */
  money?: boolean;
}

export interface MathStep {
  op: MathOp;
  term: MathTerm;
  /** Words after the running result, e.g. "a year" or "left to pay the loan". */
  resultLabel?: string;
}

export interface MathSentence {
  /** No trailing period, so it can sit inside a larger sentence. */
  text: string;
  result: number;
  /** Every number the sentence displays, as computed (for the validator's derived pool). */
  values: number[];
}

const OP_WORD: Record<MathOp, string> = { plus: "plus", minus: "minus", times: "×", "divided by": "÷" };

function show(t: MathTerm): string {
  return t.money === false ? String(t.value) : money(t.value);
}

/**
 * Builds "Rent $2,400 × 12 = $28,800 a year; minus $9,100 in costs = $19,700 left to pay the loan".
 * Money terms are rounded for display first and the math runs on the rounded numbers,
 * so the sentence always adds up on its face.
 */
export function mathInWords(start: MathTerm & { lead?: string }, steps: MathStep[]): MathSentence {
  const norm = (t: MathTerm) => (t.money === false ? t.value : roundMoney(t.value));
  let acc = norm(start);
  const values = [acc];
  const head = `${start.lead ? start.lead + " " : ""}${show({ ...start, value: acc })}${start.label ? " " + start.label : ""}`;
  const parts: string[] = [];
  for (const s of steps) {
    const v = norm(s.term);
    values.push(v);
    if (s.op === "plus") acc += v;
    else if (s.op === "minus") acc -= v;
    else if (s.op === "times") acc *= v;
    else acc = v === 0 ? acc : acc / v;
    const resultMoney = start.money !== false || s.term.money !== false;
    acc = resultMoney ? Math.round(acc) : acc;
    values.push(acc);
    const res = resultMoney ? money(acc) : String(acc);
    parts.push(`${OP_WORD[s.op]} ${show({ ...s.term, value: v })}${s.term.label ? " " + s.term.label : ""} = ${res}${s.resultLabel ? " " + s.resultLabel : ""}`);
  }
  const text = parts.length === 0 ? head : `${head} ${parts[0]}${parts.slice(1).map((p) => "; " + p).join("")}`;
  return { text, result: acc, values };
}

/** "a, b, and c" */
export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
