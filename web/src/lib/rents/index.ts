import "server-only";
import { rents } from "@easescore/engine";
import { parcelFacts, rentComps } from "@/lib/data";
import { rentcastListings } from "./rentcast";

export const RENT_BEDROOMS = [1, 2, 3];

/**
 * Rents by bedroom count for a parcel: RentCast listings near the parcel's centroid, summarized by the
 * engine, cross-checked with HUD Small Area FMR and ZORI (parcel_rent_comps). Never throws: without
 * RentCast it falls back to the labeled HUD/ZORI benchmark. Full comp addresses are included — use
 * forScreen() before sending to a browser.
 */
export async function loadRents(parid: string, asOf: string, bedrooms: number[] = RENT_BEDROOMS): Promise<rents.RentsByBedroom | null> {
  const [facts, rc] = await Promise.all([parcelFacts(parid).catch(() => null), rentComps(parid).catch(() => null)]);
  if (!facts) return null;
  const c = facts.centroid as { lat?: number; lon?: number } | undefined;
  const r = rc as { hud_fmr?: rents.HudBenchmark | null; zori?: rents.ZoriBenchmark | null } | null;
  const pulls = c?.lat != null && c?.lon != null ? await rentcastListings(c.lat, c.lon, bedrooms) : {};
  const listings: Record<number, rents.RentListing[] | null> = {};
  let pulledOn: string | null = null;
  for (const br of bedrooms) {
    const p = pulls[br];
    listings[br] = p?.listings ?? null;
    if (p && (!pulledOn || p.fetchedAt < pulledOn)) pulledOn = p.fetchedAt;
  }
  pulledOn = pulledOn?.slice(0, 10) ?? null;
  return rents.rentsByBedroom({ asOf, bedrooms, listings, pulledOn, hud: r?.hud_fmr ?? null, zori: r?.zori ?? null });
}

/** Screen copy: comp addresses are block-level only (the full address stays in the downloadable report). */
export function forScreen(r: rents.RentsByBedroom): rents.RentsByBedroom {
  const byBedroom: Record<number, rents.RentEstimate> = {};
  for (const [k, e] of Object.entries(r.byBedroom)) byBedroom[Number(k)] = { ...e, comps: e.comps.map((c) => ({ ...c, address: c.block })) };
  return { ...r, byBedroom };
}
