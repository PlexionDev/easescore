import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";

export const metadata: Metadata = {
  title: "Limitations — EaseScore.AI",
  description: "What EaseScore.AI does not know, where its data is old or partial, who it may help or harm, and what it is not.",
};

const GAPS: { what: string; detail: string; vintage: string }[] = [
  {
    what: "Zoning covers the City of Pittsburgh only",
    detail: "Allegheny County has about 130 municipalities with their own zoning and no county-wide zoning map. Outside the City, zoning is marked missing, the score shows a range, and the page asks you to confirm with the municipality.",
    vintage: "City zoning map, 2026",
  },
  {
    what: "Sewer service is unknown for every parcel",
    detail: "No public sewer service-area map exists for the county. Sewersheds are drainage basins, not service areas, so they are not used. The app says “unknown — confirm with the municipality,” never “served.”",
    vintage: "—",
  },
  {
    what: "Water service areas are approximate",
    detail: "Many boundaries are old. “Outside” can mean the map is out of date: some built-out suburbs show as outside. Parcels within 100 m of a boundary are marked unknown.",
    vintage: "PA DEP boundary edits 2003–2024",
  },
  {
    what: "Permit times are City targets, not measured times",
    detail: "No public City dataset records the date a permit application was filed, so real processing times cannot be measured. The building-permit part uses the City’s published review target for one review round, labeled “City target, not measured.” Revisions, hearings and other reviews add time. The review-queue file shows only permits waiting on the City, and its dates reset on each resubmission.",
    vintage: "Targets page updated 2025-11-21; queue file 2026-09-21",
  },
  {
    what: "Slope-movement history is from 1982",
    detail: "The county slope-movement inventory maps areas of past movement, not recent individual landslides. It counts only where a mapped area touches the lot, and the geohazard factor is marked partial because of it.",
    vintage: "1982 (Pomeroy)",
  },
  {
    what: "Landslide-prone and undermined overlays cover the City only",
    detail: "Outside the City these hazards are unknown, not absent. Mine maps are incomplete everywhere: no mapped mine is not proof of no mine.",
    vintage: "City overlays, 2026; PA DEP mine layers",
  },
  {
    what: "Zoning Board history is short",
    detail: "Grant rates come from Zoning Board of Adjustment decisions published for 2025 and 2026. Older decisions sit in an archive we did not collect. With fewer than 5 cases in a district, a labeled default grant rate is used.",
    vintage: "ZBA decisions 2025-02 to 2026-08",
  },
  {
    what: "Costs are editable assumptions, not bids",
    detail: "Construction uses published Pittsburgh builder ranges and labeled estimates. Demolition, geotechnical reports and dumpsters have no local cost yet and are shown as “Not included.” Rehab is not priced until you enter a rehab cost. Slope adders use slope across the whole lot, not under the building.",
    vintage: "Cost assumptions effective 2026-09-26",
  },
  {
    what: "Home values depend on nearby sales",
    detail: "New homes are valued only from new-construction sales. Where there are too few, the value is left blank. Layouts on tight lots can be much smaller than new homes that sell nearby; the value assumes the same price per square foot.",
    vintage: "County sales 2012–2026",
  },
  {
    what: "Rental answers stop at yield on cost",
    detail: "There is no local market cap rate, so the page does not call a rental a yes or no.",
    vintage: "—",
  },
  {
    what: "Other old layers",
    detail: "Pittsburgh Public Schools attendance zones date from 2012–13 (verify with the district). Greenways were last substantially updated around 2018.",
    vintage: "2012–13; ~2018",
  },
];

const TOC: [string, string][] = [
  ["not-advice", "What this is not"],
  ["gaps", "Data gaps and vintages"],
  ["scope", "Out of scope"],
  ["people", "Who benefits, who could be harmed"],
  ["terms", "Third-party terms"],
];

export default function LimitationsPage() {
  return (
    <Shell current="limitations">
      <section className={d.pageHead} aria-labelledby="page-title">
        <div className={d.wrap}>
          <span className={d.eyebrow}>Limitations</span>
          <h1 id="page-title">What this tool does not know</h1>
          <p className={d.lede}>
            Missing data is shown as missing, never as zero or as &ldquo;fine.&rdquo; This page lists the gaps that matter most, so you know what to check yourself.
          </p>
        </div>
      </section>

      <div className={`${d.wrap} ${d.layout}`}>
        <nav className={d.toc} aria-label="On this page">
          <p>On this page</p>
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`}>{label}</a></li>
            ))}
          </ol>
        </nav>

        <div className={d.prose}>
          <section id="not-advice" aria-labelledby="not-advice-h">
            <h2 id="not-advice-h">What this is not</h2>
            <div className={d.flag}>
              EaseScore.AI is decision support. It is <strong>not legal, financial, zoning or engineering advice</strong>, and it is not an appraisal,
              a survey, a title search or a geotechnical study. Confirm zoning with the permitting office, costs with local bids, financing with your
              lender, and site conditions with a licensed engineer.
            </div>
            <p>
              The score measures how hard a site is to develop. It does not say whether anyone should buy, sell, or build. It is not affiliated with
              Allegheny County or the City of Pittsburgh.
            </p>
          </section>

          <section id="gaps" aria-labelledby="gaps-h">
            <h2 id="gaps-h">Data gaps and vintages</h2>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead>
                  <tr><th scope="col">Gap</th><th scope="col">What it means for you</th><th scope="col">Data date</th></tr>
                </thead>
                <tbody>
                  {GAPS.map((g) => (
                    <tr key={g.what}>
                      <th scope="row">{g.what}</th>
                      <td>{g.detail}</td>
                      <td>{g.vintage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={d.muted}>
              How missing data affects the score is explained on the <Link href="/methods#evidence">Data and methods</Link> page.
            </p>
          </section>

          <section id="scope" aria-labelledby="scope-h">
            <h2 id="scope-h">Out of scope</h2>
            <ul>
              <li><strong>Developer capacity.</strong> The tool does not judge a developer&apos;s experience, financial strength or ability to finish a project.</li>
              <li><strong>Site inspection.</strong> Nothing here replaces walking the lot, a survey, soil borings, or an environmental assessment.</li>
              <li><strong>Title and ownership.</strong> Owner names are not stored. Liens, easements and title problems are not checked beyond tax-delinquency status.</li>
              <li><strong>Affordable-housing financing and the policy simulator.</strong> The nonprofit and policy tools are labeled &ldquo;Coming next&rdquo; and are not live yet.</li>
            </ul>
          </section>

          <section id="people" aria-labelledby="people-h">
            <h2 id="people-h">Who benefits, who could be harmed</h2>
            <h3>Who benefits</h3>
            <p>
              Small developers, nonprofits and planners who cannot pay for a feasibility study on every lot get a fast, sourced first look, and
              can see which rules block housing most often.
            </p>
            <h3>Who could be harmed, and how we limit it</h3>
            <ul>
              <li>
                <strong>Neighbors and residents.</strong> A high score could draw speculative buying to a lot or a neighborhood. The tool shows
                public records only and stores no owner names.
              </li>
              <li>
                <strong>Places with less data.</strong> Parcels outside the City have more missing factors. Their scores show wider ranges and may be
                labeled preliminary, which can make them look less attractive than they are.
              </li>
              <li>
                <strong>Anyone who treats an estimate as a fact.</strong> A wrong cost or value could lead to a bad decision. Every number carries its
                source, estimates are labeled, and items with no local cost are shown as &ldquo;Not included&rdquo; instead of zero.
              </li>
            </ul>
          </section>

          <section id="terms" aria-labelledby="terms-h">
            <h2 id="terms-h">Third-party terms</h2>
            <ul>
              <li>
                <strong>Google Photorealistic 3D Tiles</strong> are used under the Google Maps Platform Terms of Service. They stream while you view them,
                with Google&apos;s attribution shown, and are not stored or redistributed. The lidar terrain view works without them.
              </li>
              <li>
                <strong>PA DEP public water service areas</strong> are licensed &ldquo;not for commercial use or resale.&rdquo; They are used here for a
                non-commercial project, and the raw data is not redistributed.
              </li>
              <li><strong>Basemap</strong> data &copy; OpenStreetMap contributors (ODbL), via Protomaps.</li>
            </ul>
            <p className={d.fine}>
              The full list of known issues is kept in the project&apos;s{" "}
              <a href="https://github.com/PlexionDev/easescore/blob/main/KNOWN-ISSUES.md">known issues file</a>.
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
