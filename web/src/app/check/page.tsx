import { redirect } from "next/navigation";
import { searchParcels } from "@/lib/data";
import { SEARCH_ID } from "@/components/home/constants";

// No separate results page: search lives on the homepage. This route only serves the no-JavaScript form
// fallback and old links — one match goes straight to the parcel, anything else back to the homepage search.
export default async function CheckPage({ searchParams }: PageProps<"/check">) {
  const q = String((await searchParams).q ?? "").trim();
  if (q) {
    const hits = await searchParcels(q, 2);
    if (hits.length === 1) redirect(`/parcel/${hits[0].parid}`);
    redirect(`/?q=${encodeURIComponent(q)}#${SEARCH_ID}`);
  }
  redirect(`/#${SEARCH_ID}`);
}
