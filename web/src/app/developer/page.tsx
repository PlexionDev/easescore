import type { Metadata } from "next";
import { CITY, PAGE_SIZE, parseDir, parseFilters, parseSort, plannerOptions, plannerQuery, type PlannerOptions, type PlannerResult } from "@/lib/planner";
import DeveloperApp from "./DeveloperApp";

export const metadata: Metadata = {
  title: "Developer workspace · EaseScore.AI",
  description: "Developer seat: find lots by neighborhood, size, ownership type and what zoning allows, rank them by Development Ease Score, open any parcel and keep a short list in this browser.",
};

const PARID = /^[0-9A-Z]{16}$/;

// Developer seat. Same precomputed parcel_scores reads as the Planner (planner_query / planner_points);
// the first page renders on the server. ?parcel=<id> opens that parcel in the pane.
export default async function DeveloperPage({ searchParams }: PageProps<"/developer">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const parcelRaw = (q.get("parcel") ?? "").trim().toUpperCase();
  const parcel = PARID.test(parcelRaw) ? parcelRaw : null;
  q.delete("parcel");
  // A bare /developer lands on vacant lots with no red flags; any other query string is taken as is.
  const filters = q.size ? parseFilters(q) : { land: "vacant" as const, clean: true };
  if (!filters.muni) filters.muni = CITY;
  const sort = parseSort(q.get("sort"));
  const dir = parseDir(q.get("dir"), sort);
  const [options, initial] = await Promise.all([
    plannerOptions().catch((): PlannerOptions | null => null),
    plannerQuery(filters, sort, dir, PAGE_SIZE, 0).catch((): PlannerResult | null => null),
  ]);
  return <DeveloperApp options={options} initial={initial} initialFilters={filters} initialSort={sort} initialDir={dir} initialParcel={parcel} />;
}
