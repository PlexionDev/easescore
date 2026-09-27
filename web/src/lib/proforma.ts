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
  units: "pf_units",
  storiesAboveGarage: "pf_floors",
  parking: "pf_parking",
  bedrooms: "pf_beds",
  baths: "pf_baths",
  costPerUnit: "pf_unit_cost",
  costIncludesSite: "pf_unit_site",
  salePricePerUnit: "pf_unit_price",
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
  const parking = s(PF.parking);
  if (parking === "tuck_under" || parking === "pad" || parking === "none") o.parking = parking;
  const inc = s(PF.costIncludesSite);
  if (inc === "yes" || inc === "no") o.costIncludesSite = inc === "yes";
  for (const [key, q] of Object.entries(PF) as [keyof assumptions.CostOverrides, string][]) {
    if (key === "tenure" || key === "tier" || key === "minePath" || key === "parking" || key === "costIncludesSite") continue;
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

// ---------------------------------------------------------------------------------------------
// New-construction sales around a parcel, from the database function new_construction_comps
// (migration 095). It returns the candidate sale records within the widest search radius; the engine
// applies the comp rules (dates, size, age at sale, radius steps) exactly as before.

/** Arguments for new_construction_comps from the versioned cost config. */
export function newConstructionArgs(parid: string, asOf: string) {
  const r = assumptions.COST_CONFIG.comps.newConstruction;
  return {
    p_parid: parid, p_as_of: asOf, p_years: r.years, p_max_age: r.maxAgeAtSaleYears, p_min_sqft: r.minLivingAreaSqft,
    p_min_price: r.minPrice, p_max_mi: r.radiiMi[r.radiiMi.length - 1], p_uses: [...r.singleFamilyUses, ...r.attachedUses],
  };
}

/** Recent new-construction sales near a parcel; null when they could not be loaded. */
export function newConstructionSalesNear(parid: string, asOf: string): Promise<assumptions.SaleRecord[] | null> {
  return rpc<assumptions.SaleRecord[]>("new_construction_comps", newConstructionArgs(parid, asOf));
}

/** New-construction comps for a strategy from already-loaded nearby sales. */
export function newCompsFrom(strategy: string, parid: string, centroid: { lat?: number; lon?: number } | null | undefined, records: assumptions.SaleRecord[] | null, asOf: string): assumptions.CompSet | null {
  if (strategy === "rehab_existing" || centroid?.lat == null || centroid?.lon == null || !records) return null;
  return assumptions.newConstructionCompsFor(strategy, { lat: centroid.lat, lon: centroid.lon, parid }, records, asOf);
}

/** New-construction comps around a parcel for a strategy; null when the sales could not be loaded. */
export async function newCompsFor(strategy: string, parid: string, centroid: { lat?: number; lon?: number } | null | undefined, asOf: string): Promise<assumptions.CompSet | null> {
  if (strategy === "rehab_existing" || centroid?.lat == null || centroid?.lon == null) return null;
  return newCompsFrom(strategy, parid, centroid, await newConstructionSalesNear(parid, asOf), asOf);
}

type RpcComp = { parid: string; address?: string | null; sale_date: string; price: number; living_area_sqft?: number | null; distance_mi: number };

/** Existing-home comps for a rehab, matched on size and age (year built looked up for the listed comps). */
export async function rehabComps(
  own: { comparable_use?: string | null; radius_mi?: number | null; search_steps?: string[] | null; comps?: RpcComp[] | null } | null,
  subject: { livingAreaSqft: number | null; yearBuilt: number | null },
): Promise<assumptions.CompSet> {
  const list = own?.comps ?? [];
  const ids = [...new Set(list.map((c) => c.parid))];
  const rows = ids.length ? await select<{ parid: string; year_built: number | null; condition_desc: string | null }>(`assessments?select=parid,year_built,condition_desc&parid=in.(${ids.join(",")})`) : [];
  const y = new Map(rows.map((r) => [r.parid, r]));
  return assumptions.matchedExistingComps(subject, { ...own, comps: list.map((c) => ({ ...c, year_built: y.get(c.parid)?.year_built ?? null, condition_desc: y.get(c.parid)?.condition_desc ?? null })) });
}

/** Query string without the pf_* keys (for "Reset to defaults"). */
export function withoutOverrides(sp: SP): URLSearchParams {
  const q = new URLSearchParams();
  const pf = new Set<string>(Object.values(PF));
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !pf.has(k)) q.set(k, v);
  return q;
}
