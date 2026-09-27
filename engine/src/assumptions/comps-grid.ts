// Comparable-sales grid for the report and the pencil panel. Pure and deterministic.
//
// Single source: the grid is built from the SAME CompSet the pro forma priced the home from
// (plan.valueComps). Its $/SF median and middle-half range are the set's own numbers, so the grid
// and the sale value can never disagree. The grid only orders and trims the rows for display.

import { blockLevelAddress } from "../rents";

/** Block-level address for the screen ("1200 block of Smith St"); full addresses only in the PDF. */
export const blockLevelAddressOf = blockLevelAddress;
import type { CompRow, CompSet } from "./comps";
import { COST_CONFIG } from "./config";

export type HomeType = "detached" | "attached" | "condo" | "unknown";

export const HOME_TYPE_LABEL: Record<HomeType, string> = { detached: "Detached", attached: "Attached", condo: "Condo", unknown: "Not recorded" };

/** County use → home type. */
export function homeTypeOf(use: string | null | undefined): HomeType {
  const u = String(use ?? "").toUpperCase();
  if (!u) return "unknown";
  if (/CONDO/.test(u)) return "condo";
  if (/TOWNHOUSE|ROWHOUSE|ROW HOUSE/.test(u)) return "attached";
  if (/SINGLE FAMILY/.test(u)) return "detached";
  return "unknown";
}

/** The planned home's type from the strategy (townhouse rows are attached; other new builds detached). */
export function subjectHomeType(strategy: string | null | undefined): HomeType {
  return strategy === "townhouse_row" ? "attached" : "detached";
}

export interface CompGridRow extends CompRow {
  type: HomeType;
  sameType: boolean;
  /** "1200 block of Smith St" (screen). The full address is `address` (PDF only). */
  blockAddress: string;
}

export interface CompGrid {
  /** ok: 5+ sales in the value set; few: some but fewer than 5; none: no sales. */
  status: "ok" | "few" | "none";
  subjectType: HomeType;
  /** Sales in the value set (the pro forma's median uses all of them). */
  inSet: number;
  /** Rows shown (up to `max`), ordered by the selection rule. */
  rows: CompGridRow[];
  /** Median and middle half of $/SF across the whole value set: the pro forma's numbers. */
  medianPerSf: number | null;
  p25PerSf: number | null;
  p75PerSf: number | null;
  radiusMi: number;
  steps: string[];
  /** How the rows are ordered and trimmed, plain words. */
  orderRule: string;
  /** How the value set itself was chosen (the comp engine's receipt). */
  setRule: string;
  /** Template sentence from the numbers; null when there is nothing to reconcile. */
  reconciliation: string | null;
  confidence: "Moderate" | "Low";
  confidenceWhy: string;
  /** Plain note when fewer than 5 sales qualify (what was searched). */
  fewNote: string | null;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const round5k = (n: number) => Math.round(n / 5000) * 5000;
const cmpDate = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/**
 * Build the grid from the pro forma's value comps.
 * Order: same home type as the plan first, then nearest, then most recent sale; keep `max` (10).
 */
export function compsGrid(
  set: CompSet | null | undefined,
  opts: {
    strategy?: string | null;
    /** Planned finished sq ft per home (for the per-home range). */
    perHomeSf?: number | null;
    /** The $/SF the pro forma used and whether it is the user's own number. */
    valuePerSf?: number | null;
    userValue?: boolean;
    /** Label for a comp in the reconciliation sentence (default: block level). */
    label?: (r: CompGridRow) => string;
    max?: number;
    minComps?: number;
  } = {},
): CompGrid {
  const max = opts.max ?? 10;
  const minComps = opts.minComps ?? 5;
  const subjectType = subjectHomeType(opts.strategy);
  // Rows from a stored set may predate the `use` field: fall back to the set's comparable use.
  const setType: HomeType = set ? (/townhouse|rowhouse/i.test(set.comparable_use) ? "attached" : /single-family/i.test(set.comparable_use) ? "detached" : "unknown") : "unknown";
  const all: CompGridRow[] = (set?.comps ?? []).map((r) => {
    const type = r.use ? homeTypeOf(r.use) : setType;
    return { ...r, type, sameType: type === subjectType, blockAddress: r.address ? blockLevelAddress(r.address) : "Address not recorded" };
  });
  all.sort((a, b) => Number(b.sameType) - Number(a.sameType) || a.distanceMi - b.distanceMi || cmpDate(a.saleDate, b.saleDate) || (a.parid < b.parid ? -1 : a.parid > b.parid ? 1 : 0));
  const rows = all.slice(0, max);
  const inSet = set?.count ?? 0;
  const ok = !!set && set.sufficient && inSet >= minComps;
  const status: CompGrid["status"] = ok ? "ok" : inSet > 0 ? "few" : "none";
  const med = set?.median_price_per_sqft ?? null;
  const p25 = set?.selection?.p25PerSqft ?? null;
  const p75 = set?.selection?.p75PerSqft ?? null;
  const orderRule = `Shown: the ${Math.min(max, all.length) || max} most similar of the ${inSet} sale${inSet === 1 ? "" : "s"} in the value set, ${subjectType === "attached" ? "attached (townhouse or rowhouse)" : "detached"} homes first, then nearest, then most recent sale. The median and middle half below use all ${inSet}.`;
  const label = opts.label ?? ((r: CompGridRow) => r.blockAddress);

  let reconciliation: string | null = null;
  if (rows.length) {
    const top = rows.slice(0, 3);
    const lo = Math.min(...top.map((r) => r.pricePerSqft)), hi = Math.max(...top.map((r) => r.pricePerSqft));
    const names = top.map(label);
    const list = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const first = `The most similar sale${top.length === 1 ? " is" : "s are"} ${list} at ${lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`}/SF.`;
    const sf = opts.perHomeSf && opts.perHomeSf > 0 ? Math.round(opts.perHomeSf) : null;
    let second = "";
    if (opts.userValue && opts.valuePerSf != null) second = ` The study uses your price of ${usd(opts.valuePerSf)}/SF instead; the sales are shown for comparison.`;
    else if (ok && med != null && p25 != null && p75 != null && sf) {
      const typical = set?.median_living_area_sqft ?? null;
      const why: string[] = [`new construction (every sale was built within ${COST_CONFIG.comps.newConstruction.maxAgeAtSaleYears} years of its sale)`];
      if (typical) {
        if (sf < typical * 0.85) why.push(`a smaller home than the typical sale (${sf.toLocaleString("en-US")} vs ${Math.round(typical).toLocaleString("en-US")} sq ft), priced at the same $/SF`);
        else if (sf > typical * 1.15) why.push(`a larger home than the typical sale (${sf.toLocaleString("en-US")} vs ${Math.round(typical).toLocaleString("en-US")} sq ft), priced at the same $/SF`);
        else why.push(`a size close to the typical sale (${Math.round(typical).toLocaleString("en-US")} sq ft)`);
      }
      second = ` Projected pricing of ${usd(round5k(p25 * sf))}–${usd(round5k(p75 * sf))} per home (${usd(p25)}–${usd(p75)}/SF, the middle half of all ${inSet} sales; the study uses the median, ${usd(med)}/SF, × ${sf.toLocaleString("en-US")} sq ft) reflects ${why.join(" and ")}. Parking is not in the County sale records, so it is not adjusted.`;
    } else if (!ok) second = ` Fewer than ${minComps} new-construction sales qualify, so no sale value is estimated from them.`;
    reconciliation = first + second;
  }

  const steps = set?.search_steps ?? [];
  const fewNote = ok ? null
    : `Only ${inSet} new-construction sale${inSet === 1 ? "" : "s"} qualif${inSet === 1 ? "ies" : "y"} (at least ${minComps} are needed). The search widened step by step: ${steps.length ? steps.join(" → ") : "no sales found"}. Older homes are never used as the value of a new home.`;
  const confidence: CompGrid["confidence"] = ok ? "Moderate" : "Low";
  const confidenceWhy = ok
    ? `${inSet} valid new-construction sales (${minComps} or more needed for Moderate)`
    : `${inSet} valid new-construction sale${inSet === 1 ? "" : "s"}, fewer than ${minComps}`;
  return {
    status, subjectType, inSet, rows, medianPerSf: med, p25PerSf: p25, p75PerSf: p75,
    radiusMi: set?.radius_mi ?? 0, steps, orderRule, setRule: set?.selection?.receipt ?? set?.rule ?? "",
    reconciliation, confidence, confidenceWhy, fewNote,
  };
}
