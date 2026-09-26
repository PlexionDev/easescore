import type { Metadata } from "next";
import Link from "next/link";
import { searchParcels } from "@/lib/data";
import HeroContours from "../_site/HeroContours";
import SearchForm from "../_site/SearchForm";
import Site from "../_site/Site";
import s from "../_site/site.module.css";

export const metadata: Metadata = {
  title: "Check a lot — EaseScore.AI",
  description: "Find any Allegheny County parcel by address or parcel ID and open its EaseScore.",
};

export default async function CheckPage({ searchParams }: PageProps<"/check">) {
  const q = String((await searchParams).q ?? "").trim();
  const hits = q ? await searchParcels(q) : [];

  return (
    <Site current="check">
      <section className={s.pageHead} aria-labelledby="page-title">
        <HeroContours />
        <div className={s.wrap} style={{ position: "relative", zIndex: 1 }}>
          <span className={s.eyebrow}>For developers</span>
          <h1 id="page-title">Check one lot</h1>
          <SearchForm key={q} defaultValue={q} autoFocus={!q} showExample={!q} />
        </div>
      </section>

      <div className={s.wrap}>
        {q ? (
          <section className={s.results} aria-labelledby="results-title" aria-live="polite">
            <h2 id="results-title" className={s.count}>
              {hits.length === 25 ? "First 25 matches" : `${hits.length} match${hits.length === 1 ? "" : "es"}`} for &ldquo;{q}&rdquo;
            </h2>
            {hits.length ? (
              <ul className={s.hitList}>
                {hits.map((h) => (
                  <li key={h.parid}>
                    <Link href={`/parcel/${h.parid}`} className={s.hit}>
                      <span>
                        <span className={s.hitAddr}>{[h.house_num !== "0" ? h.house_num : null, h.address].filter(Boolean).join(" ")}</span>
                        <br />
                        <span className={s.hitMeta}>{h.muni_desc} · {h.zip} · {h.use_desc} · <code>{h.parid}</code></span>
                      </span>
                      <span className={s.hitArrow} aria-hidden="true">Open →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>
                <b>No parcels matched.</b> Try the street number and name without the city, a parcel ID such as
                0011-J-00056-0000-00, or a map-block-lot such as 11-J-56.
              </p>
            )}
          </section>
        ) : (
          <p className={s.intro} style={{ marginTop: 32 }}>
            Search by street address, parcel ID (0011-J-00056-0000-00), or map-block-lot (11-J-56). Every parcel in
            Allegheny County is covered.
          </p>
        )}
        <p className={s.fine} style={{ marginTop: 40 }}>
          Decision support only. Verify with the permitting office, your lender, and your accountant.
        </p>
      </div>
    </Site>
  );
}
