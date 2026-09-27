// Compact comparable-sales grid for the pencil panel: the same engine grid as the report
// (assumptions.compsGrid, built from the comps the sale value uses). Screen only, so addresses are
// block level ("1200 block of Smith St"); full street addresses are only in the downloadable PDF.

import { assumptions } from "@easescore/engine";

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : "—");
const street = (s: string) => s.replace(/^(.*block of )(.+)$/, (_m, a: string, st: string) => `${a}${st.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase())}`);

export default function CompsMini({ plan }: { plan: assumptions.DevelopmentPlan }) {
  const c = plan.valueComps as assumptions.CompSet | null;
  if (!c || !("median_living_area_sqft" in c) || c.kind !== "new_construction") return null;
  const userValue = plan.assumptions.some((r) => (r.key === "salePricePerSf" || r.key === "salePricePerUnit") && r.edited);
  const g = assumptions.compsGrid(c, {
    strategy: plan.strategy, perHomeSf: plan.units && plan.finishedSf ? plan.finishedSf / plan.units : null,
    valuePerSf: plan.revenue.sale.pricePerSf, userValue, label: (r) => street(r.blockAddress),
  });
  if (!g.rows.length) return null;
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-slate-600 underline decoration-dotted underline-offset-2">
        The sales ({g.rows.length} of {g.inSet}) · sale-revenue confidence {g.confidence}
      </summary>
      <div className="mt-0.5 max-h-48 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Comparable new-construction sales, block-level addresses</caption>
          <thead className="text-slate-500">
            <tr><th scope="col" className="pr-1 font-medium">Block</th><th scope="col" className="pr-1 font-medium">Sold</th><th scope="col" className="pr-1 text-right font-medium">Price</th><th scope="col" className="pr-1 text-right font-medium">Sq ft</th><th scope="col" className="pr-1 text-right font-medium">$/SF</th><th scope="col" className="text-right font-medium">Mi</th></tr>
          </thead>
          <tbody className="text-slate-700">
            {g.rows.map((r) => (
              <tr key={`${r.parid}${r.saleDate}`}>
                <td className="pr-1">{street(r.blockAddress)}{r.sameType ? "" : ` (${assumptions.HOME_TYPE_LABEL[r.type].toLowerCase()})`}</td>
                <td className="pr-1">{r.saleDate}</td>
                <td className="pr-1 text-right">{usd(r.price)}</td>
                <td className="pr-1 text-right">{r.livingAreaSqft.toLocaleString("en-US")}</td>
                <td className="pr-1 text-right">{usd(r.pricePerSqft)}</td>
                <td className="text-right">{r.distanceMi.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {g.reconciliation && <p className="mt-0.5 text-slate-600">{g.reconciliation}</p>}
      <p className="text-slate-500">{g.orderRule} Addresses show the block only; the PDF report lists full street addresses.</p>
    </details>
  );
}
