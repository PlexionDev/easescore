import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SearchBox from "@/components/home/SearchBox";
import SiteFrame from "@/components/home/SiteFrame";
import { EXAMPLE_QUERY, SEARCH_ID } from "@/components/home/constants";
import { searchParcels } from "@/lib/data";

export const metadata: Metadata = {
  title: "Check a lot — EaseScore.AI",
  description: "Find any Allegheny County parcel by address or parcel ID and open its EaseScore.",
};

export default async function CheckPage({ searchParams }: PageProps<"/check">) {
  const q = String((await searchParams).q ?? "").trim();
  const hits = q ? await searchParcels(q) : [];
  // One match: go straight to the parcel.
  if (hits.length === 1) redirect(`/parcel/${hits[0].parid}`);

  return (
    <SiteFrame>
      <section className="page-head" aria-labelledby="page-title">
        <div className="wrap">
          <p className="eyebrow">Developers</p>
          <h1 id="page-title">Check one lot.</h1>
          <p className="page-lede">Get the score, what fits on the lot, and whether it pencils, then download the full feasibility study.</p>
          <SearchBox key={q} id={SEARCH_ID} icon shortcut tryExample={!q} defaultValue={q} autoFocus={!q} />
        </div>
      </section>

      <div className="wrap page-body">
        {q ? (
          <section aria-labelledby="results-title" aria-live="polite">
            <h2 id="results-title" className="eyebrow results-count">
              {hits.length === 25 ? "First 25 matches" : `${hits.length} match${hits.length === 1 ? "" : "es"}`} for “{q}”
            </h2>
            {hits.length ? (
              <ul className="hit-list">
                {hits.map((h) => (
                  <li key={h.parid}>
                    <Link href={`/parcel/${h.parid}`} className="hit">
                      <span>
                        <span className="hit-addr">{[h.house_num !== "0" ? h.house_num : null, h.address].filter(Boolean).join(" ")}</span>
                        <span className="hit-meta">{h.muni_desc} · {h.zip} · {h.use_desc} · {h.parid}</span>
                      </span>
                      <span className="hit-go">Open <span aria-hidden="true">↗</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="page-note">
                <strong>No parcels matched.</strong> Try the street number and name without the city, a parcel ID such as
                0011A00151000000, or a map-block-lot such as {EXAMPLE_QUERY}.
              </p>
            )}
          </section>
        ) : (
          <p className="page-note">
            Search by street address, parcel ID (0011A00151000000), or map-block-lot ({EXAMPLE_QUERY}). Every parcel in
            Allegheny County is covered.
          </p>
        )}
        <p className="page-fine">Decision support only. Verify with the permitting office, your lender, and your accountant.</p>
      </div>
    </SiteFrame>
  );
}
