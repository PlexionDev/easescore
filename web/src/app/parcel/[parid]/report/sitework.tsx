// Site work & earthwork takeoff (Section 7): the quantity lines the budget priced, from the plan itself
// (assumptions.siteWorkQuantities via buildDevelopmentInputs), so the table, the budget, the Pencil
// calculator and the PDF show the same numbers.

import { money, num } from "@/lib/report/assess";
import type { Ctx } from "./sections";

const fn = (x: Ctx, ...keys: string[]) => <sup className="fn">[{keys.map((k) => x.c.ref(k)).join(", ")}]</sup>;

export function SiteWorkBlock(x: Ctx) {
  const p = x.m.proForma.plan;
  const q = p.siteTakeoff;
  if (!q) return null;
  // The budget table's own (rounded) amounts, so this table and the budget agree.
  const inBudget = (id: string) => x.m.proForma.budget.find((b) => b.id === id);
  const rows = q.lines.filter((l) => (l.id === "foundation_walls" || l.id === "excavation" || l.id === "retaining_walls") && inBudget(l.id));
  const staging = inBudget("dumpsters");
  const lateral = inBudget("lateral");
  const t = x.tab();
  return (
    <div className="sitework">
      <h2>Site work &amp; earthwork takeoff</h2>
      <p>
        On this hillside lot the site work is priced by quantity instead of a per-sq-ft allowance. Quantities come from the site-fit building on the 1 m lidar
        ground{fn(x, "quickfit", "slope_1m")}; each line is quantity × a unit cost range with its source. The budget uses the likely figure; low and high use the ends of each range.
      </p>
      <div className="tcap">Table {t}. Site work &amp; earthwork takeoff (estimate; confirm with bids)</div>
      <table>
        <thead><tr><th scope="col" style={{ width: "22%" }}>Item</th><th scope="col">Quantity</th><th scope="col" className="num">Unit cost range (likely)</th><th scope="col" className="num">In the budget</th><th scope="col" className="num">Range</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.label}<div className="small muted">{l.sourceLabel}</div></td>
              <td className="small">{l.quantity != null ? <b>{num(l.quantity)} {l.unit}.</b> : null} {l.quantityBasis}</td>
              <td className="num small">{l.unitCost ? `${money(l.unitCost.low)}–${money(l.unitCost.high)} (${money(l.unitCost.likely)}) ${l.unitCost.unit.replace(/^\$ /, "")}` : "—"}</td>
              <td className="num">{money(inBudget(l.id)!.amount)}</td>
              <td className="num small">{money(l.amount.low)}–{money(l.amount.high)}</td>
            </tr>
          ))}
          {staging && (
            <tr>
              <td>{staging.label}<div className="small muted">{staging.sourceLabel}</div></td>
              <td className="small" colSpan={2}>{staging.basis}</td>
              <td className="num">{money(staging.amount)}</td>
              <td />
            </tr>
          )}
          {lateral && (
            <tr>
              <td>{lateral.label}<div className="small muted">{lateral.sourceLabel}</div></td>
              <td className="small" colSpan={2}>{lateral.basis}</td>
              <td className="num">{money(lateral.amount)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted">
        Foundation wall counts only the wall beyond what a flat lot needs; ordinary foundations and basement digging are in the construction cost per sq ft. Cut is estimated from the
        fitted ground plane and hauled away (no reuse as fill); rock can double or triple it. Contingency is {Math.round(p.shares.contingency * 100)}% on this site
        {p.shares.contingencyKind === "hillside" ? " (steep or landslide-prone)" : ""}. National cost guides are cross-checks, not Pittsburgh quotes; the foundation-wall figure is unverified.
      </p>
    </div>
  );
}
