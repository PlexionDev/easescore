// Advocacy brief (print-first): need, sites, project, gap, capital stack and sources, 2–4 pages.
// Rendered to PDF by /api/nonprofit/brief through the shared Chromium pipeline (lib/report/pdf.ts).
// Same state (query string) and the same engine calls as the /nonprofit page.

import type { Metadata } from "next";
import * as affordable from "@easescore/engine/src/affordable";
import { need as loadNeed, lotsDetail } from "@/lib/nonprofit/data";
import { projectCost } from "@/lib/nonprofit/project";
import { acquisitionPath, statusNote, TYPICAL_NOTE } from "@/lib/nonprofit/acquisition";
import { EQUITY_NOTE, acsVintage } from "@/lib/nonprofit/receipts";
import { fmtMoney, formatRange, roundRange } from "@/components/seats/format";
import { inTen, needSummary, parseState, projectInput, shortParid, unitGroups, usd, usdK } from "@/lib/nonprofit/types";
import "./brief.css";

export const metadata: Metadata = { title: "Advocacy brief — EaseScore.AI", robots: { index: false } };
export const dynamic = "force-dynamic";

const title = (a: string | null, parid: string) => (a && a.trim() ? a.trim().toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : `Parcel ${shortParid(parid)}`);
const about = (n: number) => (Math.round(n / 10) * 10).toLocaleString("en-US");
// Same rounding as the seat page (two significant figures on the whole range), so brief and screen match.
const rng = (r: { low: number; high: number }) => formatRange({ low: r.low, likely: r.low, high: r.high }, { format: "money" });
/** The likely value rounded with its range, as the seat page's RangeValue shows it. */
const likelyOf = (r: { low: number; likely: number; high: number }) => fmtMoney(roundRange(r).likely);
const perHome = (r: { low: number; likely: number; high: number }, n: number) => ({ low: r.low / n, likely: r.likely / n, high: r.high / n });

function Outline({ geom, pts }: { geom: GeoJSON.Geometry | null; pts: { lon: number; lat: number; n: number }[] }) {
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) return null;
  const rings = geom.type === "Polygon" ? [geom.coordinates[0]!] : geom.coordinates.map((p) => p[0]!);
  const all = rings.flat();
  const xs = all.map((c) => c[0]!), ys = all.map((c) => c[1]!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const W = 260, H = Math.max(120, Math.min(260, (W * (y1 - y0)) / ((x1 - x0) * k)));
  const sx = (x: number) => 10 + ((x - x0) / (x1 - x0)) * (W - 20);
  const sy = (y: number) => 10 + ((y1 - y) / (y1 - y0)) * (H - 20);
  return (
    <svg className="br-outline" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Neighborhood outline with the chosen lots numbered">
      {rings.map((r, i) => <path key={i} d={`M${r.map((c) => `${sx(c[0]!).toFixed(1)},${sy(c[1]!).toFixed(1)}`).join("L")}Z`} fill="#eef5f1" stroke="#111b1a" strokeWidth="1.2" strokeDasharray="4 3" />)}
      {pts.map((p) => (
        <g key={p.n}><circle cx={sx(p.lon)} cy={sy(p.lat)} r="7" fill="#156b54" /><text x={sx(p.lon)} y={sy(p.lat) + 3.5} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="700">{p.n}</text></g>
      ))}
    </svg>
  );
}

export default async function BriefPage({ searchParams }: PageProps<"/nonprofit/brief">) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const s = parseState(q);
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : new Date().toISOString().slice(0, 10);
  const [need, lots, cost] = await Promise.all([loadNeed(s.hood), lotsDetail(s.lots), s.lots.length ? projectCost(s.lots, s.perLot, s.bedrooms) : Promise.resolve(null)]);
  const area = need.area;
  const hood = area?.hood ?? s.hood;
  const n = needSummary(area);
  const il = affordable.parseIncomeLimits(need.il as affordable.IncomeLimitsRow | null);
  const ladder = il ? affordable.incomeLadder(il, s.household) : null;
  const chas = n?.chas ?? null;
  const total = (cost?.lots.length ?? 0) * s.perLot;
  const groups = unitGroups(s.mix, total, s.bedrooms);
  const input = cost && il ? projectInput(cost, s.tenure, groups, s.own) : null;
  const r = input && il ? affordable.evaluateProject(input, il, s.sources) : null;
  const sale = s.tenure === "sale";
  // Headline gap counts only sources with no caution (✓); flagged (!) sources are shown separately, as on the page.
  const flaggedOn = r ? r.sources.filter((x) => r.flagged.includes(x.id)) : [];
  const headGap = r ? (flaggedOn.length ? r.firm : r.remaining) : null;
  const lihtc = area?.lihtc ?? [];
  const bandKey = ["le30", "30_50", "50_80", "80_100", "gt100"] as const;
  const maxRent = Math.max(...(ladder ?? []).map((x) => x.affordableRent ?? 0), n?.rent ?? 0) * 1.08 || 1;

  return (
    <div className="br" data-report-ready>
      <header className="br-head">
        <p className="br-kicker">EaseScore.AI · Advocacy brief · {date}</p>
        <h1>Affordable homes for {hood}: the need, the sites, and the gap to close</h1>
        <p className="br-lede">
          {n?.rb30 != null ? `${inTen(n.rb30)} renters in ${hood} pay more than 30% of their income on rent. ` : ""}
          {r && !sale ? `A ${r.units}-home rental project on ${lots.length} public lot${lots.length === 1 ? "" : "s"} would cost about ${rng(r.tdc)}; after a mortgage the restricted rents can carry, it needs ${rng(r.gapBefore)} from other sources, and ${rng(headGap!)} remains after the sources below${flaggedOn.length ? " marked ✓" : ""}.` : ""}
          {r && sale ? `${r.units} homes for sale on ${lots.length} public lot${lots.length === 1 ? "" : "s"} would cost about ${rng(r.tdc)} (${rng(perHome(r.tdc, r.units))} per home); the families they serve can pay ${rng(r.debt.loan)} in all, so each home needs about ${rng(r.subsidyPerUnit)} in subsidy (${r.benchmark.source}: ${usdK(r.benchmark.low)}–${usdK(r.benchmark.high)} per home), and ${rng(headGap!)} remains after the sources below${flaggedOn.length ? " marked ✓" : ""}.` : ""}
        </p>
      </header>

      <section className="br-sec">
        <h2>1. Who needs homes here</h2>
        <div className="br-facts">
          <div><b>{n?.rb30 != null ? `${Math.round(n.rb30)}%` : "—"}</b><span>of renter households pay 30%+ of income on rent</span></div>
          <div><b>{n?.rb50 != null ? `${Math.round(n.rb50)}%` : "—"}</b><span>pay more than half their income</span></div>
          <div><b>{n?.income != null ? usdK(n.income) : "—"}</b><span>median household income{n?.income != null && il ? `, about ${Math.round((100 * n.income) / il.median)}% of the area median` : ""}</span></div>
          <div><b>{chas ? about(chas.gap) : "—"}</b><span>{chas ? `more homes needed for the ${about(chas.under50)} households under 50% of area median (about ${about(chas.afford50)} rental homes are priced for them)` : "gap count needs HUD CHAS (not loaded)"}</span></div>
        </div>
        {ladder ? (
          <table className="br-ladder">
            <caption>Income ladder, family of {s.household}: the rent each band can afford vs. the median rent here ({n?.rent != null ? usd(n.rent) : "—"}, dark line)</caption>
            <thead><tr><th>Income band</th><th>Affordable rent (30% of income)</th><th className="num">Households here</th></tr></thead>
            <tbody>
              {ladder.map((x, i) => (
                <tr key={x.id}>
                  <td><b>{x.label}</b><br /><small>{x.incomeHigh ? `${usdK(x.incomeLow)}–${usdK(x.incomeHigh)}` : `over ${usdK(x.incomeLow)}`}</small></td>
                  <td>
                    <span className="br-bar"><i className={x.affordableRent != null && n?.rent != null && x.affordableRent < n.rent ? "short" : ""} style={{ width: `${x.affordableRent != null ? Math.min(100, (100 * x.affordableRent) / maxRent) : 100}%` }} />
                      <em>{x.affordableRent != null ? `up to ${usd(x.affordableRent)}/mo` : "can afford the median rent"}</em>
                      {n?.rent != null ? <s style={{ left: `${Math.min(99.5, (100 * n.rent) / maxRent)}%` }} /> : null}</span>
                  </td>
                  <td className="num">{chas ? about(chas.bands[bandKey[i]!]) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="br-small">
          {n?.qct ? "The area is a HUD Qualified Census Tract (tax-credit basis boost). " : ""}
          {lihtc.length ? (() => {
            const known = lihtc.reduce((t, l) => t + (l.li_units ?? 0), 0).toLocaleString("en-US");
            const unknown = lihtc.filter((l) => l.li_units == null).length;
            const homes = unknown === lihtc.length ? "; HUD does not list their income-restricted home counts" : unknown ? `, with at least ${known} income-restricted homes (${unknown} list no count)` : `, with about ${known} income-restricted homes`;
            return `${lihtc.length} tax-credit (LIHTC) ${lihtc.length === 1 ? "property is" : "properties are"} in or within half a mile of ${hood}${homes} (HUD LIHTC database, placed in service through 2019; newer projects are not in it). `;
          })() : ""}
          {n?.poverty != null ? `About ${Math.round(n.poverty)}% of people here live below the poverty line. ` : ""}
          {n?.method}
        </p>
      </section>

      <section className="br-sec br-break">
        <h2>2. Where we could build</h2>
        {lots.length ? (
          <div className="br-sites">
            <Outline geom={area?.outline ?? null} pts={lots.filter((l) => l.lon != null && l.lat != null).map((l, i) => ({ lon: l.lon!, lat: l.lat!, n: i + 1 }))} />
            <table className="br-table">
              <thead><tr><th>#</th><th>Lot</th><th>Owner</th><th className="num">By-right yield</th><th>Flags</th></tr></thead>
              <tbody>
                {lots.map((l, i) => {
                  const st = statusNote(l.agency_status);
                  // The parcel page's own figures for the lot (site-fit check, mapped lot area) when the project read them.
                  const pc = cost?.lots.find((c) => c.parid === l.parid.trim());
                  const lotSf = pc?.lotSqft ?? (l.lot_sqft ? Math.round(Number(l.lot_sqft)) : null);
                  return (
                    <tr key={l.parid}>
                      <td>{i + 1}</td>
                      <td><b>{title(l.address, l.parid)}</b><br /><small>{shortParid(l.parid)} · {lotSf ? `${lotSf.toLocaleString("en-US")} sq ft` : ""} · zoning {l.zoning ?? "—"} · Ease Score {l.score ?? "—"} ({l.band ?? "no band"})</small></td>
                      <td>{l.agency ?? (l.owner_class === "public" ? "Public owner" : "Private")}{st ? <><br /><small>{st.text}</small></> : null}</td>
                      <td className="num">{pc?.byRightUnits ?? l.by_right_units ?? "—"}{pc?.bestLabel ? <><br /><small>best: {pc.bestLabel.toLowerCase()}</small></> : null}</td>
                      <td>{(l.red_flags ?? []).length ? (l.red_flags ?? []).map((f) => f.title).join("; ") : "None"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p>No lots chosen yet.</p>}
        {(() => {
          const path = lots[0] ? acquisitionPath(lots[0].agency, lots[0].tax_delinquent, lots[0].owner_class, lots[0].city_program) : null;
          return path ? (
            <div className="br-box">
              <p><b>How to get the lots (typical):</b> {path.title}. {path.steps.join(" → ")}. Typical time {path.typicalMonths[0]}–{path.typicalMonths[1]} months. {path.note}</p>
              <p className="br-small">{TYPICAL_NOTE} Treating scattered lots as one project shares design, legal and financing costs.</p>
            </div>
          ) : null;
        })()}

        <h2>3. The project</h2>
        {r && il && sale ? (
          <>
            <p>{r.units} homes for sale of {s.bedrooms} bedroom{s.bedrooms === 1 ? "" : "s"}, {s.perLot} per lot. Who they serve and what they can pay:</p>
            <ul className="br-serves">
              {r.sales.map((x) => (
                <li key={x.amiPct}><b>{x.count} home{x.count > 1 ? "s" : ""} at {x.amiPct}% of area median.</b> A family of {x.persons} at {x.amiPct}% AMI can afford about {usd(x.price.likely)} ({usd(x.price.low)}–{usd(x.price.high)}). They earn up to about {usd(x.income)} a year; 30% of it, {usd(x.budget)} a month, covers the mortgage, taxes and insurance.</li>
              ))}
            </ul>
            <p className="br-small"><b>How the price is figured:</b> {r.saleAssumptions.map((a) => `${a.label} ${a.value}${a.assumption ? " (assumption)" : ""}`).join("; ")}.</p>
            <p>Development cost from the EaseScore.AI pro forma, priced for sale: <b>{rng(r.tdc)}</b>, likely {likelyOf(r.tdc)} ({rng(perHome(r.tdc, r.units))} per home, likely {likelyOf(perHome(r.tdc, r.units))}).</p>
            <ul className="br-small">
              {cost!.lots.map((l) => <li key={l.parid}>{title(l.address, l.parid)}: {l.strategyLabel ?? "—"}{l.sale?.tdc ? `, ${rng(l.sale.tdc)}` : ", not priced"}{l.mine ? " (over undermined ground)" : ""}{l.notes.length ? ` (${l.notes.join(" ")})` : ""}</li>)}
            </ul>
          </>
        ) : r && il ? (
          <>
            <p>{r.units} rental homes of {s.bedrooms} bedroom{s.bedrooms === 1 ? "" : "s"}, {s.perLot} per lot. Who they serve:</p>
            <ul className="br-serves">
              {r.rents.map((x) => (
                <li key={x.amiPct}><b>{x.count} home{x.count > 1 ? "s" : ""} at {x.amiPct}% of area median.</b> {affordable.householdSentence(il, x.amiPct, Math.max(1, Math.round(x.persons))).text} Maximum rent {usd(x.grossRent)} a month including utilities; tenant pays about {usd(x.netRent)} after a {usd(x.utilityAllowance)} utility allowance (assumption; replace with the HACP / ACHA schedule).</li>
              ))}
            </ul>
            <p>Development cost from the EaseScore.AI pro forma: <b>{rng(r.tdc)}</b>, likely {likelyOf(r.tdc)} ({rng(perHome(r.tdc, r.units))} per home, likely {likelyOf(perHome(r.tdc, r.units))}).</p>
            <ul className="br-small">
              {cost!.lots.map((l) => <li key={l.parid}>{title(l.address, l.parid)}: {l.strategyLabel ?? "—"}, {l.headline ?? "not priced"}{l.notes.length ? ` (${l.notes.join(" ")})` : ""}</li>)}
            </ul>
          </>
        ) : <p>{s.lots.length ? "The project could not be priced right now." : "Pick lots to size a project."}</p>}
      </section>

      {r ? (
        <section className="br-sec br-break">
          <h2>4. The funding gap and how to close it</h2>
          <div className="br-gap">
            <div><span>Total cost</span><b>{rng(r.tdc)}</b></div>
            <div><span>{sale ? "What the buyers can pay" : "Mortgage the rents can carry"}</span><b>{rng(r.debt.loan)}</b></div>
            <div><span>Gap before other sources</span><b>{rng(r.gapBefore)}</b></div>
            <div className="hl"><span>Remaining gap with the sources marked “on”{flaggedOn.length ? " and ✓" : ""}</span><b>{rng(headGap!)}</b></div>
          </div>
          {flaggedOn.length ? <p className="br-small">If {flaggedOn.map((x) => x.label).join(" and ")} (on, but flagged ! below) also came through, the remaining gap would be {rng(r.remaining)}.</p> : null}
          <div className="br-stack">
            {r.stack.filter((p) => p.applied > 0).map((p) => <i key={p.id} className={p.id === "gap" ? "gap" : ""} style={{ flex: p.applied }}><span>{p.applied / r.tdc.likely > 0.08 ? `${p.short} ${usdK(p.applied)}` : ""}</span></i>)}
          </div>
          <p className="br-small">Likely case. Every source amount is a typical range for planning, <b>not an award</b>.</p>
          <table className="br-table">
            <thead><tr><th>Source</th><th>In this plan</th><th className="num">Typical amount</th><th>Fit for this project</th><th>Timing</th></tr></thead>
            <tbody>
              {r.sources.map((x) => (
                <tr key={x.id} className={x.status === "no" ? "no" : ""}>
                  <td><b>{x.label}</b></td>
                  <td>{r.enabled.includes(x.id) ? "On" : x.status === "no" ? "Not eligible" : "Off"}</td>
                  <td className="num">{x.amount.high > 0 ? rng(x.amount) : "—"}</td>
                  <td>{x.checks.map((c) => `${c.status === "ok" ? "✓" : c.status === "no" ? "✗" : "!"} ${c.text}`).join("; ")}</td>
                  <td><small>{x.timing}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.taxSavings && r.taxSavings.amount.high > 0 ? <p className="br-small"><b>Not construction money:</b> {r.taxSavings.label} lowers the {sale ? "owners'" : "operator's"} property taxes over the years, worth about {rng(r.taxSavings.amount)} in today&apos;s dollars (typical, not an award; {r.taxSavings.checks.map((c) => c.text).join("; ")}). It is not in the stack or the gap.</p> : null}
          <p>{sale ? "The subsidy gap (cost − affordable price)" : "Money needed beyond the mortgage"} is about <b>{usdK(r.subsidyPerUnit.low)}–{usdK(r.subsidyPerUnit.high)} per home</b>. For comparison, {sale ? "" : `${r.benchmark.compareLabel.charAt(0).toLowerCase() + r.benchmark.compareLabel.slice(1)} here is ${usdK(r.benchmark.compare.low)}–${usdK(r.benchmark.compare.high)}; `}{r.benchmark.label.charAt(0).toLowerCase() + r.benchmark.label.slice(1)}: {usdK(r.benchmark.low)}–{usdK(r.benchmark.high)} ({r.benchmark.source}). {r.benchmark.note}{r.benchmark.verdict === "below" && sale ? " The cost here is the pro forma's cost to build without a general contractor's fee (often 15–25% more); check it against local bids." : ""}</p>
        </section>
      ) : null}

      <section className="br-sec br-sources">
        <h2>Sources and method</h2>
        <ul>
          <li>Rent burden, income, rent, poverty: U.S. Census Bureau, American Community Survey 5-year ({acsVintage(n?.acsYear ?? null)}), tables B25070, B19013, B25064, B17001, by census tract.</li>
          {chas ? <li>Households by income and affordable rental homes: HUD CHAS by tract ({chas.vintage}). The gap = households under 50% of HUD area median − rental homes priced for them; a rough measure.</li> : <li>HUD CHAS: not loaded; the household gap is not shown.</li>}
          {il ? <li>Income limits and rents: HUD FY{il.year} Income Limits, {il.areaName} (Pittsburgh HMFA). Rents use the 30% rule and 1.5 persons per bedroom; they match PHFA&apos;s published LIHTC rent limits. Utility allowance is a placeholder (assumption).</li> : null}
          <li>Tax-credit properties: HUD LIHTC database (placed in service through 2019). QCT/DDA: HUD current designations.</li>
          <li>Lots, Ease Scores and owners: EaseScore.AI precomputed parcel results; owner shown only for public agencies.</li>
          <li>Development cost: EaseScore.AI pro forma ({cost?.costConfig ?? "cost-assumptions"}), ranges from each input&apos;s documented range. {sale
            ? <>Affordable prices: 30% of the HUD income limit pays principal, interest, property tax ({cost?.context.millsSource ?? "assumed millage"}), insurance and mortgage insurance{cost?.context.mineSubsidence ? ", plus PA DEP mine subsidence insurance" : ""}; mortgage rate {cost?.mortgage ? cost.mortgage.source : "assumed (FRED rate not loaded)"}; other assumptions in capital-sources.v0.1 (forSale). 100% and 120% AMI limits are derived from HUD&apos;s 50% limit (2× and 2.4×).</>
            : <>Mortgage: restricted rents less vacancy and operating cost, sized at a debt-coverage ratio (assumptions in capital-sources.v0.1).</>}</li>
          <li>Capital sources: typical ranges and rules in engine/config/capital-sources.v0.1.json; amounts marked “Assumption” have no public source yet.</li>
        </ul>
        <p className="br-small">{EQUITY_NOTE} Decision support only; not legal, financial or zoning advice. Confirm costs with local bids and funding with each program.</p>
      </section>
    </div>
  );
}
