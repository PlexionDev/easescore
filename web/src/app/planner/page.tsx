import type { Metadata } from "next";
import ComingNext from "../_site/ComingNext";

export const metadata: Metadata = { title: "Compare and rank sites — EaseScore.AI" };

export default function PlannerPage() {
  return (
    <ComingNext
      current="planner"
      who="For planners"
      title="Compare and rank sites"
      job="Filter parcels by what blocks them, rank the best candidates, and export a list for staff review."
    />
  );
}
