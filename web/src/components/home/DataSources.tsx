import Link from "next/link";

// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "data.s1.name": "Allegheny County",
  "data.s1.what": "Parcels, assessments and sales",
  "data.s2.name": "City of Pittsburgh",
  "data.s2.what": "Zoning map, zoning code and permits",
  "data.s3.name": "USGS",
  "data.s3.what": "1-meter lidar for slope and terrain",
  "data.s4.name": "FEMA",
  "data.s4.what": "Flood hazard maps",
  "data.s5.name": "PA DEP",
  "data.s5.what": "Mine and environmental records",
  "data.s6.name": "HUD and Census",
  "data.s6.what": "Income limits, rents and housing data",
};

const SOURCES = [1, 2, 3, 4, 5, 6] as const;

export default async function DataSources() {
  return (
    <section className="data-section section" id="data" aria-labelledby="data-title">
      <div className="wrap data-grid">
        <div className="data-heading reveal">
          <p className="eyebrow">Evidence you can follow</p>
          <h2 id="data-title">Built on public records<br />you can check.</h2>
          <p>Missing data is shown as missing. The date on every source is listed in each report.</p>
          <Link className="text-link" href="/methods">{"Explore data & methods"} <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="sources reveal">
          {SOURCES.map((n) => (
            <div key={n} className="source">
              <span>{String(n).padStart(2, "0")}</span>
              <div><h3>{TEXT[`data.s${n}.name`]}</h3><p>{TEXT[`data.s${n}.what`]}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
