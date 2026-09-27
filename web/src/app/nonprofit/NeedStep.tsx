"use client";

// Step 1 — "Who needs homes here?": the need map, headline sentences with receipts, the income ladder
// (households by income band vs. the rent they can afford vs. the median rent here), and context.

import dynamic from "next/dynamic";
import { useMemo } from "react";
import * as affordable from "@easescore/engine/src/affordable";
import { EmptyState, ReceiptButton, Segmented, type Receipt } from "@/components/seats";
import { EQUITY_NOTE, acsVintage, chasReceipt, ilReceipt, incomeReceipt, lihtcReceipt, qctReceipt, rentBurdenReceipt } from "@/lib/nonprofit/receipts";
import { inTen, needSummary, usd, usdK, type GeoLevel, type NeedData } from "@/lib/nonprofit/types";
import { LAYER_STEPS, SCALE, type Layer } from "./AreaMap";

const AreaMap = dynamic(() => import("./AreaMap"), { ssr: false, loading: () => <div className="np-map-skel" aria-hidden="true" /> });

const fmt = (n: number) => n.toLocaleString("en-US");
/** CHAS counts are rounded by HUD; show them to the nearest 10. */
const about = (n: number) => fmt(Math.round(n / 10) * 10);

export default function NeedStep({ need, loading, hoodName, tracts, geo, onGeo, geoVintage, geoError, layer, onLayer, household, onHousehold, onNext }: {
  need: NeedData | null;
  /** The neighborhood's need figures are being fetched. */
  loading: boolean;
  hoodName: string;
  /** Map features for the chosen level (tracts or block groups); null while loading. */
  tracts: GeoJSON.FeatureCollection | null;
  geo: GeoLevel;
  onGeo: (g: GeoLevel) => void;
  /** Block-group ACS vintage from the map payload. */
  geoVintage: string | null;
  geoError: boolean;
  layer: Layer;
  onLayer: (l: Layer) => void;
  household: number;
  onHousehold: (n: number) => void;
  onNext: () => void;
}) {
  const area = need?.area ?? null;
  const hood = area?.hood ?? hoodName;
  const n = useMemo(() => needSummary(area), [area]);
  const il = useMemo(() => affordable.parseIncomeLimits(need?.il as affordable.IncomeLimitsRow | null), [need?.il]);
  const ladder = useMemo(() => (il ? affordable.incomeLadder(il, household) : null), [il, household]);
  const chas = n?.chas ?? null;
  const lihtcLoaded = need?.datasets.find((d) => d.id === "lihtc")?.loaded ?? false;
  const lihtc = area?.lihtc ?? [];
  const lihtcUnits = lihtc.reduce((t, l) => t + (l.li_units ?? 0), 0);
  const steps = LAYER_STEPS[layer];

  const legend = (
    <div className="np-legend">
      <span>{steps.title}</span>
      <div className="np-legend-bar" aria-hidden="true">{(steps.reverse ? [...SCALE].reverse() : SCALE).map((c) => <i key={c} style={{ background: c }} />)}</div>
      <div className="np-legend-ends"><span>{steps.labels[0]}</span><span>{steps.labels[1]}</span></div>
      <small>
        {geo === "bg" ? `Census block groups · ${geoVintage ?? acsVintage(n?.acsYear ?? null)}` : `Census tracts · ${acsVintage(n?.acsYear ?? null)}`} · dashed line: {hood}
        {geo === "bg" ? <><br />Small areas: wide margins of error; grey = too few renters to estimate{layer === "poverty" ? "; poverty from table C17002" : ""}.</> : null}
      </small>
      {geo === "bg" && !tracts ? <small role="status">{geoError ? "Block groups could not be loaded; switch back to tracts." : "Loading block groups…"}</small> : null}
    </div>
  );
  const tools = (
    <div className="np-maptools">
      <Segmented<GeoLevel> label="Map level" hideLabel tone="dark" size="sm" value={geo} onChange={onGeo}
        options={[{ value: "tract", label: "Tracts", title: "Census tracts (about 4,000 people each)" }, { value: "bg", label: "Block groups", title: "Census block groups (about 1,000 people each; noisier estimates)" }]} />
      <Segmented<Layer> label="Shade the map by" hideLabel tone="dark" size="sm" value={layer} onChange={onLayer}
        options={[{ value: "rb30", label: "Renters paying 30%+" }, { value: "rb50", label: "50%+" }, { value: "income", label: "Median income" }, { value: "poverty", label: "Poverty" }]} />
    </div>
  );

  if (!area && (loading || !need)) {
    return (
      <div className="np-pad">
        <div className="np-loading" role="status"><span className="np-spin" aria-hidden="true" />Loading census figures for {hood}…</div>
        <div className="np-map-skel" aria-hidden="true" />
      </div>
    );
  }
  if (!area) {
    return (
      <div className="np-pad">
        <EmptyState tone="error" title={`No census tracts found for ${hood}`}>Pick another City of Pittsburgh neighborhood from the menu above.</EmptyState>
      </div>
    );
  }

  const incomeShare = n?.income != null && il ? Math.round((100 * n.income) / il.median) : null;
  const maxRent = Math.max(...(ladder ?? []).map((r) => r.affordableRent ?? 0), n?.rent ?? 0) * 1.08 || 1;
  const bandKey = { le30: "le30", "30_50": "30_50", "50_80": "50_80", "80_100": "80_100", gt100: "gt100" } as const;
  const chasR: Receipt | null = chas ? chasReceipt(chas, n!.method) : null;
  const rentR: Receipt | null = n ? { ...rentBurdenReceipt(n, hood), label: "Median gross rent here", value: n.rent != null ? usd(n.rent) : "—", source: "U.S. Census Bureau, ACS table B25064 (median gross rent), by census tract", method: `Median gross rent (rent plus utilities). ${n.method}` } : null;

  return (
    <div className="np-grid">
      <div className="np-col">
        <h2 className="es-sr">Map and income ladder for {hood}</h2>
        <div className="np-mapbox">
          <AreaMap tracts={tracts} layer={layer} outline={area.outline} bbox={area.bbox} ariaLabel={`Map of census ${geo === "bg" ? "block groups" : "tracts"} around ${hood}, shaded by ${steps.title.toLowerCase()}`} legend={legend} tools={tools} />
        </div>

        <section className="np-card" aria-labelledby="ladder-h">
          <div className="np-card-head">
            <h3 id="ladder-h">Income ladder: households here vs. the rent they can afford</h3>
            {il ? <ReceiptButton receipts={[
              ilReceipt(il.year, il.areaName, "Income bands and affordable rent", `Band edges are HUD's ${household}-person income limits (30%, 50%, 80%) and the area median family income adjusted for household size. Affordable rent = 30% of the band's top income ÷ 12, including utilities.`),
              ...(chasR ? [chasR] : []),
              ...(rentR ? [rentR] : []),
            ]} /> : null}
          </div>
          <div className="np-ladder-controls">
            <Segmented<string> label="Household size for the rent column" size="sm" value={String(household)} onChange={(v) => onHousehold(Number(v))}
              options={[1, 2, 3, 4, 5].map((k) => ({ value: String(k), label: k === 1 ? "1 person" : `${k}` }))} />
            {n?.rent != null ? <p className="np-muted">Median rent here: <b>{usd(n.rent)}</b> a month</p> : null}
          </div>
          {!ladder ? <EmptyState compact dataset="HUD income limits" /> : (
            <div className="np-ladder" role="table" aria-label="Income ladder">
              <div className="np-lad np-lad-head" role="row">
                <span role="columnheader">Income band ({household === 1 ? "1 person" : `family of ${household}`})</span>
                <span role="columnheader">Rent they can afford (bar) vs. the median rent here (line)</span>
                <span role="columnheader" className="np-r">Households here</span>
              </div>
              {ladder.map((r) => {
                const short = r.affordableRent != null && n?.rent != null && r.affordableRent < n.rent;
                const w = r.affordableRent != null ? (100 * r.affordableRent) / maxRent : 100;
                const k = bandKey[r.id as keyof typeof bandKey];
                const hh = chas ? chas.bands[k] : null;
                const cb = chas && k !== "gt100" ? chas.burdened[k as keyof typeof chas.burdened] : null;
                return (
                  <div className="np-lad" role="row" key={r.id}>
                    <span role="cell" className="np-lad-name"><b>{r.label}</b><small>{r.incomeHigh ? `${usdK(r.incomeLow)}–${usdK(r.incomeHigh)}` : `over ${usdK(r.incomeLow)}`}</small></span>
                    <span role="cell" className="np-lad-bar">
                      <span className="np-bar">
                        <i className={short ? "is-short" : ""} style={{ width: `${Math.min(100, w)}%` }} />
                        <em>{r.affordableRent != null ? `up to ${usd(r.affordableRent)}/mo` : "can afford the median rent"}</em>
                        {n?.rent != null ? <s style={{ left: `${Math.min(99.5, (100 * n.rent) / maxRent)}%` }} aria-hidden="true" /> : null}
                      </span>
                      {short ? <small className="np-short">Can&apos;t afford the median rent here</small> : null}
                    </span>
                    <span role="cell" className="np-r">
                      {hh != null ? <><b>{about(hh)}</b>{cb != null && hh > 0 ? <small className="np-muted np-block">{about(cb)} cost-burdened</small> : null}</> : <span className="np-muted">—</span>}
                    </span>
                  </div>
                );
              })}
              <p className="np-foot">
                {chas ? `Household counts: HUD CHAS ${chas.vintage ?? ""}, all households (owners and renters), rounded.` : "Household counts by band need HUD CHAS, not loaded yet."} Rents: HUD FY{il?.year} Income Limits, Pittsburgh HMFA; median rent: Census {acsVintage(n?.acsYear ?? null)}.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="np-col">
        <h2 className="np-q">{n?.rb30 != null ? `${inTen(n.rb30)} renters in ${hood} pay more than they can afford.` : `Who needs homes in ${hood}?`}</h2>
        <p className="np-sub">{n?.tracts === 1 ? "1 census tract" : `${n?.tracts} census tracts`} · Census {acsVintage(n?.acsYear ?? null)}{chas ? ` · HUD CHAS ${chas.vintage?.slice(0, 9) ?? ""}` : ""} · HUD FY{il?.year ?? ""} income limits</p>

        <div className="np-facts">
          <div className="np-fact">
            <div className="np-fact-top"><span>Renters paying 30%+ of income</span>{n ? <ReceiptButton receipt={rentBurdenReceipt(n, hood)} /> : null}</div>
            <p>{n?.rb30 != null ? <><b>{Math.round(n.rb30)}%</b> of renter households</> : "—"}</p>
          </div>
          <div className="np-fact">
            <div className="np-fact-top"><span>Median household income</span>{n && il ? <ReceiptButton receipt={incomeReceipt(n, il.median, il.year)} /> : null}</div>
            <p>{n?.income != null ? <><b>{usdK(n.income)}</b>{incomeShare != null ? `, about ${incomeShare}% of the area median` : ""}</> : "—"}</p>
          </div>
          <div className="np-fact">
            <div className="np-fact-top"><span>Households under 50% of area median</span>{chasR ? <ReceiptButton receipt={chasR} /> : null}</div>
            {chas ? <p><b>{about(chas.under50)}</b> households</p> : <EmptyState compact dataset="HUD CHAS">Counts of households by income band will appear here.</EmptyState>}
          </div>
          <div className="np-fact">
            <div className="np-fact-top"><span>Rental homes priced for them</span>{chasR ? <ReceiptButton receipt={chasR} /> : null}</div>
            {chas ? <p><b>about {about(chas.afford50)}</b> at those rents</p> : <EmptyState compact dataset="HUD CHAS">Affordable units by income band will appear here.</EmptyState>}
          </div>
          <div className="np-fact np-gapcard">
            <span className="np-gap-lbl">The gap</span>
            {chas ? (
              <p>Roughly <b className="np-gap-n">{about(chas.gap)}</b> more homes are needed for households here earning under half the area median{n?.rb50 != null ? <>, and <b>{Math.round(n.rb50)}%</b> of renters already pay more than half their income on rent</> : null}.</p>
            ) : (
              <p>The count of missing homes needs HUD CHAS (not loaded yet).{n?.rb50 != null ? <> What the census shows: <b>{Math.round(n.rb50)}%</b> of renters here pay more than <b>half</b> their income on rent.</> : null}</p>
            )}
            {chasR ? <ReceiptButton className="np-rc-light" receipts={[chasR, ...(n ? [rentBurdenReceipt(n, hood, 50)] : [])]} /> : n ? <ReceiptButton className="np-rc-light" receipt={rentBurdenReceipt(n, hood, 50)} /> : null}
          </div>
        </div>

        <section className="np-card" aria-labelledby="ctx-h">
          <div className="np-card-head"><h3 id="ctx-h">Context</h3></div>
          <ul className="np-ctx">
            <li>
              <span className={n?.qct ? "np-ok" : "np-muted"}>{n?.qct ? "✓" : "–"}</span>
              <span>{n?.qct ? "Qualified Census Tract: tax-credit projects here can claim a 130% basis boost." : "Not a Qualified Census Tract."}{n?.dda ? " Also a Difficult Development Area." : ""}</span>
              <ReceiptButton receipt={qctReceipt(!!n?.qct, !!n?.dda)} />
            </li>
            <li>
              <span className="np-muted">⌂</span>
              <span>
                {lihtcLoaded
                  ? lihtc.length
                    ? <>{lihtc.length} tax-credit (LIHTC) {lihtc.length === 1 ? "property" : "properties"} in or within half a mile of {hood}, with about {fmt(lihtcUnits)} income-restricted homes{lihtc.filter((l) => (l.n_units ?? 0) >= 5).length ? <>, including {lihtc.filter((l) => (l.n_units ?? 0) >= 5).slice(0, 3).map((l) => `${titleCase(l.project)} (${l.li_units ?? "?"} homes${l.yr_pis && l.yr_pis < 3000 ? `, ${l.yr_pis}` : ""})`).join(", ")}</> : null}.</>
                    : <>No tax-credit (LIHTC) properties in or within half a mile of {hood} in HUD&apos;s database.</>
                  : <>Existing tax-credit (LIHTC) properties nearby: <em>HUD LIHTC database not loaded yet.</em></>}
              </span>
              {lihtcLoaded ? <ReceiptButton receipt={lihtcReceipt(hood)} /> : null}
            </li>
            {n?.poverty != null ? (
              <li><span className="np-muted">%</span><span>About {Math.round(n.poverty)}% of people here live below the federal poverty line.</span><ReceiptButton receipt={{ ...rentBurdenReceipt(n, hood), label: "People below the poverty line", value: `${Math.round(n.poverty)}%`, source: "U.S. Census Bureau, ACS table B17001 (poverty status), by census tract", method: `People below the poverty line ÷ people for whom poverty status is determined. ${n.method}` }} /></li>
            ) : null}
            {il ? (
              <li>
                <span className="np-muted">$</span>
                <span>{affordable.householdSentence(il, 60, 3).text}</span>
                <ReceiptButton receipt={ilReceipt(il.year, il.areaName, "60% AMI income and rent, family of 3", affordable.householdSentence(il, 60, 3).basis)} />
              </li>
            ) : null}
          </ul>
          <p className="np-foot">{EQUITY_NOTE}</p>
        </section>

        <div className="np-next">
          <button type="button" className="es-btn es-btn-primary" onClick={onNext}>Next: where could we build? →</button>
        </div>
      </div>
    </div>
  );
}

function titleCase(s: string | null): string {
  if (!s) return "A property";
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bPh\b/g, "Phase");
}
