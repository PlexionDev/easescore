import "server-only";

// Assembles the site plan sheet (EA-101) for the report: parcel map layers from the database, the
// QuickFit result, the zoning setbacks and the lidar terrain grid, then the deterministic SVG.

import { score as ease } from "@easescore/engine";
import { parcelMap } from "@/lib/data";
import { layoutSitePlan, renderSitePlan, type LonLatAffine, type ParcelMapFC, type SitePlanInput } from "./siteplan";
import { sampleDem } from "./terrain";
import type { Facts, QFInputPayload, ReportModel } from "./load";
import { configVersionOf } from "./score";
import { titleCase } from "./assess";

export interface SitePlanSheet {
  svg: string;
  scaleFt: number;
  extended: boolean;
  terrain: boolean;
}

type Model = Pick<ReportModel, "parid" | "facts" | "qfInput" | "qf" | "qfError" | "rules" | "scheme" | "closest" | "frontInferred" | "generatedDate" | "score">;

function noFootprintReason(m: Model): string {
  if (m.qfError) return m.qfError;
  const c = m.closest;
  if (c) {
    const what = `The closest layout the solver found is a ${c.typologyLabel.toLowerCase()}`;
    const limit = c.binding?.label ? ` ${c.binding.label}.` : "";
    if (c.badge === "by_right") return `the studied building type does not fit. ${what}, allowed by right.${limit}`;
    if (c.badge === "not_permitted") return `no layout is a permitted use here. ${what}, which is not permitted.${limit}`;
    const needs = c.approvals.map((x) => x.label).filter(Boolean);
    return `no layout is allowed by right. ${what}; it needs ${needs.length ? needs.join("; ") : "zoning approval"}.${limit}`;
  }
  if (m.qf && !m.qf.all.length) return "no building of the studied types fits inside the buildable area after setbacks.";
  return "the site-fit solver did not place a building.";
}

export async function buildSitePlanSheet(m: Model): Promise<SitePlanSheet | null> {
  const qi = m.qfInput as (QFInputPayload & { toLonLat?: LonLatAffine }) | null;
  if (!qi?.parcel?.length || !qi.toLonLat) return null;
  const f: Facts = m.facts;
  const r = m.rules;
  const front = r?.min_front_setback_ft ?? 0;
  const setbacks = r
    ? { front, rear: r.min_rear_setback_ft ?? 0, side: r.min_side_setback_ft ?? 0, exterior_side: r.exterior_side_setback_ft ?? front }
    : null;
  const map = (await parcelMap(m.parid).catch(() => null)) as ParcelMapFC | null;
  const version = configVersionOf(m.score);
  const input: SitePlanInput = {
    parid: m.parid,
    address: titleCase(f.assessment?.address) || m.parid,
    zoningCode: f.zoning?.code ?? null,
    zoningName: (r?.district_name as string | null | undefined) ?? f.zoning?.type ?? null,
    lotAreaSf: (f.lot_area_sqft_gis as number | undefined) ?? f.assessment?.lot_area_sqft ?? null,
    generatedDate: m.generatedDate,
    engineVersion: version === "pending" ? `v${ease.DEFAULT_CONFIG.version}` : version,
    affine: qi.toLonLat,
    parcel: qi.parcel,
    frontEdges: qi.frontEdges,
    streetSideEdges: qi.streetSideEdges ?? [],
    frontInferred: !!m.frontInferred,
    setbacks: setbacks && qi.frontEdges.length ? setbacks : null,
    contextualFront: !!r?.contextual_front_setback,
    setbackCitation: r?.citation ?? null,
    envelope: (m.qf?.envelope.polygons ?? []) as SitePlanInput["envelope"],
    envelopeAreaSf: m.qf?.envelope.areaSf ?? null,
    scheme: m.scheme
      ? {
          label: m.scheme.typologyLabel,
          units: m.scheme.units,
          stories: m.scheme.stories,
          footprints: m.scheme.footprints as SitePlanInput["parcel"][],
          byRight: m.scheme.byRight,
        }
      : null,
    noFootprintReason: m.scheme ? null : noFootprintReason(m),
    steepShareOfLot: typeof f.slope_1m?.share_over_25 === "number" ? f.slope_1m.share_over_25 : null,
    map: map && Array.isArray(map.features) ? map : null,
  };
  const layout = layoutSitePlan(input);
  const dem = await sampleDem(layout.bounds, 3, input.affine).catch(() => null);
  const svg = renderSitePlan(input, layout, dem);
  return { svg, scaleFt: layout.scaleFt, extended: layout.extended, terrain: !!dem };
}
