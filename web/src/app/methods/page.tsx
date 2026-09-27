import type { Metadata } from "next";
import Link from "next/link";
import ease from "@easescore/engine/config/ease-score.v0.2.json";
import costs from "@easescore/engine/config/cost-assumptions.v0.1.json";
import { assumptions } from "@easescore/engine";
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
              <li>Seven factors are scored 0 to 100 and combined with fixed weights into the Development Ease Score. Higher means easier.</li>
              <li>Deal-breakers are shown as red flags above the score. Serious but workable issues become &ldquo;Review required&rdquo; callouts.</li>
              <li>Money is kept separate: the pro forma answers &ldquo;does it pencil?&rdquo; from costs and nearby sales.</li>
              <li>Plain-English sentences are written from those computed results. Nothing in them is new information.</li>
            </ol>
            <p className={d.muted}>The score measures how hard a site is to develop, not whether to buy it.</p>
          </section>

          <section id="factors" aria-labelledby="factors-h">
            <h2 id="factors-h">Seven factors</h2>
            <p>
              Score = the sum of (weight × factor score) over the factors that have data, divided by the sum of those weights.
              The weights add up to {totalWeight}.
            </p>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
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
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead><tr><th scope="col">Band</th><th scope="col" className={d.num}>Score</th></tr></thead>
                <tbody>
                  {ease.bands.map((b, i) => {
                    const upper = i === 0 ? 100 : ease.bands[i - 1]!.min - 1;
                    return (
                      <tr key={b.band}><th scope="row">{b.band}</th><td className={d.num}>{b.min}–{upper}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h3>Zoning permission</h3>
            <p>Use permission comes from the City&apos;s §911.02 Use Table. The permission score is multiplied by the lot-fit factor.</p>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
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
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
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
              not a quote. No geotechnical report cost is set; get quotes from a geotechnical engineer.
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
                <strong>Construction:</strong> five tiers from published Pittsburgh builder ranges, per finished square foot
                ({tiers.map((t) => `${t.label} ${usd(t.costPerSf.value)}`).join(", ")}). The default is {defaultTier.label}, {usd(defaultTier.costPerSf.value)}.
              </li>
              <li>
                <strong>Hillside adders</strong> fire from the lidar slope: moderate slope {usd(costs.siteAdders.moderateSlope.value)} and steep slope{" "}
                {usd(costs.siteAdders.steepSlope.value)} per finished square foot, each with the reason shown.
              </li>
              <li><strong>Undermined lots:</strong> the mine grouting or mine subsidence insurance path; the premium comes from the PA DEP rate chart.</li>
              <li>
                <strong>Soft costs:</strong> architecture and engineering {pct(costs.softCosts.architectureEngineering.value)} of hard cost; the Pittsburgh
                building permit fee at {usd(costs.softCosts.pittsburghBuildingPermitFee.value)} per $1,000 of construction value; survey, title, legal and
                insurance {pct(costs.softCosts.surveyTitleLegalInsurance.value)}.
              </li>
              <li>
                <strong>Contingency:</strong> {pct(costs.contingency.flat.value)} on a flat lot, {pct(costs.contingency.hillside.value)} on a hillside or
                hazard site, {pct(costs.contingency.rehab.value)} for a rehab.
              </li>
              <li>
                <strong>Financing:</strong> construction loan at the Bank Prime Loan Rate plus {pct(costs.financing.rateSpreadOverPrime.value)},
                {" "}{pct(costs.financing.loanToCost.value)} of cost, with {pct(costs.financing.averageDrawShare.value)} of the loan drawn on average.
              </li>
              <li>
                <strong>Items with no local cost yet</strong> (demolition, geotechnical report, dumpsters and street permit) are listed as &ldquo;Not
                included&rdquo; and the estimate is marked partial. They are never counted as zero.
              </li>
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
          </section>

          <section id="comps" aria-labelledby="comps-h">
            <h2 id="comps-h">How homes are valued</h2>
            <h3>New construction</h3>
            <p>
              A new home is valued only from sales of new homes: valid arm&apos;s-length sales in the last {nc.years} years of homes built no more than{" "}
              {nc.maxAgeAtSaleYears} years before the sale, at least {nc.minLivingAreaSqft.toLocaleString("en-US")} sq ft and {usd(nc.minPrice)}, nearest first.
              We need at least {nc.minComps}, widening the search from ¼ mile to {nc.radiiMi[nc.radiiMi.length - 1]} miles and saying how far it went.
              Sales in the same City neighborhood (or municipality) are used alone when there are at least {nc.selection.sameAreaMinComps}; otherwise the
              nearest by distance. We widen until {nc.selection.nearestMin} sales, keep the nearest {nc.selection.nearestMax}, and drop sales whose price per
              square foot is beyond {nc.selection.outlierIqrMultiplier}× the middle-half spread; dropped sales are listed with the reason. When the
              lot&apos;s own area has too few new sales, comps come only from areas in the same market tier: the median price per square foot of
              existing-home sales there is within &plusmn;{Math.round(nc.selection.tierBand * 100)}% of the lot&apos;s area (an assumption you can edit;
              at least {nc.selection.tierMinSales} sales in {nc.selection.tierYears} years, else the tier is unknown). This is the way appraisers pick
              comparable neighborhoods; no income, race or other demographic data is used. If too few sales qualify, the nearest sales are used and the
              receipt says so.
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
