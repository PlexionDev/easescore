import type { Metadata } from "next";
import { score } from "@easescore/engine";
import {
  CITY, CSV_DATE_SOURCES, PAGE_SIZE, parseDir, parseFilters, parseSort, plannerOptions, plannerQuery, type PlannerOptions, type PlannerResult,
} from "@/lib/planner";
import PlannerApp from "./PlannerApp";
import type { BadgeConfig } from "./BadgeSettings";

export const metadata: Metadata = {
  title: "Compare and rank sites · EaseScore.AI",
  description: "Municipal planner view: filter, rank and compare parcels by Development Ease Score, blockers and homes by right; export a list or a staff memo.",
};

const DATE_LABEL: Record<string, string> = {
  assessment_as_of: "Allegheny County assessments",
  sales_as_of: "County sale transactions",
  permits_as_of: "City PLI permits",
  zba_decisions_to: "Zoning decisions (ZBA) through",
  lidar: "USGS 3DEP 1 m lidar",
};

// Planner seat. Scores are precomputed (scripts/score_all.ts into parcel_scores) so filtering the
// City's 142k parcels stays fast; the first page and the summary render on the server.
export default async function PlannerPage({ searchParams }: PageProps<"/planner">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const filters = parseFilters(q);
  if (!filters.muni) filters.muni = CITY;
  const sort = parseSort(q.get("sort"));
  const dir = parseDir(q.get("dir"), sort);
  const page = Math.max(0, Math.floor(Number(q.get("page") ?? 0)) || 0);
  const [options, initial] = await Promise.all([
    plannerOptions().catch((): PlannerOptions | null => null),
    plannerQuery(filters, sort, dir, PAGE_SIZE, page * PAGE_SIZE).catch((): PlannerResult | null => null),
  ]);
  const pb = score.DEFAULT_CONFIG.planningBadge;
  const badgeConfig: BadgeConfig = {
    criteria: pb.criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight })),
    tiers: pb.tiers.map((t) => ({ tier: t.tier, min: t.min, requiresNoRedFlags: t.requiresNoRedFlags })),
  };
  const dates = options?.data_dates ?? {};
  const dataDates = CSV_DATE_SOURCES.filter(([, src]) => dates[src]).map(([k, src]) => ({ name: DATE_LABEL[k] ?? src, date: dates[src]! }));
  return (
    <PlannerApp options={options} initial={initial} initialFilters={filters} initialSort={sort} initialDir={dir} initialPage={page}
      badgeConfig={badgeConfig} dataDates={dataDates} />
  );
}
