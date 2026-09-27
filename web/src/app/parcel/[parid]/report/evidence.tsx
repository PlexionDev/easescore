// Report evidence blocks: the comparable-sales grid and the confidence grades.
// Plain functions (like the sections) so table numbers and footnotes are assigned in reading order.
// Numbers come from the engine only: the grid is built from the pro forma's own value comps.

import { assumptions } from "@easescore/engine";
import { money, num, titleCase } from "@/lib/report/assess";
import type { Ctx } from "./sections";

const fn = (x: Ctx, ...keys: string[]) => <sup className="fn">[{keys.map((k) => x.c.ref(k)).join(", ")}]</sup>;

/** "1200 block of SMITH ST" → "1200 block of Smith St". */
const blockText = (r: assumptions.CompGridRow) => r.blockAddress.replace(/^(.*block of )(.+)$/, (_m, a: string, st: string) => `${a}${titleCase(st)}`);

/** The grid for this study (same comps the sale value came from); null for a rehab or when unavailable. */
export function studyGrid(x: Ctx): assumptions.CompGrid | null {
  const p = x.m.proForma.plan;
  const c = p.valueComps as assumptions.CompSet | null;
  if (p.strategy === "rehab_existing" || !c || !("median_living_area_sqft" in c) || c.kind !== "new_construction") return null;
  const userValue = p.assumptions.some((r) => (r.key === "salePricePerSf" || r.key === "salePricePerUnit") && r.edited);
  const perHomeSf = p.units && p.finishedSf ? p.finishedSf / p.units : null;
  return assumptions.compsGrid(c, {
    strategy: p.strategy, perHomeSf, valuePerSf: p.revenue.sale.pricePerSf, userValue,
    label: (r) => (x.print && r.address ? titleCase(r.address) : blockText(r)),
  });
}

/** Comparable-sales grid (Section 9): 5–10 new-construction sales, selection rule, reconciliation line. */
export function CompsGrid(x: Ctx) {
  const p = x.m.proForma.plan;
  const floor = p.floor;
  const g = studyGrid(x);
  if (!g) {
    if (p.strategy === "rehab_existing") return null;
    return <p className="muted">New-construction sales could not be loaded for this lot, so no comparable-sales grid is shown.</p>;
  }
  const t = g.rows.length ? x.tab() : 0;
  return (
    <div className="comps-grid">
      <h2>Comparable new-construction sales</h2>
      <p>
        <b>{g.inSet}</b> valid new-construction sale{g.inSet === 1 ? "" : "s"} within {+g.radiusMi.toFixed(2)} mi
        {g.medianPerSf != null ? <>: median <b>{money(g.medianPerSf)}</b> per finished sq ft</> : null}
        {g.p25PerSf != null && g.p75PerSf != null ? `, middle half ${money(g.p25PerSf)}–${money(g.p75PerSf)}` : ""}
        {fn(x, "nc_sales")}. Sale-revenue confidence: <b>{g.confidence}</b> ({g.confidenceWhy}).
        {g.status === "ok" && !p.assumptions.some((r) => (r.key === "salePricePerSf" || r.key === "salePricePerUnit") && r.edited) ? " The sale value in this study uses this median." : ""}
      </p>
      {g.fewNote && (
        <div className="callout amber">
          <div className="callout-title">Fewer than 5 comparable new-construction sales</div>
          <p>{g.fewNote}</p>
        </div>
      )}
      {g.rows.length > 0 && (
        <>
          <div className="tcap">Table {t}. Comparable new-construction sales ({g.rows.length} of {g.inSet} shown){fn(x, "nc_sales")}</div>
          <table className="comps-table">
            <thead>
              <tr>
                <th scope="col">Address{x.print ? "" : " (block)"}</th>
                <th scope="col" className="num">Miles</th>
                <th scope="col">Sold</th>
                <th scope="col" className="num">Price</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Finished sq ft</th>
                <th scope="col" className="num">$/sq ft</th>
                <th scope="col" className="num">Built</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={`${r.parid}${r.saleDate}`}>
                  <td>{x.print && r.address ? titleCase(r.address) : blockText(r)}</td>
                  <td className="num">{num(r.distanceMi, 2)}</td>
                  <td>{r.saleDate}</td>
                  <td className="num">{money(r.price)}</td>
                  <td>{assumptions.HOME_TYPE_LABEL[r.type]}{r.sameType ? "" : " (other type)"}</td>
                  <td className="num">{num(r.livingAreaSqft)}</td>
                  <td className="num">{money(r.pricePerSqft)}</td>
                  <td className="num">{r.yearBuilt ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            {g.orderRule} Bedrooms, bathrooms and parking are not in the County sale records, so they are not shown or adjusted. Only valid arm’s-length sales are used; no owner,
            buyer or seller names.{x.print ? "" : " On screen, addresses show the block only; the downloadable PDF lists full street addresses."}
          </p>
        </>
      )}
      {g.reconciliation && <p><b>Reconciliation:</b> {g.reconciliation}</p>}
      <p className="small muted"><b>How the sales were chosen:</b> {g.setRule}{g.steps.length ? ` Search steps: ${g.steps.join(" → ")}.` : ""}</p>
      {floor && <p className="small">{floor.text}{fn(x, "sales")}</p>}
    </div>
  );
}

/** Confidence grades table (Section 1), with the rules printed. */
export function ConfidenceGrades(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const rows = assumptions.confidenceGrades({
    plan: m.proForma.plan,
    grid: studyGrid(x),
    isCity: f.assessment?.is_pittsburgh === true,
    zoningCode: f.zoning?.code ?? null,
    zoningRules: !!m.rules,
    hasOutline: (m.qfInput?.parcel?.length ?? 0) >= 3,
    hasLidar: typeof f.slope_1m?.mean_pct === "number",
    hasScheme: !!m.scheme,
    permitFromRecords: m.score.status === "ready" && m.score.permit ? m.score.permit.method !== "heuristic" : null,
  });
  const t = x.tab();
  return (
    <div className="grades">
      <h2>How confident is each part?</h2>
      <div className="tcap">Table {t}. Confidence grades, by fixed rules (printed below)</div>
      <table className="grades-table">
        <thead><tr><th scope="col" style={{ width: "22%" }}>Part</th><th scope="col" style={{ width: "16%" }}>Grade</th><th scope="col">Why, for this parcel</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.topic} className={r.topic === "Overall" ? "overall" : undefined}>
              <td>{r.topic === "Overall" ? <b>Overall</b> : r.topic}</td>
              <td><b>{r.grade}</b></td>
              <td>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small"><b>The rules behind the grades</b></p>
      <ul className="small grade-rules">
        {rows.map((r) => <li key={r.topic}><b>{r.topic}.</b> {r.rule}</li>)}
      </ul>
    </div>
  );
}
