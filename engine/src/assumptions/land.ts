// Land price from vacant-land sales (engine/config/land-comps.v0.1.json), never from the assessed land
// value. Private lots: the area's median sale price per sq ft of lot × this lot's area (range: 25th–75th
// percentile). Too few sales in the area: the pooled areas of the same market tier, then the City (or
// the rest of the County). Public lots: the agency sets the price, so the range runs from what agencies
// actually sold lots for (the County's GOVT SALE code) up to the private median, flagged.

import landComps from "../../config/land-comps.v0.1.json";
import { COST_CONFIG, type CostConfig } from "./config";

type Stat = { sales: number; from: string; to: string; perSqft: number[]; perLot: number[]; medianLotSqft: number; areas?: number };
type AreaEntry = { city: boolean; private?: Stat; public?: Stat; privatePeers?: Stat; publicPeers?: Stat };
export interface LandCompsTable {
  asOf: string;
  from: string;
  minSales: number;
  areas: Record<string, AreaEntry>;
  wide: Record<string, { private: Stat | null; public: Stat | null }>;
}
export const LAND_COMPS: LandCompsTable = landComps as unknown as LandCompsTable;

export interface LandEstimate {
  low: number;
  likely: number;
  high: number;
  /** "Vacant-land sales in Larimer (10 sales, 2019-01 to 2026-07): median $4.46/sq ft × 2,383 sq ft". */
  basis: string;
  /** The raw (unrounded) likely value, for the receipt. */
  raw: number;
  public: boolean;
  /** "Public land: price set by the agency" for public lots. */
  flag: string | null;
  sales: number;
  dateRange: { from: string; to: string };
  scope: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const ym = (d: string) => d.slice(0, 7);

function pick(area: string | null | undefined, city: boolean, kind: "private" | "public", t: LandCompsTable): { s: Stat; scope: string } | null {
  const e = area ? t.areas[area.trim()] : undefined;
  const own = e?.[kind];
  if (own && own.sales >= t.minSales) return { s: own, scope: area!.trim() };
  const peers = e?.[`${kind}Peers` as const];
  if (peers && peers.sales >= t.minSales) return { s: peers, scope: `${peers.areas ?? "several"} areas of the same market tier as ${area!.trim()}` };
  const w = t.wide[city ? "City of Pittsburgh" : "Allegheny County outside the City"]?.[kind];
  if (w && w.sales >= t.minSales) return { s: w, scope: city ? "the City of Pittsburgh" : "Allegheny County outside the City" };
  return null;
}

/**
 * Land estimate for a vacant lot. null when there is no lot area or no sales to price it from.
 * Rounded to $1,000 (a cost line); `raw` keeps the unrounded likely value for the receipt.
 */
export function landEstimate(
  a: { lotSqft: number | null | undefined; area: string | null | undefined; isCity: boolean; ownerClass: string | null | undefined },
  cfg: CostConfig = COST_CONFIG,
  table: LandCompsTable = LAND_COMPS,
): LandEstimate | null {
  const lot = a.lotSqft;
  if (lot == null || !(lot > 0)) return null;
  const priv = pick(a.area, a.isCity, "private", table);
  if (!priv) return null;
  const r1000 = (x: number) => Math.round(x / 1000) * 1000;
  const [q1, med, q3] = priv.s.perSqft as [number, number, number];
  const privLikely = med * lot;
  const privText = `vacant-land sales in ${priv.scope} (${priv.s.sales} sales, ${ym(priv.s.from)} to ${ym(priv.s.to)}): median $${med.toFixed(2)} per sq ft of lot × ${Math.round(lot).toLocaleString("en-US")} sq ft`;
  const isPublic = !!a.ownerClass && (cfg.land.publicOwnerClasses as string[]).includes(a.ownerClass);
  if (!isPublic) {
    return {
      low: r1000(q1 * lot), likely: r1000(privLikely), high: r1000(q3 * lot), raw: privLikely,
      basis: `${privText.charAt(0).toUpperCase()}${privText.slice(1)} = ${usd(privLikely)}; range = middle half of the sales ($${q1.toFixed(2)}–$${q3.toFixed(2)}/sq ft)`,
      public: false, flag: null, sales: priv.s.sales, dateRange: { from: priv.s.from, to: priv.s.to }, scope: priv.scope,
    };
  }
  // Public lot: agencies set the price. Low / likely from what agencies sold lots for; high = the private median.
  const pub = pick(a.area, a.isCity, "public", table);
  const pLow = pub ? pub.s.perSqft[0]! * lot : 0;
  const pMid = pub ? pub.s.perSqft[1]! * lot : privLikely / 2;
  const likely = Math.min(pMid, privLikely);
  const low = Math.min(pLow, likely);
  const high = Math.max(privLikely, likely);
  const pubText = pub
    ? `agency sales of vacant lots in ${pub.scope} (${pub.s.sales} sales, ${ym(pub.s.from)} to ${ym(pub.s.to)}): median $${pub.s.perSqft[1]!.toFixed(2)} per sq ft × ${Math.round(lot).toLocaleString("en-US")} sq ft = ${usd(pMid)}`
    : "no agency sales recorded nearby: half the private median (Assumption, edit me)";
  return {
    low: r1000(low), likely: r1000(likely), high: r1000(high), raw: likely,
    basis: `Public land: price set by the agency. Likely from ${pubText}; the range runs from the 25th percentile of agency sales up to the private market (${privText} = ${usd(privLikely)}).`,
    public: true, flag: cfg.land.publicFlag, sales: (pub?.s.sales ?? 0) + priv.s.sales,
    dateRange: { from: [priv.s.from, pub?.s.from ?? priv.s.from].sort()[0]!, to: [priv.s.to, pub?.s.to ?? priv.s.to].sort()[1]! }, scope: pub?.scope ?? priv.scope,
  };
}
