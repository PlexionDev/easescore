"use client";

// Right rail: count + band bar, what's holding the matching parcels back (share of parcels per
// blocker; click to filter), capacity by right vs. with relief, and public land.

import Link from "next/link";
import { EmptyState, RangeValue, ReceiptButton, type Receipt } from "@/components/seats";
import { BAND_COLOR, BANDS, BLOCKER_LEVER, bandLabel, blockerText, NO_BAND_COLOR, policyKey, SMALL_INFILL_CAP, type Filters, type PlannerSummary } from "@/lib/planner";

const BLOCKER_RECEIPT: Receipt = {
  label: "Site constraints",
  source: "EaseScore.AI Ease Score (score config shown in the footer), computed per parcel from county, City and federal datasets",
  date: "See data dates below",
  method: "For each parcel's best option that adds homes, every factor or callout that costs at least one score point is listed as a blocker, in plain words (red flags and hazard band caps first). A parcel can have several, so the bars show the share of matching parcels that list each blocker; they do not add up to 100%. Low market activity is counted only where it is a parcel's top blocker (it is a small secondary drag on most parcels); the parcel's own list still shows it. Missing data (for example sewer service not confirmed) is never counted as a blocker.",
  kind: "data",
};
const CAPACITY_RECEIPT: Receipt = {
  label: "Homes these lots could hold",
  source: "QuickFit lot-fit test on the county parcel outline and the City zoning rules table",
  date: "Scores as of the computed date in the footer",
  method: "By right: the most homes any new building fits with the use allowed by right and no dimensional variance, summed over matching parcels. With relief: the most homes on any path short of a use variance (special exception, conditional use, dimensional variance). The low end counts only parcels with no red flag and no hazard band cap; the high end counts every matching parcel.",
  notes: `${SMALL_INFILL_CAP} Lots whose fit test did not run in the batch (large or irregular lots) have no unit count and are left out; open them for the full result.`,
  kind: "data",
};

export default function PlannerSummary({ s, f, set, loading }: {
  s: PlannerSummary | null;
  f: Filters;
  set: (patch: Partial<Filters>) => void;
  loading: boolean;
}) {
  if (!s) return <EmptyState tone="error" title="Results could not load">Try again in a moment. The filters still work.</EmptyState>;
  if (!s.total) return <EmptyState tone="empty" title="No parcels match these filters">Remove a filter on the left to widen the search.</EmptyState>;
  const bands = [...BANDS, "Partial", "No score"].map((b) => ({ b, label: b === "Partial" ? "partial (no score)" : bandLabel(b).toLowerCase(), n: s.bands[b] ?? 0 })).filter((x) => x.n > 0);
  // Blockers a rule change can relax (slope and hazards are not rules), most common first; levers that
  // relax blockers on at least 10% of the matching parcels are combined into one Policy scenario.
  const ruleBlockers = s.blockers.filter((b) => BLOCKER_LEVER[b.blocker]);
  const top = ruleBlockers[0];
  const lever = top ? BLOCKER_LEVER[top.blocker] : undefined;
  const levers = [...new Map(ruleBlockers.filter((b, i) => i === 0 || b.n >= 0.1 * s.total).map((b) => [BLOCKER_LEVER[b.blocker]!.key, BLOCKER_LEVER[b.blocker]!])).values()];
  // The Policy seat reads the lever from ?s= and the geography from the shared seat selection.
  const policyHref = levers.length ? `/policy?s=${policyKey(levers.map((l) => l.key))}` : null;
  const leverText = levers.map((l) => l.label).join(" and ");
  const pl = s.public_land;
  return (
    <div className="pl-sum" aria-busy={loading || undefined}>
      <section aria-label="Matching parcels">
        <p className="pl-card-label" style={{ fontSize: 12, color: "var(--es-muted)" }}>Matching parcels</p>
        <p className="pl-count">{s.total.toLocaleString("en-US")}</p>
        <div className="pl-bandbar" role="img" aria-label={bands.map((x) => `${x.n} ${x.label}`).join(", ")}>
          {bands.map((x) => <span key={x.b} style={{ width: `${(100 * x.n) / s.total}%`, background: BAND_COLOR[x.b] ?? NO_BAND_COLOR }} />)}
        </div>
        <p className="pl-bandlegend">{bands.map((x) => `${x.n.toLocaleString("en-US")} ${x.label}`).join(" · ")}</p>
      </section>

      <section aria-labelledby="pl-blk-h">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 id="pl-blk-h">What&apos;s holding them back</h2>
          <ReceiptButton receipt={BLOCKER_RECEIPT} />
        </div>
        <p className="pl-hint">Share of matching parcels blocked by each (a parcel can have more than one). Click one to filter.</p>
        <div style={{ marginTop: 8 }}>
          {s.blockers.slice(0, 8).map((b) => {
            const pct = Math.round((100 * b.n) / s.total);
            const on = f.hasBlocker === b.blocker;
            return (
              <button key={b.blocker} type="button" className={`pl-blk${on ? " on" : ""}`} aria-pressed={on}
                onClick={() => set({ hasBlocker: on ? undefined : b.blocker })}>
                <span className="pl-blk-row"><span className="pl-blk-label">{blockerText(b.blocker)}</span><b>{pct}%</b></span>
                <span className="pl-blk-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, pct)}%` }} /></span>
              </button>
            );
          })}
          {s.no_blocker ? <p className="pl-hint" style={{ marginTop: 6 }}>{s.no_blocker.toLocaleString("en-US")} parcels have no blocker costing a full point.</p> : null}
        </div>
        {policyHref && lever ? (
          <p style={{ marginTop: 8 }}><Link className="pl-link" href={policyHref}>Test changing the {leverText} rule{levers.length > 1 ? "s" : ""} →</Link>
            <span className="pl-hint" style={{ display: "block" }}>{ruleBlockers.slice(0, 3).map((b) => `${blockerText(b.blocker)} ${Math.round((100 * b.n) / s.total)}%`).join(" · ")} of these parcels.</span></p>
        ) : null}
      </section>

      <section className="pl-card" aria-label="Homes these lots could hold">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <p className="pl-card-label">Homes these lots could hold</p>
          <ReceiptButton receipt={CAPACITY_RECEIPT} />
        </div>
        <div className="pl-card-big">
          <RangeValue value={{ low: s.capacity.by_right_clean, likely: s.capacity.by_right_clean, high: s.capacity.by_right }} showLikely={false} unit="by right" label="Homes by right" />
        </div>
        <p className="pl-card-sub">
          <RangeValue value={{ low: s.capacity.relief_clean, likely: s.capacity.relief_clean, high: s.capacity.relief }} size="sm" showLikely={false} unit="with typical relief" label="Homes with relief" />
        </p>
        {s.capacity.units_unknown ? <p className="pl-card-sub">{s.capacity.units_unknown.toLocaleString("en-US")} lots without a unit count (fit test not run).</p> : null}
      </section>

      <section className="pl-card" aria-label="Public land in this filter">
        <p className="pl-card-label">Public land in this filter</p>
        <p className="pl-card-big">{pl.count.toLocaleString("en-US")} lots · {pl.acres.toLocaleString("en-US")} acres</p>
        <p className="pl-card-sub">{pl.buildable_count.toLocaleString("en-US")} buildable ({pl.buildable_acres.toLocaleString("en-US")} acres): no red flag and room for at least one home.</p>
        <p className="pl-card-sub">{Object.entries(pl.by_agency).map(([a, n]) => `${a} ${n.toLocaleString("en-US")}`).join(" · ") || "No publicly owned lots match."}</p>
      </section>

      {s.other_public_land.count ? (
        <section className="pl-card" aria-label="Other public land">
          <p className="pl-card-label">Other public land</p>
          <p className="pl-card-big">{s.other_public_land.count.toLocaleString("en-US")} lots · {s.other_public_land.acres.toLocaleString("en-US")} acres</p>
          <p className="pl-card-sub">Not ranked for housing: alleys, streets and rights-of-way, parks and plazas, parking structures and lots, and utility and transit land.</p>
          <p className="pl-card-sub">{Object.entries(s.other_public_land.by_reason).map(([r, n]) => `${r} ${n.toLocaleString("en-US")}`).join(" · ")}</p>
        </section>
      ) : null}
    </div>
  );
}
