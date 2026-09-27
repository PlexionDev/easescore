// Rounding and formatting helpers for estimates shown as ranges. Ranges, not false precision:
// every estimate is rounded to two significant figures by default, and low ≤ likely ≤ high is enforced.

export type Range = { low: number; likely: number; high: number };

export type RangeFormat = "count" | "money" | "pct" | "acres" | ((n: number) => string);

/** Round to `sig` significant figures (0 stays 0). roundSig(3642, 2) = 3600. */
export function roundSig(n: number, sig = 2): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - sig + 1);
  return Math.round(n / p) * p;
}

/**
 * Round a whole range with ONE step, set by its largest magnitude, so low/likely/high stay comparable
 * ("2,900 to 3,600", never "2,940 to 3,600"). Returns the values ordered low ≤ likely ≤ high.
 */
export function roundRange(r: Range, sig = 2): Range {
  const [low, likely, high] = orderRange(r);
  const top = Math.max(Math.abs(low), Math.abs(likely), Math.abs(high));
  if (top === 0) return { low: 0, likely: 0, high: 0 };
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(top)) - sig + 1));
  const f = (x: number) => Math.round(x / step) * step;
  return { low: f(low), likely: f(likely), high: f(high) };
}

/** [low, likely, high] sorted, so a caller's mistake can never show an inverted range. */
export function orderRange(r: Range): [number, number, number] {
  const xs = [r.low, r.likely, r.high].map((x) => (Number.isFinite(x) ? x : 0));
  xs.sort((a, b) => a - b);
  return [xs[0]!, xs[1]!, xs[2]!];
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 2900 → "2,900". */
export function fmtCount(n: number): string {
  return nf.format(Math.round(n));
}

/** 3100000 → "$3.1M", 640000 → "$640K", 950 → "$950". Negative → "−$3.1M". */
export function fmtMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${trim(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${trim(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${trim(a / 1e3)}K`;
  return `${sign}$${nf.format(a)}`;
}

/** 41.3 → "41%" (input is already a percent). */
export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

export function fmtAcres(n: number): string {
  return `${n < 10 ? n.toFixed(1) : nf.format(n)} acres`;
}

function trim(x: number): string {
  // One decimal below 10 ($3.1M), none above ($640K).
  return x < 10 ? String(Math.round(x * 10) / 10) : nf.format(Math.round(x));
}

export function formatter(f: RangeFormat = "count"): (n: number) => string {
  if (typeof f === "function") return f;
  return f === "money" ? fmtMoney : f === "pct" ? fmtPct : f === "acres" ? fmtAcres : fmtCount;
}

/**
 * Plain-text range: "2,900 to 3,600". Collapses to one value when low == high. `signed` prefixes "+"
 * on positive values (for "more homes" deltas).
 */
export function formatRange(r: Range, opts: { format?: RangeFormat; sig?: number | false; signed?: boolean } = {}): string {
  const rr = opts.sig === false ? toRange(orderRange(r)) : roundRange(r, opts.sig ?? 2);
  const f = formatter(opts.format);
  const s = (n: number) => (opts.signed && n > 0 ? `+${f(n)}` : f(n));
  if (rr.low === rr.high) return s(rr.likely);
  // Money reads fine with an en dash ("$3.1M–$4.4M"); counts read better with "to".
  return typeof opts.format === "string" && opts.format === "money" ? `${s(rr.low)}–${f(rr.high)}` : `${s(rr.low)} to ${f(rr.high)}`;
}

function toRange([low, likely, high]: [number, number, number]): Range {
  return { low, likely, high };
}
