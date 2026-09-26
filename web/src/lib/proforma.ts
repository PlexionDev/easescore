import "server-only";
import { assumptions } from "@easescore/engine";

// Pro forma plumbing shared by the parcel page and the Feasibility Study: the pf_* query keys the
// "Change the assumptions" form writes, and the few database reads the cost builder needs
// (single-family comps, the prime rate, published tap fees). Reads use the publishable key.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function select<T>(pathAndQuery: string): Promise<T[]> {
  try {
    const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: KEY }, cache: "no-store" });
    return r.ok ? ((await r.json()) as T[]) : [];
  } catch {
    return [];
  }
}

type SP = Record<string, string | string[] | undefined>;

/** Query keys of the assumptions form. Percent fields are entered as percents (8 = 8%). */
export const PF = {
  tenure: "pf_tenure",
  tier: "pf_tier",
  costPerSf: "pf_cost",
  land: "pf_land",
  slopeAdderPerSf: "pf_slope",
  minePath: "pf_mine",
  groutingCost: "pf_grout",
  demolition: "pf_demo",
  geotech: "pf_geo",
  dumpsters: "pf_dump",
  aeShare: "pf_ae",
  permitShare: "pf_permit",
  softOtherShare: "pf_soft",
  contingencyShare: "pf_cont",
  constructionRate: "pf_rate",
  ltc: "pf_ltc",
  approvalMonths: "pf_approval",
  constructionMonths: "pf_months",
  salePricePerSf: "pf_price",
  rentPerUnit: "pf_rent",
} as const satisfies Record<keyof assumptions.CostOverrides, string>;

const PERCENT_KEYS = new Set<keyof assumptions.CostOverrides>(["aeShare", "permitShare", "softOtherShare", "contingencyShare", "constructionRate", "ltc"]);

export function readCostOverrides(sp: SP): assumptions.CostOverrides {
  const s = (k: string) => (typeof sp[k] === "string" && (sp[k] as string).trim() !== "" ? (sp[k] as string).trim() : undefined);
  const o: assumptions.CostOverrides = {};
  const tenure = s(PF.tenure);
  if (tenure === "sale" || tenure === "rent") o.tenure = tenure;
  const tier = s(PF.tier);
  if (tier && assumptions.COST_CONFIG.construction.tiers.some((t) => t.id === tier)) o.tier = tier;
  const mine = s(PF.minePath);
  if (mine === "grouting" || mine === "insurance") o.minePath = mine;
  for (const [key, q] of Object.entries(PF) as [keyof assumptions.CostOverrides, string][]) {
    if (key === "tenure" || key === "tier" || key === "minePath") continue;
    const raw = s(q)?.replace(/[$,%\s]/g, "");
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    (o as Record<string, number>)[key] = PERCENT_KEYS.has(key) ? n / 100 : n;
  }
  return o;
}

/** Bank prime loan rate (FRED DPRIME), latest observation, as a decimal. */
export async function primeRate(): Promise<{ rate: number; date: string } | null> {
  const rows = await select<{ value: number; date: string }>("market_series?select=value,date&series_id=eq.DPRIME&order=date.desc&limit=1");
  const r = rows[0];
  return r && Number.isFinite(r.value) ? { rate: r.value / 100, date: r.date } : null;
}

export interface TapFeeRow {
  fee_type: string;
  amount: number;
}
const HOME_TAP_FEES = /residential permit|connection fee tap 1 in \(normal|meter fee 5\/8/i;

/** The published permit, connection and meter fee items for one new home (PWSA tariff). */
export const homeTapFees = <T extends TapFeeRow>(fees: T[]): T[] => fees.filter((t) => t.amount > 0 && HOME_TAP_FEES.test(t.fee_type));

/** Tap fees for one new home inside the City (PWSA); null where no tariff is loaded. */
export async function tapFeesPerHome(isPittsburgh: boolean): Promise<number | null> {
  if (!isPittsburgh) return null;
  const rows = await select<TapFeeRow>("utility_tap_fees?select=fee_type,amount&authority=eq.Pittsburgh%20Water%20(PWSA)");
  const lines = homeTapFees(rows);
  return lines.length ? lines.reduce((s, t) => s + t.amount, 0) : null;
}

/**
 * Valid single-family sales comps for pricing a finished home. Reuses the parcel's own comps when they
 * are already single-family; otherwise asks the comps RPC for single-family sales (same minimum-5,
 * widening rules). Returns null when that search is not available.
 */
export async function singleFamilyComps(parid: string, own: assumptions.SalesCompsLike | null): Promise<assumptions.SalesCompsLike | null> {
  if (own?.comparable_use === "single family") return own;
  return rpc<assumptions.SalesCompsLike>("parcel_sales_comps", { p_parid: parid, p_use: "SINGLE FAMILY" });
}

/** Query string without the pf_* keys (for "Reset to defaults"). */
export function withoutOverrides(sp: SP): URLSearchParams {
  const q = new URLSearchParams();
  const pf = new Set<string>(Object.values(PF));
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !pf.has(k)) q.set(k, v);
  return q;
}
