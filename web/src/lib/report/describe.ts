// Plain-text descriptions of drawings, generated from the same numbers the drawing uses. They are the
// alt text of the site plan in the PDF and the "Describe this view" text on screen, so a screen-reader
// user gets the lot, the rules and the studied building without seeing the picture.

type XY = [number, number];

/** Shoelace area of a closed ring (units²). */
export function ringArea(r: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i]!;
    const [x1, y1] = r[(i + 1) % r.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

export interface DrawingFacts {
  parid: string;
  address?: string | null;
  zoningCode?: string | null;
  lotAreaSf?: number | null;
  setbacks?: Partial<Record<"front" | "rear" | "side" | "exterior_side", number>> | null;
  contextualFront?: boolean;
  setbackCitation?: string | null;
  envelopeAreaSf?: number | null;
  scheme?: { label: string; units: number; stories: number; footprints: readonly (readonly XY[])[]; byRight: boolean } | null;
  noFootprintReason?: string | null;
  steepShareOfLot?: number | null;
  scaleFt?: number | null;
}

/** One paragraph describing the lot, the setbacks and the studied building. */
export function describeSitePlan(f: DrawingFacts): string {
  const out: string[] = [];
  out.push(`Site plan of parcel ${f.parid}${f.address ? `, ${f.address}` : ""}${f.scaleFt ? `, drawn at 1 inch = ${f.scaleFt} feet` : ""}.`);
  if (f.lotAreaSf) out.push(`The lot is ${n0(f.lotAreaSf)} square feet${f.zoningCode ? `, zoned ${f.zoningCode}` : ""}.`);
  const sb = f.setbacks;
  if (sb) {
    const parts = [
      sb.front != null ? `front ${n0(sb.front)} ft${f.contextualFront ? " (matching the neighbors)" : ""}` : null,
      sb.side != null ? `sides ${n0(sb.side)} ft` : null,
      sb.rear != null ? `rear ${n0(sb.rear)} ft` : null,
      sb.exterior_side != null ? `street side ${n0(sb.exterior_side)} ft` : null,
    ].filter(Boolean);
    if (parts.length) out.push(`Required setbacks: ${parts.join(", ")}${f.setbackCitation ? ` (${f.setbackCitation})` : ""}.`);
  }
  if (f.envelopeAreaSf) out.push(`The area left to build on inside the setbacks is about ${n0(f.envelopeAreaSf)} square feet.`);
  if (f.scheme && f.scheme.footprints.length) {
    const fp = f.scheme.footprints.reduce((t, r) => t + ringArea(r), 0);
    const s = f.scheme;
    out.push(`Studied building: ${s.label}, ${s.units} home${s.units === 1 ? "" : "s"}, ${s.stories} ${s.stories === 1 ? "story" : "stories"}, footprint about ${n0(fp)} square feet${f.lotAreaSf ? ` (${Math.round((100 * fp) / f.lotAreaSf)}% of the lot)` : ""}; ${s.byRight ? "allowed by right" : "needs zoning relief"}.`);
  } else if (f.noFootprintReason) {
    out.push(`No building is drawn: ${f.noFootprintReason}`);
  }
  if (f.steepShareOfLot != null && f.steepShareOfLot > 0) out.push(`${Math.round(f.steepShareOfLot * 100)}% of the lot is steep ground.`);
  return out.join(" ");
}

/** Plain names for the parcel overlay layers (parcel_facts.overlays[].layer). */
const OVERLAY_LABEL: Record<string, string> = {
  landslide_prone_pgh: "the City's landslide-prone overlay",
  undermined_pgh: "the City's undermined-area overlay",
  historic_district_pgh: "a City historic district",
  inclusionary_pgh: "the City's inclusionary housing overlay",
  parking_reduction_pgh: "a City parking-reduction area",
  zoning_overlay_pgh: "a City zoning overlay",
  landslide_recorded: "a slope-movement area on the 1982 landslide inventory (a historic map)",
  combined_sewer: "the combined-sewer service area",
  mined_out_dep: "a PA DEP mapped mine area",
  wetland_nwi: "a mapped wetland (National Wetlands Inventory)",
  greenway_pgh: "a City greenway",
  flood_fema_nfhl: "a FEMA flood zone",
};
export const overlayLabel = (layer: string) => OVERLAY_LABEL[layer] ?? layer.replace(/_pgh$/, "").replace(/_/g, " ");
