import type { Metadata } from "next";
import AudiencePage from "@/components/home/AudiencePage";

export const metadata: Metadata = {
  title: "Plan affordable homes — EaseScore.AI",
  description: "For nonprofits and CDCs: set rents families can pay, see the funding gap, and match it to the sources that can close it.",
};

export default function NonprofitPage() {
  return (
    <AudiencePage
      who="Nonprofits & CDCs"
      title="Plan affordable homes."
      job="Set rents families can pay, see the funding gap, and match it to the sources that can close it."
      note="Start with a lot. Search any Allegheny County address or parcel ID to see its score, what fits on it, and the numbers behind the pro forma."
    />
  );
}
