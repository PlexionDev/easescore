import type { Metadata } from "next";
import Link from "next/link";
import ease from "@easescore/engine/config/ease-score.v0.2.json";
import costs from "@easescore/engine/config/cost-assumptions.v0.2.json";
import capital from "@easescore/engine/config/capital-sources.v0.1.json";
import { assumptions } from "@easescore/engine";
import { bandLabel } from "@easescore/engine/src/score/bands";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";

export const metadata: Metadata = {
  title: "Data and methods — EaseScore.AI",
  description: "How the Development Ease Score, red flags, review callouts, the pro forma and the plain-English answers are calculated.",
};

// Weights, bands and costs are read from the engine's config files so this page never drifts from the math.
type FactorId = keyof typeof ease.weights;
const FACTORS: { id: FactorId; label: string; rule: string }[] = [
  { id: "F1", label: "Zoning permission", rule: "How the district treats the use (by right, administrator exception, special exception, conditional use, or use variance) times how a building fits the lot: by right, with a contextual setback, with a dimensional variance weighted by that district's Zoning Board grant rate, or not at all." },
  { id: "F2", label: "Terrain and buildable ground", rule: `Share of the lot steeper than 25% from USGS 1-meter lidar, read through a curve; multiplied by ${ease.f2.envelopeFactor.tooSmall} when the buildable area inside the setbacks is smaller than the smallest footprint for the housing type.` },
  { id: "F3", label: "Geohazards", rule: "Starts at 100 and is multiplied down for each hazard on the lot: landslide-prone overlay, mapped mine workings, 1982 slope-movement area, 100-year floodplain, a cleanup site on or next to the lot, and combined-sewer area." },
  { id: "F4", label: "Access and infrastructure", rule: "Street frontage (opened street, paper street, city steps, or none) times water and sewer service (inside, unknown, or outside), plus a small bonus near frequent transit." },
  { id: "F5", label: "Approval burden and time", rule: "Starts at 100 and loses points for each approval beyond a building permit, a required geotechnical report, a historic district, and a demolition. Also yields months to a permit." },
  { id: "F6", label: "Lot and acquisition readiness", rule: "Vacant or teardown-ready lots score highest; for a rehab, the county's condition rating sets the score. Tax delinquency and public ownership adjust it." },
  { id: "F7", label: "Market activity", rule: "Percentile rank of nearby valid sales and completed permits." },
];

const PERMISSION: [string, string][] = [
  ["P", "Permitted by right"],
  ["A", "Administrator exception"],
  ["S", "Special exception (Zoning Board hearing)"],
  ["C", "Conditional use (City Council)"],
  ["N", "Not permitted; needs a use variance"],
];

const HAZARDS: [keyof typeof ease.f3.multipliers, string][] = [
  ["landslideProne", "City landslide-prone overlay"],
  ["undermined", "Over mapped mine workings"],
  ["slopeMovementOnLot", "Inside a 1982 mapped slope-movement area"],
  ["floodplain100yr", "In the 100-year floodplain"],
  ["contaminationOnOrAdjacent", "Cleanup site on or next to the lot"],
  ["combinedSewer", "Combined-sewer area"],
];

const TOC: [string, string][] = [
  ["overview", "The short version"],
  ["factors", "Seven factors"],
  ["flags", "Red flags and review callouts"],
  ["evidence", "Evidence and ranges"],
  ["time", "Months to a permit"],
  ["proforma", "Does it pencil?"],
  ["comps", "How homes are valued"],
  ["planner", "How the Planner ranks a parcel"],
  ["policy", "Policy levers"],
  ["nonprofit", "Nonprofit affordability math"],
  ["words", "The plain-English layer"],
  ["sources", "Sources"],
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export default function MethodsPage() {
  const totalWeight = Object.values(ease.weights).reduce((a, b) => a + b, 0);
  const tiers = costs.construction.tiers;
  const defaultTier = tiers.find((t) => t.id === costs.construction.defaultTier)!;
  const nc = costs.comps.newConstruction;
  const arv = costs.comps.existingMatch;
  const minShare = ease.evidence.minEvidenceShare;

  return (
    <Shell current="methods">
      <section className={d.pageHead} aria-labelledby="page-title">
        <div className={d.wrap}>
          <span className={d.eyebrow}>Data and methods</span>
          <h1 id="page-title">How the score and the numbers are made</h1>
          <p className={d.lede}>
            Every result comes from public records and rules written in code. The same parcel and the same data always give the same answer.
            Weights and defaults below are read straight from the engine&apos;s config (Ease Score v{ease.version}, cost assumptions {costs.version.replace("cost-assumptions.", "")}).
          </p>
        </div>
      </section>

      <div className={`${d.wrap} ${d.layout}`}>
        <nav className={d.toc} aria-label="On this page">
          <p>On this page</p>
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`}>{label}</a></li>
            ))}
          </ol>
        </nav>

        <div className={d.prose}>
          <section id="overview" aria-labelledby="overview-h">
            <h2 id="overview-h">The short version</h2>
            <ol className={d.steps}>
              <li>We gather the facts for the lot: zoning, lidar slope, hazard maps, street frontage, water service, transit, permits, Zoning Board decisions, nearby sales.</li>
              <li>For each housing option (single-family, duplex, 3–4 units, townhouse row, ADU, rehab of the existing building) we test whether a building fits the lot and which approvals it needs.</li>
              <li>Seven factors are scored 0 to 100 and combined with fixed weights into the Development Ease Score. Higher means fewer barriers.</li>
              <li>Deal-breakers are shown as red flags above the score. Serious but workable issues become &ldquo;Review required&rdquo; callouts.</li>
              <li>Money is kept separate: the pro forma answers &ldquo;does it pencil?&rdquo; from costs and nearby sales.</li>
              <li>Plain-English sentences are written from those computed results. Nothing in them is new information.</li>
            </ol>
            <p className={d.muted}>The score measures barriers to building, not whether it&apos;s a good investment.</p>
            <p>
              <strong>No numeric score where zoning is not loaded.</strong> Zoning rules are transcribed for the City of Pittsburgh only. Elsewhere (and for the
              few City parcels with no zoning district) there is no Ease Score: the parcel reads &ldquo;Partial screen: zoning not available for [municipality]&rdquo;
              with the known facts only (lot, slope, hazards, existing building, market). In the Planner and Developer tables these parcels read
              &ldquo;Partial&rdquo;, are never counted in a band and sort after every scored parcel.
            </p>
            <p>
              <strong>Market strength</strong> is a separate signal beside the score, never part of it: Strong, Moderate or Weak from the count and median $/sq ft of
              recent new-construction sales nearby (the same comparable set the pro forma prices from), against the default construction cost per sq ft.
              The receipt beside it states the rule and the numbers. When the pro forma does not pencil, the headline says so (&ldquo;[band], but doesn&apos;t pencil at today&apos;s prices&rdquo;).
            </p>
          </section>

          <section id="factors" aria-labelledby="factors-h">
            <h2 id="factors-h">Seven factors</h2>
            <p>
              Score = the sum of (weight × factor score) over the factors that have data, divided by the sum of those weights.
              The weights add up to {totalWeight}.
            </p>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Factor weights table (scrolls sideways on small screens)">
              <table className={d.table}>
                <caption>Factor weights (from the engine config)</caption>
                <thead>
                  <tr><th scope="col">Factor</th><th scope="col" className={d.num}>Weight</th><th scope="col">How it is scored</th></tr>
                </thead>
                <tbody>
                  {FACTORS.map((f) => (
                    <tr key={f.id}>
                      <th scope="row">{f.label}</th>
                      <td className={d.num}>{ease.weights[f.id]}</td>
                      <td>{f.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Bands</h3>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Bands table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead><tr><th scope="col">Band</th><th scope="col" className={d.num}>Score</th></tr></thead>
                <tbody>
                  {ease.bands.map((b, i) => {
                    const upper = i === 0 ? 100 : ease.bands[i - 1]!.min - 1;
                    return (
                      <tr key={b.band}><th scope="row">{bandLabel(b.band)}</th><td className={d.num}>{b.min}–{upper}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h3>Zoning permission</h3>
            <p>Use permission comes from the City&apos;s §911.02 Use Table. The permission score is multiplied by the lot-fit factor.</p>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Zoning permission table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead><tr><th scope="col">Code</th><th scope="col">Meaning</th><th scope="col" className={d.num}>Points</th></tr></thead>
                <tbody>
                  {PERMISSION.map(([code, meaning]) => (
                    <tr key={code}>
                      <th scope="row">{code}</th>
                      <td>{meaning}</td>
                      <td className={d.num}>{ease.f1.permission[code as keyof typeof ease.f1.permission]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Lot fit: by right ×{ease.f1.dimensional.byRight}, with a contextual front setback ×{ease.f1.dimensional.contextualSetback},
              with a dimensional variance ×({ease.f1.dimensional.varianceBase} + {ease.f1.dimensional.varianceRateWeight} × the district&apos;s
              Zoning Board grant rate) × {ease.caps.varianceF1Max}% (a variance path never scores like a sure thing), no fit ×{ease.f1.dimensional.noFit}.
              With fewer than {ease.f1.zba.minCases} decided cases in the district, the citywide record for the same kind of request is used,
              labeled with its case count and years; only when neither exists does the grant rate default to {pct(ease.f1.zba.defaultGrantRate)}, and it says so.
              Hazard cap: when at least {pct(ease.caps.hazardBand.landslideProneShareMin)} of the lot is landslide-prone or at least {pct(ease.caps.hazardBand.steepShareOver25Min)} is
              steeper than 25%, the score is held to {ease.caps.hazardBand.maxBand} or lower and labeled.
            </p>

            <h3>Geohazard multipliers</h3>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Geohazard multipliers table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead><tr><th scope="col">Condition on the lot</th><th scope="col" className={d.num}>Multiplier</th></tr></thead>
                <tbody>
                  {HAZARDS.map(([k, label]) => (
                    <tr key={k}><th scope="row">{label}</th><td className={d.num}>×{ease.f3.multipliers[k]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="flags" aria-labelledby="flags-h">
            <h2 id="flags-h">Red flags and review callouts</h2>
            <div className={d.flag}>
              <strong>Red flags</strong> are deal-breakers: a FEMA floodway on at least {pct(ease.redFlags.floodwayMinShare)} of the lot,
              no legal street access, or an active cleanup site on the lot. They appear above the score with the label &ldquo;Blocked unless
              resolved&rdquo; and name the way out. They never change the number.
            </div>
            <div className={d.note}>
              <strong>&ldquo;Review required&rdquo; callouts</strong> cover issues that add cost, time or a study but can be handled: landslide-prone
              ground, undermined land, historic districts and similar. Each lists the code sections that apply, a checklist, and cost notes.
              The mine grouting figure is an editable default ({usd(ease.reviewCallouts.groutingCostUsd.low)}–{usd(ease.reviewCallouts.groutingCostUsd.high)}),
              not a quote. The geotechnical report default ({usd(costs.lineModel.geotech.hillsideOrLandslide)} landslide-prone or steep, {usd(costs.lineModel.geotech.underminedOnly)} undermined only) is an assumption; get quotes from a geotechnical engineer.
            </div>
            <p>
              In the requirements checklist, an item is marked Required only when a cited law requires it. Other items are shown as advisories.
            </p>
          </section>

          <section id="evidence" aria-labelledby="evidence-h">
            <h2 id="evidence-h">Evidence and ranges</h2>
            <ul>
              <li><strong>Unknown is not zero.</strong> A factor without data is marked missing and left out of the average. It is never scored as zero or as fine.</li>
              <li><strong>Ranges.</strong> When a factor is missing, the result also shows the range the score would span if that factor were 0 or 100.</li>
              <li><strong>Preliminary.</strong> If the factors with data carry less than {pct(minShare)} of the weight, the result is labeled &ldquo;Preliminary — insufficient evidence.&rdquo;</li>
              <li><strong>City-only layers.</strong> Zoning, landslide-prone areas, historic districts and combined sewers are mapped for the City of Pittsburgh only. Outside the City they are unknown, never &ldquo;none.&rdquo;</li>
              <li><strong>Receipts.</strong> Each factor bar opens a receipt: the inputs, the rule applied, and the sources with dates.</li>
            </ul>
          </section>

          <section id="time" aria-labelledby="time-h">
            <h2 id="time-h">Months to a permit</h2>
            <p>
              The estimate adds time for each approval step to the building-permit part. Hearing-based approvals use the Zoning Board record
              (about {ease.f5.months.dimensional_variance} months from hearing to decision, plus about {ease.f5.months.afterHearingToPermit} months
              from decision to permit). Other step times are heuristics and are labeled as estimates.
            </p>
            <p>
              For the building permit itself, no public City dataset records when an application was filed, so real processing times cannot
              be measured. Inside the City we use the published review target and label it &ldquo;City target, not measured.&rdquo;
              Outside the City we fall back to a labeled {ease.f5.months.base}-month estimate.
            </p>
          </section>

          <section id="proforma" aria-labelledby="proforma-h">
            <h2 id="proforma-h">Does it pencil?</h2>
            <p>
              The pro forma is separate from the Ease Score. A cheap site in a weak market and a hard site in a strong market are different
              answers, so the two are never blended. Every default below is editable on the parcel page and shows its source label.
            </p>
            <h3>Costs</h3>
            <ul>
              <li>
                <strong>Construction:</strong> the cost to build per finished square foot, with the builder&apos;s fee removed: published Pittsburgh builder
                ranges divided by about 1.20 (NAHB 2024 builder overhead and profit). Tiers: {tiers.map((t) => `${t.label} ${usd(t.costPerSf.value)} (${usd(t.costPerSf.range[0]!)}–${usd(t.costPerSf.range[1]!)}; published retail ${usd(t.retail.range[0]!)}–${usd(t.retail.range[1]!)})`).join(", ")}.
                The default is {defaultTier.label}, {usd(defaultTier.costPerSf.value)}.
              </li>
              <li>
                <strong>Hillside adders</strong> fire from the lidar slope under the building footprint (the lot&apos;s average slope when there is no footprint yet):
                over {costs.lineModel.slopeOverPct}%, {usd(costs.siteAdders.moderateSlope.value)} per square foot of footprint; {costs.lineModel.steepPct}% or more,{" "}
                {usd(costs.siteAdders.steepSlope.value)} per square foot of footprint plus {usd(costs.siteAdders.retainingWalls.value)} of retaining walls per building, each with the reason shown.
                Water and sewer laterals: {usd(costs.siteAdders.waterSewerLateral.value)} per house ({costs.siteAdders.waterSewerLateral.sourceLabel.toLowerCase()}).
              </li>
              <li><strong>Undermined lots:</strong> the mine grouting or mine subsidence insurance path; the premium comes from the PA DEP rate chart.</li>
              <li>
                <strong>Soft costs:</strong> architecture and design {pct(costs.softCosts.architectureEngineering.value)} of hard cost, at least {usd(costs.softCosts.architectureEngineering.min)};
                structural engineer {usd(costs.lineModel.structural.value)} when the slope under the building is over {costs.lineModel.slopeOverPct}%;
                civil and grading plan {usd(costs.lineModel.civil.value)} when about {costs.lineModel.civil.disturbanceSfMin.toLocaleString("en-US")} sq ft or more is disturbed or the site is steep;
                survey {usd(costs.lineModel.survey.value)}; geotechnical report {usd(costs.lineModel.geotech.hillsideOrLandslide)} (landslide-prone or steep) or {usd(costs.lineModel.geotech.underminedOnly)} (undermined only);
                builder&apos;s risk and liability insurance {pct(costs.lineModel.insurance.value)} of hard cost; title and closing {pct(costs.lineModel.titleClosing.value)} of the land price.
              </li>
              <li>
                <strong>Permits:</strong> inside the City, the PLI 2026 fee schedule ({usd(costs.softCosts.pittsburghBuildingPermitFee.value)} per $1,000 of construction value,
                minimum {usd(costs.softCosts.pittsburghBuildingPermitFee.min)}, maximum {usd(costs.softCosts.pittsburghBuildingPermitFee.max)}, plus electrical, mechanical and
                certificate of occupancy) and Pittsburgh Water {usd(costs.softCosts.pittsburghBuildingPermitFee.pittsburghWater)}. Outside the City, a flat{" "}
                {usd(costs.softCosts.permitsAndFees.flatPerHouse)} per house for permits and tap-in fees, flagged &ldquo;confirm with the municipality.&rdquo;
              </li>
              <li>
                <strong>Contingency:</strong> {pct(costs.contingency.flat.value)} of hard and site cost; {pct(costs.contingency.hillside.value)} in the landslide-prone
                overlay or on a steep site; {pct(costs.contingency.rehab.value)} for a rehab.
              </li>
              <li>
                <strong>Financing:</strong> construction loan at {pct(costs.financing.constructionRate.value)}, interest-only,{" "}
                {pct(costs.financing.loanToCost.value)} of cost, with {pct(costs.financing.averageDrawShare.value)} of the loan drawn on average over{" "}
                {costs.financing.constructionMonths.single.value} months for one home; lender fees {pct(costs.financing.loanFeeShare.value)} of the loan.
              </li>
              <li>
                <strong>Sale and taxes:</strong> no sales commissions; the seller&apos;s half of the realty transfer tax (City {costs.sale.transferTax.cityPct}% total,
                {" "}{costs.sale.transferTax.cityBaldwinWhitehallPct}% in the Baldwin-Whitehall School District, elsewhere the municipality&apos;s rate). Property taxes while
                holding use the City&apos;s 2026 total of {costs.propertyTax.cityMills.value} mills ({costs.propertyTax.cityMills.sourceLabel.replace(/^2026 millage: /, "")}).
              </li>
              <li>
                <strong>Items with no local cost yet</strong> (demolition, dumpsters and street permit) are listed as &ldquo;Not
                included&rdquo; and the estimate is marked partial. They are never counted as zero.
              </li>
              <li><strong>{costs.disclaimer}</strong></li>
              <li>{costs.construction.rehabNote}</li>
            </ul>
            <h3>Ranges</h3>
            <p>
              Every cost line and total is shown as low to high with a likely figure, rounded to $1,000 per line and $10,000 for totals. Cost
              ranges come from each input&apos;s documented range (builder tiers, site adders, soft-cost shares). The sale value range is the 25th to
              75th percentile of the comparable sales per square foot when there are at least {assumptions.MIN_COMPS_FOR_PERCENTILES} of them,
              otherwise &plusmn;{Math.round(assumptions.VALUE_FALLBACK_SHARE * 100)}%, labeled as an assumption. {assumptions.RANGE_METHOD}
            </p>
            <h3>The verdict</h3>
            <p>
              For a home built to sell: profit = sales − total cost − selling costs. If profit is zero or less, the answer is <strong>No</strong>.
              If the margin on cost is under {pct(costs.pencils.thinMarginBelow.value)}, it is <strong>Barely</strong>. Otherwise <strong>Yes</strong>.
              For a rental the page stops at yield on cost, because there is no local market cap rate to judge it against yet.
              The math is written out as sentences, for example &ldquo;sales − total cost − selling costs = profit.&rdquo;
            </p>
            <p>
              Totals are checked against recent Allegheny County projects as a sanity check, never as defaults.
            </p>
            <h3>Backtest</h3>
            <p>
              We tested our cost model against 518 homes that were actually built and sold in Allegheny County since 2020 (3 sales under $100 per
              square foot were set aside as likely non-market, leaving 515). Our earlier model&apos;s cost estimates ran a median 53% above what those
              homes actually sold for. The current model is roughly break-even on single-lot infill homes (96 homes; median margin −0.6%). Because
              real builders earned a profit on those homes, our estimates are likely conservative. Subdivision homes built by large production
              builders on pre-graded lots cost less to build than one-off infill (419 homes; 78% show a loss under our costs), so EaseScore is not
              calibrated for them.
            </p>
            <p className="text-sm text-slate-600">
              Method: new single-family homes, townhouses and rowhouses built in 2020 or later, each at its first valid sale after completion (at least
              $75,000 and 600 sq ft). The engine prices each home with its own size, lot, slope, overlays, taxes and land estimate, and uses its actual
              sale price as the value. Margin = (sale price − selling costs − our total cost) ÷ our total cost; a loss means our total cost is above
              what the home sold for, net of selling costs.
            </p>
          </section>

          <section id="comps" aria-labelledby="comps-h">
            <h2 id="comps-h">How homes are valued</h2>
            <h3>New construction</h3>
            <p>
              A new home is valued only from sales of new homes: valid arm&apos;s-length sales in the last {nc.years} years of homes built no more than{" "}
              {nc.maxAgeAtSaleYears} years before the sale, at least {nc.minLivingAreaSqft.toLocaleString("en-US")} sq ft and {usd(nc.minPrice)}, nearest first.
              We need at least {nc.minComps}, widening the search from ¼ mile to {nc.radiiMi[nc.radiiMi.length - 1]} miles and saying how far it went.
              Sales in the same City neighborhood (or municipality) are used alone when there are at least {nc.selection.sameAreaMinComps}; otherwise
              market-tier areas (below). We widen until {nc.selection.nearestMin} sales, keep the nearest {nc.selection.nearestMax}, and drop sales whose price per
              square foot is beyond {nc.selection.outlierIqrMultiplier}× the middle-half spread; dropped sales are listed with the reason. When the
              lot&apos;s own area has too few new sales, comps come only from areas in the same market tier or lower, never a richer one: the median price per square foot of
              existing-home sales there is no higher than the lot&apos;s area and at most {Math.round(nc.selection.tierBand * 100)}% below it (an assumption you can edit;
              at least {nc.selection.tierMinSales} sales in {nc.selection.tierYears} years, else {nc.selection.tierYearsFallback} years; an area still
              without a tier borrows the median tier of its {nc.selection.tierNeighbors} nearest areas). This is the way appraisers pick
              comparable neighborhoods; no income, race or other demographic data is used. If too few sales qualify, any lower-priced area is
              allowed; if there are still too few, no value is estimated — sales from richer markets nearby are never used just because they are close.
              Comps are kept within &plusmn;{Math.round(nc.selection.sizeBand * 100)}% of the planned home&apos;s size when enough remain.
            </p>
            <p>
              When there are too few, the value is left blank. Older-home prices are then shown only as a labeled floor, never as the value of a new build.
            </p>
            <h3>After-repair value (rehab)</h3>
            <p>
              A rehab is valued from nearby valid sales of the same use in Good, Very Good or Excellent condition (county assessment rating),
              with living area within {pct(arv.livingAreaTolerance)} of the building. We need at least {arv.minComps}; with fewer, all
              Good-or-better sales nearby are used with a note. As-is sales of older homes are not used as the value after a rehab.
            </p>
          </section>

          <section id="planner" aria-labelledby="planner-h">
            <h2 id="planner-h">How the Planner ranks a parcel</h2>
            <p>
              A parcel&apos;s rank uses its best strategy that <strong>adds</strong> homes: new single-family, duplex, 3&ndash;4 units,
              townhouse row, or ADU. A rehab of the existing building is shown alongside, never in place of it. ADU only becomes
              the ranked option when no other strategy has a zoning answer &mdash; ADU zoning is not transcribed yet, so without this
              rule ADU would float to the top of most parcels on missing data, not on merit. Outside the City, where no zoning is
              loaded at all, the same rule applies: the best of single-family, duplex, 3&ndash;4 units or townhouse ranks the parcel,
              and ADU only stands in when none of them has an answer.
            </p>
            <p>
              <strong>Blockers</strong> are the factors and callouts actually holding the ranked strategy back: every red flag, a v0.2
              hazard band cap, then the first factor losing at least one score point and any other losing at least two. A data gap
              (for example, sewer service marked unknown) is never listed as a blocker &mdash; missing evidence is not the same as a
              problem. &ldquo;Only blocked by X&rdquo; on the filter rail means every one of a parcel&apos;s blockers is in the set X.
            </p>
            <p>
              Each blocker can link to a <Link href="/policy">Policy</Link> scenario that would relax it &mdash; a minimum-lot-size or
              lot-too-small blocker links to no minimum lot size, a parking blocker links to no parking minimum near transit, and a
              use-not-permitted, special-exception, conditional-use or too-small-to-fit blocker links to attached homes by right on
              narrow lots. When several of a parcel&apos;s blockers have a lever, the link combines them. Setbacks and slope have no
              lever yet, so they carry no link.
            </p>
          </section>

          <section id="policy" aria-labelledby="policy-h">
            <h2 id="policy-h">Policy levers</h2>
            <p>
              A lever never changes the engine. It rewrites the zoning-rules row a parcel is scored with, only for the parcels it
              applies to; with every lever off, a parcel scores exactly as it does on its own parcel page. Six levers, defined
              exactly as the code applies them:
            </p>
            <ul>
              <li>
                <strong>Attached homes by right on narrow lots.</strong> On existing single-unit lots (districts R1D and R1A) at or
                under a chosen width, a side-by-side attached pair becomes permitted by right; in R1D, the existing townhouse-row
                width limit also rises to that width when it is currently lower. Parks (district P) are excluded from every lever.
              </li>
              <li>
                <strong>Minimum lot size.</strong> A district&apos;s minimum lot area and minimum lot area per unit are scaled down to
                a chosen share of the current number (0% removes the minimum).
              </li>
              <li>
                <strong>Parking minimums.</strong> Off, none within a quarter mile of a frequent-transit stop (the Ease Score&apos;s own
                transit test), or none anywhere.
              </li>
              <li>
                <strong>ADUs by right.</strong> One accessory dwelling unit (up to 800 sq ft, a scenario setting: our zoning table has
                no ADU rules) beside a detached single-family house in R1D, R1A, R2, R3 and RM. It is counted as one more home per
                eligible lot, not rescored. The low end counts only lots where an area check (lot area minus the house footprint and
                the front yard) holds the smallest ADU, 14 &times; 16 ft, with the district&apos;s side and rear yards and 10 ft from
                the house &mdash; a labeled proxy, since the lot-fit test has no priced ADU path. Its pencil test prices 800 sq ft at
                nearby new-construction prices with no land cost. When another lever also adds homes on the lot, the path with more
                homes counts, never both.
              </li>
              <li>
                <strong>Contextual front setback.</strong> In the same residential districts, the front setback becomes the
                neighbors&apos; average by right. Neighboring buildings are not measured; the engine&apos;s own contextual-setback
                assumption (5 ft, the value every parcel page uses for &sect;925.06) stands in for it. Because the baseline already
                credits that setback where a lot needs it, by-right gains are small.
              </li>
              <li>
                <strong>One more story.</strong> In the same residential districts, the height limit rises by one story and 10 ft.
                The lot-fit test&apos;s building types top out at three stories (placeholder sizes), so where a district already allows
                three this lever cannot add homes in the model; its result is a floor.
              </li>
            </ul>
            <p>
              <strong>Capacity</strong> is shown as a range: the low end counts only homes needing no lot split, the likely figure
              counts every lot-fit gain the batch could test, and the high end adds lots that ran past the per-parcel time budget,
              estimated at the average gain. Capacity is how many homes a rule change would allow by right, not how many would get
              built.
            </p>
            <p>
              <strong>The pencil test</strong> is a screening test, not an underwriting: sale price per square foot from at least five
              nearby new-construction sales, construction cost from the &ldquo;{tiers.find((t) => t.id === costs.construction.defaultTier)?.label}&rdquo; tier
              range in the same cost-assumptions config the Developer pro forma uses, land at the county&apos;s assessed value, and a{" "}
              {pct(costs.pencils.thinMarginBelow.value)} margin floor. It never runs financing, absorption or a hold period.
            </p>
            <p>
              <strong>The fiscal ledger</strong> multiplies a new home&apos;s added assessed value by each taxing body&apos;s current
              millage (county, municipality, school district). Assessed value is estimated as sale value times the county&apos;s
              assessment ratio for recent new-construction sales, minus the assessed value of anything the new home replaces. A tax
              abatement lever, where turned on, is illustrative and fiscal-only: it does not change how many homes a rule allows or
              whether they pencil.
            </p>
          </section>

          <section id="nonprofit" aria-labelledby="nonprofit-h">
            <h2 id="nonprofit-h">Nonprofit affordability math</h2>
            <p>
              <strong>Rent limits</strong> follow HUD Income Limits and the LIHTC 30% rule: household size is imputed at{" "}
              {capital.rentRule.personsPerBedroom.value} persons per bedroom (1 for an efficiency), the income limit for that
              household size at the chosen AMI band is looked up (30% and 50% and 80% are HUD&apos;s published limits; 60% is{" "}
              {capital.rentRule.sixtyPctFactor.value}&times; the 50% limit, HUD&apos;s Multifamily Tax Subsidy convention), and the
              maximum gross rent is {pct(capital.rentRule.incomeShare.value)} of that income divided by 12. A placeholder tenant-paid
              utility allowance by bedroom count (labeled &ldquo;{capital.utilityAllowance.sourceLabel}&rdquo;) is subtracted from gross
              rent to get the rent the project collects.
            </p>
            <p>
              <strong>Need</strong> compares households at or below 50% of the area median (HUD CHAS, all tenures) against the count of
              rental units in the tract already affordable at that band; the receipt labels this comparison rough.
            </p>
            <p>
              <strong>The funding gap</strong> is total development cost, from the same pro forma the Developer seat uses, minus the
              permanent loan the restricted rents can support (net operating income &divide; a debt-coverage ratio &divide; the annual
              payment per dollar borrowed). Turning a capital source on subtracts its typical amount &mdash; labeled &ldquo;Typical, not
              an award&rdquo; &mdash; from the remaining gap, capped at what is left. Every source&apos;s eligibility checks (AMI limits,
              tenure, site, minimum project size) run in plain words before its amount is offered.
            </p>
            <p>
              <strong>Cost</strong> comes from the same precomputed site-fit layout the Developer parcel page prices when one exists for
              the lot; otherwise it falls back to a labeled standard program (homes sized by bedroom count as floors over the lot&apos;s
              buildable footprint), never a live, unpriced guess.
            </p>
          </section>

          <section id="words" aria-labelledby="words-h">
            <h2 id="words-h">The plain-English layer</h2>
            <p>
              The parcel page answers four questions (Can you build here? Does it pencil? What&apos;s in the way? What next?) and gives a
              two-sentence summary: what the lot allows by right, and what might be possible with zoning relief.
            </p>
            <ul>
              <li>The engine writes a template sentence for every answer from the computed results.</li>
              <li>An AI model may reword those sentences to read more naturally, using only the computed data.</li>
              <li>A validator rejects any sentence that contains a number not found in that data, and the template is shown instead.</li>
              <li>How nearby Zoning Board precedent is described is fixed by the counts, not chosen by the model.</li>
            </ul>
            <p>
              Full details are on the <Link href="/ai-use">AI tools used</Link> page.
            </p>
          </section>

          <section id="sources" aria-labelledby="sources-h">
            <h2 id="sources-h">Sources</h2>
            <p>
              Parcels, assessments and sales from Allegheny County via WPRDC; zoning, hazard overlays, permits and Zoning Board decisions from the
              City of Pittsburgh; flood maps from FEMA; lidar from USGS; mine, water-service and cleanup records from PA DEP; neighborhood data from
              the U.S. Census Bureau; transit from Pittsburgh Regional Transit. Each report lists the source and date behind every number.
            </p>
            <p>
              The full list with licenses and access dates is in the project&apos;s{" "}
              <a href="https://github.com/PlexionDev/easescore/blob/main/SOURCES.md">sources ledger</a> and{" "}
              <a href="https://github.com/PlexionDev/easescore/blob/main/docs/DATA.md">data inventory</a>. Gaps are on the{" "}
              <Link href="/limitations">Limitations</Link> page.
            </p>
            <p className={d.fine}>
              Decision support only, not legal, financial, zoning or engineering advice. Confirm zoning with the permitting office, costs with local bids, and financing with your lender.
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
