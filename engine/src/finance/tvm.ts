// Time-value-of-money primitives. Pure math on plain numbers; the Receipt layer sits on top.
// Cash-flow arrays are per period with flows[0] at time 0 (not discounted).

/** Net present value: Σ flows[t] ÷ (1 + rate)^t, with t = 0 undiscounted. */
export function npv(rate: number, flows: readonly number[]): number {
  let total = 0;
  for (let t = 0; t < flows.length; t++) total += (flows[t] ?? 0) / Math.pow(1 + rate, t);
  return total;
}

/** d(NPV)/d(rate), used by Newton's method. */
function npvDerivative(rate: number, flows: readonly number[]): number {
  let total = 0;
  for (let t = 1; t < flows.length; t++) total += (-t * (flows[t] ?? 0)) / Math.pow(1 + rate, t + 1);
  return total;
}

/** True when the flows contain at least one positive and one negative value (an IRR can exist). */
export function hasSignChange(flows: readonly number[]): boolean {
  return flows.some((f) => f > 0) && flows.some((f) => f < 0);
}

// Solver settings (numerical, not financial assumptions).
const TOLERANCE = 1e-10;
const MAX_NEWTON = 100;
const MAX_BISECT = 300;
const NEWTON_SEED = 0.1;
/** Rates scanned (per period) to bracket a root for the bisection fallback. */
const BRACKET_GRID = [-0.999999, -0.99, -0.9, -0.75, -0.5, -0.25, -0.1, 0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 100, 1000];

/**
 * Internal rate of return per period: the rate at which NPV = 0.
 * Newton's method first; if it fails to converge, bisection over a bracket found by scanning rates.
 * Returns null when the flows never change sign (no IRR exists) or no root can be bracketed.
 * With several sign changes more than one IRR can exist; this returns the one Newton/bisection reaches
 * (the root nearest the seed, else the lowest bracketed root).
 */
export function irr(flows: readonly number[]): number | null {
  if (!hasSignChange(flows)) return null;
  const scale = flows.reduce((s, f) => s + Math.abs(f), 0);

  let r = NEWTON_SEED;
  for (let k = 0; k < MAX_NEWTON; k++) {
    const f = npv(r, flows);
    if (Math.abs(f) <= TOLERANCE * scale) return r;
    const d = npvDerivative(r, flows);
    if (d === 0 || !Number.isFinite(d)) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < TOLERANCE) {
      if (Math.abs(npv(next, flows)) <= Math.sqrt(TOLERANCE) * scale) return next;
      break;
    }
    r = next;
  }

  for (let g = 0; g + 1 < BRACKET_GRID.length; g++) {
    const lo = BRACKET_GRID[g] as number;
    const hi = BRACKET_GRID[g + 1] as number;
    const root = bisect((x) => npv(x, flows), lo, hi);
    if (root !== null) return root;
  }
  return null;
}

/**
 * Bisection root-finder on [lo, hi]. Returns null if f(lo) and f(hi) have the same sign.
 * Deterministic: fixed iteration cap and tolerance.
 */
export function bisect(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tolerance = TOLERANCE,
  maxIter = MAX_BISECT,
): number | null {
  let a = lo;
  let b = hi;
  let fa = f(a);
  const fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  for (let k = 0; k < maxIter; k++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0 || (b - a) / 2 < tolerance) return m;
    if (fa * fm < 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** Level payment per period for a fully amortizing loan: P·i ÷ (1 − (1 + i)^−n); P ÷ n when i = 0. */
export function payment(principal: number, ratePerPeriod: number, periods: number): number {
  if (periods <= 0) return NaN;
  if (ratePerPeriod === 0) return principal / periods;
  return (principal * ratePerPeriod) / (1 - Math.pow(1 + ratePerPeriod, -periods));
}

/** Monthly payment for an annual nominal rate and a term in years (rate ÷ 12, years × 12 payments). */
export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  return payment(principal, annualRate / 12, years * 12);
}

/** Present value of a level payment stream: pmt · (1 − (1 + i)^−n) ÷ i; pmt · n when i = 0. */
export function presentValueOfPayments(pmt: number, ratePerPeriod: number, periods: number): number {
  if (ratePerPeriod === 0) return pmt * periods;
  return (pmt * (1 - Math.pow(1 + ratePerPeriod, -periods))) / ratePerPeriod;
}

/** Remaining balance after k level payments: P(1 + i)^k − pmt · ((1 + i)^k − 1) ÷ i. */
export function balanceAfter(principal: number, ratePerPeriod: number, periods: number, k: number): number {
  const pmt = payment(principal, ratePerPeriod, periods);
  if (k >= periods) return 0;
  if (ratePerPeriod === 0) return principal - pmt * k;
  const g = Math.pow(1 + ratePerPeriod, k);
  return principal * g - (pmt * (g - 1)) / ratePerPeriod;
}

export interface AmortizationRow {
  period: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/** Month-by-month amortization schedule for an annual nominal rate and a term in years. */
export function amortizationSchedule(principal: number, annualRate: number, years: number): AmortizationRow[] {
  const i = annualRate / 12;
  const n = Math.round(years * 12);
  const pmt = payment(principal, i, n);
  const rows: AmortizationRow[] = [];
  let balance = principal;
  for (let p = 1; p <= n; p++) {
    const interest = balance * i;
    const toPrincipal = pmt - interest;
    balance = p === n ? 0 : balance - toPrincipal;
    rows.push({ period: p, payment: pmt, interest, principal: toPrincipal, balance });
  }
  return rows;
}

/** Equivalent per-month rate for an annual effective rate: (1 + r)^(1/12) − 1. */
export const monthlyFromAnnual = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1;

/** Annual effective rate for a per-month rate: (1 + m)^12 − 1. */
export const annualFromMonthly = (monthly: number) => Math.pow(1 + monthly, 12) - 1;

/** First period index at which cumulative cash flow turns ≥ 0 (after being negative); null if never. */
export function paybackPeriod(flows: readonly number[]): number | null {
  let cumulative = 0;
  let wasNegative = false;
  for (let t = 0; t < flows.length; t++) {
    cumulative += flows[t] ?? 0;
    if (cumulative < 0) wasNegative = true;
    else if (wasNegative) return t;
  }
  return null;
}

/** Total cash returned ÷ total cash put in (sum of positive flows ÷ sum of negative flows). */
export function equityMultiple(flows: readonly number[]): number | null {
  const out = flows.reduce((s, f) => (f < 0 ? s - f : s), 0);
  const back = flows.reduce((s, f) => (f > 0 ? s + f : s), 0);
  return out === 0 ? null : back / out;
}
