// Feasibility Study blocks from engine/src/assumptions/decision.ts: the decision box at the top of the
// summary (same function as the Pencil calculator), taxes after construction, and the unit-by-unit
// sellout. Plain functions like the sections, so footnote and table numbers stay in reading order.

import { assumptions, score } from "@easescore/engine";
import type { Ctx } from "./sections";
import { money, num } from "@/lib/report/assess";
import { absorption } from "@/lib/report/extras";

const fn = (x: Ctx, ...keys: string[]) => <sup className="fn">[{keys.map((k) => x.c.ref(k)).join(", ")}]</sup>;
/** Percent with a true minus sign. */
const pct = (s: number | null | undefined, d = 0) => (typeof s === "number" && Number.isFinite(s) ? `${s < 0 ? "−" : ""}${(Math.abs(s) * 100).toFixed(d)}%` : "—");
const r1k = (n: number | null | undefined) => (n == null ? null : Math.round(n / 1000) * 1000 + 0);
const sf$ = (n: number | null | undefined) => (n == null ? "—" : `${money(Math.round(n))}/sf`);

export function DecisionBlock(x: Ctx) {
  const { m } = x;
  const d = assumptions.decisionBox(m.proForma, m.criteria);
  const c = d.criteria;
  const tCrit = x.tab();
  const criteria = (
    <>
      <div className="tcap">Table {tCrit}. Returns &amp; investment criteria (editable){fn(x, "cost_config")}</div>
      <table>
        <thead><tr><th style={{ width: "38%" }}>Criterion</th><th className="num" style={{ width: "8%" }}>Value</th><th>This project</th></tr></thead>
        <tbody>
          <tr><td>Target developer profit (share of total development cost)</td><td className="num">{pct(c.targetMargin, 0)}</td><td>{d.profitOnCost != null ? `${pct(d.profitOnCost, 1)} on cost` : "—"}</td></tr>
          <tr><td>Minimum contingency (share of hard cost)</td><td className="num">{pct(c.minContingency, 0)}</td><td>{d.contingency.text}</td></tr>
          <tr><td>Maximum construction loan (loan-to-cost)</td><td className="num">{pct(c.maxLtc, 0)}</td><td>{d.ltc.text || "—"}</td></tr>
        </tbody>
      </table>
      <p className="small muted">
        Defaults are assumptions ({assumptions.DECISION_CONFIG.targetMarginOnCost.sourceLabel}). Change them in the Pro forma; the report link carries them
        (dc_margin, dc_cont, dc_ltc){d.edited ? ". This report uses edited criteria." : "."}
      </p>
    </>
  );

  if (d.missing) {
    return (
      <div className="decision" id="decision">
        <h2 style={{ marginTop: 0 }}>Decision box</h2>
        <div className="callout pending">
          <div className="callout-title">Not computed yet</div>
          <p>{d.missing}</p>
        </div>
        {criteria}
      </div>
    );
  }

  const tWater = x.tab();
  const tBreak = x.tab();
  const rlv = d.residual.value;
  return (
    <div className="decision" id="decision">
      <h2 style={{ marginTop: 0 }}>{d.rentalPlan ? "If you sold instead… " : ""}Decision box: what can you pay for the land, and what must it sell for?</h2>
      <p className="lead"><b>{d.sentence}</b>{fn(x, "cost_config", "finance_engine")}</p>
      {d.rentalPlan && (
        <p className="small">This option is studied as a rental; the box tests building the same homes to sell. The rental result (unlevered, before loan payments) is in Sections 8 and 9.</p>
      )}
      {criteria}
      <div className="tcap">Table {tWater}. From sellout to developer profit{fn(x, "finance_engine")}</div>
      <table>
        <tbody>
          <tr><td>Gross sellout: {d.units} home{d.units === 1 ? "" : "s"} × {money(d.pricePerUnit)} ({sf$(d.pricePerSf)} × {num(d.finishedSf)} finished sq ft)</td><td className="num">{money(d.grossSellout)}</td></tr>
          <tr><td>Less selling and closing costs</td><td className="num">−{money(d.sellingClosing)}</td></tr>
          <tr className="total"><td>Net sale proceeds</td><td className="num">{money(d.netProceeds)}</td></tr>
          <tr><td>Less total development cost (land, hard, soft, contingency, financing and holding; Section 7)</td><td className="num">−{money(d.tdc)}</td></tr>
          <tr className="total"><td>{d.sellOutCarry ? "Developer profit (before loan interest after completion)" : "Developer profit"}</td><td className="num">{money(d.profit)}</td></tr>
          <tr><td>Profit on cost · profit on revenue</td><td className="num">{pct(d.profitOnCost, 1)} · {pct(d.profitOnRevenue, 1)}</td></tr>
          {d.sellOutCarry != null && d.profitAfterCarry != null && d.tdc ? (
            <>
              <tr><td>Less loan interest from completion to the last sale (not in the budget; closing schedule in Section 6)</td><td className="num">−{money(d.sellOutCarry)}</td></tr>
              <tr className="total"><td>Profit after that interest · on cost</td><td className="num">{money(d.profitAfterCarry)} · {pct(d.profitAfterCarry / d.tdc, 1)}</td></tr>
            </>
          ) : null}
          {d.levered && d.unleveredProfit != null && (
            <tr><td>Unlevered profit (before loan interest and lender fees of {money(d.financingCost)})</td><td className="num">{money(d.unleveredProfit)} ({pct(d.unleveredOnCost, 1)})</td></tr>
          )}
        </tbody>
      </table>
      <p className="small muted">{d.sellingBasis} {d.financingBasis}</p>
      <div className="tcap">Table {tBreak}. Break-evens and residual land value at a {pct(c.targetMargin, 0)} target{fn(x, "finance_engine")}</div>
      <table>
        <thead><tr><th>Measure</th><th className="num">Per home</th><th className="num">Per sq ft</th><th className="num">Total</th></tr></thead>
        <tbody>
          <tr><td>Sale price needed for the {pct(c.targetMargin, 0)} target</td><td className="num">{money(r1k(d.breakEven.perUnit))}</td><td className="num">{sf$(d.breakEven.perSf)}</td><td className="num">{money(r1k(d.breakEven.targetGross))}</td></tr>
          <tr><td>Sale price for zero profit</td><td className="num">{money(r1k(d.breakEven.zeroPerUnit))}</td><td className="num">{sf$(d.breakEven.zeroPerSf)}</td><td className="num">{money(r1k(d.breakEven.zeroPerUnit != null && d.units ? d.breakEven.zeroPerUnit * d.units : null))}</td></tr>
          <tr><td>{(d.costReduction ?? 0) > 0 ? "Cost reduction needed to reach the target" : "Cost headroom above the target"}</td><td /><td /><td className="num">{money(r1k(Math.abs(d.costReduction ?? 0)))}</td></tr>
          <tr className="total"><td>Residual land value (maximum land price that hits the target)</td><td /><td /><td className="num">{money(r1k(rlv))}</td></tr>
          <tr><td>Land price used in the budget ({d.residual.landSource})</td><td /><td /><td className="num">{money(d.residual.landUsed)}</td></tr>
        </tbody>
      </table>
      <p className="small">
        Residual land value: {d.residual.formula}.{" "}
        {rlv != null && rlv <= 0 ? <b>The site doesn’t support a land price at this margin.</b> : null}{" "}
        Each $1 of land adds about {money(d.residual.tdcPerLandDollar, 3)} of cost, because the construction loan, its interest and its fee are a share of cost.
      </p>
    </div>
  );
}

export function TaxesAfterBlock(x: Ctx) {
  const { m } = x;
  const t = assumptions.taxesAfterCompletion({
    plan: m.proForma.plan,
    isCity: score.isCityParcel(m.facts as unknown as Parameters<typeof score.isCityParcel>[0]),
    generalMills: m.facts.property_tax?.general_mills,
    assessedToday: m.facts.assessment?.fmv_total ?? null,
  });
  const tt = x.tab();
  const units = m.proForma.plan.units;
  return (
    <>
      <h2>Taxes after construction</h2>
      <div className="tcap">Table {tt}. Property tax today and after completion{fn(x, "millage", "assessment")}</div>
      <table>
        <thead><tr><th /><th className="num">Assessed value</th><th className="num">Mills</th><th className="num">Tax a year</th></tr></thead>
        <tbody>
          <tr><td>Today (current County assessment)</td><td className="num">{money(t.assessedToday)}</td><td className="num">{num(t.mills, 3)}</td><td className="num">{money(t.taxToday)}</td></tr>
          <tr><td>After completion{units && units > 1 ? ` (all ${units} homes)` : ""}</td><td className="num">{money(r1k(t.assessedAfter))}</td><td className="num">{num(t.mills, 3)}</td><td className="num">{money(r1k(t.taxAfter))}</td></tr>
          {units && units > 1 && t.taxAfterPerUnit != null ? <tr><td>After completion, per home</td><td /><td /><td className="num">{money(Math.round(t.taxAfterPerUnit / 100) * 100)}</td></tr> : null}
        </tbody>
      </table>
      <p className="small">
        Millage: {t.millsLabel}. Assessment ratio: {t.ratio != null ? `${pct(t.ratio, 0)} (middle half ${pct(t.ratioRange![0], 0)}–${pct(t.ratioRange![1], 0)}), ${t.ratioSource}` : t.ratioSource}.{" "}
        {t.receipt}
      </p>
      <p className="small"><b>{t.abatement}</b></p>
    </>
  );
}

export function UnitSelloutBlock(x: Ctx) {
  const { m } = x;
  const a = absorption(m);
  const u = assumptions.unitSellout(m.proForma, { localNewSalesPerYear: a.ncPerYear });
  if (!u) return null;
  const tu = x.tab();
  return (
    <>
      <h2>Unit-by-unit sellout</h2>
      <div className="tcap">Table {tu}. Homes, sizes and projected prices from the QuickFit layout and new-construction comps{fn(x, "quickfit", "nc_sales")}</div>
      <table>
        <thead><tr><th>Home</th><th className="num">Finished sq ft (approx.)</th><th className="num">Bedrooms</th><th className="num">Parking</th><th className="num">Price (low–high)</th><th className="num">Projected price</th><th className="num">Closes (month after completion)</th></tr></thead>
        <tbody>
          {u.rows.map((r) => (
            <tr key={r.unit}>
              <td>{r.unit}</td><td className="num">{num(r.finishedSf)}</td><td className="num">{r.bedrooms}</td><td className="num">{r.parking ?? "—"}</td>
              <td className="num">{r.priceLow != null && r.priceHigh != null ? `${money(r.priceLow)}–${money(r.priceHigh)}` : "—"}</td>
              <td className="num">{money(r.price)}</td><td className="num">{r.closingMonth}</td>
            </tr>
          ))}
          <tr className="total"><td>Gross sellout</td><td /><td /><td /><td className="num">{u.totalLow != null && u.totalHigh != null ? `${money(u.totalLow)}–${money(u.totalHigh)}` : ""}</td><td className="num">{money(u.total)}</td><td className="num">{u.lastClosingMonth}</td></tr>
        </tbody>
      </table>
      <p className="small">
        Size: {u.sizeBasis} Bedrooms by size band ({u.bandsSource}): {u.bandsText}. Price: {u.priceBasis}
        {u.proFormaGross != null && u.proFormaGross !== u.total ? ` The budget uses the average home (${money(u.proFormaGross)} in all); the difference is rounding and size.` : ""}
      </p>
      <p className="assume">{u.scheduleText}{fn(x, "cost_config")}</p>
      {u.carry && (
        <p className="small">
          Interest carry to the last closing: {u.carry.text}
          {u.profitAfterCarry != null ? ` Profit after this carry: ${money(u.profitAfterCarry)} (${pct(u.marginAfterCarry, 1)} of cost).` : ""}
        </p>
      )}
    </>
  );
}
