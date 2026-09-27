"use client";

// Step 3 — "What would it cost, and what's the gap?": homes and who they serve (HUD FY limits, 30% rule),
// development cost from the pro forma, supportable loan, funding gap, and a capital stack of typical
// sources you switch on and off (instant: all math runs here from engine/src/affordable).

import { useMemo } from "react";
import * as affordable from "@easescore/engine/src/affordable";
import { EmptyState, RangeValue, ReceiptButton, Segmented, Switch, type Receipt } from "@/components/seats";
import { ilReceipt } from "@/lib/nonprofit/receipts";
import { usd, unitGroups, type NeedData, type ProjectCost } from "@/lib/nonprofit/types";

const STACK_COLOR: Record<string, string> = {
  debt: "#6b7c75", lihtc4: "#2f7d63", lihtc9: "#1f6a52", home: "#5ea98a", cdbg: "#7fbfa4", phare: "#3e8c70", hof: "#4f9c80",
  ahp: "#8ccab0", lerta: "#a9d7c3", land: "#9fcdb6", philanthropy: "#b9dccd",
};
const AMIS = [30, 50, 60, 80];

export function computeProject(cost: ProjectCost | null, il: affordable.IncomeLimits | null, mix: Record<number, number>, perLot: number, bedrooms: number, sources: string[]) {
  if (!cost?.tdc || !il) return null;
  const total = cost.lots.length * perLot;
  const units = unitGroups(mix, total, bedrooms);
  if (!units.length) return null;
  return affordable.evaluateProject({ units, tdc: cost.tdc, land: cost.land, context: { tenure: "rent", ...cost.context } }, il, sources);
}

export default function ProjectStep({ need, lotCount, cost, costLoading, costError, perLot, onPerLot, bedrooms, onBedrooms, mix, onMix, sources, onSources, onExport }: {
  need: NeedData | null;
  /** Lots chosen in step 2 (known before the cost arrives). */
  lotCount: number;
  cost: ProjectCost | null;
  costLoading: boolean;
  costError: string | null;
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
  const r = useMemo(() => computeProject(cost, il, mix, perLot, bedrooms, sources), [cost, il, mix, perLot, bedrooms, sources]);
  const hood = need?.area?.hood ?? "the area";

  const setCount = (ami: number, delta: number) => {
    // Edit the scaled counts the user sees, then store them as the new mix.
    const cur: Record<number, number> = Object.fromEntries(groups.map((g) => [g.amiPct, g.count]));
    const next = { ...cur, [ami]: Math.max(0, (cur[ami] ?? 0) + delta) };
    if (Object.values(next).reduce((t, x) => t + x, 0) === 0) return;
    onMix(next);
  };
  const toggle = (id: string, on: boolean) => onSources(on ? [...sources.filter((s) => s !== id), id] : sources.filter((s) => s !== id));

  const costReceipt: Receipt | null = cost?.tdc ? {
    label: "Total development cost",
    value: `${usd(cost.tdc.low)}–${usd(cost.tdc.high)}, likely ${usd(cost.tdc.likely)}`,
    source: `EaseScore.AI pro forma (${cost.costConfig}), the same model as the parcel page`,
    date: cost.asOf,
    method: <>Each lot priced for {perLot} rental home{perLot > 1 ? "s" : ""} of {bedrooms} bedroom{bedrooms === 1 ? "" : "s"}, then summed:<ul>{cost.lots.map((l) => <li key={l.parid}>{l.address ?? l.parid}: {l.strategyLabel ?? "—"}{l.finishedSf ? `, about ${Math.round(l.finishedSf / Math.max(1, l.units)).toLocaleString("en-US")} sq ft per home` : ""} — {l.headline ?? "not priced"}{l.needsRelief ? " (needs zoning relief)" : ""}</li>)}</ul>Low and high come from each input&apos;s documented range (construction tier, site adders, soft-cost shares, land).</>,
    kind: "data",
    notes: cost.lots.flatMap((l) => l.notes).join(" ") || "Construction costs are estimates; confirm with local bids.",
  } : null;

  return (
    <div className="np-grid np-grid-project">
      <div className="np-col">
        <section className="np-card" aria-labelledby="homes-h">
          <div className="np-card-head"><h3 id="homes-h">Homes and who they serve</h3></div>
          <div className="np-controls">
            <Segmented<string> label="Tenure" size="sm" value="rent" onChange={() => undefined} options={[{ value: "rent", label: "Rental" }, { value: "sale", label: "For-sale (not modeled yet)", title: "For-sale affordability is not modeled in this seat yet" }]} />
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
          {il && r ? (
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
          ) : !cost.tdc ? (
            <EmptyState tone="error" title="Some lots could not be priced">{cost.lots.filter((l) => !l.tdc).map((l) => `${l.address ?? l.parid}: ${l.notes.join(" ")}`).join(" ")}</EmptyState>
          ) : (
            <>
              <div className="np-row2">
                <div><span className="np-lbl">Total cost, {total} homes on {lots} lots</span><RangeValue value={cost.tdc} format="money" size="lg" label="Total development cost" /></div>
                <div><span className="np-lbl">Per home</span><RangeValue value={{ low: cost.tdc.low / total, likely: cost.tdc.likely / total, high: cost.tdc.high / total }} format="money" size="md" label="Cost per home" /></div>
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
                about <b>{usd(r.remainingPerUnit.low)}–{usd(r.remainingPerUnit.high)}</b> per home, after a {usd(r.debt.loan.low)}–{usd(r.debt.loan.high)} mortgage
                {r.enabled.length ? ` and ${r.enabled.map((id) => r.sources.find((s) => s.id === id)!.short).join(", ")}` : " (no other sources switched on)"}.
              </p>
              <ReceiptButton className="np-rc-light" receipts={[
                { label: "Funding gap before sources", value: `${usd(r.gapBefore.low)}–${usd(r.gapBefore.high)}`, source: "Pro forma cost − supportable loan", date: cost?.asOf ?? "", method: r.receipts.gap, kind: "data" },
                { label: "Supportable permanent loan", value: `${usd(r.debt.loan.low)}–${usd(r.debt.loan.high)}`, source: "engine/config/capital-sources.v0.1.json (debt)", date: "2026-09-26", method: r.debt.basis, kind: "assumption", notes: "Rate, term, debt coverage and operating cost are editable assumptions." },
                { label: "Remaining gap", value: `${usd(r.remaining.low)}–${usd(r.remaining.high)}`, source: "Capital sources, typical ranges (not awards)", date: "2026-09-26", method: r.receipts.remaining, kind: "assumption" },
              ]} />
            </section>

            <section className="np-card" aria-labelledby="stack-h">
              <div className="np-card-head"><h3 id="stack-h">Capital stack</h3><span className="np-typical">Typical, not an award</span></div>
              <p className="np-muted">Cost {usd(r.tdc.likely)} (likely) · Loan {usd(r.debt.loan.likely)} · Gap before sources {usd(r.gapBefore.low)}–{usd(r.gapBefore.high)}</p>
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
              <p>Money needed beyond the mortgage: <b>{usd(r.subsidyPerUnit.low)}–{usd(r.subsidyPerUnit.high)}</b> per home. {r.benchmark.label}: <b>{usd(r.benchmark.low)}–{usd(r.benchmark.high)}</b> ({r.benchmark.source}). {r.benchmark.note}</p>
              <p className="np-muted">Serves {r.units} households at {[...new Set(r.rents.map((x) => x.amiPct))].join("% and ")}% of the area median in {hood}, where {need?.area?.tracts[0]?.rent_burden_30_pct != null ? `${Math.round(Number(need.area.tracts[0].rent_burden_30_pct))}% of renters are cost-burdened (census tract ${need.area.tracts[0].name})` : "renter cost burden is shown in step 1"}.</p>
              <button type="button" className="es-btn es-btn-primary" onClick={onExport}>Download the advocacy brief (PDF)</button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
