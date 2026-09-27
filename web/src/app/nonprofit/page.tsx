import type { Metadata } from "next";
import { need, neighborhoods, sites } from "@/lib/nonprofit/data";
import { parseState, suggestLots } from "@/lib/nonprofit/types";
import NonprofitApp from "./NonprofitApp";

export const metadata: Metadata = {
  title: "Plan affordable homes — EaseScore.AI",
  description: "For nonprofits and CDCs: see who needs homes, find public lots, and size the funding gap with the sources that can close it.",
};

export default async function NonprofitPage({ searchParams }: PageProps<"/nonprofit">) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const state = parseState(q);
  const [hoods, n, s] = await Promise.all([neighborhoods(), need(state.hood), sites(state.hood, state.filters, 60)]);
  // No lots in the URL: start from a suggested scattered-site set so step 3 is ready when opened.
  if (!state.lots.length && s?.rows.length) state.lots = suggestLots(s.rows, state.perLot);
  return <NonprofitApp initial={state} hoods={hoods ?? []} initialNeed={n} initialSites={s} hoodFromUrl={q.has("hood")} />;
}
