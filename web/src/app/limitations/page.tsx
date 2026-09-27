import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";
import { getLocale } from "@/lib/i18n/server";
import LimitationsEs from "./LimitationsEs";

export async function generateMetadata(): Promise<Metadata> {
  return (await getLocale()) === "es"
    ? { title: "Limitaciones — EaseScore.AI", description: "Lo que EaseScore.AI no sabe, dónde sus datos son antiguos o parciales, a quién puede ayudar o perjudicar, y lo que no es." }
    : { title: "Limitations — EaseScore.AI", description: "What EaseScore.AI does not know, where its data is old or partial, who it may help or harm, and what it is not." };
}

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
  {
    what: "HUD CHAS is an older vintage",
    detail: "Tract-level affordability need (households by income band, cost burden) comes from HUD's eGIS copy of CHAS. The newer tract file is behind a bot challenge on huduser.gov and could not be loaded, so county- and municipality-level need uses the newer 2018–2022 vintage while tract-level need does not.",
    vintage: "Tract data 2016–2020; county/municipality data 2018–2022",
  },
  {
    what: "LIHTC projects are not current",
    detail: "The Low-Income Housing Tax Credit database used for the Nonprofit seat's local-precedent numbers lists projects placed in service only through 2019. HUD's newer national LIHTC file is behind the same bot challenge.",
    vintage: "Placed in service through 2019",
  },
  {
    what: "Land Bank parcels are counted with the Urban Redevelopment Authority",
    detail: "The Pittsburgh Land Bank publishes no public parcel list, and its properties share the URA's mailing address in the county's data, so Land Bank parcels cannot be told apart from URA parcels. Ownership-class figures for \"URA\" include both.",
    vintage: "2026",
  },
  {
    what: "Nonprofit ownership class is approximate",
    detail: "A parcel is marked publicly or nonprofit-owned by matching the owner's mailing address (never stored) to a short list of known public-agency and housing-nonprofit office addresses, not by an owner name or a registry. A nonprofit that owns land under a different mailing address will not be found; the app never names a private or nonprofit owner.",
    vintage: "2026",
  },
  {
    what: "Policy Analyst numbers are screening estimates",
    detail: "The pencil test behind each policy lever is a quick check (sale price per square foot from nearby new-construction sales, a published construction-cost range, land at assessed value, one margin floor), not a full underwriting. \"Capacity\" is how many homes a rule change would allow by right; it is not a forecast of how many would actually get built, financed, or permitted.",
    vintage: "Cost assumptions effective 2026-09-26",
  },
];

const HARMS: { risk: string; today: string }[] = [
  {
    risk: "Speculators use it to find owners who are behind on taxes",
    today: "No owner names are stored or shown. The Nonprofit seat lists publicly owned lots by default. The Planner has a tax-delinquent filter. It is off by default, but it is not limited to public land, and it shows only whether a county tax lien is open. There is no “motivated seller” score or feature.",
  },
  {
    risk: "Easier building speeds up displacement where rents are rising",
    today: "The Policy seat shows how much new capacity lands in census tracts with high rent burden, and flags tracts where rent burden is high and sale prices are rising fast. The flag marks where to look; it does not predict displacement. The Nonprofit seat maps renter cost burden. This is context only: rent burden and displacement data are never used to compute the Ease Score.",
  },
  {
    risk: "Someone buys a lot because they trust an estimate",
    today: "Scores and costs show ranges, and numbers carry their source. The parcel page and the report say they are decision support, not advice. The report lists each parcel’s data gaps and says to check with the permitting office, a surveyor, an engineer and your lender.",
  },
  {
    risk: "Places with thin data get worse estimates",
    today: "Each score factor says whether its data is complete, partial or missing. When too much is missing, the score is a range marked “Preliminary — insufficient evidence” instead of one number. With too few nearby sales, the home value is left blank.",
  },
  {
    risk: "People in older homes read “can’t be built today” as a threat to their home",
    today: "The street-precedent panel counts how many buildings on a block would not meet today’s code. Where most of a block does not, the Planner says the code, not the lot, is the obstacle. The tool does not rule on whether any home is legal to keep.",
  },
];

const TOC: [string, string][] = [
  ["not-advice", "What this is not"],
  ["gaps", "Data gaps and vintages"],
  ["scope", "Out of scope"],
  ["who-it-helps", "Who this helps and who it could hurt"],
  ["terms", "Third-party terms"],
];

export default async function LimitationsPage() {
  // Spanish (language menu): the full Spanish page. When this English page changes, update LimitationsEs.tsx too.
  if ((await getLocale()) === "es") return <LimitationsEs />;
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
              <li><strong>Affordable-housing financing and policy forecasts.</strong> The Nonprofit and Policy seats give screening estimates, not an underwriting or a forecast of what will get built.</li>
            </ul>
          </section>

          <section id="who-it-helps" aria-labelledby="who-it-helps-h">
            <h2 id="who-it-helps-h">Who this helps and who it could hurt</h2>
            <h3>Who it helps</h3>
            <ul>
              <li>Homeowners and small builders who cannot pay a consultant before they decide.</li>
              <li>Nonprofits and community groups sizing affordable homes on public land.</li>
              <li>Planners and policy staff who need evidence of which rules block housing.</li>
              <li>Permit staff, when applicants come in already knowing the rules for their lot.</li>
            </ul>
            <h3>Who it could hurt, and what the tool does about it</h3>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Risks table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead>
                  <tr><th scope="col">Risk</th><th scope="col">What the tool does today</th></tr>
                </thead>
                <tbody>
                  {HARMS.map((h) => (
                    <tr key={h.risk}>
                      <th scope="row">{h.risk}</th>
                      <td>{h.today}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>What it gets wrong</h3>
            <ul>
              <li>Zoning rules are loaded for the City of Pittsburgh only. Elsewhere the score shows a range and asks you to check with the municipality.</li>
              <li>Rents from nearby listings are asking rents, not signed leases.</li>
              <li>Property taxes after you build are estimates. They come from how similar new homes were assessed, and the receipt shows the spread. The County sets the real figure.</li>
              <li>Costs are published ranges and labeled estimates, not bids. Items with no local cost show as &ldquo;Not included,&rdquo; not zero.</li>
              <li>Mine maps are incomplete. No mapped mine is not proof of no mine.</li>
              <li>Lot lines and street frontage come from county GIS, not a survey.</li>
              <li>
                Match-the-neighbors (contextual) setbacks are only partly automated. Parcel pages use setbacks measured from nearby buildings where
                there are enough of them. The Planner still uses a 5 ft assumption, so the two can differ. Measured setbacks are not surveyed.
              </li>
              <li>Permit times are City targets and typical steps. They are not measured or guaranteed review times.</li>
              <li>The tool has no data on a building&apos;s condition inside. Rehab is not priced until you enter a rehab cost.</li>
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
