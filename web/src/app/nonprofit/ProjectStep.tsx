"use client";

// Step 3 — "What would it cost, and what's the gap?": homes and who they serve (HUD FY limits, 30% rule),
// development cost from the pro forma, supportable loan (rental) or what buyers can pay (for-sale, PITI),
// funding gap, and a capital stack of typical sources you switch on and off (instant: all math runs here
// from engine/src/affordable; switching tenure needs no round trip, both are priced in one request).

import { useId, useMemo, useState } from "react";
import * as affordable from "@easescore/engine/src/affordable";
import { EmptyState, RangeValue, ReceiptButton, Segmented, Switch, type Receipt } from "@/components/seats";
import { ilReceipt } from "@/lib/nonprofit/receipts";
import { AMI_BY_TENURE, projectInput, usd, unitGroups, type NeedData, type ProjectCost, type ProjectState, type Tenure } from "@/lib/nonprofit/types";

const STACK_COLOR: Record<string, string> = {
  debt: "#6b7c75", lihtc4: "#2f7d63", lihtc9: "#1f6a52", home: "#5ea98a", cdbg: "#7fbfa4", phare: "#3e8c70", hof: "#4f9c80",
  ahp: "#8ccab0", lerta: "#a9d7c3", land: "#9fcdb6", philanthropy: "#b9dccd", hba: "#3e8c70", clt: "#2f7d63",
};

export function computeProject(cost: ProjectCost | null, il: affordable.IncomeLimits | null, mix: Record<number, number>, perLot: number, bedrooms: number, sources: string[], tenure: Tenure, own?: ProjectState["own"]) {
  if (!cost || !il) return null;
  const input = projectInput(cost, tenure, unitGroups(mix, cost.lots.length * perLot, bedrooms), own);
  return input ? affordable.evaluateProject(input, il, sources) : null;
}

/** One editable for-sale assumption: typed as a display number (percent or dollars), stored in the URL state. */
function OwnField({ label, value, fallback, scale, min, max, step, unit, onChange }: {
  label: string; value: number | null; fallback: number; scale: number; min: number; max: number; step: number; unit: string; onChange: (v: number | null) => void;
}) {
  const id = useId();
  const shown = (x: number) => String(+(x * scale).toFixed(3));
  const [text, setText] = useState(value != null ? shown(value) : "");
  const mine = value != null;
  return (
    <div className="np-own-field">
      <label htmlFor={id}>{label}</label>
      <span className="np-own-input">
        {unit === "$" ? <span aria-hidden="true">$</span> : null}
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={text} placeholder={shown(fallback)}
          aria-describedby={`${id}-b`}
          onChange={(e) => {
            setText(e.target.value);
            const x = Number(e.target.value);
            if (e.target.value === "") onChange(null);
            else if (Number.isFinite(x) && x >= min && x <= max) onChange(x / scale);
          }} />
        {unit !== "$" ? <span aria-hidden="true">{unit}</span> : null}
      </span>
      <small id={`${id}-b`} className={mine ? "np-mine" : "np-assume"}>{mine ? "Your input" : `Assumption, edit me (default ${unit === "$" ? usd(fallback) : `${shown(fallback)}%`})`}</small>
    </div>
  );
}

/** Sources that count the same money: switching one on switches the other off. */
const EXCLUSIVE: Record<string, string[]> = { clt: ["land"], land: ["clt"] };

export default function ProjectStep({ need, lotCount, cost, costLoading, costError, tenure, onTenure, own, onOwn, perLot, onPerLot, bedrooms, onBedrooms, mix, onMix, sources, onSources, onExport }: {
  need: NeedData | null;
  /** Lots chosen in step 2 (known before the cost arrives). */
  lotCount: number;
  cost: ProjectCost | null;
  costLoading: boolean;
  costError: string | null;
  tenure: Tenure;
  onTenure: (t: Tenure) => void;
  own: ProjectState["own"];
  onOwn: (o: ProjectState["own"]) => void;
  perLot: number;
  onPerLot: (n: number) => void;
  bedrooms: number;
  onBedrooms: (n: number) => void;
  mix: Record<number, number>;
  onMix: (m: Record<number, number>) => void;
  sources: string[];
  onSources: (s: string[]) => void;
  onExport: () => void;
}) {
  const il = useMemo(() => affordable.parseIncomeLimits(need?.il as affordable.IncomeLimitsRow | null), [need?.il]);
  const lots = lotCount;
  const total = lots * perLot;
  const groups = useMemo(() => unitGroups(mix, total, bedrooms), [mix, total, bedrooms]);
  const r = useMemo(() => computeProject(cost, il, mix, perLot, bedrooms, sources, tenure, own), [cost, il, mix, perLot, bedrooms, sources, tenure, own]);
  const fs = affordable.CAPITAL_CONFIG.forSale;
  // Bumped on reset so the fields drop what was typed.
  const [ownKey, setOwnKey] = useState(0);
  const rate = cost?.mortgage?.rate ?? fs.rateFallback.value;
  const hood = need?.area?.hood ?? "the area";
  const sale = tenure === "sale";
  const AMIS = AMI_BY_TENURE[tenure];
  const tdcShown = sale ? cost?.sale?.tdc ?? null : cost?.tdc ?? null;

  const setCount = (ami: number, delta: number) => {
    // Edit the scaled counts the user sees, then store them as the new mix.
    const cur: Record<number, number> = Object.fromEntries(groups.map((g) => [g.amiPct, g.count]));
    const next = { ...cur, [ami]: Math.max(0, (cur[ami] ?? 0) + delta) };
    if (Object.values(next).reduce((t, x) => t + x, 0) === 0) return;
    onMix(next);
  };
  const toggle = (id: string, on: boolean) => onSources(on ? [...sources.filter((s) => s !== id && !(EXCLUSIVE[id] ?? []).includes(s)), id] : sources.filter((s) => s !== id));

  const costReceipt: Receipt | null = cost && tdcShown ? {
    label: "Total development cost",
    value: `${usd(tdcShown.low)}–${usd(tdcShown.high)}, likely ${usd(tdcShown.likely)}`,
    source: `EaseScore.AI pro forma (${cost.costConfig}), the same model as the parcel page`,
    date: cost.asOf,
    method: <>Each lot priced for {perLot} {sale ? "for-sale" : "rental"} home{perLot > 1 ? "s" : ""} of {bedrooms} bedroom{bedrooms === 1 ? "" : "s"}, then summed:<ul>{cost.lots.map((l) => <li key={l.parid}>{l.address ?? l.parid}: {l.strategyLabel ?? "—"}{l.finishedSf ? `, about ${Math.round(l.finishedSf / Math.max(1, l.units)).toLocaleString("en-US")} sq ft per home` : ""} — {l.headline ?? "not priced"}{l.needsRelief ? " (needs zoning relief)" : ""}</li>)}</ul>Low and high come from each input&apos;s documented range (construction tier, site adders, soft-cost shares, land).</>,
    kind: "data",
    notes: cost.lots.flatMap((l) => l.notes).join(" ") || "Construction costs are estimates; confirm with local bids.",
  } : null;

  return (
    <div className="np-grid np-grid-project">
      <div className="np-col">
        <section className="np-card" aria-labelledby="homes-h">
          <div className="np-card-head"><h3 id="homes-h">Homes and who they serve</h3></div>
          <div className="np-controls">
            <Segmented<Tenure> label="Tenure" size="sm" value={tenure} onChange={onTenure} options={[{ value: "rent", label: "Rental" }, { value: "sale", label: "For-sale", title: "Affordable homeownership at 80–120% of the area median" }]} />
            <Segmented<string> label="Homes per lot" size="sm" value={String(perLot)} onChange={(v) => onPerLot(Number(v))} options={[1, 2, 3, 4].map((k) => ({ value: String(k), label: String(k) }))} />
            <Segmented<string> label="Bedrooms" size="sm" value={String(bedrooms)} onChange={(v) => onBedrooms(Number(v))} options={[1, 2, 3].map((k) => ({ value: String(k), label: `${k} BR` }))} />
          </div>
          <div className="np-mix" role="group" aria-label="Homes at each income level">
            <span className="es-field-label">Homes at each income level ({total} total)</span>
            {AMIS.map((a) => {
              const c = groups.find((g) => g.amiPct === a)?.count ?? 0;
              return (
                <div className="np-mix-row" key={a}>
                  <span>{a}% of area median</span>
                  <button type="button" className="es-btn" aria-label={`One fewer home at ${a}% AMI`} onClick={() => setCount(a, -1)} disabled={c === 0}>−</button>
                  <b aria-live="polite">{c}</b>
                  <button type="button" className="es-btn" aria-label={`One more home at ${a}% AMI`} onClick={() => setCount(a, +1)}>+</button>
                </div>
              );
            })}
          </div>
          {il && r && sale ? (
            <>
              <ul className="np-serves">
                {r.sales.map((x) => (
                  <li key={x.amiPct}>
                    <p><b>{x.count} home{x.count > 1 ? "s" : ""} at {x.amiPct}% AMI.</b> A family of {x.persons} at {x.amiPct}% AMI can afford about <b>{usd(x.price.likely)}</b> <span className="np-muted">({usd(x.price.low)}–{usd(x.price.high)} as the rate moves half a point)</span>. They earn up to about {usd(x.income)} a year; 30% of that is {usd(x.budget)} a month for the mortgage, taxes and insurance.</p>
                    <ReceiptButton receipt={{ ...ilReceipt(il.year, il.areaName, `${x.amiPct}% AMI affordable price, ${x.bedrooms} bedrooms`, `${x.incomeBasis}. ${x.formula}`), value: `${usd(x.price.low)}–${usd(x.price.high)}, likely ${usd(x.price.likely)}`, kind: "assumption", notes: "Mortgage rate from FRED when loaded; down payment, insurance, mortgage insurance and household size are editable assumptions (engine/config/capital-sources.v0.1.json → forSale)." }} />
                  </li>
                ))}
              </ul>
              <div className="np-own" role="group" aria-labelledby="own-h">
                <div className="np-own-head">
                  <span id="own-h" className="es-field-label">Buyer&apos;s loan: change any assumption</span>
                  {own.down != null || own.ins != null || own.pmi != null ? <button type="button" className="es-btn np-own-reset" onClick={() => { onOwn({ down: null, ins: null, pmi: null }); setOwnKey((k) => k + 1); }}>Reset to defaults</button> : null}
                </div>
                <p className="np-muted np-own-rate">
                  Mortgage rate <b>{(rate * 100).toFixed(2)}%</b> ± {(fs.rateSpread.value * 100).toFixed(1)} pt, 30-year fixed{" "}
                  {cost?.mortgage ? <span className="np-muted">(FRED, week of {cost.mortgage.date})</span> : <span className="np-assume">(Assumption, edit me: FRED rate not loaded)</span>}
                </p>
                <div className="np-own-grid" key={ownKey}>
                  <OwnField label="Down payment" value={own.down} fallback={fs.downPaymentShare.value} scale={100} min={0} max={50} step={0.5} unit="%" onChange={(down) => onOwn({ ...own, down })} />
                  <OwnField label="Insurance a year" value={own.ins} fallback={fs.insurancePerYear.value} scale={1} min={0} max={10000} step={100} unit="$" onChange={(ins) => onOwn({ ...own, ins })} />
                  <OwnField label="Mortgage insurance (% of loan a year)" value={own.pmi} fallback={fs.pmiAnnualShare.value} scale={100} min={0} max={2} step={0.05} unit="%" onChange={(pmi) => onOwn({ ...own, pmi })} />
                </div>
                {(own.down ?? fs.downPaymentShare.value) >= fs.pmiAnnualShare.belowDownShare ? <p className="np-muted">No mortgage insurance at 20% or more down.</p> : null}
              </div>
              <details className="np-assumptions">
                <summary>How the price is figured (every assumption labeled)</summary>
                <ul>
                  {r.saleAssumptions.map((a) => (
                    <li key={a.id}><b>{a.label}:</b> {a.value} <span className={a.assumption ? "np-assume" : "np-muted"}>({a.source})</span></li>
                  ))}
                </ul>
              </details>
            </>
          ) : il && r ? (
            <ul className="np-serves">
              {r.rents.map((x) => {
                const size = Math.max(1, Math.round(x.persons));
                const h = affordable.householdSentence(il, x.amiPct, size);
                return (
                  <li key={x.amiPct}>
                    <p><b>{x.count} home{x.count > 1 ? "s" : ""} at {x.amiPct}% AMI.</b> {h.text.replace(/\.$/, "")}. Maximum rent for a {x.bedrooms}-bedroom home: <b>{usd(x.grossRent)}</b> a month including utilities; the tenant pays about {usd(x.netRent)} after a {usd(x.utilityAllowance)} utility allowance <span className="np-assume">(utility allowance: Assumption, edit me)</span>.</p>
                    <ReceiptButton receipt={ilReceipt(il.year, il.areaName, `${x.amiPct}% AMI rent, ${x.bedrooms} bedrooms`, `${x.formula}. Matches PHFA's published LIHTC rent limits for Allegheny County. Tenant rent = maximum gross rent − a placeholder utility allowance (replace with the HACP / ACHA schedule).`)} />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="np-card" aria-labelledby="cost-h">
          <div className="np-card-head"><h3 id="cost-h">Development cost</h3>{costReceipt ? <ReceiptButton receipt={costReceipt} /> : null}</div>
          {costLoading ? (
            <div className="np-loading" role="status"><span className="np-spin" aria-hidden="true" />Pricing {lots || "the"} lot{lots === 1 ? "" : "s"} with the pro forma… (a few seconds the first time)</div>
          ) : costError ? (
            <EmptyState tone="error" title="The cost could not be computed right now">{costError}</EmptyState>
          ) : !cost ? (
            <EmptyState tone="empty" title="No lots chosen yet">Pick lots in step 2.</EmptyState>
          ) : !tdcShown ? (
            <EmptyState tone="error" title={`Some lots could not be priced${sale ? " for sale" : ""}`}>{cost.lots.filter((l) => !(sale ? l.sale?.tdc : l.tdc)).map((l) => `${l.address ?? l.parid}: ${l.notes.join(" ") || "no cost from the pro forma."}`).join(" ")}</EmptyState>
          ) : (
            <>
              <div className="np-row2">
                <div><span className="np-lbl">Total cost, {total} {sale ? "for-sale " : ""}homes on {lots} lots</span><RangeValue value={tdcShown} format="money" size="lg" label="Total development cost" /></div>
                <div><span className="np-lbl">Per home</span><RangeValue value={{ low: tdcShown.low / total, likely: tdcShown.likely / total, high: tdcShown.high / total }} format="money" size="md" label="Cost per home" /></div>
              </div>
              {cost.lots.some((l) => l.needsRelief) ? <p className="np-warn">Some lots need zoning relief for {perLot} homes; see the receipt.</p> : null}
            </>
          )}
        </section>
      </div>

      <div className="np-col">
        {!r ? (
          <section className="np-card"><div className="np-card-head"><h3>Funding gap</h3></div>
            {!il ? <EmptyState compact dataset="HUD income limits" /> : <p className="np-muted">The gap appears once the lots are priced.</p>}
          </section>
        ) : (
          <>
            <section className="np-gapbig" aria-labelledby="gap-h">
              <span className="np-gap-lbl" id="gap-h">Remaining funding gap</span>
              <p className="np-gap-val"><RangeValue value={r.remaining} format="money" size="lg" label="Remaining funding gap" /></p>
              <p>
                about <b>{usd(r.remainingPerUnit.low)}–{usd(r.remainingPerUnit.high)}</b> per home, after {sale ? `${usd(r.debt.loan.low)}–${usd(r.debt.loan.high)} from home sales at affordable prices` : `a ${usd(r.debt.loan.low)}–${usd(r.debt.loan.high)} mortgage`}
                {r.enabled.length ? ` and ${r.enabled.map((id) => r.sources.find((s) => s.id === id)!.short).join(", ")}` : " (no other sources switched on)"}.
              </p>
              <ReceiptButton className="np-rc-light" receipts={[
                { label: "Funding gap before sources", value: `${usd(r.gapBefore.low)}–${usd(r.gapBefore.high)}`, source: sale ? "Pro forma cost − affordable sale prices" : "Pro forma cost − supportable loan", date: cost?.asOf ?? "", method: r.receipts.gap, kind: "data" },
                sale
                  ? { label: "What the buyers can pay (all homes)", value: `${usd(r.debt.loan.low)}–${usd(r.debt.loan.high)}`, source: "HUD income limits; FRED 30-year rate; lot millage; engine/config/capital-sources.v0.1.json (forSale)", date: cost?.mortgage?.date ?? "2026-09-26", method: r.debt.basis, kind: "assumption", notes: r.debt.sources.join(" · ") }
                  : { label: "Supportable permanent loan", value: `${usd(r.debt.loan.low)}–${usd(r.debt.loan.high)}`, source: "engine/config/capital-sources.v0.1.json (debt)", date: "2026-09-26", method: r.debt.basis, kind: "assumption", notes: "Rate, term, debt coverage and operating cost are editable assumptions." },
                { label: "Remaining gap", value: `${usd(r.remaining.low)}–${usd(r.remaining.high)}`, source: "Capital sources, typical ranges (not awards)", date: "2026-09-26", method: r.receipts.remaining, kind: "assumption" },
              ]} />
            </section>

            <section className="np-card" aria-labelledby="stack-h">
              <div className="np-card-head"><h3 id="stack-h">Capital stack</h3><span className="np-typical">Typical, not an award</span></div>
              <p className="np-muted">Cost {usd(r.tdc.likely)} (likely) · {sale ? "Home sales" : "Loan"} {usd(r.debt.loan.likely)} · Gap before sources {usd(r.gapBefore.low)}–{usd(r.gapBefore.high)}</p>
              <div className="np-stack" role="img" aria-label={`Likely case: ${r.stack.map((p) => `${p.short} ${usd(p.applied)}`).join(", ")}`}>
                {r.stack.filter((p) => p.applied > 0).map((p) => (
                  <i key={p.id} className={p.id === "gap" ? "is-gap" : ""} style={{ flex: p.applied, background: p.id === "gap" ? undefined : STACK_COLOR[p.id] ?? "#5ea98a" }} title={`${p.short}: ${usd(p.applied)}`}>
                    <span>{p.applied / r.tdc.likely > 0.07 ? p.short : ""}</span>
                  </i>
                ))}
              </div>
              <ul className="np-srcs">
                {r.sources.map((s) => {
                  const on = r.enabled.includes(s.id);
                  const first = s.checks.find((c) => c.status === "no") ?? s.checks.find((c) => c.status === "caution") ?? s.checks[0];
                  return (
                    <li key={s.id} className={s.status === "no" ? "is-no" : ""}>
                      <div className="np-src-top">
                        <Switch label={s.label} checked={on} disabled={s.status === "no"} onChange={(v) => toggle(s.id, v)} hint={`${usd(s.amount.low)}–${usd(s.amount.high)} typical`} />
                        {first ? <span className={first.status === "ok" ? "np-ok" : first.status === "no" ? "np-bad" : "np-warn"}>{first.status === "ok" ? "✓ " : first.status === "no" ? "✗ " : "! "}{first.text}</span> : null}
                      </div>
                      <details className="np-src-more">
                        <summary>Details</summary>
                        <p>{s.what}</p>
                        <ul>{s.checks.map((c) => <li key={c.text} className={c.status === "ok" ? "np-ok" : c.status === "no" ? "np-bad" : "np-warn"}>{c.status === "ok" ? "✓" : c.status === "no" ? "✗" : "!"} {c.text}</li>)}</ul>
                        <p className="np-muted">Amount: {s.amountBasis}. Source: {s.amountSource}.</p>
                        <p className="np-muted">Timing: {s.timing}{s.governing ? ` Rules: ${s.governing}.` : ""}</p>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="np-card" aria-labelledby="per-h">
              <div className="np-card-head"><h3 id="per-h">Subsidy per home vs. a local benchmark</h3></div>
              <p>{sale ? "Subsidy gap per home (cost − affordable price)" : "Money needed beyond the mortgage"}: <b>{usd(r.subsidyPerUnit.low)}–{usd(r.subsidyPerUnit.high)}</b> per home. {r.benchmark.label}: <b>{usd(r.benchmark.low)}–{usd(r.benchmark.high)}</b> ({r.benchmark.source}). {r.benchmark.note}</p>
              {sale ? <p className="np-muted">{r.subsidyPerUnit.high < r.benchmark.low ? "Below the local benchmark range." : r.subsidyPerUnit.low > r.benchmark.high ? "Above the local benchmark range." : "Overlaps the local benchmark range."}{cost?.context.mineSubsidence ? " Prices include mine subsidence insurance (a lot is over undermined ground)." : ""}</p> : null}
              <p className="np-muted">Serves {r.units} households at {[...new Set((sale ? r.sales : r.rents).map((x) => x.amiPct))].join("% and ")}% of the area median in {hood}, where {need?.area?.tracts[0]?.rent_burden_30_pct != null ? `${Math.round(Number(need.area.tracts[0].rent_burden_30_pct))}% of renters are cost-burdened (census tract ${need.area.tracts[0].name})` : "renter cost burden is shown in step 1"}.</p>
              <button type="button" className="es-btn es-btn-primary" onClick={onExport}>Download the advocacy brief (PDF)</button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
