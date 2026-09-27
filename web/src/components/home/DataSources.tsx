import Link from "next/link";

const SOURCES: [string, string][] = [
  ["Allegheny County", "Parcels, assessments and sales"],
  ["City of Pittsburgh", "Zoning map, zoning code and permits"],
  ["USGS", "1-meter lidar for slope and terrain"],
  ["FEMA", "Flood hazard maps"],
  ["PA DEP", "Mine and environmental records"],
  ["HUD and Census", "Income limits, rents and housing data"],
];

export default function DataSources() {
  return (
    <section className="data-section section" id="data" aria-labelledby="data-title">
      <div className="wrap data-grid">
        <div className="data-heading reveal">
          <p className="eyebrow">Evidence you can follow</p>
          <h2 id="data-title">Built on public records<br />you can check.</h2>
          <p>Missing data is shown as missing. The date on every source is listed in each report.</p>
          <Link className="text-link" href="/methods">Explore data &amp; methods <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="sources reveal">
          {SOURCES.map(([name, what], i) => (
            <div key={name} className="source">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div><h3>{name}</h3><p>{what}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
