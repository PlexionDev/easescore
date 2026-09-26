import type { Metadata } from "next";
import ComingNext from "../_site/ComingNext";

export const metadata: Metadata = { title: "Plan affordable homes — EaseScore.AI" };

export default function NonprofitPage() {
  return (
    <ComingNext
      who="For nonprofits and CDCs"
      title="Plan affordable homes"
      job="Set rents families can pay, see the funding gap, and match it to the sources that can close it."
    />
  );
}
