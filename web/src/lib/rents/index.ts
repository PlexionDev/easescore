import "server-only";
import { rents } from "@easescore/engine";
import { parcelFacts, rentComps } from "@/lib/data";
import { rentcastZipMarket } from "./rentcast";

export const RENT_BEDROOMS = [1, 2, 3];

/**
 * Rents by bedroom count for a parcel: RentCast market statistics for the parcel's ZIP (median asking
 * rent by bedroom count), cross-checked with HUD Small Area FMR and ZORI (parcel_rent_comps). Never
 * throws: without RentCast statistics it falls back to HUD Small Area FMR with an honest label.
 * Listing-level RentCast lookups are no longer made.
 *
 * allowLive: only the on-demand /api/rents route passes true. Everything else (report, precompute,
 * batch scripts) reads the ZIP cache only and never calls RentCast.
 */
export async function loadRents(
  parid: string, asOf: string, bedrooms: number[] = RENT_BEDROOMS,
  /** parcel_facts and parcel_rent_comps the caller already has (e.g. the pane row), instead of two more calls. */
  pre?: { facts: Record<string, unknown> | null; rent: unknown },
  opts: { allowLive?: boolean; caller?: string } = {},
): Promise<rents.RentsByBedroom | null> {
  const [facts, rc] = pre
    ? [pre.facts, pre.rent]
    : await Promise.all([parcelFacts(parid).catch(() => null), rentComps(parid).catch(() => null)]);
  if (!facts) return null;
  const r = rc as { hud_fmr?: rents.HudBenchmark | null; zori?: rents.ZoriBenchmark | null } | null;
  const zip = r?.hud_fmr?.zip ?? r?.zori?.zip ?? null;
  const { market, status } = await rentcastZipMarket(zip, { allowLive: opts.allowLive === true, caller: opts.caller ?? "server" });
  return rents.rentsByBedroom({ asOf, bedrooms, listings: {}, market, marketNote: rents.marketNote(status), hud: r?.hud_fmr ?? null, zori: r?.zori ?? null });
}

/** Screen copy: comp addresses are block-level only (the full address stays in the downloadable report). */
export function forScreen(r: rents.RentsByBedroom): rents.RentsByBedroom {
  const byBedroom: Record<number, rents.RentEstimate> = {};
  for (const [k, e] of Object.entries(r.byBedroom)) byBedroom[Number(k)] = { ...e, comps: e.comps.map((c) => ({ ...c, address: c.block })) };
  return { ...r, byBedroom };
}
