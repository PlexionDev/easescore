import type { Metadata } from "next";
import ComingNext from "../_site/ComingNext";

export const metadata: Metadata = { title: "Test a rule change — EaseScore.AI" };

export default function PolicyPage() {
  return (
    <ComingNext
      who="For policy analysts"
      title="Test a rule change"
      job="Change a zoning rule or incentive and see how many homes it unlocks, what it costs, and who pays."
    />
  );
}
