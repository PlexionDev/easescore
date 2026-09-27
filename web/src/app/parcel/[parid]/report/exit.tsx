// The studied exit (sell or rent) leads the summary. A for-sale study leads with gross sellout,
// selling costs, total development cost, developer profit and margin; rental measures (NOI, yield on
// cost, cap rate, DSCR) appear only as a labeled alternative, and the reverse for a rental study.

import type { finance } from "@easescore/engine";
import type { Ctx } from "./sections";
import { money } from "@/lib/report/assess";

const fn = (x: Ctx, ...keys: string[]) => <sup className="fn">[{keys.map((k) => x.c.ref(k)).join(", ")}]</sup>;
const pct = (s: number | null | undefined, d = 1) => (typeof s === "number" && Number.isFinite(s) ? `${s < 0 ? "−" : ""}${(Math.abs(s) * 100).toFixed(d)}%` : "—");
const val = (r: finance.Receipt | undefined) => (r && r.status === "ok" ? r.value : null);
const neg = (n: number | null) => (n == null ? "—" : `−${money(n)}`);

export function ExitLead(x: Ctx) {
  const { m } = x;
  const pf = m.proForma;
  const rent = pf.plan.tenure === "rent";
  const { sale } = pf;
  const r = pf.rent;
  const value = val(m.rental.stabilizedValue);
  const dscr = val(m.rental.financing.dscr);
  const capRate = value && r.noi ? r.noi / value : null;

  const saleRows = (
    <tbody>
      <tr><td>Gross sellout</td><td className="num">{money(sale.grossSales)}</td></tr>
      <tr><td>Less selling and closing costs</td><td className="num">{neg(sale.sellingCosts)}</td></tr>
      <tr><td>Less total development cost</td><td className="num">{neg(pf.tdc)}</td></tr>
      <tr className="total"><td>Developer profit</td><td className="num">{money(sale.profit)}</td></tr>
      <tr><td>Margin (profit on cost)</td><td className="num">{pct(sale.margin)}</td></tr>
    </tbody>
  );
  const rentRows = (
    <tbody>
      <tr><td>Net operating income (a year, before loan payments)</td><td className="num">{money(r.noi)}</td></tr>
      <tr><td>Total development cost</td><td className="num">{money(pf.tdc)}</td></tr>
      <tr className="total"><td>Yield on cost (NOI ÷ total cost)</td><td className="num">{pct(r.yieldOnCost)}</td></tr>
      <tr><td>Cap rate used to value it</td><td className="num">{capRate != null ? pct(capRate) : "Not set (needs a local cap rate)"}</td></tr>
      <tr><td>Debt service coverage (DSCR)</td><td className="num">{dscr != null ? `${dscr.toFixed(2)}×` : "Not set (needs permanent loan terms)"}</td></tr>
    </tbody>
  );
  const altSale =
    sale.grossSales != null && sale.profit != null
      ? `gross sellout ${money(sale.grossSales)}, less ${money(sale.sellingCosts)} selling costs and ${money(pf.tdc)} total cost, leaves ${sale.profit >= 0 ? `a ${money(sale.profit)} profit` : `a ${money(-sale.profit)} loss`} (${pct(sale.margin)} on cost).`
      : "the sale price is not estimated for this layout.";
  const altRent =
    r.noi != null
      ? `about ${money(r.noi)} a year after running costs (NOI), ${pct(r.yieldOnCost)} yield on cost${capRate != null ? `, valued at a ${pct(capRate)} cap rate` : "; a local cap rate is needed to value it"}${dscr != null ? `, DSCR ${dscr.toFixed(2)}×` : ""}. Details in Sections 8 and 9.`
      : "rent is not estimated for this layout (Section 8).";

  return (
    <div className="exit-lead">
      <h2 style={{ marginTop: 0 }}>{rent ? "Studied exit: rent" : "Studied exit: sell"}</h2>
      <table aria-label={rent ? "Rental headline" : "For-sale headline"}>
        <thead><tr><th>{rent ? "If built to rent (unlevered)" : "If built to sell"}</th><th className="num">Amount</th></tr></thead>
        {rent ? rentRows : saleRows}
      </table>
      <p className="small">
        <b>{rent ? "If you sold instead…" : "If you rented instead…"}</b> {rent ? altSale : altRent}
        {fn(x, "cost_config", "finance_engine")}
      </p>
    </div>
  );
}
