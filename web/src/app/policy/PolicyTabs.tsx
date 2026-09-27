"use client";

// Tabs under the policy map: Where (neighborhoods), Who (census context, never used to score),
// Fiscal ledger (new assessed value x millage per taxing body) and Method (plain-English method).

import { EmptyState, RangeValue, ReceiptButton, formatRange, fmtMoney } from "@/components/seats";
import {
  concentration, leverSentence, LEVER_METHOD, TRANSIT_M, type Fiscal, type LeverState, type Places, type PolicyMeta, type Summary,
} from "@/lib/policy/model";
import type { Who } from "@/lib/policy/data";
import type { DataFlags } from "./PolicyApp";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function WhereTab({ summary, flags, places, highlight }: { summary: Summary; flags: DataFlags; places: Places | null; highlight: string | null }) {
  const rows = [...summary.by_neighborhood].sort((a, b) => b.homes - a.homes);
  const total = rows.reduce((t, r) => t + r.homes, 0);
  const { top, share } = concentration(summary);
  const max = Math.max(1, ...rows.map((r) => r.homes));
  const pencilHoods = rows.filter((r) => (r.homes_pencil ?? 0) > 0).sort((a, b) => (b.homes_pencil ?? 0) - (a.homes_pencil ?? 0));
  if (!rows.length) return <EmptyState title="No parcel gains homes under this change" tone="empty">The lever applies to {summary.eligible.toLocaleString()} parcels, but none of them fits more homes by right.</EmptyState>;
  return (
    <div className="pol-where">
      <p className="pol-lede">
        {top.length >= 5
          ? <>{pct(share)} of the new capacity falls in 5 neighborhoods: {top.map((r) => r.neighborhood).join(", ")}.</>
          : <>New capacity lands in {rows.length} neighborhood{rows.length === 1 ? "" : "s"}.</>}
        {share >= 0.5 && top.length >= 5 ? " That is concentrated: check those neighborhoods’ infrastructure and displacement pressure." : ""}
        {" "}{pencilHoods.length
          ? <>Homes that pencil at today’s prices (likely scenario) are in {pencilHoods.length} neighborhood{pencilHoods.length === 1 ? "" : "s"}: {pencilHoods.slice(0, 5).map((r) => `${r.neighborhood} (${(r.homes_pencil ?? 0).toLocaleString()})`).join(", ")}{pencilHoods.length > 5 ? ", …" : ""}. Elsewhere the pencil column is 0 because nearby new-construction prices don’t cover cost (construction plus the lot at assessed value); the high-price column shows where they could.</>
          : <>No added home pencils at today’s prices in the likely scenario; the high-price column shows where they could.</>}
      </p>
      <div className="pol-tablewrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="pol-table">
          <caption className="es-sr">Homes added by right, by neighborhood</caption>
          <thead>
            <tr><th scope="col">Neighborhood</th><th scope="col" className="num">Parcels gaining</th><th scope="col" className="num">Newly buildable</th>
              <th scope="col" className="num">Homes added</th><th scope="col" className="num">Share</th><th scope="col" className="num">Pencil (likely)</th><th scope="col" className="num">Pencil (high prices)</th><th scope="col"><span className="es-sr">Bar</span></th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={r.neighborhood} className={highlight && r.neighborhood === highlight ? "is-hl" : ""}>
                <th scope="row">{r.neighborhood}</th>
                <td className="num">{r.parcels.toLocaleString()}</td>
                <td className="num">{r.newly.toLocaleString()}</td>
                <td className="num">{r.homes.toLocaleString()}</td>
                <td className="num">{total ? pct(r.homes / total) : "—"}</td>
                <td className="num">{(r.homes_pencil ?? 0).toLocaleString()}</td>
                <td className="num">{r.homes_pencil_high != null ? r.homes_pencil_high.toLocaleString() : "—"}</td>
                <td className="pol-barcell" aria-hidden="true"><span style={{ width: `${(100 * r.homes) / max}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 40 ? <p className="pol-muted">Showing the 40 neighborhoods with the most new capacity of {rows.length}. The CSV export lists every parcel that gains homes.</p> : null}
      </div>
      <h3 className="pol-h3">By council district</h3>
      {!flags.geo ? (
        <EmptyState compact dataset="Council district boundaries">The by-district view appears when the parcel-to-council-district crosswalk is loaded.</EmptyState>
      ) : places?.by_district?.length ? (
        <div className="pol-tablewrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="pol-table">
            <caption className="es-sr">Homes added by right, by City Council district</caption>
            <thead><tr><th scope="col">Council district</th><th scope="col" className="num">Parcels gaining</th><th scope="col" className="num">Newly buildable</th>
              <th scope="col" className="num">Homes added</th><th scope="col" className="num">Share</th><th scope="col"><span className="es-sr">Bar</span></th></tr></thead>
            <tbody>
              {[...places.by_district].sort((a, b) => (a.district ?? 99) - (b.district ?? 99)).map((d) => (
                <tr key={d.district ?? "none"}>
                  <th scope="row">{d.district != null ? `District ${d.district}` : "Outside a district polygon"}</th>
                  <td className="num">{d.parcels.toLocaleString()}</td><td className="num">{d.newly.toLocaleString()}</td>
                  <td className="num">{d.homes.toLocaleString()}</td><td className="num">{total ? pct(d.homes / total) : "—"}</td>
                  <td className="pol-barcell" aria-hidden="true"><span style={{ width: `${(100 * d.homes) / Math.max(1, ...places.by_district.map((x) => x.homes))}%` }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pol-muted">City Council districts, 2022 map (parcel centroid in district).</p>
        </div>
      ) : <p className="pol-muted">Loading districts…</p>}
      <p className="pol-muted">Counts are exact model counts per neighborhood; the headline shows them as ranges. Neighborhood = City of Pittsburgh neighborhood the parcel sits in.</p>
    </div>
  );
}

const money0 = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`);
const pct0 = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(Number(n))}%`);

export function WhoTab({ flags, who, computing }: { flags: DataFlags; who: Who | null; computing: boolean }) {
  const share = (n: number) => (who && who.homes ? pct(n / who.homes) : "—");
  return (
    <div className="pol-who">
      <p className="pol-lede">Who lives where the new capacity lands: context only. Census figures are never used to decide capacity, pencils or scores.</p>
      {!flags.acs ? (
        <EmptyState dataset="Census income and rent-burden data (ACS 5-year)" />
      ) : !who ? <p className="pol-muted">Loading census context…</p> : !who.homes ? (
        <EmptyState title="No parcel gains homes under this change" tone="empty" />
      ) : (
        <>
          <ul className="pol-facts">
            <li><b>{share(who.homes_below_city_median)}</b> of the new capacity is in census tracts with a median household income below the City tract median ({money0(who.city_median_income)}).</li>
            <li><b>{share(who.homes_high_burden)}</b> is in tracts where at least half of renters pay 30% or more of income on rent.</li>
            <li><b>{share(who.homes_majority_renter)}</b> is in tracts where most households rent.</li>
            <li><b>{share(who.homes_displacement_flag)}</b> is in tracts flagged for displacement risk: rent burden that high <em>and</em> median sale prices up 15% or more ({who.price_window ?? "last four years"}, last 24 months vs the 24 before).</li>
          </ul>
          <div className="pol-tablewrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="pol-table">
              <caption className="es-sr">Census context for the tracts that gain the most capacity</caption>
              <thead><tr><th scope="col">Census tract</th><th scope="col" className="num">Homes added</th><th scope="col" className="num">Median household income</th>
                <th scope="col" className="num">Renter share</th><th scope="col" className="num">Renters paying 30%+</th><th scope="col" className="num">Median rent</th>
                <th scope="col" className="num">Sale price change</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {who.tracts.slice(0, 15).map((t) => (
                  <tr key={t.geoid}>
                    <th scope="row">{(t.name ?? t.geoid).split(";")[0]}</th>
                    <td className="num">{t.homes.toLocaleString()}</td>
                    <td className="num">{money0(t.median_hh_income)}{t.median_hh_income_moe ? <span className="pol-muted"> ±{Math.round(Number(t.median_hh_income_moe) / 1000)}k</span> : null}</td>
                    <td className="num">{pct0(t.renter_share_pct)}</td>
                    <td className="num">{pct0(t.rent_burden_30_pct)}</td>
                    <td className="num">{money0(t.median_gross_rent)}</td>
                    <td className="num">{t.price_change_pct == null ? "too few sales" : `${t.price_change_pct > 0 ? "+" : ""}${Math.round(Number(t.price_change_pct))}%`}</td>
                    <td>{t.displacement_flag ? "Displacement risk" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pol-muted">
            U.S. Census Bureau ACS 5-year {who.acs_year ? `(${Number(who.acs_year) - 4}–${who.acs_year})` : ""} by tract; ± is the Census margin of error. Sale price change: Allegheny County valid sales.
            Tract figures describe everyone in the tract, not the people on these lots. {computing ? "Shares cover the parcels computed so far." : ""}
          </p>
        </>
      )}
      <div className="pol-note">
        <strong>Displacement risk.</strong> More homes allowed by right can raise land values. Where many renters already pay over 30% of income
        and sale prices have been rising, pair a rule change with tenant protections and affordability tools. The flag marks where to look; it does not predict displacement.
      </div>
    </div>
  );
}

export function FiscalTab({ summary, fis, meta }: { summary: Summary; fis: Fiscal | null; meta: PolicyMeta | null }) {
  if (!fis) return <EmptyState dataset="Millage rates (County Treasurer)" />;
  const money = (r: { low: number; likely: number; high: number }) => <RangeValue value={r} format="money" size="sm" />;
  return (
    <div className="pol-fiscal">
      <div className="pol-tablewrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="pol-table">
          <caption className="es-sr">Fiscal ledger by taxing body</caption>
          <thead>
            <tr><th scope="col">Taxing body</th><th scope="col" className="num">Millage</th><th scope="col" className="num">New assessed value</th>
              <th scope="col" className="num">New revenue / yr</th><th scope="col" className="num">Abatement cost / yr</th><th scope="col" className="num">Break-even</th></tr>
          </thead>
          <tbody>
            {fis.rows.map((r, i) => (
              <tr key={`${r.body.id}-${r.body.name}`}>
                <th scope="row">{r.body.name}</th>
                <td className="num">{r.body.mills} mills ({r.body.year})</td>
                <td className="num">{money(fis.av[i] ?? summary.av_delta)}</td>
                <td className="num">{money(r.revenue)}</td>
                <td className="num">{fis.abatement ? <>{money(r.abatementPerYear)}<span className="pol-muted"> for {fis.abatement.years} yr</span></> : "none"}</td>
                <td className="num">{fis.abatement ? (r.breakEvenYear ? `year ${r.breakEvenYear}` : "—") : "n/a"}</td>
              </tr>
            ))}
            <tr className="pol-total">
              <th scope="row">All bodies</th>
              <td className="num">{Math.round(fis.totalMills * 100) / 100} mills<span className="pol-muted"> (City + PPS)</span></td>
              <td className="num">{money(summary.av_delta)}</td>
              <td className="num">{money(fis.total)}</td>
              <td className="num">{fis.abatement ? money(fis.abatementTotal) : "none"}</td>
              <td />
            </tr>
            <tr>
              <th scope="row">Doing nothing</th>
              <td className="num" colSpan={2}>these lots keep today’s assessed value</td>
              <td className="num">$0 new · {fmtMoney(fis.doingNothing)}/yr paid today</td>
              <td className="num" colSpan={2}><ReceiptButton receipt={{
                label: "Cost of doing nothing", value: `${fmtMoney(fis.doingNothing)} per year`, kind: "data",
                source: "Allegheny County assessments (county assessed value) and the millage above", date: String(fis.rows[0]?.body.year ?? ""),
                method: `Today’s assessed value of the parcels that gain homes (${fmtMoney(summary.av_before_gaining)}) × ${Math.round(fis.totalMills * 100) / 100} mills ÷ 1,000. Without the change these lots add no new value; vacant land yields little.`,
              }} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="pol-muted">
        Millage from the County Treasurer’s published rates ({fis.rows.map((r) => `${r.body.name} ${r.body.year}`).join(", ")}). New assessed value assumes every home that pencils
        is built, crediting only the added homes: their share of the scheme’s sale value × assessment ratio {meta?.ratio.p50 ?? "—"} (median of {meta?.ratio.n ?? "—"} recent new-construction sales), less the existing building on lots that had no by-right home before.
        {fis.abatement ? ` Abatement: ${Math.round(fis.abatement.share * 100)}% of the tax on the added value for ${fis.abatement.years} years (illustrative LERTA-style terms, not a verified program). Break-even is the year cumulative collected tax covers the forgone tax.` : ""}
        {" "}Range: {formatRange(fis.total, { format: "money" })} per year.
      </p>
    </div>
  );
}

export function MethodTab({ meta, levers, summary }: { meta: PolicyMeta | null; levers: LeverState; summary: Summary | null }) {
  return (
    <div className="pol-method">
      <h3>What this tests</h3>
      <p>{leverSentence(levers)}.</p>
      <h3>How it is calculated</h3>
      <ol>
        <li><strong>Baseline</strong> is today’s code as transcribed in our zoning table, scored by the same engine as every parcel page (Ease Score config v0.2). With every lever off the results equal the baseline exactly.</li>
        <li><strong>Which parcels.</strong> Each lever has an eligibility rule: <em>attached homes</em> applies to lots in R1D and R1A no wider than the slider (street frontage from the lot outline) where a two-unit building is not already permitted; <em>minimum lot size</em> applies wherever the district has a minimum lot size or lot area per unit; <em>parking</em> applies wherever a parking minimum exists (within {TRANSIT_M} m of a frequent-transit stop for the transit option). Parks (P) and districts that permit no housing type are left out. Only those parcels are recomputed.</li>
        {levers.adu ? <li><strong>ADUs.</strong> {LEVER_METHOD.adu}</li> : null}
        {levers.contextual ? <li><strong>Front setback.</strong> {LEVER_METHOD.contextual}</li> : null}
        {levers.matchBlock ? <li><strong>Match the block.</strong> {LEVER_METHOD.matchBlock}</li> : null}
        {levers.height ? <li><strong>Height.</strong> {LEVER_METHOD.height}</li> : null}
        <li><strong>Capacity.</strong> For each eligible parcel the zoning rules are rewritten for the lever and the lot-fit test (QuickFit) runs again for single-family, duplex, 3–4 unit and townhouse-row options. Homes allowed by right = the most homes an option fits with the use permitted and no variance. The headline range: <em>low</em> = only homes that need no lot split (townhouse rows need a subdivision plan first; for ADUs, only lots where the footprint check passes); <em>likely</em> = low plus the homes that need a split on lots where the scheme pencils at high prices (the split could pay off); <em>high</em> = every home the fit test finds.</li>
        <li><strong>Pencil test.</strong> For parcels that gain homes, the by-right scheme is tested against nearby new-construction prices and the cost defaults, in a low, likely and high scenario.</li>
        <li><strong>Fiscal.</strong> Added assessed value × millage per taxing body, for homes that pencil.</li>
      </ol>
      <h3>Limits</h3>
      <ul>
        <li>Capacity is not production. Owners, financing, construction labor and market absorption decide what gets built and when; a lot that can take more homes may never be redeveloped.</li>
        <li>The Zoning Code text is summarized from our transcription; overlays, residential compatibility standards and site-specific conditions are not modeled. Check the code before relying on a count.</li>
        <li>The pencil test is simpler than the parcel pro forma: no financing detail or site adders; land at assessed value (a base-year level that often understates price).</li>
        <li>Large or irregular lots whose fit test runs out of time are not counted in any of the three values.{summary?.skipped ? ` ${summary.skipped.toLocaleString()} lots in this run.` : ""}</li>
        <li>An inclusionary-share lever is not modeled.</li>
        <li>Census and demographic data are never inputs to capacity, pencils or scores.</li>
      </ul>
      <h3>Data dates</h3>
      <ul>
        <li>New-construction sales: {meta ? `${meta.sales_window.earliest} to ${meta.sales_window.latest} (${meta.citywide.n} City sales)` : "not loaded"}.</li>
        <li>Millage: {meta?.millage?.length ? meta.millage.map((m) => `${m.name} ${m.mills} (${m.year})`).join("; ") : "not loaded"}.</li>
        <li>Results computed: {summary?.computed_at?.slice(0, 16).replace("T", " ") ?? "in progress"} UTC · {meta?.policy_version ?? ""}.</li>
      </ul>
    </div>
  );
}
