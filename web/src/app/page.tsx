import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import HeroContours from "./_site/HeroContours";
import SearchForm from "./_site/SearchForm";
import Site from "./_site/Site";
import s from "./_site/site.module.css";

export const metadata: Metadata = {
  title: "EaseScore.AI — what it takes to build on any lot in Allegheny County",
  description: "Zoning, slope, mines, flood and cost for every parcel in Allegheny County, with a source behind every number.",
};

const DOORS: { href: string; who: string; title: string; body: string; go: string; glyph: ReactNode }[] = [
  {
    href: "/planner", who: "For planners", title: "Compare and rank sites", go: "Open the site finder",
    body: "Filter parcels by what blocks them, rank the best candidates, and export a list for staff review.",
    glyph: (
      <svg viewBox="0 0 90 54" fill="none" stroke="#0F6E74" strokeWidth="2" strokeLinecap="round">
        <path d="M4 12h70M4 26h52M4 40h30" /><path d="M4 12h70" stroke="#14202B" />
      </svg>
    ),
  },
  {
    href: "/check", who: "For developers", title: "Check one lot", go: "Check a lot",
    body: "Get the score, what fits on the lot, and whether it pencils, then download the full feasibility study.",
    glyph: (
      <svg viewBox="0 0 90 54" fill="none" strokeLinejoin="round" strokeWidth="2">
        <path d="M8 44L30 8l44 10-10 32z" stroke="#14202B" />
        <path d="M26 38l12-18 20 5-5 15z" stroke="#0F6E74" fill="rgba(15,110,116,.12)" />
      </svg>
    ),
  },
  {
    href: "/nonprofit", who: "For nonprofits and CDCs", title: "Plan affordable homes", go: "Model a project",
    body: "Set rents families can pay, see the funding gap, and match it to the sources that can close it.",
    glyph: (
      <svg viewBox="0 0 90 54" fill="none" strokeWidth="2">
        <rect x="4" y="10" width="80" height="12" rx="2" stroke="#14202B" />
        <rect x="4" y="30" width="52" height="12" rx="2" stroke="#0F6E74" fill="rgba(15,110,116,.12)" />
        <path d="M58 36h24" stroke="#A86514" strokeDasharray="3 4" />
      </svg>
    ),
  },
  {
    href: "/policy", who: "For policy analysts", title: "Test a rule change", go: "Open the simulator",
    body: "Change a zoning rule or incentive and see how many homes it unlocks, what it costs, and who pays.",
    glyph: (
      <svg viewBox="0 0 90 54" fill="none" strokeWidth="2" strokeLinecap="round">
        <path d="M6 27h78" stroke="#D9DEDA" strokeWidth="4" />
        <path d="M6 27h46" stroke="#0F6E74" strokeWidth="4" />
        <circle cx="52" cy="27" r="7" fill="#fff" stroke="#14202B" />
      </svg>
    ),
  },
];

// Illustrative only — labelled as such on the page. Not computed from the engine.
const EXAMPLE_BARS: { label: string; pct: number; low?: boolean }[] = [
  { label: "Zoning", pct: 70 },
  { label: "Terrain", pct: 15, low: true },
  { label: "Hazards", pct: 65 },
  { label: "Access", pct: 60 },
  { label: "Approvals", pct: 55 },
];

const EXPLAIN: [string, string][] = [
  ["The score shows how hard, not whether to buy", "Seven factors, each with a bar. Tap the receipt beside any bar to see the records and rules behind it, with dates."],
  ["Problems are named, not averaged away", "Landslide areas, old mines and flood zones lower the score and appear as their own callouts, with the code sections that apply."],
  ["The summary is written from the numbers", "Two sentences on what the lot allows today and what could be possible with approval. Every figure in them comes from the calculation, never from guesswork."],
  ["The full report is ready to share", "Site, zoning, process, market, costs, returns and risks in one cited document you can print or save as a PDF."],
];

const SOURCES: [string, string][] = [
  ["Allegheny County", "Parcels, assessments and sales"],
  ["City of Pittsburgh", "Zoning map, zoning code and permits"],
  ["USGS", "1-meter lidar for slope and terrain"],
  ["FEMA", "Flood hazard maps"],
  ["PA DEP", "Mine and environmental records"],
  ["HUD and Census", "Income limits, rents and housing data"],
];

const FAQ: [string, string][] = [
  ["How is the score calculated?", "Seven factors are scored from 0 to 100 and weighted: zoning, terrain, hazards, access, approvals, the lot itself and nearby market activity. The weights are published on the methods page. Money is kept separate, in the “does it pencil” result."],
  ["Does it cover the whole county?", "Parcels, terrain, hazards and sales cover all of Allegheny County. Detailed zoning rules are loaded for the City of Pittsburgh first; elsewhere the score shows a range and asks you to confirm zoning with the municipality."],
  ["What does AI do here?", "It helps find a parcel from a plain question and writes the short summary from the calculated results. It never calculates a score, a cost or a return."],
  ["Is this legal, zoning or financial advice?", "No. It is a starting point for a decision. Confirm zoning with the permitting office, costs with local bids and financing with your lender."],
  ["What happens to what I type?", "Searches are used to find the parcel and are not tied to an account. There is no sign-in."],
];

export default function Home() {
  return (
    <Site>
      <section className={s.hero} aria-labelledby="hero-title">
        <HeroContours />
        <div className={`${s.wrap} ${s.heroInner}`}>
          <h1 id="hero-title">See what it takes to build on any lot in Allegheny County.</h1>
          <p className={s.lede}>Zoning, slope, old mines, flood risk and cost for 585,000 parcels, with a source behind every number.</p>
          <SearchForm />
        </div>
        <p className={s.artCredit}>Contours: Mt. Washington, drawn from USGS 1-meter lidar</p>
      </section>

      <section className={s.doors} aria-label="Choose how you want to start">
        <div className={s.wrap}>
          <div className={s.doorGrid}>
            {DOORS.map((d) => (
              <Link key={d.href} className={s.door} href={d.href}>
                <span className={s.who}>{d.who}</span>
                <h2>{d.title}</h2>
                <p>{d.body}</p>
                <span className={s.glyph} aria-hidden="true">{d.glyph}</span>
                <span className={s.go}>{d.go}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={s.block} aria-labelledby="ex-title">
        <div className={s.wrap}>
          <h2 className={s.title} id="ex-title">One lot, one page, every number sourced.</h2>
          <p className={s.intro}>Each parcel opens to a short, visual summary. The full feasibility study is one click away when you need the detail.</p>
          <div className={s.example}>
            <article className={s.pane} aria-label="Example parcel summary (illustrative)">
              <div className={s.photo}>Street photo of the lot</div>
              <div className={s.body}>
                <p className={s.addr}>34 Soffel St</p>
                <p className={s.sub}>Mt. Washington, zoned R1D-H</p>
                <div className={s.facts}>
                  <div className={s.fact}><b>84%</b><span>Steeper than 25%</span></div>
                  <div className={s.fact}><b>43%</b><span>Average slope</span></div>
                  <div className={s.fact}><b>421 m</b><span>To frequent transit</span></div>
                </div>
                <div className={s.scoreline}><span className={s.num}>54</span><span className={s.band}>Hard to build</span></div>
                <ul className={s.bars}>
                  {EXAMPLE_BARS.map((b) => (
                    <li key={b.label} className={s.barRow}>
                      <span>{b.label}</span>
                      <span className={s.track} role="img" aria-label={`${b.pct} out of 100`}>
                        <i className={b.low ? s.low : undefined} style={{ width: `${b.pct}%` }} />
                      </span>
                      {/* The receipt icon is decorative in this example; on a real parcel it opens the sources. */}
                      <span className={s.rcpt} aria-hidden="true">
                        <svg viewBox="0 0 14 14" fill="none" stroke="#56636F" strokeWidth="1.4">
                          <path d="M3 1.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2z" /><path d="M5 5h4M5 7.5h4" />
                        </svg>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={s.callout}>Review required: the whole lot is in the City&apos;s landslide-prone overlay, so new construction needs a geotechnical report.</div>
                <p className={s.summary}>By right, this lot allows one single-family home, and the steep slope points to a stepped foundation that pushes cost toward the high end. A duplex would need zoning relief; check nearby Zoning Board decisions before counting on it.</p>
                <p className={s.fine}>Example layout. Scores shown here are illustrative. Decision support only, not legal, financial or engineering advice.</p>
                <Link className={s.btn} href="/check?q=34+Soffel+St">Look up this lot</Link>
              </div>
            </article>
            <div className={s.explain}>
              {EXPLAIN.map(([h, p]) => (
                <Fragment key={h}>
                  <h3>{h}</h3>
                  <p>{p}</p>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={s.block} aria-labelledby="src-title">
        <div className={s.wrap}>
          <h2 className={s.title} id="src-title">Built on public records you can check.</h2>
          <p className={s.intro}>Missing data is shown as missing. The date on every source is listed in each report.</p>
          <div className={s.sources}>
            {SOURCES.map(([b, t]) => (
              <div key={b} className={s.src}><b>{b}</b><span>{t}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className={s.block} aria-labelledby="faq-title">
        <div className={s.wrap}>
          <h2 className={s.title} id="faq-title">Questions before you start</h2>
          <div className={s.faq}>
            {FAQ.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </div>
      </section>
    </Site>
  );
}
