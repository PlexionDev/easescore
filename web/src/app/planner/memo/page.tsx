import type { Metadata } from "next";
import localFont from "next/font/local";
import {
  BADGE_NOTE, CITY, CSV_DATE_SOURCES, FACTORS, FT_PER_M, STRATEGY_TEXT, describeFilters, ownerLabel, parcelLabel, parseDir,
  parseFilters, parseSort, plannerOptions, plannerQuery, titleCase, type PlannerRow,
} from "@/lib/planner";
import "./memo.css";

// Staff memo (print page): a cover summarizing the filter, counts and blockers, then one page per
// shortlisted parcel. /api/planner/memo renders it to PDF. Every number comes from parcel_scores.

const sans = localFont({ src: "../../fonts/brand-sans.woff2", weight: "100 900", style: "normal", variable: "--memo-sans", display: "block" });

export const metadata: Metadata = { title: "Staff memo — EaseScore.AI", robots: { index: false } };

const n = (x: number | null | undefined) => (x == null ? "—" : Math.round(x).toLocaleString("en-US"));

function ParcelPage({ r, rank }: { r: PlannerRow; rank: number }) {
  const hz = [r.hz_floodway && "FEMA floodway", r.hz_landslide && "landslide-prone overlay", r.hz_undermined && "undermined (old mines)",
    (r.steep_share ?? 0) >= 0.25 && `${Math.round((r.steep_share ?? 0) * 100)}% of the lot steeper than 25%`].filter(Boolean) as string[];
  return (
    <section className="page">
      <p className="meta">Shortlisted parcel {rank} · parcel ID {r.parid.trim()}</p>
      <h1>{parcelLabel(r)}</h1>
      <p className="meta">{[r.neighborhood, titleCase(r.municipality), r.zoning ? `zoning ${r.zoning}` : "zoning not loaded", ownerLabel(r), r.lot_sqft != null ? `${n(r.lot_sqft)} sq ft lot` : null, r.vacant ? "vacant" : "has a structure"].filter(Boolean).join(" · ")}</p>

      <h2>Development Ease Score</h2>
      <div className="grid">
        <div>
          <p className="big">{r.score ?? "—"} <span style={{ fontSize: "12pt", fontWeight: 600 }}>{r.band ?? "No score"}</span></p>
          {r.range_lo != null ? <p>{r.preliminary ? "Preliminary: m" : "M"}issing data puts it between {r.range_lo} and {r.range_hi}.</p> : null}
          {!r.zoning ? <p>Zoning rules for {titleCase(r.municipality) || "this municipality"} are not loaded; confirm zoning with {titleCase(r.municipality) || "the municipality"}.</p> : null}
          <p>Best option that adds homes: {r.best_strategy ? STRATEGY_TEXT[r.best_strategy] ?? r.best_strategy : "none scored"}.</p>
          <p>Rehab of the existing building: {r.rehab_score != null ? `${r.rehab_score} (${r.rehab_band})` : "no building on the lot"}.</p>
        </div>
        <div>
          <div className="kv"><span>Homes by right</span><b>{r.by_right_units ?? "not computed"}</b></div>
          <div className="kv"><span>Homes with typical relief</span><b>{r.units_with_relief ?? "not computed"}</b></div>
          <div className="kv"><span>Months to a building permit (estimate)</span><b>{r.months_to_permit != null ? `about ${r.months_to_permit}` : "—"}</b></div>
          <div className="kv"><span>Frequent transit</span><b>{r.transit_m != null ? `${n(Math.round((r.transit_m * FT_PER_M) / 10) * 10)} ft` : "—"}</b></div>
          <div className="kv"><span>Tax-delinquent</span><b>{r.tax_delinquent == null ? "unknown" : r.tax_delinquent ? "yes" : "no"}</b></div>
          <div className="kv"><span>Planning badge ({BADGE_NOTE.toLowerCase()})</span><b>{r.planning_badge ?? "none"}</b></div>
        </div>
      </div>

      <h2>Issues for staff review</h2>
      <ul>
        {r.red_flags.map((f) => <li key={f.id}><b>Blocked unless resolved:</b> {f.title}.</li>)}
        {r.cap_label ? <li>{r.cap_label}.</li> : null}
        {r.blockers.length ? <li>What costs the most points, in order: {r.blockers.join("; ")}.</li> : <li>No factor costs a full point.</li>}
        <li>Mapped hazards: {hz.length ? hz.join("; ") : "none on record"}.</li>
        {r.note ? <li>{r.note}</li> : null}
      </ul>

      <h2>Factor scores</h2>
      <table>
        <thead><tr><th>Factor</th><th className="n">Weight</th><th className="n">Sub-score (0-100)</th><th style={{ width: "40%" }}>&nbsp;</th></tr></thead>
        <tbody>
          {FACTORS.map((f) => {
            const v = r.factor_scores?.[f.id] ?? null;
            return (
              <tr key={f.id}>
                <td>{f.label}</td><td className="n">{f.weight}%</td><td className="n">{v == null ? "no data" : Math.round(v)}</td>
                <td>{v != null ? <span className="bar" style={{ width: `${Math.max(1, v)}%` }} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fine">Precomputed with score config v{r.config_version} on {r.computed_at.slice(0, 10)}. Receipts, the full requirements checklist and the pro forma are in the parcel&apos;s Developer view and Feasibility Study (EaseScore.AI, parcel {r.parid.trim()}). Decision support only; confirm zoning with the City.</p>
    </section>
  );
}

export default async function MemoPage({ searchParams }: PageProps<"/planner/memo">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const f = parseFilters(q);
  if (!f.muni) f.muni = CITY;
  const sort = parseSort(q.get("sort"));
  const dir = parseDir(q.get("dir"), sort);
  const shortlist = (q.get("shortlist") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[0-9A-Z]{16}$/.test(x)).slice(0, 25);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date")! : new Date().toISOString().slice(0, 10);
  const [sum, picked, options] = await Promise.all([
    plannerQuery(f, sort, dir, 10, 0),
    shortlist.length ? plannerQuery({ ids: shortlist }, "score", "desc", 25, 0) : Promise.resolve(null),
    plannerOptions().catch(() => null),
  ]);
  const byId = new Map((picked?.rows ?? []).map((r) => [r.parid.trim(), r]));
  const rows = shortlist.length ? shortlist.map((id) => byId.get(id)).filter((r): r is PlannerRow => !!r) : sum.rows;
  const dates = options?.data_dates ?? {};
  const top = sum.blockers.slice(0, 6);

  return (
    <main className={`memo ${sans.variable}`} data-report-ready="">
      <section className="page">
        <p className="meta">EaseScore.AI · Staff memo · {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })}</p>
        <h1>Candidate housing sites</h1>
        <p>This memo lists sites that match the criteria below, ranked by the Development Ease Score (0-100, higher means easier to get housing built). It is decision support, not a zoning determination.</p>

        <h2>Criteria</h2>
        <p>{describeFilters(f).join(" · ")}</p>

        <h2>What the filter finds</h2>
        <div className="grid">
          <div>
            <div className="kv"><span>Matching parcels</span><b>{n(sum.total)}</b></div>
            {(["Easy", "Moderate", "Hard", "Very hard"] as const).map((b) => <div key={b} className="kv"><span>{b}</span><b>{n(sum.bands[b] ?? 0)}</b></div>)}
          </div>
          <div>
            <div className="kv"><span>Homes by right</span><b>{n(sum.capacity.by_right_clean)} to {n(sum.capacity.by_right)}</b></div>
            <div className="kv"><span>Homes with typical relief</span><b>{n(sum.capacity.relief_clean)} to {n(sum.capacity.relief)}</b></div>
            <div className="kv"><span>Publicly owned lots</span><b>{n(sum.public_land.count)} ({sum.public_land.acres} acres)</b></div>
            <div className="kv"><span>Buildable public lots</span><b>{n(sum.public_land.buildable_count)} ({sum.public_land.buildable_acres} acres)</b></div>
          </div>
        </div>
        <p className="fine">Home counts: the low end counts parcels with no red flag and no hazard band cap; the high end counts every matching parcel.</p>

        <h3>What holds these sites back (share of matching parcels; a parcel can have several)</h3>
        <table>
          <thead><tr><th>Blocker</th><th className="n">Parcels</th><th className="n">Share</th></tr></thead>
          <tbody>{top.map((b) => <tr key={b.blocker}><td>{b.blocker}</td><td className="n">{n(b.n)}</td><td className="n">{Math.round((100 * b.n) / Math.max(1, sum.total))}%</td></tr>)}</tbody>
        </table>

        <h2>Shortlist</h2>
        <p className="meta">{shortlist.length ? "Parcels pinned by staff." : "The top 10 by the table's sort order."}</p>
        <table>
          <thead><tr><th>#</th><th>Parcel</th><th>Neighborhood</th><th>Zoning</th><th className="n">Score</th><th>Top blocker</th><th className="n">By right</th><th className="n">Relief</th><th className="n">Months</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.parid}>
                <td>{i + 1}</td><td>{parcelLabel(r)}</td><td>{r.neighborhood ?? "—"}</td><td>{r.zoning ?? "not loaded"}</td>
                <td className="n">{r.score ?? "—"} {r.band ?? ""}</td><td>{r.top_blocker ?? "none major"}</td>
                <td className="n">{r.by_right_units ?? "—"}</td><td className="n">{r.units_with_relief ?? "—"}</td><td className="n">{r.months_to_permit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Sources and limits</h2>
        <p className="fine">
          Data dates: {CSV_DATE_SOURCES.filter(([, s]) => dates[s]).map(([, s]) => `${s} ${dates[s]}`).join("; ") || "see the sources CSV"}.
          Scores precomputed with score config v{(options?.config_versions ?? []).join(", v")}; policy what-ifs off. Unit counts come from an automated lot-fit test on the county parcel outline and are not a site plan.
          Months to permit are estimates. The planning badge uses {BADGE_NOTE.toLowerCase()} and never changes the score. Owner names of private individuals are never shown.
          Decision support only. Not legal, financial or zoning advice. Confirm zoning with the City and costs with local bids.
        </p>
      </section>
      {rows.map((r, i) => <ParcelPage key={r.parid} r={r} rank={i + 1} />)}
    </main>
  );
}
