// Every finance output is a Receipt: the value plus how it was made.
// Missing inputs never become zero: the output turns into "insufficient evidence" and names what is missing.

/** A user- or data-supplied number. `undefined` and `null` both mean "not known". */
export type Num = number | null | undefined;

export type InputValue = number | string | boolean | null;

interface ReceiptBase {
  /** Plain language first, acronym second: "Return per year (IRR)". */
  label: string;
  /** The formula in words, e.g. "NOI ÷ annual debt service". */
  formula: string;
  /** The values that went into this output, by name. */
  inputs: Record<string, InputValue>;
}

export interface Computed extends ReceiptBase {
  status: "ok";
  value: number;
}

export interface Insufficient extends ReceiptBase {
  status: "insufficient evidence";
  value: null;
  /** Names of the inputs that must be supplied before this can be computed. */
  missing: string[];
}

export interface NotComputable extends ReceiptBase {
  status: "not computable";
  value: null;
  /** Why the math has no answer for these inputs (e.g. division by zero, no sign change). */
  reason: string;
}

export type Receipt = Computed | Insufficient | NotComputable;

/** An argument to `compute`: a raw number or another Receipt (its value is used and its missing list propagates). */
export type Arg = Num | Receipt;

export const isReceipt = (a: unknown): a is Receipt =>
  typeof a === "object" && a !== null && "status" in a && "label" in a;

export const isOk = (r: Receipt): r is Computed => r.status === "ok";

const dedupe = (xs: string[]) => [...new Set(xs)];

/**
 * Build a Receipt. Any missing argument makes the result "insufficient evidence";
 * an upstream "not computable" makes this one "not computable" too.
 * `fn` returns a number, or a string explaining why there is no answer.
 */
export function compute<K extends string>(
  label: string,
  formula: string,
  args: Record<K, Arg>,
  fn: (v: Record<K, number>) => number | string,
): Receipt {
  const inputs: Record<string, InputValue> = {};
  const values = {} as Record<K, number>;
  const missing: string[] = [];
  let blocked: string | null = null;

  for (const k of Object.keys(args) as K[]) {
    const a = args[k];
    if (isReceipt(a)) {
      inputs[k] = a.value;
      if (a.status === "ok") values[k] = a.value;
      else if (a.status === "insufficient evidence") missing.push(...a.missing);
      else blocked ??= `${a.label}: ${a.reason}`;
    } else if (typeof a === "number" && Number.isFinite(a)) {
      inputs[k] = a;
      values[k] = a;
    } else {
      inputs[k] = null;
      missing.push(k);
    }
  }

  if (missing.length > 0) {
    return { status: "insufficient evidence", value: null, label, formula, inputs, missing: dedupe(missing) };
  }
  if (blocked !== null) return notComputable(label, formula, inputs, blocked);

  const out = fn(values);
  if (typeof out === "string") return notComputable(label, formula, inputs, out);
  if (!Number.isFinite(out)) {
    return notComputable(label, formula, inputs, "the calculation has no finite answer for these inputs");
  }
  return { status: "ok", value: out, label, formula, inputs };
}

export function notComputable(
  label: string,
  formula: string,
  inputs: Record<string, InputValue>,
  reason: string,
): NotComputable {
  return { status: "not computable", value: null, label, formula, inputs, reason };
}

/** Division that reports "not computable" instead of returning Infinity/NaN. */
export const divide = (a: number, b: number, what: string): number | string =>
  b === 0 ? `${what} is zero, so the ratio is undefined` : a / b;

/**
 * Sum a record of named optional lines (e.g. Pittsburgh site costs).
 * A line that is omitted does not apply to this project; a line set to `null` applies but its amount
 * is unknown, which makes the sum "insufficient evidence".
 */
export function sumLines(
  label: string,
  prefix: string,
  lines: Partial<Record<string, Num>> | undefined,
): Receipt {
  const args: Record<string, Num> = {};
  for (const [k, v] of Object.entries(lines ?? {})) {
    if (v !== undefined) args[`${prefix}.${k}`] = v;
  }
  const names = Object.keys(args);
  const formula = names.length > 0 ? names.join(" + ") : "no lines apply (none entered)";
  return compute(label, formula, args, (v) => Object.values(v).reduce((s, x) => s + x, 0));
}

/**
 * Pick the first alternative whose inputs were supplied (e.g. hard cost as a total, or cost per sq ft × sq ft).
 * - An alternative that computes (or is "not computable") wins.
 * - Else, an alternative whose own inputs were all entered but which waits on an upstream value is chosen,
 *   so the missing list names only the upstream items.
 * - Else the missing list offers each alternative: "hardCost (or hardCostPerSqFt and grossSqFt)".
 */
export function oneOf(label: string, alternatives: Receipt[]): Receipt {
  const done = alternatives.find((r) => r.status !== "insufficient evidence");
  if (done) return done;
  const insufficient = alternatives.filter((r): r is Insufficient => r.status === "insufficient evidence");
  const own = (r: Insufficient) => r.missing.filter((m) => m in r.inputs);
  const upstream = (r: Insufficient) => r.missing.filter((m) => !(m in r.inputs));
  const chosen = insufficient.find((r) => own(r).length === 0);
  if (chosen) return chosen;
  const options = insufficient.map((r) => own(r).join(" and "));
  const first = options[0] ?? label;
  const offer = options.length > 1 ? `${first} (or ${options.slice(1).join(", or ")})` : first;
  return {
    status: "insufficient evidence",
    value: null,
    label,
    formula: alternatives.map((r) => r.formula).join("  OR  "),
    inputs: Object.assign({}, ...alternatives.map((r) => r.inputs)),
    missing: dedupe([offer, ...insufficient.slice(1).flatMap(upstream)]),
  };
}
