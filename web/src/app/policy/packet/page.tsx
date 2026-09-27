import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { formatRange, fmtMoney } from "@/components/seats/format";
import { hoodOutlines, policyMeta, policyPlaces, policyPoints, policyState, storedContext, type Outline, type PolicyPoint } from "@/lib/policy/data";
import {
  concentration, fiscal, homesRange, leverSentence, leverComboLabel, LEVER_METHOD, newlyRange, scenarioFromQuery, stateKey, TRANSIT_M,
} from "@/lib/policy/model";
import "./packet.css";

// Council packet (print page, 3 pages): p1 fiscal note, p2 housing outcome with map and neighborhood
// table, p3 assumptions, sources and limitations. /api/policy/packet renders it to PDF. Every number
// comes from the lever state's summary and the stored inputs; nothing is typed in here.

const sans = Inter({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--pk-sans", display: "block" });
export const metadata: Metadata = { title: "Council packet — EaseScore.AI", robots: { index: false } };

const DOT: Record<string, string> = { attached: "#000000", minLot: "#7a7a7a", "attached+minLot": "#333333", parking: "#b0b0b0", adu: "#555555", contextual: "#999999", height: "#444444" };

function DotMap({ outline, points }: { outline: Outline | null; points: PolicyPoint[] }) {
  const W = 680, H = 250;
  const rings: [number, number][][] = [];
  for (const f of outline?.features ?? []) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) rings.push(p[0]);
  }
  const all = rings.flat();
  if (!all.length) return <p className="fine">Neighborhood outlines not available; see the neighborhood table.</p>;
  const [x0, x1] = [Math.min(...all.map((c) => c[0])), Math.max(...all.map((c) => c[0]))];
  const [y0, y1] = [Math.min(...all.map((c) => c[1])), Math.max(...all.map((c) => c[1]))];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = Math.min(W / ((x1 - x0) * k), H / (y1 - y0));
  const px = (lon: number) => (lon - x0) * k * s + (W - (x1 - x0) * k * s) / 2;
  const py = (lat: number) => (y1 - lat) * s + (H - (y1 - y0) * s) / 2;
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Map of City of Pittsburgh neighborhoods with a dot for each parcel that gains homes by right">
      {rings.map((r, i) => <path key={i} d={`M${r.map((c) => `${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join("L")}Z`} fill="none" stroke="#9a9a9a" strokeWidth={0.5} />)}
      {points.map((p) => <circle key={p[0]} cx={px(p[1])} cy={py(p[2])} r={Math.min(2.6, 0.9 + 0.35 * p[3])} fill={DOT[p[4]] ?? "#333"} />)}
    </svg>
  );
}

export default async function PacketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sc = scenarioFromQuery(sp);
  const key = stateKey(sc.levers);
  const name = typeof sp.name === "string" ? sp.name.slice(0, 80) : "";
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : new Date().toISOString().slice(0, 10);
  const [meta, st, points, outline, places] = await Promise.all([policyMeta(), policyState(key), policyPoints(key), hoodOutlines(), storedContext(key).then((c) => c?.places ?? policyPlaces(key))]);
  const s = st.summary;
  const title = name || "Rule change";
  if (!s) {
    return (
      <main className={`pk ${sans.variable}`} data-report-ready="">
        <h1>{title}</h1>
        <p>This rule combination has not been computed yet ({st.status}). Open it in the Policy view and export again when results appear.</p>
      </main>
    );
  }
  const fis = fiscal(s, meta, sc.abatement, places);
  const h = homesRange(s), nb = newlyRange(s);
  const fr = (r: { low: number; likely: number; high: number }, money = false) => formatRange(r, { format: money ? "money" : "count" });
  const conc = concentration(s);
  const hoods = [...s.by_neighborhood].sort((a, b) => b.homes - a.homes);
  const maxHomes = Math.max(1, ...hoods.map((x) => x.homes));
  const partial = st.status !== "done";

  return (
    <main className={`pk ${sans.variable}`} data-report-ready="">
      {/* ------------------------------------------------------------ page 1: fiscal note */}
      <section className="page">
        <p className="meta">Fiscal note · City of Pittsburgh · {date} · prepared with EaseScore.AI (decision support, not legal or financial advice)</p>
        <h1>{title}</h1>
        <p className="lede"><b>Proposed change:</b> {leverSentence(sc.levers)}.</p>
        {partial ? <p><b>Partial results:</b> computed for {st.done} of {st.total} parcel batches when this packet was made; totals will grow.</p> : null}
        <p className="lede">
          The change would allow about <b>{fr(h)}</b> more homes by right on <b>{fr(nb)}</b> parcels that cannot take a home by right today
          (and more on lots that already can). Of the added homes, <b>{fr(s.homes_pencil)}</b> plausibly pencil at today’s prices.
          At full build-out of homes that pencil, the taxing bodies would collect <b>{fis ? fr(fis.total, true) : "—"}</b> more per year.
        </p>
        <h2>New annual revenue by taxing body</h2>
        {fis ? (
          <table>
            <thead><tr><th>Taxing body</th><th className="n">Millage</th><th className="n">New assessed value</th><th className="n">New revenue / yr</th><th className="n">Abatement cost / yr</th><th className="n">Break-even</th></tr></thead>
            <tbody>
              {fis.rows.map((r, i) => (
                <tr key={`${r.body.id}-${r.body.name}`}>
                  <td>{r.body.name}</td><td className="n">{r.body.mills} ({r.body.year})</td><td className="n">{fr(fis.av[i] ?? s.av_delta, true)}</td>
                  <td className="n">{fr(r.revenue, true)}</td><td className="n">{fis.abatement ? fr(r.abatementPerYear, true) : "none"}</td>
                  <td className="n">{fis.abatement ? (r.breakEvenYear ? `year ${r.breakEvenYear}` : "—") : "n/a"}</td>
                </tr>
              ))}
              <tr className="tot"><td>All bodies</td><td className="n">{Math.round(fis.totalMills * 100) / 100}</td><td className="n">{fr(s.av_delta, true)}</td><td className="n">{fr(fis.total, true)}</td><td className="n">{fis.abatement ? fr(fis.abatementTotal, true) : "none"}</td><td /></tr>
              <tr><td>Doing nothing</td><td className="n" colSpan={2}>lots keep today’s assessed value</td><td className="n">$0 new</td><td className="n" colSpan={2}>{fmtMoney(fis.doingNothing)}/yr paid today on these lots</td></tr>
            </tbody>
          </table>
        ) : <p>Millage rates are not loaded, so the ledger cannot be computed.</p>}
        <p className="fine">
          New assessed value = value of the added homes that pencil × assessment ratio {meta?.ratio.p50} (median assessed value ÷ price of {meta?.ratio.n} recent
          new-construction sales in the City), counting only the added homes’ share of each scheme’s value, less the existing building on lots that had no by-right home before. Revenue = assessed value × mills ÷ 1,000.
          Ranges: low = low-quartile prices with high costs; high = high-quartile prices with low costs.
          {fis?.abatement ? ` Abatement modeled: ${Math.round(fis.abatement.share * 100)}% of the tax on the added value for ${fis.abatement.years} years (illustrative LERTA-style terms, not a verified program).` : " No tax abatement is part of this scenario."}
          {" "}Only property tax is counted; wage, earned-income and transfer taxes are not.
        </p>
        <h2>What it does not cost</h2>
        <p>The rule changes modeled here carry no direct public spending. Administrative costs (plan review, permitting, code amendment) and infrastructure capacity are not estimated.</p>
      </section>

      {/* ------------------------------------------------------------ page 2: housing outcome */}
      <section className="page">
        <h2 style={{ marginTop: 0 }}>Housing outcome</h2>
        <div className="boxes">
          <div className="box"><p className="l">More homes allowed by right</p><p className="v">{fr(h)}</p><p className="s">vs. today’s code</p></div>
          <div className="box"><p className="l">Parcels newly buildable by right</p><p className="v">{fr(nb)}</p><p className="s">of {s.eligible.toLocaleString()} parcels a lever applies to</p></div>
          <div className="box"><p className="l">Plausibly pencil</p><p className="v">{fr(s.homes_pencil)}</p><p className="s">homes; capacity is not production</p></div>
          <div className="box"><p className="l">New tax revenue / yr</p><p className="v">{fis ? fr(fis.total, true) : "—"}</p><p className="s">at build-out, all bodies</p></div>
        </div>
        <DotMap outline={outline} points={points} />
        <p className="fine">
          {Object.entries(DOT).filter(([k]) => points.some((p) => p[4] === k)).map(([k, c]) => <span key={k} className="key"><i style={{ background: c }} />{leverComboLabel(k)}</span>)}
          One dot per parcel that gains homes ({points.length.toLocaleString()}); larger dots gain more. Lines are City neighborhood boundaries.
        </p>
        <h2>Where the new capacity lands</h2>
        {conc.top.length >= 5 ? <p>{Math.round(conc.share * 100)}% of the new capacity falls in 5 neighborhoods: {conc.top.map((x) => x.neighborhood).join(", ")}.</p> : null}
        <table>
          <thead><tr><th>Neighborhood</th><th className="n">Parcels gaining</th><th className="n">Newly buildable</th><th className="n">Homes added</th><th className="n">Pencil (likely)</th><th style={{ width: "22%" }}>&nbsp;</th></tr></thead>
          <tbody>
            {hoods.slice(0, 10).map((x) => (
              <tr key={x.neighborhood}><td>{x.neighborhood}</td><td className="n">{x.parcels.toLocaleString()}</td><td className="n">{x.newly.toLocaleString()}</td><td className="n">{x.homes.toLocaleString()}</td><td className="n">{(x.homes_pencil ?? 0).toLocaleString()}</td>
                <td><span className="bar" style={{ width: `${(100 * x.homes) / maxHomes}%` }} /></td></tr>
            ))}
          </tbody>
        </table>
        {hoods.length > 10 ? <p className="fine">Top 10 of {hoods.length} neighborhoods. The CSV export lists every parcel that gains homes.</p> : null}
      </section>

      {/* ------------------------------------------------------------ page 3: assumptions, sources, limits */}
      <section className="page p3">
        <h2 style={{ marginTop: 0 }}>Method and assumptions</h2>
        <ol>
          <li><b>Baseline</b> is today’s code as transcribed in the EaseScore.AI zoning table, scored with the Ease Score engine (config v0.2). With every lever off, results equal the baseline exactly.</li>
          <li><b>Eligibility.</b> Attached homes: R1D and R1A lots no wider than {sc.levers.attached.maxWidthFt} ft (measured along the street) where two units are not already permitted. Minimum lot size: every district with a minimum lot size or lot area per unit. Parking: every district with a minimum{sc.levers.parking === "transit" ? `, within ${TRANSIT_M} m (¼ mile) of a frequent-transit stop` : ""}. Parks (P) and districts that permit no housing are excluded. Only eligible parcels are recomputed.</li>
          {sc.levers.adu ? <li><b>ADUs.</b> {LEVER_METHOD.adu}</li> : null}
          {sc.levers.contextual ? <li><b>Front setback.</b> {LEVER_METHOD.contextual}</li> : null}
          {sc.levers.height ? <li><b>Height.</b> {LEVER_METHOD.height}</li> : null}
          <li><b>Capacity.</b> The lot-fit test (QuickFit) reruns with the changed rules for single-family, duplex, 3–4 unit and townhouse-row options; homes allowed by right = the most homes an option fits with the use permitted and no variance. Range: low counts only homes that need no lot split; high adds lots the fit test could not finish, at the average gain.</li>
          <li><b>Pencil test.</b> Sale value = nearby new-construction price per finished sq ft × finished area. Cost = ${meta?.cost_basis.costPsf.high}–${meta?.cost_basis.costPsf.low} per sq ft construction × gross area × (1 + soft costs + {Math.round((meta?.cost_basis.contingencyShare ?? 0) * 100)}% contingency) + the lot at assessed value. Pencils at a margin of at least {Math.round((meta?.cost_basis.minMargin ?? 0) * 100)}% after {Math.round((meta?.cost_basis.brokerShare ?? 0) * 100)}% selling costs.</li>
          <li><b>Fiscal.</b> Added assessed value × millage for each taxing body, at full build-out of homes that pencil.</li>
        </ol>
        <h2>Sources and data dates</h2>
        <table>
          <thead><tr><th>Data</th><th>Source</th><th>Date</th></tr></thead>
          <tbody>
            <tr><td>Parcels, lot outlines, assessments</td><td>Allegheny County Office of Property Assessments; County parcel boundaries</td><td>{meta?.computed_at?.slice(0, 10) ?? "—"} load</td></tr>
            <tr><td>Zoning districts and rules</td><td>City of Pittsburgh zoning map; Pittsburgh Zoning Code (transcribed)</td><td>2026</td></tr>
            <tr><td>New-construction sales</td><td>Allegheny County valid sales ({meta?.citywide.n ?? "—"} City sales)</td><td>{meta ? `${meta.sales_window.earliest} to ${meta.sales_window.latest}` : "—"}</td></tr>
            <tr><td>Construction and soft costs</td><td>EaseScore.AI cost assumptions v0.1 (Pittsburgh builder published ranges; labeled assumptions)</td><td>2026</td></tr>
            <tr><td>Millage</td><td>Allegheny County Treasurer published millage listings ({(meta?.millage ?? []).map((m) => `${m.name.replace(/^PITTSBURGH$/, "Pittsburgh Public Schools")} ${m.mills}`).join("; ")})</td><td>{meta?.millage?.[0]?.year ?? "—"}</td></tr>
            <tr><td>Frequent transit</td><td>Pittsburgh Regional Transit GTFS (weekday 7–9 am)</td><td>current feed</td></tr>
            <tr><td>Results</td><td>EaseScore.AI policy batch ({meta?.policy_version})</td><td>{s.computed_at?.slice(0, 10) ?? "—"}</td></tr>
          </tbody>
        </table>
        <h2>Limitations</h2>
        <ul>
          <li><b>Capacity is not production.</b> Ownership, financing, construction costs, labor and market absorption decide what is built and when. Many lots that gain capacity will not be redeveloped.</li>
          <li>Zoning rules are our transcription; overlays, residential compatibility standards, historic review and site conditions are not fully modeled. Check the Code.</li>
          <li>The pencil test is a screening test, simpler than a project pro forma. Land is valued at assessed value, which is a base-year level and often below market.</li>
          <li>New assessed values use a City-wide assessment ratio; actual assessments of new homes vary.</li>
          <li>Census and demographic data are never used to compute capacity, pencils or revenue. Displacement risk is not modeled here.</li>
          <li>{s.skipped ? `${s.skipped.toLocaleString()} large or irregular lots could not be fit-tested in time; they widen the high end of the range.` : "Large or irregular lots whose fit test runs out of time are left out of the likely value."}</li>
        </ul>
        <p className="fine">EaseScore.AI · decision support only · not a legal reading of the Zoning Code or a financial forecast · {date}</p>
      </section>
    </main>
  );
}
