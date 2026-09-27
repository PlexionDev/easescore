import type { Metadata } from "next";
import AudiencePage from "@/components/home/AudiencePage";

export const metadata: Metadata = {
  title: "Test a rule change — EaseScore.AI",
  description: "For policy analysts: change a zoning rule or incentive and see how many homes it unlocks, what it costs, and who pays.",
};

export default function PolicyPage() {
  return (
    <AudiencePage
      who="Policy analysts"
      title="Test a rule change."
      job="Change a zoning rule or incentive and see how many homes it unlocks, what it costs, and who pays."
      note="Start with a lot. Search any Allegheny County address or parcel ID to see which rules shape what can be built there, with the code sections cited."
    />
  );
}
