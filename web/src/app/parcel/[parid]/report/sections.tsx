// Sections of the Feasibility Study. Each section is a plain function (not a component) so that it
// runs eagerly, in document order: footnote numbers, figure numbers and table numbers are assigned
// in reading order, and the same inputs always give the same numbering.

import type { ReactNode } from "react";
import { assumptions, finance, PHASE_ORDER, quickfit, type RequirementResult } from "@easescore/engine";
import type { CiteRegistry } from "@/lib/report/cite";
import type { ReportModel } from "@/lib/report/load";
import { STRATEGY_LABEL } from "@/lib/report/load";
import { CapitalStack, CompsScatter, LotPlan, PhaseSequence, SlopeBar, Tornado, TornadoPending } from "@/lib/report/charts";
import { absorption, abatementScenario, sourcesUses } from "@/lib/report/extras";
import { narrative, score as ease } from "@easescore/engine";
import { approvalItems, dataGaps, longDate, money, nextSteps, num, pct, redFlags, reviewItems, sqft, titleCase, type Finding } from "@/lib/report/assess";
import { NOT_RECORDED } from "@/lib/report/sources";
import { DecisionBlock, TaxesAfterBlock, UnitSelloutBlock } from "./decision";
import { CompsGrid, ConfidenceGrades } from "./evidence";

export interface Ctx {
  m: ReportModel;
  c: CiteRegistry;
  fig: () => number;
  tab: () => number;
  /** Rendering for the downloadable PDF: full rent-comp street addresses (on screen: block level only). */
  print?: boolean;
}

/** Screen address for a sale: "1200 block of Smith St" (full street addresses only in the PDF). */
const blockText = (address: string | null | undefined) => {
  if (!address) return "";
  const b = assumptions.blockLevelAddressOf(address);
  const m = /^(.*block of )(.+)$/.exec(b);
  return m ? `${m[1]}${titleCase(m[2])}` : titleCase(b);
};

export const REPORT_VERSION = "report v0.1";
const PENCILS_TEXT: Record<string, string> = { yes: "Yes", thin: "Barely", no: "No" };
export const DISCLAIMER = "Decision support — not legal, financial, or engineering advice.";

// Small helpers -----------------------------------------------------------------------------------

/** Footnote marker. Called as a function so the number is assigned right here, in reading order. */
const fn = (x: Ctx, ...keys: string[]) => <sup className="fn">[{keys.map((k) => x.c.ref(k)).join(", ")}]</sup>;


/** A numbered section. `flow` sections continue on the same page when there is room. */
function Sec({ id, no, title, flow, children }: { id: string; no: string; title: string; flow?: boolean; children: ReactNode }) {
  return (
    <section className={`sec ${flow ? "flow" : "page-break"}`} id={id}>
      <h1>
        <span className="secno">{no}</span>
        {title}
      </h1>
      {children}
    </section>
  );
}

function Callout({ tone, title, children }: { tone: "red" | "amber" | "pending" | "plain"; title: string; children?: ReactNode }) {
  return (
    <div className={`callout ${tone === "plain" ? "" : tone}`}>
      <div className="callout-title">{title}</div>
      {children}
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  due_diligence: "Due diligence",
  design_engineering: "Design & engineering",
  zoning: "Zoning",
  permits: "Permits",
  construction: "Construction",
  closeout: "Closeout",
};
const STATUS_TEXT: Record<string, string> = { REQUIRED: "Required", LIKELY: "Likely", POSSIBLE: "Possible", ASK: "Ask", NOT_NEEDED: "Not needed" };
const PERMISSION_TEXT: Record<string, string> = {
  P: "Allowed by right",
  S: "Special exception (Zoning Board hearing)",
  C: "Conditional use (Planning Commission and City Council)",
  A: "Administrator exception (zoning staff)",
  N: "Not permitted",
};
const RELIEF_TEXT: Record<string, string> = {
  dimensional_variance: "Dimensional variance",
  use_variance: "Use variance",
  variance: "Variance",
  special_exception: "Special exception",
  conditional_use: "Conditional use",
  dimensional: "Dimensional relief",
  other: "Other relief",
};

/** Turn engine input names ("hardCostPerSqFt") into plain words ("hard cost per sq ft"). */
function plainInput(name: string): string {
  const special: Record<string, string> = {
    land: "land price",
    grossSqFt: "gross sq ft",
    hardCostPerSqFt: "hard cost per sq ft",
    tdc: "total development cost",
    egi: "effective gross income",
    noi: "net operating income",
    salePrice: "sale price",
    monthlyRent: "monthly rent",
    ltc: "loan-to-cost",
  };
  return name.replace(/unitMix\[\d+\]\./g, "").replace(/[A-Za-z][A-Za-z0-9.]*(\[\d+\])?/g, (w) => {
    if (special[w]) return special[w]!;
    const last = w.split(".").at(-1)!.replace(/\[\d+\]/, "");
    if (special[last]) return special[last]!;
    return last
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/Sq Ft/i, "sq ft")
      .toLowerCase()
      .replace(/\bltv\b/, "loan-to-value")
      .replace(/\bltc\b/, "loan-to-cost")
      .replace(/\begi\b/, "effective gross income")
      .replace(/\bnoi\b/, "net operating income");
  });
}

type Kind = "money" | "share" | "ratio" | "months" | "years" | "count";
function receiptValue(r: finance.Receipt, kind: Kind): ReactNode {
  if (r.status === "ok") {
    const v = r.value;
    const s =
      kind === "money" ? money(v) : kind === "share" ? pct(v, 1) : kind === "ratio" ? `${num(v, 2)}×` : kind === "months" ? `${num(v)} months` : kind === "years" ? `${num(v, 1)} years` : num(v);
    return <b>{s}</b>;
  }
  if (r.status === "not computable") return <span className="muted">Not computable: {r.reason}</span>;
  const miss = r.missing.map(plainInput);
  return (
    <span className="assume">
      Needs {miss.slice(0, 3).join("; ")}
      {miss.length > 3 ? ` (+${miss.length - 3} more)` : ""}
    </span>
  );
}

function receiptRows(rows: [finance.Receipt, Kind][]) {
  return rows.map(([r, k], i) => (
    <tr key={`${r.label}-${i}`}>
      <td>{r.label}</td>
      <td className="small muted">{r.formula}</td>
      <td style={{ width: "34%" }}>{receiptValue(r, k)}</td>
    </tr>
  ));
}

const overlay = (m: ReportModel, layer: string) => m.facts.overlays?.find((o) => o.layer === layer && o.share > 0);

/** Plain list of what a scheme needs (use permission and dimensional relief). */
function blockers(s: quickfit.Scheme): string {
  const items = s.approvals.map((a) => a.label.replace(/\.$/, "").toLowerCase());
  if (s.permission.code === "N") items.unshift(`a use that is not permitted here (${s.permission.use})`);
  return items.length ? items.join("; ") : `relief it could not identify (${s.binding.label.toLowerCase()})`;
}

function schemeLabel(m: ReportModel): string {
  const s = m.scheme;
  if (!s) return "No scheme found";
  return `${s.typologyLabel}, ${s.units} unit${s.units > 1 ? "s" : ""}, ${s.stories} stories, new construction`;
}

// ---------------------------------------------------------------------------------------------
// Cover and contents

export function Cover(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const a = f.assessment;
  const hero = m.images.context ?? m.images.analysis;
  return (
    <section className="cover" id="cover">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/easescore-logo-stacked.svg" alt="EaseScore.AI" className="brand" />
      <div className="doctype">Development Feasibility Study</div>
      <h1>{titleCase(a?.address) || m.parid}</h1>
      <div className="sub">
        {f.context?.neighborhood ? `${f.context.neighborhood}, ` : ""}
        {titleCase(f.context?.municipality ?? a?.municipality)}, Pennsylvania
      </div>
      <div className="meta">
        <div>
          <div className="k">Parcel ID</div>
          {m.parid}
        </div>
        <div>
          <div className="k">Zoning</div>
          {f.zoning?.code ? `${f.zoning.code} — ${titleCase(f.zoning.type)}` : "Not loaded for this municipality"}
        </div>
        <div>
          <div className="k">Date</div>
          {longDate(m.generatedDate)}
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <div className="k">Scenario studied</div>
          {m.scheme ? schemeLabel(m) : "No building placed by the site-fit solver"}
          {m.scheme ? (m.scenario.tenure === "rent" ? ", to rent" : ", for sale") : ""}
          {m.scenario.affordable ? ", affordable mode" : ""}
        </div>
        <div>
          <div className="k">Lot</div>
          {sqft(f.lot_area_sqft_gis ?? a?.lot_area_sqft)}
        </div>
      </div>
      <div className="hero">
        {hero ? (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero} alt="Captured map view of the parcel" className="frame" />
            <figcaption>Captured map view.</figcaption>
          </figure>
        ) : m.qfInput?.parcel?.length ? (
          <figure>
            <div className="frame">
              <LotPlan
                parcel={m.qfInput.parcel}
                envelope={(m.qf?.envelope.polygons ?? []) as [number, number][][][]}
                footprints={(m.scheme?.footprints ?? []) as [number, number][][]}
                masks={m.qfInput.masks}
                frontEdges={m.qfInput.frontEdges}
              />
            </div>
            <figcaption>Lot plan with the buildable area and the studied footprint. The true-scale site plan is sheet EA-101 in Section 3.</figcaption>
          </figure>
        ) : (
          <div className="slot">Map figure: use “Capture view” in the app to add one.</div>
        )}
      </div>
      <p className="disclaimer">
        {DISCLAIMER} This study screens a parcel with public data and published rules. It is not an appraisal, a zoning determination, a survey or an
        engineering report. Every number is footnoted to its source in Appendix A. Costs are editable defaults with a source label on each; values
        marked “not included” or “awaiting” are not yet known and are never filled with guesses. Prepared by the EaseScore.AI engine · {REPORT_VERSION}.
      </p>
    </section>
  );
}

export const TOC_ENTRIES: { id: string; no: string; title: string; app?: boolean }[] = [
  { id: "s1", no: "1", title: "Summary in plain English" },
  { id: "s2", no: "2", title: "Project scenario" },
  { id: "s3", no: "3", title: "Site analysis" },
  { id: "s4", no: "4", title: "Zoning and approvals" },
  { id: "s5", no: "5", title: "Process and timeline" },
  { id: "s6", no: "6", title: "Market analysis" },
  { id: "s7", no: "7", title: "Development budget" },
  { id: "s8", no: "8", title: "Operations (if rented)" },
  { id: "s9", no: "9", title: "Financing and returns" },
  { id: "s10", no: "10", title: "Affordable scenario" },
  { id: "s11", no: "11", title: "Sensitivity and scenarios" },
  { id: "s12", no: "12", title: "Risks and mitigations" },
  { id: "s13", no: "13", title: "Conclusion and next steps" },
  { id: "s14", no: "14", title: "Limiting conditions" },
  { id: "appA", no: "A", title: "Sources and data dates", app: true },
  { id: "appB", no: "B", title: "Methods and formulas", app: true },
  { id: "appC", no: "C", title: "Assumptions used", app: true },
  { id: "appD", no: "D", title: "Ease Score breakdown", app: true },
  { id: "appE", no: "E", title: "Limitations", app: true },
  { id: "appF", no: "F", title: "Glossary", app: true },
];

export function Contents() {
  const row = (e: (typeof TOC_ENTRIES)[number]) => (
    <li key={e.id} className={e.app ? "app" : ""}>
      <span className="no">{e.no}</span>
      <a href={`#${e.id}`}>{e.title}</a>
      <span className="dots" />
      <span className="pg" data-toc={e.id} />
    </li>
  );
  return (
    <section className="toc page-break" id="toc">
      <h2 style={{ fontSize: "16pt", marginTop: 0 }}>Contents</h2>
      <ol>{TOC_ENTRIES.filter((e) => !e.app).map(row)}</ol>
      <div className="group">Appendices</div>
      <ol>{TOC_ENTRIES.filter((e) => e.app).map(row)}</ol>
      <h3 style={{ marginTop: "0.4in" }}>How to read this study</h3>
      <p className="small">
        Numbers in brackets, like <sup className="fn">[3]</sup>, point to the numbered source list in Appendix A, which gives each source’s publisher and
        data date. Amber boxes are items that need review; red boxes are red flags (only three things count: floodway, no legal access, or a
        contamination site on the lot). Dashed gray boxes mark results that cannot be computed yet, with the reason. Words in the glossary (Appendix F) are
        explained in plain English.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Summary

export function S1(x: Ctx) {
  const { m } = x;
  // The decision box comes first on the page, so its tables and footnotes are numbered first.
  const decision = DecisionBlock(x);
  const s = m.scheme;
  const flags = redFlags(m);
  const reviews = reviewItems(m);
  const approvals = approvalItems(m);
  // Ranked by decision impact: blockers, then approvals that can fail, then hazard reviews, then money risks.
  const moneyRisks: Finding[] = (m.proForma.narrative?.risks ?? []).map((t) => ({ title: t.split(",")[0]!.replace(/\.$/, ""), reason: t, mitigation: "", sources: ["cost_config"] }));
  const barriers: Finding[] = [...flags, ...(s && !s.byRight ? approvals : []), ...reviews, ...moneyRisks].slice(0, 3);
  const steps = nextSteps(m);
  const zone = m.facts.zoning?.code;

  let canBuild: ReactNode;
  if (!s)
    canBuild = (
      <p>
        {m.closest ? (
          <>
            Not by right. The closest new building our site-fit check found, a {m.closest.typologyLabel.toLowerCase()}, would need{" "}
            {blockers(m.closest)}
            {fn(x, "quickfit", "zoning_rules")}.
          </>
        ) : (
          <>Not shown yet. {m.qfError ?? "No building type fit inside the setbacks and rules for this district."}{fn(x, "quickfit")}</>
        )}
        {m.score.status === "ready" ? ` The Ease Score looks at other paths too; its best is ${m.score.strategyLabel.toLowerCase()} (Appendix D).` : ""}
      </p>
    );
  else if (s.byRight)
    canBuild = (
      <p>
        Yes, on paper. A {s.typologyLabel.toLowerCase()} with {s.units} unit{s.units > 1 ? "s" : ""} fits by right under {zone} zoning{fn(x, "zoning", "zoning_rules")}, based on our site-fit
        check{fn(x, "quickfit")}.{s.needsSubdivision ? " It would need the lot split into one lot per home." : ""}{reviews.length ? ` ${reviews.length} item${reviews.length > 1 ? "s" : ""} still need${reviews.length > 1 ? "" : "s"} review (see below).` : ""}
      </p>
    );
  else
    canBuild = (
      <p>
        Possibly. A {s.typologyLabel.toLowerCase()} with {s.units} unit{s.units > 1 ? "s" : ""} fits the lot{fn(x, "quickfit")}, but it needs{" "}
        {s.approvals.map((a) => a.label.toLowerCase()).join(", ") || "an approval"} under {zone} zoning{fn(x, "zoning_rules")}.
      </p>
    );

  return (
    <Sec id="s1" no="1" title="Summary in plain English">
      {decision}
      <p className="lead">
        {s ? (
          <>
            This study looks at building <b>{schemeLabel(m).toLowerCase()}</b> on the {sqft(m.facts.lot_area_sqft_gis)}
            {fn(x, "parcels")} lot at {titleCase(m.facts.assessment?.address)}
            {m.facts.context?.neighborhood ? ` in ${m.facts.context.neighborhood}` : ""}.
          </>
        ) : (
          <>
            This study looks at the {sqft(m.facts.lot_area_sqft_gis)}
            {fn(x, "parcels")} lot at {titleCase(m.facts.assessment?.address)}
            {m.facts.context?.neighborhood ? ` in ${m.facts.context.neighborhood}` : ""}. Our site-fit solver could not place a building here, so
            sections that depend on a building say so.
          </>
        )}
      </p>

      {m.plans && (
        <div className="callout">
          <div className="callout-title">In two sentences</div>
          <p>{m.plans.summary.text}{fn(x, "ease_score", "cost_config", "zba")}</p>
          <p className="small muted">{narrative.SUMMARY_FINE_PRINT}</p>
        </div>
      )}
      {ProductTable(x)}

      {flags.length > 0 && (
        <Callout tone="red" title={`Red flag${flags.length > 1 ? "s" : ""}: blocked unless resolved`}>
          <ul>
            {flags.map((f) => (
              <li key={f.title}>
                <b>{f.title}.</b> {f.reason}
                {fn(x, ...f.sources)}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="answers">
        <div className="answer">
          <h3>Can you build here?</h3>
          {canBuild}
        </div>
        <div className="answer">
          <h3>Does it pencil?</h3>
          <p>
            {m.proForma.headline}
            {fn(x, "cost_config", "finance_engine")}
          </p>
          {m.proForma.sentences.length > 0 && (
            <ul className="small">
              {m.proForma.sentences.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
        </div>
        <div className="answer">
          <h3>What’s in the way?</h3>
          {barriers.length ? (
            <ol>
              {barriers.map((b) => (
                <li key={b.title}>
                  <b>{b.title}.</b> {b.reason.split(". ")[0]!.replace(/\.$/, "")}.{fn(x, ...b.sources)}
                </li>
              ))}
            </ol>
          ) : (
            <p>No red flags or site review items were found in our data.{((n) => (n ? ` The process checklist still lists ${n} required step${n === 1 ? "" : "s"} (Section 5).` : ""))(m.requirements.filter((r) => r.status === "REQUIRED").length)} Data gaps are listed in Section 12.</p>
          )}
        </div>
        <div className="answer">
          <h3>What next?</h3>
          <ol>
            {steps.map((r) => (
              <li key={r.id}>
                <b>{r.item}</b> ({r.issuer}). {r.reasons[0]?.reason ?? ""}
                {fn(x, "requirements")}
              </li>
            ))}
            {(m.proForma.narrative?.steps ?? []).slice(0, Math.max(0, 3 - steps.length)).map((t) => (
              <li key={t}>{t}{fn(x, "cost_config")}</li>
            ))}
          </ol>
          <p className="small muted">Routine transaction and permit items are in the full checklist (Section 5).</p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="kicker">Ease Score{m.score.status === "ready" ? ` · ${m.score.strategyLabel}` : ""}</div>
          {m.score.status === "ready" ? (
            <div className="v">
              {m.score.range ? `${m.score.range.min}–${m.score.range.max}` : m.score.score}
              {m.score.band ? ` · ${ease.bandLabel(m.score.band)}` : ""}
              {fn(x, "ease_score")}
            </div>
          ) : (
            <div className="v pending">{m.score.partial ? "Partial" : "Pending"}</div>
          )}
          <div className="small muted">
            {m.score.status === "ready"
              ? [m.score.labels.map(ease.relabelBands).join("; "), `Barriers to getting housing built here, 0–100 (higher = fewer barriers) · config ${m.score.configVersion}`, ease.SCORE_CAPTION].filter(Boolean).join(" · ")
              : m.score.reason}
          </div>
        </div>
        <div className="stat">
          <div className="kicker">Pencils?</div>
          {m.proForma.verdict ? (
            <div className="v">
              {PENCILS_TEXT[m.proForma.verdict]}
              {m.scenario.tenure === "sale" && m.proForma.sale.margin != null ? ` · ${m.proForma.sale.margin < 0 ? "−" : ""}${pct(Math.abs(m.proForma.sale.margin), 1)}` : ""}
              {fn(x, "cost_config")}
            </div>
          ) : (
            <div className="v pending">{m.proForma.plan.missing.length || m.proForma.rent.yieldOnCost == null ? "Can’t tell yet" : `Unlevered · ${pct(m.proForma.rent.yieldOnCost, 1)} on cost`}</div>
          )}
          <div className="small muted">
            {m.proForma.plan.evidence === "partial" ? `Partial: ${m.proForma.plan.exclusions.length} cost item${m.proForma.plan.exclusions.length === 1 ? "" : "s"} not included. ` : ""}
            {m.scenario.tenure === "sale" ? "Profit ÷ total cost." : "Income after running costs ÷ total cost."} Shown separately from the Ease Score.
          </div>
        </div>
        <div className="stat">
          <div className="kicker">Months to permit</div>
          {m.score.status === "ready" && m.score.permit ? (
            <div className="v">
              {m.score.permit.upperMonths ? `${num(m.score.permit.months, 0)}–${num(m.score.permit.upperMonths, 0)}` : `about ${num(m.score.permit.months, 0)}`}
              {fn(x, "ease_score")}
            </div>
          ) : (
            <div className="v pending">Pending</div>
          )}
          <div className="small muted">
            {m.score.status === "ready" && m.score.permit ? "Building-permit review only; zoning, site-plan, geotech, PWSA and DOMI steps not included. " : null}
            {m.score.status === "ready" && m.score.permit ? (m.score.permit.method === "heuristic" ? "Estimate from typical approval steps, not permit records" : m.score.permit.dateRangeLabel ?? "From City permit records") : "Comes from the Ease Score engine"}
          </div>
        </div>
      </div>

      {ConfidenceGrades(x)}

      <h2>Assumptions that matter most</h2>
      <ul>
        <li>
          The building shape comes from our site-fit solver using editable placeholder sizes (Appendix C), not an architect’s design{fn(x, "quickfit")}.
        </li>
        <li>Lot lines and street frontage come from county GIS, not a survey{fn(x, "parcels", "streets")}.</li>
        <li>
          Construction is priced at {money(m.proForma.plan.costPerSf)} per finished sq ft ({m.proForma.plan.tier.label}), from published Pittsburgh builder ranges
          {fn(x, "builder_ranges")}; site adders, soft costs, contingency and loan terms are editable defaults, each with a source label (Appendix C){fn(x, "cost_config")}. Items with no local cost yet are listed as not included, never counted as zero.
        </li>
        <li>Market values are references from past sales and rent indexes, not a price opinion{fn(x, "sales", "zori")}.</li>
      </ul>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Scenario

export function S2(x: Ctx) {
  const { m } = x;
  const s = m.scheme;
  const t = x.tab();
  const t2 = m.perType.length ? x.tab() : 0;
  return (
    <Sec flow id="s2" no="2" title="Project scenario">
      <p>
        The scenario is the building this study tests. Unless you chose one, it is the scheme our site-fit solver ranked first for the goal “
        {m.scenario.goal === "by_right_only" ? "allowed by right only" : "most homes"}”{fn(x, "quickfit")}.
      </p>
      <div className="tcap">Table {t}. The studied scenario</div>
      <table className="kv">
        <tbody>
          <tr><td>Strategy</td><td>{STRATEGY_LABEL[m.scenario.strategy]}</td></tr>
          <tr><td>Building type</td><td>{s ? s.typologyLabel : m.closest ? `None allowed. Closest tried: ${m.closest.typologyLabel.toLowerCase()}, ${m.closest.units} unit${m.closest.units > 1 ? "s" : ""}, which needs ${blockers(m.closest)}` : "None found"}</td></tr>
          <tr><td>Homes (units)</td><td>{s ? s.units : "—"}</td></tr>
          <tr><td>Unit size on the ground</td><td>{s ? `${num(s.unitWidthFt)} ft wide × ${num(s.unitDepthFt)} ft deep` : "—"}</td></tr>
          <tr><td>Stories / height</td><td>{s ? `${s.stories} stories, about ${num(s.heightFt)} ft` : "—"}</td></tr>
          <tr><td>Floor area</td><td>{s ? `${sqft(s.grossFloorAreaSf)} gross; ${sqft(s.netFloorAreaSf)} livable (net)` : "—"}</td></tr>
          <tr><td>Parking</td><td>{s ? `${s.parking === "none" ? "No parking" : s.parking === "garage" ? "Tuck-under garage" : "Surface parking"}: ${s.parkingSpaces} space${s.parkingSpaces === 1 ? "" : "s"}${s.parkingRequired != null ? ` (${s.parkingRequired} required)` : ""}` : "—"}</td></tr>
          <tr><td>Lot split</td><td>{s ? (s.needsSubdivision ? `Needed: each townhouse sits on its own new lot${s.subLots ? ` (${s.subLots.count} lots, ${num(s.subLots.minWidthFt)}–${num(s.subLots.maxWidthFt)} ft wide)` : ""}` : "Not needed") : "—"}</td></tr>
          <tr><td>Lot coverage</td><td>{s ? pct(s.lotCoveragePct / 100) : "—"}</td></tr>
          <tr><td>Zoning status</td><td>{s ? (s.byRight ? "Allowed by right" : s.badge === "needs_approval" ? `Needs approval: ${s.approvals.map((a) => a.label).join("; ")}` : "Not permitted") : "—"}</td></tr>
          <tr><td>What limits it</td><td>{s ? `${s.binding.label}. ${s.binding.detail}` : "—"}</td></tr>
          <tr><td>Sale or rent</td><td>{m.scenario.tenure === "rent" ? "Built to rent" : "Built to sell"}</td></tr>
          <tr><td>Affordable mode</td><td>{m.scenario.affordable ? "On" : "Off"}</td></tr>
          <tr><td>Changed from defaults</td><td>{m.scenario.changes.length ? m.scenario.changes.join("; ") : "Nothing: all defaults"}</td></tr>
        </tbody>
      </table>
      {s?.warnings.length ? (
        <Callout tone="amber" title="Solver warnings for this scheme">
          <ul>{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Callout>
      ) : null}
      {m.perType.length > 0 && (
        <>
          <h2>Other building types that fit</h2>
          <div className="tcap">Table {t2}. Best scheme for each building type{fn(x, "quickfit")}</div>
          <table>
            <thead>
              <tr><th>Building type</th><th className="num">Homes</th><th className="num">Gross sq ft</th><th className="num">Stories</th><th>Parking</th><th>Zoning</th><th>Limited by</th></tr>
            </thead>
            <tbody>
              {m.perType.map((p) => (
                <tr key={p.id}>
                  <td>{p.typologyLabel}</td>
                  <td className="num">{p.units}</td>
                  <td className="num">{num(p.grossFloorAreaSf)}</td>
                  <td className="num">{p.stories}</td>
                  <td>{p.parking === "none" ? "None" : `${p.parkingSpaces} ${p.parking}`}</td>
                  <td>{p.byRight ? "By right" : p.badge === "needs_approval" ? "Needs approval" : "Not permitted"}</td>
                  <td>{p.binding.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Site analysis

export function S3(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const a = f.assessment;
  const s1 = f.slope_1m;
  const tr = f.tract;
  const fe = f.flood_evidence;
  const mines = f.mines;
  const fronts = (m.qfInput?.frontEdges ?? []).map((i) => m.qfInput?.edges?.find((e) => e.i === i)?.len).filter((v): v is number => typeof v === "number");
  const slide = overlay(m, "landslide_prone_pgh");
  const under = overlay(m, "undermined_pgh");
  const rco = f.overlays?.filter((o) => o.layer === "zoning_overlay_pgh" && /^RCO/i.test(o.label ?? "")) ?? [];
  // With the site plan sheet, its figure number is taken where the sheet sits (end of this section).
  const planFig = !m.sitePlan && m.qfInput?.parcel?.length ? x.fig() : 0;
  const slopeFig = s1 ? x.fig() : 0;
  const tHaz = x.tab();
  const env = m.ease?.env_sites;
  const tInfo = x.tab();

  return (
    <Sec flow id="s3" no="3" title="Site analysis">
      <h2>3.1 Location and neighborhood</h2>
      <p>
        {titleCase(a?.address)} is in {f.context?.neighborhood ?? "an unnamed neighborhood"}, {titleCase(a?.municipality)}{fn(x, "assessment", "context")}.
        {tr ? (
          <>
            {" "}
            In its census tract ({tr.name}), the median household income is {money(tr.median_income)}, the median rent is {money(tr.median_rent)} a
            month, and {num(tr.vacancy_rate, 1)}% of homes are vacant; {num(tr.rent_burden_30_pct, 1)}% of renters spend more than 30% of income on rent
            {fn(x, "acs")}.
          </>
        ) : null}
        {rco.length ? ` The Registered Community Organization here is ${rco.map((o) => (o.label ?? "").replace(/^RCO - /, "")).join(", ")}` : ""}
        {rco.length ? <>{fn(x, "overlays")}.</> : null}
      </p>
      {m.images.context && (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.images.context} alt="Captured 3D context view" className="frame" />
          <figcaption><b>Figure {x.fig()}.</b> Context view captured in the app.</figcaption>
        </figure>
      )}

      <h2>3.2 Lot size and shape</h2>
      <p>
        The county lists the lot at {sqft(a?.lot_area_sqft)}{fn(x, "assessment")}; the GIS outline measures {sqft(f.lot_area_sqft_gis)}{fn(x, "parcels")}. It has{" "}
        {m.qfInput?.parcel?.length ?? "an unknown number of"} sides
        {fronts.length ? `, with ${fronts.map((l) => `${num(l)} ft`).join(" and ")} of street frontage` : ""}.
        {m.frontInferred
          ? ` The street centerline is about ${num(m.frontInferred.distFt)} ft from the nearest lot edge, farther than our site-fit solver’s 45 ft frontage test, so this study treats that ${num(m.frontInferred.lenFt)} ft edge as the front. Confirm access and frontage on a survey.`
          : ""}
        {f.site?.building_count ? (
          <>
            {" "}
            There {f.site.building_count > 1 ? `are ${f.site.building_count} buildings` : "is 1 building"} on the lot now
            {f.building_footprint_sqft ? ` covering about ${sqft(f.building_footprint_sqft)}` : ""}
            {fn(x, "buildings")}
            {a?.year_built ? `, built in ${a.year_built}, condition “${titleCase(a.condition)}”` : ""}
            {a?.year_built ? fn(x, "assessment") : null}
            {f.shares_wall ? "; it shares a wall with a neighbor" : ""}. A new building means demolition first.
          </>
        ) : (
          " No building stands on the lot in the county footprint data."
        )}
      </p>
      {m.sitePlan ? (
        <p>
          The site plan (sheet EA-101, at the end of this section) draws the lot to scale at 1&Prime; = {m.sitePlan.scaleFt}&prime;
          {m.sitePlan.extended ? ", a smaller scale than the usual 1″ = 10′ to 40′ because the lot is large" : ""}: lot lines and dimensions, zoning setbacks,
          the buildable area, the studied footprint, neighboring buildings, the street
          {m.sitePlan.terrain ? ", 2-foot lidar contours, ground steeper than 25%" : ""} and mapped hazard limits. Keynotes on the sheet explain each item.
        </p>
      ) : planFig > 0 && (
        <figure>
          <div className="frame">
            <LotPlan
              parcel={m.qfInput!.parcel}
              envelope={(m.qf?.envelope.polygons ?? []) as [number, number][][][]}
              footprints={(m.scheme?.footprints ?? []) as [number, number][][]}
              masks={m.qfInput!.masks}
              frontEdges={m.qfInput!.frontEdges}
            />
          </div>
          <figcaption>
            <b>Figure {planFig}.</b> Lot plan: lot line, street frontage, buildable area after setbacks ({sqft(m.qf?.envelope.areaSf)}), review overlays and the studied
            footprint{fn(x, "parcels", "quickfit")}. Front edges are inferred from the nearest opened street; confirm on a survey.
          </figcaption>
        </figure>
      )}

      <h2>3.3 Terrain</h2>
      {s1 ? (
        <>
          <p>
            From 1-meter lidar, the lot’s average slope is {num(s1.mean_pct, 1)}%, and the steepest 5% of it is over {num(s1.p95_pct, 0)}%
            {fn(x, "slope_1m")}. {pct(s1.share_over_25)} of the lot is steeper than 25%, the line where Pittsburgh’s grading rules and most builders start to treat
            ground as steep; {pct(s1.share_over_40)} is steeper than 40%.
          </p>
          <figure>
            <SlopeBar over15={s1.share_over_15 ?? s1.share_over_25} over25={s1.share_over_25} over40={s1.share_over_40 ?? 0} />
            <figcaption>
              <b>Figure {slopeFig}.</b> Share of the lot in each slope class ({num(s1.cells)} one-meter cells){fn(x, "slope_1m")}.
            </figcaption>
          </figure>
        </>
      ) : (
        <Callout tone="pending" title="No 1 m slope data for this lot">
          <p>Lidar slope has not been computed here yet.</p>
        </Callout>
      )}
      {m.images.terrain ? (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.images.terrain} alt="Captured terrain and contour view" className="frame" />
          <figcaption><b>Figure {x.fig()}.</b> Terrain and contours captured in the app.</figcaption>
        </figure>
      ) : (
        <p className="small muted">A contour map can be added with the app’s “Capture view” (terrain mode).</p>
      )}

      <h2>3.4 Hazards</h2>
      <div className="tcap">Table {tHaz}. Hazards checked</div>
      <table>
        <thead>
          <tr><th style={{ width: "28%" }}>Hazard</th><th>What our data shows</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Landslide-prone (City overlay)</td>
            <td>{slide ? `${pct(slide.share)} of the lot` : "Not in the overlay"}{fn(x, "landslide_prone")}{((rec) => (rec ? `. ${pct(rec.share)} of the lot is in a mapped slope-movement area (1982 inventory)` : ""))((f.overlays ?? []).find((o: { layer: string; share: number }) => o.layer === "landslide_recorded" && o.share > 0))}{typeof f.landslides_within_300ft === "number" ? `. Mapped slope-movement areas (1982 inventory) within 300 ft: ${f.landslides_within_300ft}` : ""}{typeof f.landslides_within_300ft === "number" ? fn(x, "landslide_inventory") : null}</td>
          </tr>
          <tr>
            <td>Undermined / mines</td>
            <td>
              {under ? "In the City’s undermined overlay" : "Not in the City’s undermined overlay"}
              {fn(x, "undermined")}. Mine subsidence insurance risk: {mines?.msi_risk ?? "not mapped"}; nearest mapped mined-out area{" "}
              {mines?.dist_mined_out_ft != null ? `${num(mines.dist_mined_out_ft)} ft away` : "not found"}
              {mines?.mine_map_sheet ? `; mine map sheet ${mines.mine_map_sheet}` : ""}
              {fn(x, "mines")}. {mines?.caveat ?? ""}
            </td>
          </tr>
          <tr>
            <td>Flooding</td>
            <td>
              {fe ? (
                <>
                  Floodway {pct(fe.floodway_share)}, 100-year zone {pct(fe.sfha_share)}, 500-year zone {pct(fe.x500_share)} of the lot{fn(x, "fema")}. In this
                  census tract: {num(fe.tract_nfip_policies)} flood insurance policies and {num(fe.tract_nfip_claims_10y)} claims in 10 years
                  {fe.tract_nfip_median_premium != null ? `, median premium ${money(fe.tract_nfip_median_premium)}` : ""}
                  {fn(x, "nfip")}; {num(fe.flooding_311_5y_tract)} flooding complaints to 311 in 5 years{fn(x, "flood311")}.
                </>
              ) : (
                <>{pct(f.flood_1pct_share)} of the lot in the 100-year zone{fn(x, "fema")}.</>
              )}
            </td>
          </tr>
          <tr>
            <td>Sewer backup</td>
            <td>{fe?.in_combined_sewer ? "In a combined sewer area (storm and sewage share pipes), where basement backups are more common in heavy rain" : "Not mapped in a combined sewer area"}{fn(x, "sewer")}.</td>
          </tr>
          <tr>
            <td>Contamination</td>
            <td>
              {env ? `${env.on_parcel} cleanup record${env.on_parcel === 1 ? "" : "s"} on the lot and ${env.adjacent_50ft} within 50 ft` : "On-lot check not available"}
              {env ? fn(x, "env") : null}; {num(f.env_sites_within_500ft)} within 500 ft{fn(x, "env")}.
            </td>
          </tr>
          <tr>
            <td>Streams and wetlands</td>
            <td>{f.streams_or_wetlands_within_100ft ? "A stream or wetland is within 100 ft" : "None within 100 ft"}{fn(x, "hydro")}.</td>
          </tr>
        </tbody>
      </table>

      <h2>3.5 Access, utilities, transit and schools</h2>
      <div className="tcap">Table {tInfo}. Access and services</div>
      <table className="kv">
        <tbody>
          <tr>
            <td>Street access</td>
            <td>
              {f.street_frontage === "street" ? "Fronts an opened street" : f.street_frontage === "paper" ? "Only an unopened (paper) street" : f.street_frontage === "steps" ? "Reached by City steps" : "No street found within 20 m"}
              {fn(x, "streets")}
            </td>
          </tr>
          <tr>
            <td>Water and sewer</td>
            <td>
              {a?.is_pittsburgh ? "Assumed Pittsburgh Water (PWSA); confirm with an availability letter." : "Water and sewer provider not mapped yet."}
              {fe?.in_combined_sewer ? " Combined sewer area." : ""}
              {f.muni_rules?.sewer_lateral_details ? ` At sale: ${f.muni_rules.sewer_lateral_details}.` : ""}
              {f.muni_rules ? fn(x, "muni_rules") : null}
            </td>
          </tr>
          <tr>
            <td>Transit</td>
            <td>
              {f.transit ? (
                <>
                  Nearest stop {num(f.transit.nearest_any_stop_m)} m; nearest frequent stop {f.transit.nearest_frequent_stop_m != null ? `${num(f.transit.nearest_frequent_stop_m)} m` : "none nearby"}; {num(f.transit.frequent_stops_800m)} frequent stops within 800 m (about half a mile)
                  {fn(x, "transit")}
                </>
              ) : "Not available"}
            </td>
          </tr>
          <tr>
            <td>Schools</td>
            <td>
              {f.schools ? (
                <>
                  {f.schools.district} school district{f.schools.pps_elementary ? `; Pittsburgh Public Schools feeder: ${titleCase(f.schools.pps_elementary)} (elementary), ${titleCase(f.schools.pps_middle)} (middle), ${titleCase(f.schools.pps_high)} (high)` : ""}
                  {fn(x, "schools")}
                </>
              ) : "Not available"}
            </td>
          </tr>
          <tr>
            <td>Street trees within 15 m</td>
            <td>{num(f.context?.street_trees_15m)}{fn(x, "context")}</td>
          </tr>
        </tbody>
      </table>
      {m.sitePlan
        ? (() => {
            const n = x.fig();
            return (
              <figure className="sheet-page">
                <div className="sheet" dangerouslySetInnerHTML={{ __html: m.sitePlan.svg }} />
                <figcaption>
                  <b>Figure {n}.</b> Site plan, sheet EA-101 (screening drawing from public data, not a survey)
                  {fn(x, "parcels", "zoning_rules", "quickfit", "buildings", "streets", "slope_1m", "overlays")}. Street curb, walk and right-of-way widths are
                  typical-width assumptions, not surveyed.
                </figcaption>
              </figure>
            );
          })()
        : null}
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Zoning

const PENCIL_TEXT: Record<string, string> = { yes: "Pencils", thin: "Barely pencils", no: "Doesn't pencil", pricing: "Needs your rehab cost", unknown: "Can't tell yet", none: "—" };

/** "Best options for this lot" (the parcel page's ranking) and the street precedent, moved here from the pane. */
function OptionsAndPrecedent({ x }: { x: Ctx }) {
  const { m } = x;
  const rows = m.options ?? [];
  const p = m.precedent;
  if (!rows.length && !p) return null;
  return (
    <>
      {rows.length > 0 && (
        <>
          <div className="tcap">Highest and best use (screening): what works best on this lot (ease and money kept separate; the easiest option that pencils first)</div>
          <table>
            <thead><tr><th>#</th><th>Option</th><th>Ease Score</th><th>Zoning path</th><th>Pencils?</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.strategy}>
                  <td>{r.rank}</td>
                  <td>{r.name}{r.leadLabel ? <span className="small muted"> · {r.leadLabel}</span> : null}</td>
                  <td>{r.applicable && m.score.status === "ready" ? `${r.score != null ? r.score : r.range ? `${r.range[0]}–${r.range[1]}` : "—"}${r.band ? ` (${ease.bandLabel(r.band)})` : ""}` : m.score.status !== "ready" && m.score.partial ? "Partial" : "—"}</td>
                  <td>{r.zoning.text}</td>
                  <td>{r.applicable ? PENCIL_TEXT[r.pencils] ?? r.pencils : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {p && (
        <>
          <h2>Street precedent</h2>
          <p>
            {titleCase(p.streetName)} ({p.scope === "stretch" ? "this stretch of the street, 400 ft each way on the same side" : "this block face"}): {p.headline}
            {p.nBuildings > 0 ? ` Medians over ${p.nBuildings} measured building${p.nBuildings === 1 ? "" : "s"} (${p.nLots} lots)` : ""}
            {p.nBuildings > 0 ? `: lot ${p.lotWidthFt != null ? `${Math.round(p.lotWidthFt)} ft wide` : "width not measured"}, ${p.stories != null ? `${p.stories} stories` : "stories not recorded"}.` : ""}
          </p>
          <p>
            {p.contextual.applies
              ? <>Contextual front setback: <b>{p.contextual.ft} ft instead of {p.contextual.districtFt} ft</b>, because {p.contextual.why} ({p.contextual.citation}; by right, no hearing).</>
              : <>Contextual front setback: {p.contextual.reason}</>}
            {p.conformity.withBuilding > 0 ? ` ${p.conformity.nonconforming} of ${p.conformity.withBuilding} existing buildings here would not meet today's code.` : ""}
          </p>
          <p className="small muted">Measured from Allegheny County building footprints and parcel lines (approximate; an applicant documents neighbors&apos; setbacks with a survey).</p>
        </>
      )}
    </>
  );
}

export function S4(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const r = m.rules;
  const s = m.scheme;
  const lot = f.lot_area_sqft_gis ?? f.assessment?.lot_area_sqft ?? null;
  if (!f.zoning?.code || !r) {
    return (
      <Sec flow id="s4" no="4" title="Zoning and approvals">
        <Callout tone="pending" title="Zoning not loaded here">
          <p>
            Zoning rules are loaded for the City of Pittsburgh only. Confirm zoning with {titleCase(f.assessment?.municipality) || "the municipality"}.
          </p>
        </Callout>
        <OptionsAndPrecedent x={x} />
      </Sec>
    );
  }
  const tUse = x.tab();
  const uses: [string, string | null | undefined][] = [
    ["One house (single-unit detached)", r.single_unit_detached],
    ["Townhouse on its own lot (single-unit attached)", r.single_unit_attached],
    ["Two homes (two-unit)", r.two_unit],
    ["Three homes (three-unit)", r.three_unit],
    ["Four or more (multi-unit)", r.multi_unit],
  ];
  const tDim = x.tab();
  const dims: { rule: string; req: string; prop: string; ok: boolean | null }[] = [];
  const add = (rule: string, reqv: number | null | undefined, unit: string, prop: number | null | undefined, ok: boolean | null, propText?: string) => {
    if (reqv == null) return;
    dims.push({ rule, req: `${num(reqv)} ${unit}`.trim(), prop: propText ?? (prop != null ? `${num(prop)} ${unit}`.trim() : "—"), ok });
  };
  add("Minimum lot size", r.min_lot_area_sqft, "sq ft", lot, lot != null ? lot >= r.min_lot_area_sqft! : null);
  if (s && r.min_lot_area_per_unit_sqft) add("Lot area per home", r.min_lot_area_per_unit_sqft, "sq ft", lot != null ? lot / s.units : null, lot != null ? lot / s.units >= r.min_lot_area_per_unit_sqft : null);
  add("Front setback", r.min_front_setback_ft, "ft", null, s ? true : null, s ? `Kept (inside buildable area)${r.contextual_front_setback ? "; contextual setback may apply" : ""}` : "—");
  add("Rear setback", r.min_rear_setback_ft, "ft", null, s ? true : null, s ? "Kept (inside buildable area)" : "—");
  add("Side setback", r.min_side_setback_ft, "ft", null, s ? true : null, s ? "Kept (inside buildable area)" : "—");
  add("Maximum height", r.max_height_ft, "ft", s?.heightFt, s ? s.heightFt <= r.max_height_ft! : null);
  add("Maximum stories", r.max_height_stories, "", s?.stories, s ? s.stories <= r.max_height_stories! : null);
  if (r.parking_per_unit != null && s) dims.push({ rule: "Parking", req: `${num(r.parking_per_unit, 1)} per home (${s.parkingRequired ?? "—"} total)`, prop: `${s.parkingSpaces}`, ok: s.parkingRequired == null ? null : s.parkingSpaces >= s.parkingRequired });
  if (r.max_far && s && lot) dims.push({ rule: "Floor area ratio (FAR)", req: `${num(r.max_far, 2)} max`, prop: num(s.grossFloorAreaSf / lot, 2), ok: s.grossFloorAreaSf / lot <= r.max_far });
  if (r.max_lot_coverage_pct && s) dims.push({ rule: "Lot coverage", req: `${num(r.max_lot_coverage_pct)}% max`, prop: `${num(s.lotCoveragePct)}%`, ok: s.lotCoveragePct <= r.max_lot_coverage_pct });

  const zbaRows = Object.entries(m.zba?.by_relief ?? {}).sort((a, b) => b[1].decided - a[1].decided);
  const tZba = zbaRows.length ? x.tab() : 0;
  const tUnl = m.unlocks.length ? x.tab() : 0;
  const zr = f.zoning.rules as { notes?: string | null; confidence?: string | null } | null | undefined;

  return (
    <Sec flow id="s4" no="4" title="Zoning and approvals">
      <p>
        The lot is zoned <b>{f.zoning.code}</b> ({titleCase(r.district_name ?? f.zoning.type)}){fn(x, "zoning")}. The rules below are transcribed from the Pittsburgh
        Zoning Code{fn(x, "zoning_rules")}; transcription confidence: {zr?.confidence ?? "not recorded"}.
        {zr?.notes ? ` Note: ${zr.notes}` : ""}
      </p>
      <div className="tcap">Table {tUse}. Allowed uses in {f.zoning.code}</div>
      <table>
        <thead><tr><th>Use</th><th>Code</th><th>What it means</th></tr></thead>
        <tbody>
          {uses.map(([u, p]) => (
            <tr key={u}><td>{u}</td><td>{p ?? "—"}</td><td>{p ? PERMISSION_TEXT[p] ?? p : "Not in our rules table"}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="tcap">Table {tDim}. Dimensional rules: required vs. the studied scheme{fn(x, "zoning_rules", "quickfit")}</div>
      <table>
        <thead><tr><th>Rule</th><th>Required</th><th>Scheme</th><th>Meets?</th></tr></thead>
        <tbody>
          {dims.map((d) => (
            <tr key={d.rule}>
              <td>{d.rule}</td>
              <td>{d.req}</td>
              <td>{d.prop}</td>
              <td>{d.ok === null ? <span className="pill wait">Unknown</span> : d.ok ? <span className="pill ok">Yes</span> : <span className="pill no">No</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <OptionsAndPrecedent x={x} />

      <h2>Approvals needed</h2>
      {s ? (
        s.approvals.length ? (
          <ul>
            {s.approvals.map((a) => (
              <li key={a.label}>
                <b>{a.label}.</b>{" "}
                {a.odds?.status === "rate"
                  ? `Similar past requests: ${a.odds.granted} of ${a.odds.n} granted (${pct(a.odds.rate)}).`
                  : a.odds
                    ? `Only ${a.odds.n} similar decided case${a.odds.n === 1 ? "" : "s"} on record (fewer than 5), so no rate is given.`
                    : ""}
                {a.odds ? fn(x, "zba") : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>None for zoning: the studied scheme is allowed by right{fn(x, "quickfit")}. Building, grading and other permits are in Section 5.</p>
        )
      ) : (
        <p>
          {m.closest ? `No scheme is allowed as of right. The closest one tried (${m.closest.typologyLabel.toLowerCase()}) needs ${blockers(m.closest)}.` : m.qfError ?? "No scheme fit, so approvals were not checked."}
          {fn(x, "quickfit")}
        </p>
      )}

      {zbaRows.length > 0 && (
        <>
          <h2>Past zoning decisions in {f.zoning.code} districts</h2>
          <div className="tcap">Table {tZba}. Decided requests in {f.zoning.code} (granted or denied only){fn(x, "zba")}</div>
          <table>
            <thead><tr><th>Kind of request</th><th className="num">Decided</th><th className="num">Granted</th><th className="num">Denied</th><th className="num">Grant rate</th><th>Years</th></tr></thead>
            <tbody>
              {zbaRows.map(([k, v]) => (
                <tr key={k}>
                  <td>{RELIEF_TEXT[k] ?? titleCase(k.replace(/_/g, " "))}</td>
                  <td className="num">{v.decided}</td>
                  <td className="num">{v.granted}</td>
                  <td className="num">{v.denied}</td>
                  <td className="num">{v.decided >= 5 ? pct(v.granted / v.decided) : "Too few (<5)"}</td>
                  <td>{v.from && v.to ? `${v.from.slice(0, 4)}–${v.to.slice(0, 4)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">A rate is shown only when at least 5 requests were decided. Past results do not predict a single case.</p>
        </>
      )}

      <h2>What would unlock more homes</h2>
      {m.unlocks.length ? (
        <>
          <p>We re-ran the site-fit solver with one rule relaxed at a time. These are policy what-ifs, not requests you can make{fn(x, "quickfit")}.</p>
          <div className="tcap">Table {tUnl}. One rule relaxed at a time</div>
          <table>
            <thead><tr><th>What if</th><th>Rule now</th><th className="num">Extra homes</th><th className="num">Extra floor area</th></tr></thead>
            <tbody>
              {m.unlocks.map((u) => (
                <tr key={u.rule}>
                  <td>{u.label}</td>
                  <td>{u.from != null ? num(u.from) : "—"}</td>
                  <td className="num">{u.deltaUnits > 0 ? `+${u.deltaUnits}` : u.deltaUnits}</td>
                  <td className="num">{u.deltaGrossFloorAreaSf > 0 ? `+${num(u.deltaGrossFloorAreaSf)} sq ft` : num(u.deltaGrossFloorAreaSf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Not computed: the site-fit solver did not run for this lot.</p>
      )}
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Process & timeline

export function S5(x: Ctx) {
  const { m } = x;
  const byPhase = PHASE_ORDER.map((ph) => [ph, m.requirements.filter((r) => r.phase === ph)] as const);
  const figN = x.fig();
  const pgh = m.requirements.filter((r) => ["geotech", "mine_subsidence", "mine_subsidence_paths", "retaining_wall", "grading_permit", "contextual_setback", "rco_meeting", "access", "sewer_lateral", "tap_fees"].includes(r.id) && r.status !== "NOT_NEEDED");
  const counts = m.requirements.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  const tabs = byPhase.filter(([, items]) => items.some((i) => i.status !== "NOT_NEEDED")).map(([ph]) => [ph, x.tab()] as const);
  const tabOf = (ph: string) => tabs.find((t) => t[0] === ph)?.[1];

  return (
    <Sec flow id="s5" no="5" title="Process and timeline">
      <p>
        Our requirements engine checks {m.requirements.length} possible steps against this lot and project{fn(x, "requirements")}:{" "}
        {["REQUIRED", "LIKELY", "POSSIBLE", "ASK", "NOT_NEEDED"].filter((k) => counts[k]).map((k) => `${counts[k]} ${STATUS_TEXT[k]!.toLowerCase()}`).join(", ")}. “Required” means a cited law or rule
        requires it here; “Likely” and “Possible” are strong or weaker signals; “Ask” means we need an answer from you.
      </p>
      <figure>
        <PhaseSequence
          phases={PHASE_ORDER.map((ph) => {
            const it = m.requirements.filter((r) => r.phase === ph);
            return {
              label: ph === "design_engineering" ? "Design &\nengineering" : ph === "due_diligence" ? "Due\ndiligence" : PHASE_LABEL[ph]!,
              required: it.filter((r) => r.status === "REQUIRED").length,
              likely: it.filter((r) => r.status === "LIKELY").length,
              other: it.filter((r) => ["POSSIBLE", "ASK"].includes(r.status)).length,
            };
          })}
        />
        <figcaption>
          <b>Figure {figN}.</b> Phases in order with the number of items in each{fn(x, "requirements")}. Review times are not loaded yet, so no durations are drawn.
        </figcaption>
      </figure>
      {m.score.status === "ready" && m.score.permit ? (
        <Callout tone="plain" title={`Predicted time to a permit: ${m.score.permit.upperMonths ? `${num(m.score.permit.months, 0)} to ${num(m.score.permit.upperMonths, 0)}` : `about ${num(m.score.permit.months, 1)}`} months`}>
          <p>
            {m.score.permit.method === "heuristic"
              ? "This is an estimate built from the approval steps this project needs, not from permit records for similar projects."
              : `Building-permit time comes from City permit records${m.score.permit.dateRangeLabel ? ` (${m.score.permit.dateRangeLabel})` : ""}.`}
            {fn(x, "ease_score")} It counts building-permit review (plus any zoning hearing this option needs); zoning review, City Planning site-plan review, geotechnical review on hillsides, the PWSA tap and DOMI street permits are not included, so the real time to start is longer. How it adds up:
          </p>
          <ul>{m.score.permit.basis.map((b) => <li key={b}>{b}</li>)}</ul>
          <p className="small muted">Construction time is not estimated. Ask the City’s zoning and permit offices for current review times.</p>
        </Callout>
      ) : (
        <Callout tone="pending" title="Predicted timeline: pending">
          <p>
            City review times are not in our data yet, and the Ease Score engine did not return a permit-time estimate for this parcel. Ask the City’s zoning and
            permit offices for current review times.
          </p>
        </Callout>
      )}
      {pgh.length > 0 && (
        <>
          <h2>Pittsburgh-specific items for this lot</h2>
          <ul>
            {pgh.map((r) => (
              <li key={r.id}>
                <span className={`pill ${r.status}`}>{STATUS_TEXT[r.status]}</span> <b>{r.item}.</b> {r.reasons[0]?.reason}
                {fn(x, "requirements")}
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>Checklist by phase</h2>
      {byPhase.map(([ph, items]) => {
        const shown = items.filter((i) => i.status !== "NOT_NEEDED");
        const skipped = items.filter((i) => i.status === "NOT_NEEDED");
        if (!items.length) return null;
        return (
          <div key={ph}>
            <h3>{PHASE_LABEL[ph]}</h3>
            {shown.length > 0 && (
              <>
                <div className="tcap">Table {tabOf(ph)}. {PHASE_LABEL[ph]} items{fn(x, "requirements")}</div>
                <table>
                  <thead><tr><th style={{ width: "13%" }}>Status</th><th style={{ width: "27%" }}>Item</th><th>Why</th><th style={{ width: "17%" }}>Rule</th></tr></thead>
                  <tbody>
                    {shown.map((r: RequirementResult) => (
                      <tr key={r.id}>
                        <td><span className={`pill ${r.status}`}>{STATUS_TEXT[r.status]}</span></td>
                        <td><b>{r.item}</b><div className="small muted">{r.issuer}</div></td>
                        <td>
                          {r.reasons.slice(0, 2).map((t, i) => <div key={i}>{t.reason}</div>)}
                          {r.advisories.slice(0, 1).map((adv, i) => <div key={`a${i}`} className="small muted">Note: {adv}</div>)}
                        </td>
                        <td className="small">{r.citation ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {skipped.length > 0 && <p className="small muted">Not needed here: {skipped.map((r) => r.item).join("; ")}.</p>}
          </div>
        );
      })}
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 6. Market

export function S6(x: Ctx) {
  const { m } = x;
  const s = m.sales;
  const r = m.rent;
  const ok = s?.status === "ok" && s.sufficient !== false;
  const land = s?.comparable_use === "vacant land";
  const figN = ok && s!.comps.length ? x.fig() : 0;
  const tC = ok && s!.comps.length ? x.tab() : 0;
  const tR = r?.hud_fmr ? x.tab() : 0;
  const mk = m.ease?.market;
  const zChange = r?.zori?.rent_12m_ago ? r.zori.latest_rent / r.zori.rent_12m_ago - 1 : null;
  return (
    <Sec flow id="s6" no="6" title="Market analysis">
      <h2>Sales comparables</h2>
      {s ? (
        <>
          <p>
            We use only valid arm’s-length sales of the same kind of property, nearest first. At least 5 are needed; if there are fewer, the search widens
            step by step{fn(x, "sales")}.{" "}
            {ok ? (
              <>
                We found <b>{num(s.count)}</b> {s.comparable_use} sales within {num(s.radius_mi, 2)} mile{s.radius_mi === 1 ? "" : "s"} from {s.date_range?.from} to {s.date_range?.to}. Median sale price{" "}
                <b>{money(s.median_price)}</b>; median <b>{money(s.median_price_per_sqft, land ? 2 : 0)}</b> per sq ft of {land ? "lot" : "living area"}{fn(x, "sales")}.
                {land ? ((vc) => ` Because this lot is vacant, these comps are vacant-land sales: a reference for the land only, not for a finished home.${vc && vc.status === "ok" && vc.sufficient !== false && vc.count ? ` The finished home's value comes from ${num(vc.count)} new-construction sales (median ${money(vc.median_price_per_sqft)} per sq ft of living area; Section 9).` : ""}${m.proForma?.plan.sources.land.kind === "user" ? " The land price in the budget is your number." : " The land price in the budget is estimated separately (Section 7); for public land it follows agency sale prices, not this median."}`)(m.proForma?.plan.valueComps as { status?: string; sufficient?: boolean; count?: number; median_price_per_sqft?: number | null } | null | undefined) : ""}
              </>
            ) : (
              <b>Insufficient comps: {s.count} valid sales found{s.note ? ` (${s.note})` : ""}. No market reference value is given.</b>
            )}
          </p>
          {s.search_steps?.length ? <p className="small muted">Search steps: {s.search_steps.join(" → ")}.</p> : null}
          {s.fallback_note && <Callout tone="amber" title="Comps search widened"><p>{s.fallback_note}</p></Callout>}
          {figN > 0 && (
            <figure>
              <CompsScatter comps={s.comps.filter((c) => c.price_per_sqft).map((c) => ({ date: c.sale_date, ppsf: c.price_per_sqft! }))} median={s.median_price_per_sqft} />
              <figcaption>
                <b>Figure {figN}.</b> Price per sq ft of the {s.comps.length} nearest comparable sales by sale date; dashed line = median of all {s.count}
                {fn(x, "sales")}.
              </figcaption>
            </figure>
          )}
          {tC > 0 && (
            <>
              <div className="tcap">Table {tC}. Nearest comparable sales (up to 15 shown){fn(x, "sales")}{x.print ? "" : ". On screen, addresses show the block only; the downloadable PDF lists full street addresses."}</div>
              <table>
                <thead><tr><th>Address{x.print ? "" : " (block)"}</th><th>Sale date</th><th className="num">Price</th><th className="num">{land ? "Lot area" : "Living area"}</th><th className="num">$ / sq ft</th><th className="num">Distance</th></tr></thead>
                <tbody>
                  {s.comps.slice(0, 15).map((c) => (
                    <tr key={`${c.parid}-${c.sale_date}`}>
                      <td>{x.print ? titleCase(c.address) : blockText(c.address)}</td>
                      <td>{c.sale_date}</td>
                      <td className="num">{money(c.price)}</td>
                      <td className="num">{num(land ? c.lot_area_sqft : c.living_area_sqft)}</td>
                      <td className="num">{money(c.price_per_sqft, land ? 2 : 0)}</td>
                      <td className="num">{num(c.distance_mi, 2)} mi</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      ) : (
        <Callout tone="pending" title="Sales comps unavailable"><p>The comps search did not return data for this parcel.</p></Callout>
      )}

      <h2>Rents</h2>
      {r?.zori ? (
        <p>
          The Zillow rent index for ZIP {r.zori.zip} was <b>{money(r.zori.latest_rent)}</b> a month in {r.zori.latest_month.slice(0, 7)}
          {zChange != null ? `, ${zChange >= 0 ? "up" : "down"} ${pct(Math.abs(zChange), 1)} from a year earlier (${money(r.zori.rent_12m_ago)})` : ""}
          {fn(x, "zori")}. This covers all home types in the ZIP, not new construction.
        </p>
      ) : (
        <p>No ZIP-level rent index is available here.</p>
      )}
      {r?.hud_fmr && (
        <>
          <div className="tcap">Table {tR}. HUD Fair Market Rents, FY {r.hud_fmr.year} ({r.hud_fmr.level}){fn(x, "hud_fmr")}</div>
          <table>
            <thead><tr><th className="num">Studio</th><th className="num">1 bedroom</th><th className="num">2 bedrooms</th><th className="num">3 bedrooms</th><th className="num">4 bedrooms</th></tr></thead>
            <tbody>
              <tr>
                <td className="num">{money(r.hud_fmr.br0)}</td>
                <td className="num">{money(r.hud_fmr.br1)}</td>
                <td className="num">{money(r.hud_fmr.br2)}</td>
                <td className="num">{money(r.hud_fmr.br3)}</td>
                <td className="num">{money(r.hud_fmr.br4)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {RentsByBedroomBlock(x)}

      <h2>Market activity</h2>
      {mk ? (
        <p>
          In the last 3 years within half a mile: {num(mk.sales_3y_half_mile)} valid sales
          {mk.completed_permits_3y_half_mile != null ? ` and ${num(mk.completed_permits_3y_half_mile)} completed building permits` : ""}. That is more activity than
          about {num(mk.percentile, 0)}% of {mk.scope === "city" ? "City" : "county"} parcels in our fixed sample of {num(mk.sample_n)}
          {fn(x, "market_activity")}.
        </p>
      ) : (
        <p className="muted">Market activity is not available.</p>
      )}
      {AbsorptionBlock(x)}
      {UnitSelloutBlock(x)}
    </Sec>
  );
}

/** Rents by bedroom count and the listing comps behind them. Full street addresses: this downloadable report only (the screen shows block level). */
function RentsByBedroomBlock(x: Ctx) {
  const { m } = x;
  const rb = m.rentsByBedroom;
  const est = rb ? Object.values(rb.byBedroom).sort((a, b) => a.bedrooms - b.bedrooms) : [];
  if (!rb || !est.length) {
    const r = m.rent;
    return <p>Listing-level rent comps are not available here ({r?.rentease?.note ?? "no listing data"}). {r?.rules ? `${r.rules}.` : ""}</p>;
  }
  const withComps = est.filter((e) => e.comps.length > 0);
  const tE = x.tab();
  const brLabel = (n: number) => (n === 0 ? "Studio" : `${n} bedroom${n > 1 ? "s" : ""}`);
  const cite = (e: (typeof est)[number]) => (e.basis === "rentcast_comps" || e.basis === "rentcast_market" ? fn(x, "rentcast") : e.basis === "hud_safmr" ? fn(x, "hud_fmr") : e.basis === "zori" ? fn(x, "zori") : null);
  return (
    <>
      <div className="tcap">Table {tE}. Rent by bedroom count (monthly, rounded to $50)</div>
      <table>
        <thead><tr><th>Home</th><th className="num">Likely</th><th className="num">Range</th><th>Basis</th><th className="num">HUD FMR</th></tr></thead>
        <tbody>
          {est.map((e) => (
            <tr key={e.bedrooms}>
              <td>{brLabel(e.bedrooms)}</td>
              <td className="num">{money(e.likely)}</td>
              <td className="num">{e.low != null && e.high != null ? `${money(e.low)}–${money(e.high)}` : "—"}</td>
              <td>{e.basisLabel}{cite(e)}{e.note ? ` ${e.note}` : ""}</td>
              <td className="num">{money(e.hud)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        {est[0]!.method} {est[0]!.rules} {rb.caveat}
        {withComps.length && !x.print ? " On screen, listings show the block only; the downloadable PDF lists full street addresses." : ""}
      </p>
      {!withComps.length && <p className="small muted">Rents use RentCast market statistics for the parcel&apos;s ZIP code (median asking rent by bedroom count), not individual nearby listings, so no listing table is shown. Where RentCast statistics are not available the table says why and uses HUD Small Area Fair Market Rent.</p>}
      {withComps.map((e) => {
        const t = x.tab();
        return (
          <div key={e.bedrooms}>
            <div className="tcap">Table {t}. {brLabel(e.bedrooms)}: nearby rental listings used ({e.comps.length} of {e.compCount}{e.radiusMi != null ? `, within ${num(e.radiusMi, 1)} mi` : ""}){fn(x, "rentcast")}</div>
            <table className="dense">
              <thead><tr><th>Address</th><th className="num">Asking rent</th><th className="num">Size-adjusted</th><th className="num">Sq ft</th><th className="num">Baths</th><th>Type</th><th className="num">Distance</th><th>Last seen</th></tr></thead>
              <tbody>
                {e.comps.map((c, i) => (
                  <tr key={`${c.address}-${i}`}>
                    <td>{x.print ? c.address : c.block}</td>
                    <td className="num">{money(c.price)}</td>
                    <td className="num">{money(c.adjusted)}</td>
                    <td className="num">{num(c.squareFootage)}</td>
                    <td className="num">{c.bathrooms ?? "—"}</td>
                    <td>{c.propertyType ?? "—"}</td>
                    <td className="num">{num(c.distanceMi, 2)} mi</td>
                    <td className="nowrap">{c.lastSeen ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Budget

export function S7(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const pf = m.proForma;
  const p = pf.plan;
  const tB = x.tab();
  const tt = f.transfer_tax;
  const GROUP: Record<string, string> = { land: "Land", hard: "Hard costs", soft: "Soft costs", contingency: "Contingency", financing: "Financing and holding" };

  /** Footnotes for a budget line: where its number comes from. */
  const notes = (id: string): string[] => {
    switch (id) {
      case "land": return has(p.assumptions, "land") ? ["assessment"] : [];
      case "hard_base": return ["builder_ranges", "cost_config"];
      case "slope_adder": return ["slope_1m", "cost_config"];
      case "grouting": return ["undermined", "cost_config"];
      case "permits": return p.shares.permitsBasis.includes("PLI") ? ["pli_fee"] : ["cost_config"];
      case "tap_fees": return ["tap_fees"];
      case "interest": return m.prime ? ["prime", "cost_config"] : ["cost_config"];
      case "holding": return ["assessment", "millage"];
      default: return ["cost_config"];
    }
  };
  const groups = ["land", "hard", "soft", "contingency", "financing"] as const;
  return (
    <Sec id="s7" no="7" title="Development budget">
      {p.missing.length > 0 ? (
        <Callout tone="pending" title="Some inputs are missing">
          <ul>{p.missing.map((t) => <li key={t}>{t}</li>)}</ul>
        </Callout>
      ) : null}
      {p.exclusions.length > 0 ? (
        <Callout tone="amber" title={`Partial estimate: ${p.exclusions.length} cost item${p.exclusions.length === 1 ? " is" : "s are"} not included yet`}>
          <p>These items apply to this project, but there is no local cost for them yet. They are left out of the total, never counted as zero, so the total is low by their cost.</p>
          <ul>{p.exclusions.map((e) => <li key={e.id}>{e.text}. {e.reason}.</li>)}</ul>
        </Callout>
      ) : null}
      <p>
        Costs use the EaseScore.AI cost assumptions {p.configVersion}{fn(x, "cost_config")}: {p.tier.label} construction at {money(p.costPerSf)} per finished sq ft
        {fn(x, "builder_ranges")}, on {p.finishedSf != null ? sqft(p.finishedSf) : "an unknown floor area"} ({p.sizeBasis.charAt(0).toLowerCase() + p.sizeBasis.slice(1)}
        {p.strategy === "rehab_existing" ? "" : fn(x, "quickfit")}). Every line shows its source label; every value can be changed on the parcel page.
      </p>
      {p.adders.length > 0 && (
        <>
          <h2>Site adders that fired</h2>
          <ul>
            {p.adders.map((ad) => (
              <li key={ad.id}>
                {ad.reason} ({ad.sourceLabel}{ad.range ? `; range ${ad.range}` : ""}){fn(x, ...(ad.id === "mine_insurance" ? ["msi_rates"] : ad.id === "mine_grouting" ? ["cost_config"] : ["slope_1m", "cost_config"]))}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="tcap">Table {tB}. Development budget (CAPEX)</div>
      <table>
        <thead><tr><th style={{ width: "34%" }}>Line</th><th style={{ width: "18%" }} className="num">Amount</th><th>Basis and source</th></tr></thead>
        <tbody>
          {groups.flatMap((g) => {
            const rows = pf.budget.filter((b) => b.group === g && !b.minor);
            if (!rows.length) return [];
            return [
              <tr key={`g-${g}`}><td colSpan={3} className="small" style={{ fontWeight: 600, paddingTop: "6pt" }}>{GROUP[g]}</td></tr>,
              ...rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td className="num">{b.amount != null ? money(b.amount) : <span className="assume">Needs inputs</span>}</td>
                  <td className="small">{b.basis}. <i>{b.sourceLabel}</i>{fn(x, ...notes(b.id))}</td>
                </tr>
              )),
            ];
          })}
          {pf.budget.some((b) => b.minor) && (
            <tr>
              <td>Closing, permit and carrying costs</td>
              <td className="num">{money(pf.budget.filter((b) => b.minor).reduce((t, b) => t + (b.amount ?? 0), 0))}</td>
              <td className="small">
                {pf.budget.filter((b) => b.minor).map((b) => `${b.label.toLowerCase()} ${money(b.amount)}`).join("; ")}
                {fn(x, "cost_config", ...(p.shares.permitsBasis.includes("PLI") ? ["pli_fee"] : []), "millage")}. Selling costs at sale are taken from the sale price (Section 9).
              </td>
            </tr>
          )}
          {p.exclusions.map((e) => (
            <tr key={`x-${e.id}`}>
              <td>{e.label}</td>
              <td className="num"><span className="assume">Not included</span></td>
              <td className="small">{e.reason}; cost not set yet (Awaiting local cost data).</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total development cost (TDC)</td>
            <td className="num">{pf.tdc != null ? money(pf.tdc) : <span className="assume">Needs inputs</span>}</td>
            <td className="small">land + hard + soft + contingency + financing{fn(x, "finance_engine")}</td>
          </tr>
          <tr>
            <td>Cost per home / per finished sq ft</td>
            <td className="num">{pf.costPerUnit != null ? money(pf.costPerUnit) : "—"}</td>
            <td className="small">{pf.costPerSf != null ? `${money(pf.costPerSf)} per finished sq ft` : "—"}</td>
          </tr>
        </tbody>
      </table>
      {pf.sentences[0] ? <p className="small">{pf.sentences[0]}</p> : null}
      <p className="small"><b>{assumptions.COST_CONFIG.disclaimer}</b></p>
      {p.outliers.length > 0 && (
        <Callout tone="red" title="Unusually high — verify">
          <ul>{p.outliers.map((o) => <li key={o}>{o}</li>)}</ul>
        </Callout>
      )}
      {p.minePath === "insurance" && p.msiPremium?.status === "ok" ? (
        <p className="small">
          Mine subsidence insurance path: {money(p.msiPremium.value, 2)} a year on {money(p.msiCoverage)} of coverage ({money(finance.MSI_CHART.baseFee, 2)} + {money(finance.MSI_CHART.perThousand, 2)} per $1,000)
          {fn(x, "msi_rates")}. It is a yearly owner cost, so it is not in the budget{m.scenario.tenure === "rent" ? "; it is in the operating costs in Section 8" : ""}. The grouting path ({money(assumptions.COST_CONFIG.siteAdders.mineGrouting.value)} lump sum, Local project data (owner-provided)) can be chosen instead on the parcel page.
        </p>
      ) : null}
      <p className="small">
        <b>Sanity check.</b> {pf.benchmark.line}
        {fn(x, "benchmarks")} National reference: {money(assumptions.COST_CONFIG.construction.nationalReference.value)} per sq ft for construction only (national reference, not a Pittsburgh default)
        {fn(x, "nahb")}.
      </p>
      {tt ? (
        <p className="small muted">
          Realty transfer tax is {num(tt.total_pct, 1)}% of the price{fn(x, "transfer_tax")}; the seller’s customary half is counted in selling costs (Section 9). The buyer’s half at purchase is not in the total above.
        </p>
      ) : null}
    </Sec>
  );
}

const has = (rows: { key: string; edited: boolean }[], key: string) => rows.some((r) => r.key === key && !r.edited);

// ---------------------------------------------------------------------------------------------
// 8. Operations

export function S8(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const pt = f.property_tax;
  const rp = m.rental;
  const a = f.assessment;
  const currentTax = pt?.general_mills != null && a?.fmv_total ? (a.fmv_total * pt.general_mills) / 1000 : null;
  const tTax = pt ? x.tab() : 0;
  const taxesAfter = TaxesAfterBlock(x);
  const tOps = x.tab();
  const mine = !!(overlay(m, "undermined_pgh") || f.mines?.msi_risk === "confirmed" || f.mines?.in_mined_out);
  return (
    <Sec flow id="s8" no="8" title="Operations (if rented)">
      <p>
        This section applies if the homes are rented. {m.scenario.tenure === "rent" ? "This study’s scenario is to rent." : "This study’s scenario is to sell; the rental view is shown for comparison."}
      </p>
      <h2>Property taxes</h2>
      {pt ? (
        <>
          <p>
            Total tax rate: <b>{num(pt.general_mills, 2)} mills</b>, meaning {money(pt.general_mills, 2)} of tax per $1,000 of assessed value each year
            {fn(x, "millage")}.{" "}
            {currentTax != null && (
              <>
                On today’s assessment of {money(a?.fmv_total)}{fn(x, "assessment")}, that is {money(a?.fmv_total)} ÷ 1,000 × {num(pt.general_mills, 2)} = <b>{money(currentTax)}</b> a year. A new
                building is reassessed higher; the estimate after completion is below.
              </>
            )}
          </p>
          <div className="tcap">Table {tTax}. Tax rate by taxing body, tax year {pt.year}{fn(x, "millage")}</div>
          <table>
            <thead><tr><th>Taxing body</th><th>Type</th><th className="num">Mills</th></tr></thead>
            <tbody>
              {pt.parts.map((p: { name: string; jurisdiction_type: string; mills: number }) => (
                <tr key={p.name + p.jurisdiction_type}><td>{titleCase(p.name)}</td><td>{p.jurisdiction_type.replace("_", " ")}</td><td className="num">{num(p.mills, 2)}</td></tr>
              ))}
              <tr className="total"><td>Total</td><td /><td className="num">{num(pt.general_mills, 2)}</td></tr>
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Millage is not loaded for this municipality.</p>
      )}
      {taxesAfter}
      <h2>Rent roll and operating costs</h2>
      <div className="tcap">Table {tOps}. Operating statement, from the finance engine{fn(x, "finance_engine")}</div>
      <table>
        <thead><tr><th style={{ width: "34%" }}>Measure</th><th>How it is figured</th><th>Result</th></tr></thead>
        <tbody>
          {receiptRows([
            [rp.income.gpr, "money"],
            [rp.income.vacancyLoss, "money"],
            [rp.income.egi, "money"],
            [rp.opex.taxes, "money"],
            [rp.opex.insurance, "money"],
            [rp.opex.management, "money"],
            [rp.opex.total, "money"],
            [rp.noi, "money"],
          ])}
        </tbody>
      </table>
      <p className="small">
        Rent used: {m.proForma.plan.revenue.rent.perUnit != null ? <>{money(m.proForma.plan.revenue.rent.perUnit)} a month per home ({m.proForma.plan.revenue.rent.basis}){fn(x, m.proForma.plan.revenue.rent.sourceLabel.startsWith("HUD") ? "hud_fmr" : "zori")}</> : "none available"}. Vacancy,
        maintenance, management, insurance and reserves are editable assumptions (Appendix C){fn(x, "cost_config")}; the tax uses the actual millage on the assessed value after completion, estimated from completed projects (table above){fn(x, "millage")}.
        {mine ? <> Mine subsidence insurance: {money(m.msiPer100k.value, 2)} a year per $100,000 of coverage{fn(x, "msi_rates")}.</> : null}
        {(f.flood_evidence?.sfha_share ?? 0) > 0 && f.flood_evidence?.tract_nfip_median_premium != null ? (
          <> Flood insurance reference: median premium in this tract {money(f.flood_evidence.tract_nfip_median_premium)} a year{fn(x, "nfip")}.</>
        ) : null}
      </p>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 9. Financing & returns

export function S9(x: Ctx) {
  const { m } = x;
  const fs = m.forSale;
  const rp = m.rental;
  const t1 = x.tab();
  const t2 = x.tab();
  return (
    <Sec flow id="s9" no="9" title="Financing and returns">
      <p>
        Every measure below is computed by the finance engine{fn(x, "finance_engine")} from the budget in Section 7 and the assumptions in Appendix C. Rows that
        still need an input (a market cap rate, a hold period, a discount rate) say what they need. The formula column is the math in plain words.
      </p>
      {SourcesUsesBlock(x)}
      <h2>If built to sell</h2>
      {m.proForma.plan.units != null && m.proForma.plan.finishedSf != null && (
        <p>
          <b>Size:</b> {m.proForma.plan.units} home{m.proForma.plan.units === 1 ? "" : "s"} × {sqft(Math.round(m.proForma.plan.finishedSf / m.proForma.plan.units))} finished. {m.proForma.plan.sizeBasis}.
        </p>
      )}
      {m.proForma.plan.sizeWarning && <Callout tone="amber" title="Small layout for new construction nearby"><p>{m.proForma.plan.sizeWarning}</p></Callout>}
      {CompsGrid(x)}
      {m.proForma.plan.priceCheck && <p><b>Check:</b> {m.proForma.plan.priceCheck}{fn(x, "nc_sales")}</p>}
      <p>
        {m.proForma.sale.grossSales != null ? (
          <>
            {(() => {
              // The comps give a median price per finished sq ft; the total is that times this plan's finished area.
              const sv = m.proForma.plan.revenue.sale;
              const basis = sv.basis.charAt(0).toLowerCase() + sv.basis.slice(1);
              const sf = sv.pricePerSf && !/^Your sale price per home/.test(sv.basis) ? m.proForma.sale.grossSales! / sv.pricePerSf : null;
              return sf != null ? (
                <>Sale value: {money(sv.pricePerSf)} per finished sq ft ({basis.replace(/ \((.+)\)$/, ", $1")}{sv.sourceLabel === "Your input" ? "" : fn(x, "nc_sales")}) × {num(sf)} finished sq ft = <b>{money(m.proForma.sale.grossSales)}</b>.</>
              ) : (
                <>Sale value: {basis}{sv.sourceLabel === "Your input" ? "" : fn(x, "nc_sales")} = <b>{money(m.proForma.sale.grossSales)}</b>.</>
              );
            })()} Selling costs: broker and closing{" "}
            {pct(assumptions.COST_CONFIG.sale.brokerShare.value)} plus the seller’s half of the transfer tax{fn(x, "cost_config", "transfer_tax")}.
          </>
        ) : (
          <>{m.proForma.plan.missing.find((t) => /sale value/i.test(t)) ?? m.proForma.plan.revenue.sale.basis}{fn(x, "nc_sales")}</>
        )}
      </p>
      {m.scenario.tenure === "sale" && m.proForma.sentences.length > 1 && (
        <ul className="small">{m.proForma.sentences.slice(1).map((t) => <li key={t}>{t}</li>)}</ul>
      )}
      <div className="tcap">Table {t1}. For-sale results</div>
      <table>
        <thead><tr><th style={{ width: "34%" }}>Measure</th><th>How it is figured</th><th>Result</th></tr></thead>
        <tbody>
          {receiptRows([
            [fs.sales.grossSales, "money"],
            [fs.sales.sellingCosts, "money"],
            [fs.costs.tdc, "money"],
            [fs.sales.profit, "money"],
            [fs.sales.profitMargin, "share"],
            [fs.financing.ltc, "share"],
            [fs.financing.equityRequired, "money"],
            [fs.returns.leveredIrr, "share"],
            [fs.returns.equityMultiple, "ratio"],
          ])}
        </tbody>
      </table>
      <h2>If built to rent</h2>
      {m.scenario.tenure === "rent" && m.proForma.sentences.length > 1 && (
        <ul className="small">{m.proForma.sentences.slice(1).map((t) => <li key={t}>{t}</li>)}</ul>
      )}
      <div className="tcap">Table {t2}. Rental results</div>
      <table>
        <thead><tr><th style={{ width: "34%" }}>Measure</th><th>How it is figured</th><th>Result</th></tr></thead>
        <tbody>
          {receiptRows([
            [rp.yieldOnCost, "share"],
            [rp.developmentSpread, "share"],
            [rp.stabilizedValue, "money"],
            [rp.financing.permanentLoan, "money"],
            [rp.financing.dscr, "ratio"],
            [rp.returns.cashOnCash, "share"],
            [rp.returns.unleveredIrr, "share"],
            [rp.returns.leveredIrr, "share"],
            [rp.returns.leveredNpv, "money"],
            [rp.returns.payback, "months"],
            [rp.returns.equityMultiple, "ratio"],
          ])}
        </tbody>
      </table>
      <p className="small muted">Lenders commonly look for income of at least about 1.2 times the loan payments (DSCR). That is a rule of thumb, not a quote.</p>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 10. Affordable

export function S10(x: Ctx) {
  const { m } = x;
  const td = m.facts.tract_designations;
  const lim = m.rentLimits;
  const amis = [...new Set(lim.map((l) => l.ami_pct))].filter((a) => a >= 30 && a <= 80);
  const t = lim.length ? x.tab() : 0;
  const cell = (ami: number, br: number) => lim.find((l) => l.ami_pct === ami && l.bedrooms === br)?.max_rent;
  return (
    <Sec flow id="s10" no="10" title="Affordable scenario">
      {m.scenario.affordable ? (
        <p>Affordable mode is on. Rents below are the most a household at each income level can be charged under the tax credit program.</p>
      ) : (
        <p>Affordable mode is off for this study. The limits and designations below are shown for reference.</p>
      )}
      <p>
        Census tract status: {td ? `${td.qct ? "a" : "not a"} HUD Qualified Census Tract; ${td.dda ? "in" : "not in"} a Difficult Development Area; ${td.opportunity_zone ? "in" : "not in"} an Opportunity Zone` : "not available"}
        {td ? fn(x, "tract_designations") : null}. Qualified tracts can raise tax-credit funding for a project.
      </p>
      {lim.length > 0 && (
        <>
          <div className="tcap">Table {t}. Maximum monthly rent by income level (percent of area median income, AMI), Allegheny County{fn(x, "phfa")}</div>
          <table>
            <thead><tr><th>Income level</th><th className="num">Studio</th><th className="num">1 BR</th><th className="num">2 BR</th><th className="num">3 BR</th><th className="num">4 BR</th></tr></thead>
            <tbody>
              {amis.map((a) => (
                <tr key={a}>
                  <td>{a}% AMI</td>
                  {[0, 1, 2, 3, 4].map((b) => <td key={b} className="num">{money(cell(a, b))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {m.proForma.sale.profit != null && m.proForma.sale.profit < 0 && m.proForma.plan.units ? (
        <Callout tone="amber" title="For-sale gap at market prices">
          <p>
            At today’s nearby sale prices this {m.proForma.plan.units > 1 ? "project" : "home"} is {money(-m.proForma.sale.profit)} short
            {m.proForma.plan.units > 1 ? ` (${money(-m.proForma.sale.profit / m.proForma.plan.units)} per home)` : ""}{fn(x, "cost_config", "nc_sales")}. That is roughly the subsidy or
            land write-down it would take to break even. For comparison, {assumptions.COST_CONFIG.benchmarks.homeownershipSubsidy.label.replace(/\s*\(.*\)$/, "").toLowerCase()} is estimated at{" "}
            {money(assumptions.COST_CONFIG.benchmarks.homeownershipSubsidy.range[0])} to {money(assumptions.COST_CONFIG.benchmarks.homeownershipSubsidy.range[1])}{fn(x, "subsidy_ref")}.
          </p>
        </Callout>
      ) : null}
      <Callout tone="pending" title="Rental funding gap: needs loan terms">
        <p>
          The rental gap is the total development cost{m.proForma.tdc != null ? ` (${money(m.proForma.tdc)}, Section 7)` : ""} minus what the restricted rents can support in a
          permanent loan and equity. It needs the lender’s minimum debt coverage, the permanent loan rate and term, and the equity you commit; none of these has a default.
        </p>
      </Callout>
      {AbatementBlock(x)}
      {PublicCostBenefit(x)}
      <h2>Possible sources to close a gap</h2>
      <ul>
        <li><b>Low-Income Housing Tax Credits (LIHTC)</b>: federal credits sold to investors for equity; awarded by PHFA through a competitive round.</li>
        <li><b>HOME and CDBG</b>: federal block grants passed through the City or County, often as soft loans.</li>
        <li><b>PHARE</b>: the state’s housing trust fund, administered by PHFA.</li>
        <li><b>Housing Opportunity Fund</b>: the City of Pittsburgh’s housing trust fund, administered by the Urban Redevelopment Authority.</li>
        <li><b>Tax abatements</b>: local programs that phase in the new assessed value; eligibility varies.</li>
      </ul>
      <p className="small muted">Program names are listed for awareness; no award amounts are assumed.</p>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 11. Sensitivity

export function S11(x: Ctx) {
  const { m } = x;
  const f = m.facts;
  const sv = m.sensitivity;
  const sale = m.proForma.plan.tenure === "sale";
  const t = x.tab();
  const fig = x.fig();
  const monthlyTax = f.property_tax?.general_mills != null && f.assessment?.fmv_total ? (f.assessment.fmv_total * f.property_tax.general_mills) / 1000 / 12 : null;
  const cfg = assumptions.COST_CONFIG.sensitivity;
  const moveText = (id: string, v: number) =>
    id.startsWith("constructionRate") ? `${v >= 0 ? "+" : "−"}${num(Math.abs(v) * 100, 0)} pt` : id.startsWith("approvalDelay") ? `+${num(v, 0)} mo` : `${v >= 0 ? "+" : "−"}${num(Math.abs(v) * 100, 0)}%`;
  const rows = sv.tornado.map((r) => ({ label: r.label, lowLabel: moveText(r.id, r.low), highLabel: moveText(r.id, r.high), valueAtLow: r.valueAtLow, valueAtHigh: r.valueAtHigh }));
  const delay = sv.tornado.find((r) => r.id.startsWith("approvalDelay"));
  const be = sv.breakEvenCostIncrease;
  const bp = sv.breakEvenPriceChange;
  return (
    <Sec flow id="s11" no="11" title="Sensitivity and scenarios">
      <p>
        Sensitivity shows which assumption moves the result most{fn(x, "finance_engine")}. {sv.moves.join(" ")}{fn(x, "cost_config")}
      </p>
      <div className="tcap">Table {t}. Sensitivity scenarios, not the estimate&apos;s range ({sale ? "built to sell" : "built to rent"})</div>
      <table>
        <thead><tr><th>Measure</th>{sv.scenarios.map((sc) => <th key={sc.id} className="num">{sc.label}</th>)}</tr></thead>
        <tbody>
          <tr><td>Total development cost</td>{sv.scenarios.map((sc) => <td key={sc.id} className="num">{sc.tdc != null ? money(sc.tdc) : <span className="assume">Needs inputs</span>}</td>)}</tr>
          <tr><td>{sv.metricLabel}</td>{sv.scenarios.map((sc) => <td key={sc.id} className="num">{sc.result != null ? money(sc.result) : <span className="assume">Needs inputs</span>}</td>)}</tr>
          <tr><td>{sv.ratioLabel}</td>{sv.scenarios.map((sc) => <td key={sc.id} className="num">{sc.ratio != null ? `${sc.ratio < 0 ? "−" : ""}${pct(Math.abs(sc.ratio), 1)}` : "—"}</td>)}</tr>
        </tbody>
      </table>
      {(() => {
        // The range the parcel page, metrics bar and Section 9 show comes from each input's documented range
        // (combined as independent uncertainties); these scenarios move three inputs together instead.
        const rg = m.proForma.ranges;
        const ratio = sale ? rg.sale.marginPct : rg.rent.yieldOnCostPct;
        const pr = (v: number) => `${v < 0 ? "−" : ""}${num(Math.abs(v), 1)}%`;
        return rg.tdc && ratio ? (
          <p className="small">
            These scenarios are what-ifs that move construction cost, {sale ? "sale price" : "rent"} and the interest rate together. The estimate&apos;s range shown on the parcel page
            comes from each input&apos;s documented range instead: total cost {money(rg.tdc.low)} to {money(rg.tdc.high)}, {sale ? "profit margin" : "yield on cost"} {pr(ratio.low)} to {pr(ratio.high)} (likely {pr(ratio.likely)}).
          </p>
        ) : null;
      })()}
      <figure>
        {sv.base != null && rows.some((r) => r.valueAtLow != null || r.valueAtHigh != null) ? (
          <Tornado rows={rows} base={sv.base} money={(n) => money(n)} />
        ) : (
          <TornadoPending variables={rows.map((r) => r.label)} />
        )}
        <figcaption>
          <b>Figure {fig}.</b> Which assumption matters most: {sv.metricLabel.toLowerCase()} when each assumption is moved down (light) and up (dark), one at a time, largest swing first{fn(x, "cost_config")}.
        </figcaption>
      </figure>
      <h2>Break-even points</h2>
      {sale ? (
        <ul>
          <li>
            {be?.status === "ok"
              ? be.value >= 0
                ? <>Profit stays above zero as long as construction costs rise less than <b>{pct(be.value, 1)}</b>.</>
                : <>Construction costs would have to fall by <b>{pct(-be.value, 1)}</b> for the project to break even.</>
              : <span className="assume">Break-even cost change: {be?.status === "not computable" ? be.reason : "needs a sale value"}.</span>}
          </li>
          <li>
            {bp?.status === "ok"
              ? bp.value >= 0
                ? <>It breaks even if sale prices come in <b>{pct(bp.value, 1)}</b> above the comps{m.proForma.plan.revenue.sale.pricePerSf != null ? ` (about ${money(m.proForma.plan.revenue.sale.pricePerSf * (1 + bp.value))} per sq ft)` : ""}.</>
                : <>Sale prices could fall <b>{pct(-bp.value, 1)}</b> below the comps before it breaks even.</>
              : <span className="assume">Break-even sale price: {bp?.status === "not computable" ? bp.reason : "needs a sale value"}.</span>}
          </li>
        </ul>
      ) : (
        <p className="assume">Break-even rent needs a discount rate, hold period and exit cap rate, which have no defaults yet.</p>
      )}
      <h2>Cost of approval delays</h2>
      <p>
        Every month of delay adds holding costs: taxes, insurance and loan interest. Taxes alone on today’s assessment are about{" "}
        {monthlyTax != null ? (
          <>
            <b>{money(monthlyTax)}</b> a month ({money(f.assessment?.fmv_total)} × {num(f.property_tax?.general_mills, 2)} ÷ 1,000 ÷ 12){fn(x, "assessment", "millage")}
          </>
        ) : (
          "unknown"
        )}
        .{delay && delay.valueAtHigh != null && sv.base != null ? <> In this model a {num(cfg.delayMonths.value, 0)}-month approval delay changes {sv.metricLabel.toLowerCase()} by {money(delay.valueAtHigh - sv.base)}{fn(x, "finance_engine")}.</> : null}
      </p>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 12. Risks

export function S12(x: Ctx) {
  const { m } = x;
  const flags = redFlags(m);
  const reviews = reviewItems(m, m.score.status === "ready" ? m.score.reviewCallouts.map((c) => c.title) : []);
  const approvals = m.scheme?.byRight ? [] : approvalItems(m);
  const gaps = dataGaps(m);
  const tG = x.tab();
  const permission = m.scheme?.permission;
  return (
    <Sec flow id="s12" no="12" title="Risks and mitigations">
      <h2>Red flags</h2>
      <p className="small muted">Only three things are red flags: the FEMA floodway, no legal access, or an active contamination site on the parcel.</p>
      {flags.length ? (
        flags.map((f) => (
          <Callout key={f.title} tone="red" title={f.title}>
            <p>{f.reason}{fn(x, ...f.sources)}</p>
            <p><b>Mitigation:</b> {f.mitigation}</p>
          </Callout>
        ))
      ) : (
        <p>None found in our data.</p>
      )}
      <h2>Review required</h2>
      {m.score.status === "ready" &&
        m.score.reviewCallouts.map((c) => (
          <Callout key={`e-${c.title}`} tone="amber" title={c.title.replace(/^Review required:\s*/i, "").replace(/^./, (ch) => ch.toUpperCase())}>
            <p>{c.reason}{fn(x, "ease_score")}</p>
            {c.next.length > 0 && <p><b>What to do:</b> {c.next.join(" ")}</p>}
            {c.costNotes.length > 0 && <p className="small"><b>Cost notes (editable defaults, not quotes):</b> {c.costNotes.join(" ")}</p>}
          </Callout>
        ))}
      {reviews.length ? (
        reviews.map((f) => (
          <Callout key={f.title} tone="amber" title={f.title}>
            <p>{f.reason}{fn(x, ...f.sources)}</p>
            <p><b>Mitigation:</b> {f.mitigation}</p>
          </Callout>
        ))
      ) : m.score.status === "ready" && m.score.reviewCallouts.length ? null : (
        <p>No review items found in our data.</p>
      )}
      <h2>Zoning permission</h2>
      {permission && permission.code !== "P" ? (
        <Callout tone="amber" title={`${titleCase(permission.use)}: ${PERMISSION_TEXT[permission.code ?? ""] ?? permission.code}`}>
          <p>Permission for this use is part of the zoning analysis (Section 4) and is weighed in the Ease Score, not treated as a red flag{fn(x, "zoning_rules")}.</p>
        </Callout>
      ) : null}
      {approvals.length ? (
        approvals.map((f) => (
          <Callout key={f.title} tone="plain" title={f.title}>
            <p>{f.reason}{fn(x, ...f.sources)}</p>
            <p><b>Mitigation:</b> {f.mitigation}</p>
          </Callout>
        ))
      ) : (
        <p>No discretionary zoning approval is needed for the studied scheme.</p>
      )}
      <h2>Data gaps</h2>
      <div className="tcap">Table {tG}. Missing inputs and what they affect</div>
      <table>
        <thead><tr><th style={{ width: "26%" }}>Missing</th><th>Effect on this study</th><th style={{ width: "32%" }}>How to close it</th></tr></thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.what}><td>{g.what}</td><td>{g.effect}</td><td>{g.mitigation}</td></tr>
          ))}
        </tbody>
      </table>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// 13. Conclusion

export function S13(x: Ctx) {
  const { m } = x;
  const steps = nextSteps(m);
  const reviews = reviewItems(m);
  const flags = redFlags(m);
  const must: string[] = [];
  flags.forEach((f) => must.push(`The red flag “${f.title.toLowerCase()}” is resolved.`));
  if (m.scheme && !m.scheme.byRight) must.push(`The needed approval${m.scheme.approvals.length > 1 ? "s are" : " is"} granted: ${m.scheme.approvals.map((a) => a.label.toLowerCase()).join("; ")}.`);
  const reviewTitles = [...(m.score.status === "ready" ? m.score.reviewCallouts.map((c) => c.title.replace(/^Review required:\s*/i, "")) : []), ...reviews.map((r) => r.title)];
  if (reviewTitles.length)
    must.push(`Professionals check the review items (${[...new Set(reviewTitles.map((t) => t.toLowerCase()))].join("; ")}) and find nothing that stops the project or pushes the cost too high.`);
  must.push(
    m.proForma.verdict === "no"
      ? "Costs come down, or the value goes up, enough to close the gap in Section 10 (for example through a lower land price, a simpler design, or a subsidy)."
      : "A local contractor’s bid confirms the estimated cost in Section 7, including the items not included yet.",
  );
  must.push("A survey confirms the lot lines, frontage and buildable area.");
  return (
    <Sec flow id="s13" no="13" title="Conclusion and next steps">
      <p>
        This study is decision support, not a recommendation to buy or build. It shows what public data and published rules say about this lot, and what is
        still unknown.
      </p>
      <h2>What must be true for this to work</h2>
      <ol>{must.map((t) => <li key={t}>{t}</li>)}</ol>
      <h2>First three actions</h2>
      <ol>
        {steps.map((r) => (
          <li key={r.id}>
            <b>{r.item}</b> ({r.issuer}). {r.reasons[0]?.reason}
            {fn(x, "requirements")}
          </li>
        ))}
        {steps.length < 3 && <li>Get a local construction cost estimate for the studied scheme.</li>}
      </ol>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// Appendices

export function AppA(x: Ctx) {
  const list = x.c.list();
  return (
    <Sec id="appA" no="A" title="Sources and data dates">
      <p className="small">Numbered in the order first cited. “Vintage not recorded” means our database does not store the publisher’s data date yet.</p>
      <ol className="sources" style={{ listStyle: "none", paddingLeft: 0 }}>
        {list.map((s) => (
          <li key={s.key}>
            <b>[{s.n}]</b> {s.title}. {s.publisher ? `${s.publisher}. ` : ""}
            <i>{s.date ?? NOT_RECORDED}.</i>
            {s.note ? ` ${s.note}` : ""}
            {s.url ? (
              <>
                {" "}
                <a className="ext" href={s.url}>{s.url}</a>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </Sec>
  );
}

export function AppB(x: Ctx) {
  const { m } = x;
  const formulas = new Map<string, string>();
  const collect = (o: unknown, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 4) return;
    if ("formula" in o && "label" in o && typeof (o as finance.Receipt).formula === "string") {
      const r = o as finance.Receipt;
      if (!formulas.has(r.label)) formulas.set(r.label, r.formula);
      return;
    }
    for (const v of Object.values(o)) collect(v, depth + 1);
  };
  collect(m.forSale);
  collect(m.rental);
  const t = x.tab();
  return (
    <Sec id="appB" no="B" title="Methods and formulas">
      <h2>Site and data methods</h2>
      <ul>
        <li><b>Slope.</b> Slope is computed for each 1 m lidar cell inside the lot; shares are the fraction of cells above 15%, 25% and 40%{fn(x, "slope_1m")}.</li>
        <li><b>Overlays.</b> A hazard or zoning overlay’s share is the part of the lot’s area inside it.</li>
        <li><b>Street frontage.</b> A lot fronts a street when an opened street centerline is within 20 m; front edges are the lot edges nearest that street{fn(x, "streets")}.</li>
        <li><b>Sales comps.</b> {(m.sales?.rules ?? "Valid arm’s-length sales, same use, nearest first").replace(/\.?$/, ".")} The search widens by distance and years until at least 5 are found{fn(x, "sales")}.</li>
        <li><b>Zoning decision rates.</b> Granted ÷ (granted + denied), shown only when at least 5 requests were decided; partial grants, withdrawals and pending items are left out{fn(x, "zba")}.</li>
        <li><b>Requirements.</b> Each item is REQUIRED only when a cited law or rule requires it for this lot and project; otherwise it is Likely, Possible, Ask, or Not needed, with the reason shown{fn(x, "requirements")}.</li>
      </ul>
      <h2>Site-fit solver (QuickFit)</h2>
      <p>
        The buildable area is the lot minus a setback strip along each edge, minus any area that must be removed (only the FEMA floodway today). Unit rectangles are
        packed along the frontage and made as deep as allowed. Each scheme is checked for use permission, height and stories, lot size and lot area per unit,
        parking, and floor area ratio and coverage when the district has them. The limiting rule is found by relaxing each rule in turn. Footprints are
        rectangles; one building per lot{fn(x, "quickfit")}.
      </p>
      <h2>Finance formulas</h2>
      <div className="tcap">Table {t}. Formulas used by the finance engine{fn(x, "finance_engine")}</div>
      <table>
        <thead><tr><th style={{ width: "40%" }}>Measure</th><th>Formula</th></tr></thead>
        <tbody>
          {[...formulas.entries()].map(([k, v]) => (
            <tr key={k}><td>{k}</td><td className="small">{v}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Returns are computed from monthly cash flows; a yearly rate = (1 + monthly rate)^12 − 1. Property tax = assessed value × mills ÷ 1,000. Mine subsidence
        insurance = $3.75 + $0.25 per $1,000 of coverage{fn(x, "msi_rates")}.
      </p>
    </Sec>
  );
}

export function AppC(x: Ctx) {
  const { m } = x;
  const t1 = x.tab();
  const t2 = x.tab();
  const a = quickfit.DEFAULT_ASSUMPTIONS;
  const presets = [quickfit.SINGLE_FAMILY, quickfit.DUPLEX, quickfit.TOWNHOUSE_ROW];
  const plan = m.proForma.plan;
  const cc = assumptions.COST_CONFIG;
  const t3 = x.tab();
  const srcKey = (label: string): string[] =>
    label.startsWith("Pittsburgh builder") ? ["builder_ranges"]
      : label.startsWith("Pittsburgh PLI") ? ["pli_fee"]
      : label.startsWith("PA DEP") ? ["msi_rates"]
      : label.startsWith("Bank prime") ? ["prime"]
      : label.startsWith("County assess") ? ["assessment"]
      : label.startsWith("Allegheny County sales (valid new") ? ["nc_sales"]
      : label.startsWith("Allegheny County sales") ? [m.sfComps === m.sales ? "sales" : "sf_sales"]
      : label.startsWith("Zillow") ? ["zori"]
      : label.startsWith("HUD") ? ["hud_fmr"]
      : label.startsWith("Transfer tax") ? ["transfer_tax"]
      : label.startsWith("Allegheny County Treasurer") ? ["millage"]
      : label.startsWith("Site-fit") ? ["quickfit"]
      : label.startsWith("Ease Score") ? ["ease_score"]
      : ["cost_config"];
  return (
    <Sec flow id="appC" no="C" title="Assumptions used">
      <p>Every value the study used, and every value it still needs. “Placeholder” means an editable starting point, not a standard.</p>
      <div className="tcap">Table {t1}. Site-fit building sizes (placeholders){fn(x, "quickfit")}</div>
      <table>
        <thead><tr><th>Building type</th><th>Unit width</th><th>Unit depth</th><th>Stories</th><th>Floor to floor</th><th>Garage tried</th></tr></thead>
        <tbody>
          {presets.map((p) => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td>{p.unitWidthFt.min}–{p.unitWidthFt.max} ft</td>
              <td>{p.unitDepthFt.min}–{p.unitDepthFt.max} ft</td>
              <td>{p.stories.min}–{p.stories.max}</td>
              <td>{p.floorToFloorFt} ft</td>
              <td>{p.garage ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Other solver placeholders: livable share of floor area {pct(a.efficiency)}; garage bay {a.garageWidthFt} × {a.garageDepthFt} ft; surface stall with drive {a.surfaceStallAreaSf} sq ft; {a.spacesPerUnit} space
        per home when parking is chosen (never below the minimum).
      </p>
      <div className="tcap">Table {t2}. Pro forma inputs used ({plan.configVersion}, effective {cc.effectiveDate})</div>
      <table>
        <thead><tr><th style={{ width: "36%" }}>Input</th><th style={{ width: "22%" }}>Value used</th><th style={{ width: "14%" }}>Range</th><th>Source</th></tr></thead>
        <tbody>
          {plan.assumptions.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.value === "not set" ? <span className="assume">Not set</span> : r.value}</td>
              <td className="small">{r.range ?? "—"}</td>
              <td className="small">{r.sourceLabel}{r.sourceNote ? ` — ${r.sourceNote}` : ""}{fn(x, ...(r.edited ? [] : srcKey(r.sourceLabel)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Not set yet (no default, so never counted): market cap rate, discount rate, hold period and exit cap rate (rental returns), permanent loan terms, minimum debt coverage. Items that apply but have
        no local cost are listed in Section 7 as not included.
      </p>
      <div className="tcap">Table {t3}. Construction cost tiers (cost to build per finished sq ft, builder fee removed){fn(x, "builder_ranges")}</div>
      <table>
        <thead><tr><th>Tier</th><th>What it means</th><th className="num">Range</th><th className="num">Default</th><th className="num">Published retail (cross-check)</th></tr></thead>
        <tbody>
          {cc.construction.tiers.map((t) => (
            <tr key={t.id} style={t.id === plan.tier.id ? { fontWeight: 600 } : undefined}>
              <td>{t.label}{t.id === plan.tier.id ? " (used)" : ""}</td>
              <td>{t.meaning}</td>
              <td className="num">{money(t.costPerSf.range[0])}–{money(t.costPerSf.range[1])}{t.id === "custom" ? "+" : ""}</td>
              <td className="num">{money(t.costPerSf.value)}</td>
              <td className="num">{money(t.retail.range[0])}–{money(t.retail.range[1])}{t.id === "custom" ? "+" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Site adders on top of the tier (slope measured under the building footprint): moderate slope (over 15%) +{money(cc.siteAdders.moderateSlope.value)} per sq ft of building footprint (range {money(cc.siteAdders.moderateSlope.range[0])}–{money(cc.siteAdders.moderateSlope.range[1])}); steep slope or stepped
        foundation +{money(cc.siteAdders.steepSlope.value)} per sq ft of footprint (range {money(cc.siteAdders.steepSlope.range[0])}–{money(cc.siteAdders.steepSlope.range[1])}) plus retaining walls {money(cc.siteAdders.retainingWalls.value)} per building, all “{cc.siteAdders.steepSlope.sourceLabel}”; mine grouting{" "}
        {money(cc.siteAdders.mineGrouting.value)} (range {money(cc.siteAdders.mineGrouting.range[0])}–{money(cc.siteAdders.mineGrouting.range[1])}), “{cc.siteAdders.mineGrouting.sourceLabel}”; geotechnical report, demolition and
        dumpsters: awaiting local cost data{fn(x, "cost_config")}.
      </p>
    </Sec>
  );
}

export function AppD(x: Ctx) {
  const { m } = x;
  const s = m.score;
  if (s.status !== "ready") {
    return (
      <Sec flow id="appD" no="D" title="Ease Score breakdown">
        <Callout tone="pending" title={s.partial ? "Partial screen: no Ease Score" : "Ease Score pending"}>
          <p>{s.reason}</p>
        </Callout>
      </Sec>
    );
  }
  const t = x.tab();
  const t2 = x.tab();
  const t3 = s.unlocks.length ? x.tab() : 0;
  return (
    <Sec flow id="appD" no="D" title="Ease Score breakdown">
      <p>
        The Ease Score (0–100) measures the barriers to getting housing built on this lot: rules, ground, hazards, access and process. It measures barriers to building, not whether it&apos;s a good investment. Money is not in it; that is the
        separate “Pencils?” result. Score for <b>{s.strategyLabel.toLowerCase()}</b>:{" "}
        <b>{s.range ? `${s.range.min}–${s.range.max}` : s.score}{s.band ? ` (${ease.bandLabel(s.band)})` : ""}</b>
        {fn(x, "ease_score")}. Factors with evidence carry {pct(s.evidenceShare)} of the weight.
        {s.labels.length ? ` Labels: ${s.labels.map(ease.relabelBands).join("; ")}.` : ""} Scoring config {s.configVersion}.
      </p>
      <div className="tcap">Table {t}. Factors (score = weighted average of factors with evidence)</div>
      <table>
        <thead><tr><th style={{ width: "24%" }}>Factor</th><th className="num" style={{ width: "8%" }}>Weight</th><th className="num" style={{ width: "10%" }}>Sub-score</th><th style={{ width: "12%" }}>Evidence</th><th>In plain words</th></tr></thead>
        <tbody>
          {s.factors.map((f) => (
            <tr key={f.id}>
              <td>{f.id} · {f.label}</td>
              <td className="num">{f.weight}</td>
              <td className="num">{f.subscore == null ? "—" : num(f.subscore, 0)}</td>
              <td>{f.evidence}{f.partialCoverage ? " (partial coverage)" : ""}</td>
              <td className="small">{f.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tcap">Table {t2}. Score by building strategy</div>
      <table>
        <thead><tr><th>Strategy</th><th className="num">Score</th><th>Band</th></tr></thead>
        <tbody>
          {s.others.map((o) => (
            <tr key={o.label}><td>{o.label}</td><td className="num">{o.applicable ? (o.score ?? "—") : "n/a"}</td><td>{o.applicable ? (o.band ? ease.bandLabel(o.band) : "—") : "Not applicable"}</td></tr>
          ))}
        </tbody>
      </table>
      {t3 > 0 && (
        <>
          <div className="tcap">Table {t3}. Policy what-ifs: change in the best score and in homes allowed by right</div>
          <table>
            <thead><tr><th>Policy change</th><th className="num">Score change</th><th className="num">Homes change</th><th>Note</th></tr></thead>
            <tbody>
              {s.unlocks.map((u) => (
                <tr key={u.label}>
                  <td>{u.label}</td>
                  <td className="num">{u.scoreDelta == null ? "—" : `${u.scoreDelta > 0 ? "+" : ""}${num(u.scoreDelta, 0)}`}</td>
                  <td className="num">{u.unitsDelta == null ? "—" : `${u.unitsDelta > 0 ? "+" : ""}${u.unitsDelta}`}</td>
                  <td className="small">{u.evaluated ? "" : u.reason ?? "Not evaluated"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {s.notes.length > 0 && (
        <>
          <h3>Engine notes</h3>
          <ul className="small">{[...new Set(s.notes)].map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </Sec>
  );
}

export function AppE(x: Ctx) {
  const { m } = x;
  const gaps = dataGaps(m);
  const noDate = x.c.list().filter((s) => (s.date ?? NOT_RECORDED) === NOT_RECORDED).length;
  return (
    <Sec flow id="appE" no="E" title="Limitations">
      <h2>What this study is and is not</h2>
      <p>
        It is a screening study built from public data and published rules, computed the same way every time. It is not an appraisal, a zoning determination, a
        survey, an environmental assessment, or engineering, legal or financial advice. Verify every item with the permitting office, a surveyor, an engineer,
        your lender and your accountant.
      </p>
      <h2>Who this helps and who it could hurt</h2>
      <p>
        It helps homeowners, small builders, nonprofits and planners see the rules, hazards and costs of a lot early, before paying a consultant. It could
        hurt people in these ways, and this is what the tool does today:
      </p>
      <ul>
        <li><b>Buying on an estimate.</b> A lot that “fits” here may not fit after a survey or engineer looks. Scores and costs show ranges, each number cites its source, and this study lists its data gaps.</li>
        <li><b>Targeting owners behind on taxes.</b> No owner names are stored or shown. Tax-delinquency filters and labels apply to publicly owned land only; a private owner’s tax status is never shown or exported. There is no “motivated seller” feature.</li>
        <li><b>Displacement where rents are rising.</b> The Policy and Nonprofit seats show rent burden as context. It is never used to compute the Ease Score.</li>
        <li><b>Thin data.</b> Areas with less data get wider ranges or a “Preliminary — insufficient evidence” score instead of one number, which can steer attention by data quality rather than need.</li>
        <li><b>Older homes.</b> Buildings that would not meet today’s code point to the rule, not the house. This study does not rule on whether any home is legal to keep.</li>
      </ul>
      <p className="small">More at easescore.ai/limitations#who-it-helps.</p>
      <h2>What the tool can get wrong</h2>
      <ul>
        <li>GIS lot lines, street frontage and building footprints can be off by several feet, which matters on small lots.</li>
        <li>The site-fit solver uses rectangular footprints and placeholder sizes, and does not yet remove steep ground from the buildable area.</li>
        <li>Zoning rules were transcribed by hand; overlays, compatibility standards and some exceptions are not modeled.</li>
        <li>Mine maps are incomplete; the absence of a mapped mine does not prove there is none.</li>
        <li>Rents are asking rents, property taxes after building are estimates (the County sets them), and permit times are City targets, not guaranteed.</li>
        <li>Sales comps are mostly older homes, so they are a reference for new construction, not a price.</li>
        <li>Past zoning decisions describe history, not the outcome of any future case.</li>
      </ul>
      <h2>Data gaps for this parcel</h2>
      <ul>{gaps.map((g) => <li key={g.what}><b>{g.what}:</b> {g.effect}</li>)}</ul>
      {noDate > 0 && <p className="small">{noDate} of the cited sources do not yet have a data date recorded in our database (see Appendix A).</p>}
      <h2>Use of AI</h2>
      <p>
        No number in this study comes from an AI model. All numbers are computed by deterministic code from the cited data. The plain-English sentences in this
        version are written from fixed templates. The EaseScore.AI product was built with the help of AI coding tools, disclosed in the project README.
      </p>
      <p className="small muted">No personal information (owner names or contact details) is used or shown.</p>
    </Sec>
  );
}

export function AppF() {
  const terms: [string, string][] = [
    ["AMI (area median income)", "The middle household income for the region. Affordable rents are set as a percent of it."],
    ["By right", "Allowed without a public hearing, as long as the project meets the written rules."],
    ["CAPEX", "The one-time money to buy the land and build."],
    ["Cap rate", "A property’s yearly net income divided by its value. Buyers use it to price rentals."],
    ["Combined sewer", "Old pipes that carry both rainwater and sewage. In heavy rain they can back up."],
    ["Comps (comparable sales)", "Recent sales of similar nearby homes, used as a price reference."],
    ["Conditional use", "A use that needs Planning Commission review and City Council approval."],
    ["Contingency", "Money set aside for surprises during construction."],
    ["DSCR (debt service coverage ratio)", "Yearly net income divided by yearly loan payments. Lenders want it above about 1.2."],
    ["Equity", "The cash the owner puts in, as opposed to the loan."],
    ["FAR (floor area ratio)", "Total floor area divided by lot area."],
    ["Floodway", "The channel of a river or stream and the land next to it that must stay open to carry floodwater."],
    ["Geotechnical report", "An engineer’s study of the soil and rock, used to design foundations and walls."],
    ["Hard costs", "The cost of physical construction: labor and materials."],
    ["IRR (internal rate of return)", "The yearly return a project earns over its life, counting when money goes in and comes out."],
    ["LIHTC", "Low-Income Housing Tax Credits: federal credits that raise equity for affordable housing."],
    ["Mill (millage)", "Property tax rate: one mill is $1 of tax per $1,000 of assessed value."],
    ["NOI (net operating income)", "Rent collected minus the costs of running the building, before loan payments."],
    ["NPV (net present value)", "Today’s value of all future cash flows minus what you put in."],
    ["Pro forma", "A projection of a project’s costs, income and returns."],
    ["Setback", "The required distance between a building and a lot line."],
    ["Soft costs", "Costs that are not physical construction: design, engineering, permits, legal, insurance."],
    ["Special exception", "A use the Zoning Board can allow after a hearing if set conditions are met."],
    ["TDC (total development cost)", "Everything it costs to buy, build and finance the project."],
    ["Undermined", "Land above old underground mines, which can settle (subsidence)."],
    ["Variance", "Permission from the Zoning Board to break a written rule, usually for a hardship."],
    ["Yield on cost", "Yearly net income divided by total development cost."],
  ];
  return (
    <Sec flow id="appF" no="F" title="Glossary">
      <dl className="gloss">
        {terms.map(([t, d]) => (
          <div key={t} className="avoid-break">
            <dt>{t}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </Sec>
  );
}

// ---------------------------------------------------------------------------------------------
// Report additions: product-type comparison, absorption, sources and uses, tax abatement,
// public cost vs public benefit, and the limiting conditions (Section 14).

const VERDICT_WORD: Record<string, string> = { yes: "Pencils", thin: "Thin", no: "Does not pencil" };

function pfCells(pf: assumptions.ProFormaResult | null) {
  if (!pf) return { cost: "—", value: "—", result: "—", ratio: "—", verdict: "Not computed" };
  const sale = pf.plan.tenure === "sale";
  if (pf.plan.missing.length) return { cost: money(pf.tdc), value: "—", result: "—", ratio: "—", verdict: `Can’t tell yet: ${pf.plan.missing[0]!.split(". ")[0]}` };
  return {
    cost: money(pf.tdc),
    value: sale ? `${money(pf.sale.grossSales)} in sales` : `${money(pf.rent.noi)} a year after running costs`,
    result: sale ? (pf.sale.profit != null ? (pf.sale.profit >= 0 ? `${money(pf.sale.profit)} profit` : `${money(-pf.sale.profit)} gap`) : "—") : pf.rent.yieldOnCost != null ? `${pct(pf.rent.yieldOnCost, 1)} yield on cost` : "—",
    ratio: sale ? (pf.sale.margin != null ? `${pct(pf.sale.margin, 1)} margin` : "—") : pf.rent.yieldOnCost != null ? `${pct(pf.rent.yieldOnCost, 1)} a year` : "—",
    verdict: pf.verdict ? VERDICT_WORD[pf.verdict]! : pf.plan.tenure === "rent" ? "Unlevered yield shown; a local cap rate is needed to value it" : "—",
  };
}

function precedentText(p: narrative.SummaryPrecedent | null, district: string | null): string {
  if (!p) return "No Zoning Board hearing (staff decision)";
  if (p.decided === 0) return "No nearby precedent on record";
  const phrase = narrative.precedentPhrase(p, district);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function ProductTable(x: Ctx) {
  const { m } = x;
  const p = m.plans;
  if (!p || (!p.byRight && !p.withApproval && !m.affordable)) return null;
  const t = x.tab();
  const district = p.summaryInput.district;
  const cols: { head: string; build: string; homes: string; path: string; precedent: string; cells: ReturnType<typeof pfCells> }[] = [];
  if (p.byRight) cols.push({ head: "Best by right", build: p.byRight.label, homes: num(p.byRight.units), path: "Allowed by right", precedent: "Not needed", cells: pfCells(p.byRight.pf) });
  else cols.push({ head: "Best by right", build: "Nothing fits by right", homes: "—", path: "—", precedent: "—", cells: pfCells(null) });
  if (p.withApproval) cols.push({ head: "Best with approval", build: p.withApproval.label, homes: num(p.withApproval.units), path: `Needs ${p.withApproval.approval}`, precedent: precedentText(p.withApproval.precedent, district), cells: pfCells(p.withApproval.pf) });
  else cols.push({ head: "Best with approval", build: "No larger option found", homes: "—", path: "—", precedent: "—", cells: pfCells(null) });
  const af = m.affordable;
  if (af) cols.push({ head: `Affordable (${af.ami}% AMI rental)`, build: `${af.option.charAt(0).toUpperCase()}${af.option.slice(1)}, rented at ${money(af.rent)} a month (${af.bedrooms} BR limit, ${af.year})`, homes: num(af.pf.plan.units), path: p.byRight ? "Allowed by right" : `Needs ${p.withApproval?.approval ?? "an approval"}`, precedent: "—", cells: pfCells(af.pf) });
  const rows: [string, (c: (typeof cols)[number]) => string][] = [
    ["Building", (c) => c.build],
    ["Homes", (c) => c.homes],
    ["Zoning path", (c) => c.path],
    ["Past decisions", (c) => c.precedent],
    ["Total development cost", (c) => c.cells.cost],
    ["Value or income", (c) => c.cells.value],
    ["Profit or gap", (c) => c.cells.result],
    ["Margin or yield", (c) => c.cells.ratio],
    ["Pencils?", (c) => c.cells.verdict],
  ];
  return (
    <>
      <h2>Product types compared</h2>
      <p className="small">
        Each column runs the same cost builder and finance engine with the default assumptions{fn(x, "cost_config", "finance_engine")}. By right means no hearing; “with approval”
        is the option that fits the most homes with zoning relief{fn(x, "quickfit", "zba")}. The affordable column rents the by-right building at the tax-credit rent limit{fn(x, "phfa")};
        its funding gap needs loan terms (Section 10). These layouts come from the Ease Score’s site-fit check, so their size can differ from the scheme studied in
        Sections 7 to 9.
      </p>
      <div className="tcap">Table {t}. By-right best vs. with-approval best vs. affordable</div>
      <table>
        <thead><tr><th scope="col" style={{ width: "20%" }}>Measure</th>{cols.map((c) => <th scope="col" key={c.head}>{c.head}</th>)}</tr></thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}><th scope="row">{label}</th>{cols.map((c) => <td key={c.head} className="small">{f(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function AbsorptionBlock(x: Ctx) {
  const a = absorption(x.m);
  const rent = x.m.scenario.tenure === "rent";
  return (
    <>
      <h2>Absorption and lease-up</h2>
      <p>
        {a.ncCount != null && a.ncPerYear != null ? (
          <>Support from comps: {num(a.ncCount)} new-construction home sale{a.ncCount === 1 ? "" : "s"} within {a.ncRadiusMi != null ? +a.ncRadiusMi.toFixed(2) : "—"} mi over the last {num(a.ncYears)} years, about {num(a.ncPerYear, 1)} a year{fn(x, "nc_sales")}. </>
        ) : null}
        {a.salesCount != null && a.salesPerYear != null ? (
          <>Nearby valid sales of the comparable use: {num(a.salesCount)} within {a.salesRadiusMi != null ? +a.salesRadiusMi.toFixed(2) : "—"} mi over about {num(a.salesYears, 1)} years, about {num(a.salesPerYear, 1)} a year{fn(x, "sales")}. </>
        ) : null}
        {a.ncCount == null && a.salesCount == null ? "No sales counts are available near this lot. " : ""}
      </p>
      <p className="assume">
        Assumption, editable: finished homes sell within {num(a.salesMonths)} months after completion, and a rental leases up within {num(a.leaseUpMonths)} months{fn(x, "cost_config")}.
        {rent ? " The rental case uses the lease-up assumption." : " The for-sale case uses the months-to-sell assumption."} This is not a market study; a local broker should confirm the pace.
        {a.ncPerYear != null && x.m.proForma.plan.units != null && a.ncPerYear < x.m.proForma.plan.units
          ? ` Fewer new homes sell nearby in a year (about ${num(a.ncPerYear, 1)}) than this plan would add (${x.m.proForma.plan.units}), so the selling time may be longer than assumed.`
          : ""}
      </p>
    </>
  );
}

export function SourcesUsesBlock(x: Ctx) {
  const su = sourcesUses(x.m.proForma);
  if (!su) {
    return (
      <>
        <h2>Sources and uses</h2>
        <Callout tone="pending" title="Sources and uses: needs a total cost"><p>{x.m.proForma.plan.missing[0] ?? "The total development cost could not be computed."}</p></Callout>
      </>
    );
  }
  const t = x.tab();
  const f = x.fig();
  const ltc = x.m.proForma.plan.forSale.constructionLoanLtc;
  return (
    <>
      <h2>Sources and uses</h2>
      <p>
        Every dollar in and out during construction. Uses are the budget in Section 7. Sources assume a construction loan at {typeof ltc === "number" ? pct(ltc) : "the default share"} of cost
        {fn(x, "cost_config")}; the rest is the developer’s cash (equity). No grants are assumed unless entered.
      </p>
      <div className="tcap">Table {t}. Sources and uses of funds</div>
      <table>
        <thead><tr><th>Uses</th><th className="num">Amount</th><th className="num">Share</th><th>Sources</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
        <tbody>
          {Array.from({ length: Math.max(su.uses.length, su.sources.length) }).map((_, i) => {
            const u = su.uses[i];
            const s = su.sources[i];
            return (
              <tr key={i}>
                <td>{u?.label ?? ""}</td><td className="num">{u ? money(u.amount) : ""}</td><td className="num">{u ? pct(u.amount / su.total) : ""}</td>
                <td>{s?.label ?? ""}</td><td className="num">{s ? money(s.amount) : ""}</td><td className="num">{s ? pct(s.amount / su.total) : ""}</td>
              </tr>
            );
          })}
          <tr><td><b>Total uses</b></td><td className="num"><b>{money(su.total)}</b></td><td className="num">100%</td><td><b>Total sources</b></td><td className="num"><b>{money(su.sources.reduce((t2, s) => t2 + s.amount, 0))}</b></td><td className="num">100%</td></tr>
        </tbody>
      </table>
      {su.gap != null && (
        <p className="small">
          At the assumed sale value the sales do not repay these sources: {money(su.gap)} short{fn(x, "nc_sales")}. That is the amount a subsidy, a land write-down or a lower cost would have to cover (Section 10).
        </p>
      )}
      <figure className="avoid-break">
        <CapitalStack uses={su.uses} sources={su.sources} money={(n) => money(n)} />
        <figcaption>Figure {f}. Capital stack: uses of funds (left) and sources of funds (right), same total.</figcaption>
      </figure>
    </>
  );
}

export function AbatementBlock(x: Ctx) {
  const a = abatementScenario(x.m);
  const cfg = assumptions.COST_CONFIG.taxAbatement;
  if (!a) {
    return (
      <>
        <h2>Tax abatement scenario (illustrative)</h2>
        <p className="muted">Not computed: the tax rate or the county land value is not loaded for this lot.</p>
      </>
    );
  }
  const t = x.tab();
  return (
    <>
      <h2>Tax abatement scenario (illustrative)</h2>
      <p>
        Pennsylvania lets local taxing bodies phase in the added value from new construction (LERTA-style abatements). Program terms differ by taxing body and
        were not checked for this lot, so this is an illustration, not a program quote. Assumption, editable: {pct(a.share)} of the tax on the added value is abated for {a.years} years
        {a.edited ? " (your values)" : ""}{fn(x, "cost_config")}. The added value is the pro forma’s assumption (construction cost), taxed at {num(a.mills, 2)} mills{fn(x, "millage")}.
      </p>
      <div className="tcap">Table {t}. Effect of the abatement</div>
      <table>
        <tbody>
          <tr><td>Added assessed value (assumed)</td><td className="num">{money(a.addedValue)}</td></tr>
          <tr><td>Yearly tax on the added value</td><td className="num">{money(a.taxOnAdded)}</td></tr>
          <tr><td>Tax abated each year</td><td className="num"><b>{money(a.abatedPerYear)}</b>{a.perHomePerYear != null && a.units && a.units > 1 ? ` (${money(a.perHomePerYear)} per home)` : ""}</td></tr>
          <tr><td>Tax abated over {a.years} years (not discounted)</td><td className="num">{money(a.abatedTotal)}</td></tr>
          {a.rent && (
            <>
              <tr><td>Rental: income after running costs (NOI), without → with</td><td className="num">{money(a.rent.noi)} → {money(a.rent.noiWith)}</td></tr>
              <tr><td>Rental: yield on cost, without → with</td><td className="num">{pct(a.rent.yoc, 1)} → {pct(a.rent.yocWith, 1)}</td></tr>
            </>
          )}
        </tbody>
      </table>
      <p className="small">
        {x.m.proForma.plan.tenure === "sale"
          ? "Built to sell, the abatement goes to the buyer as lower taxes; it does not change the builder’s cost or profit in this study, and any effect on the sale price is not assumed."
          : "Built to rent, the abatement raises the owner’s yearly income during the abatement years; after that, full taxes apply."}{" "}
        Change the share and years with the report settings pf_abate_pct and pf_abate_years. {cfg.label}.
      </p>
    </>
  );
}

export function PublicCostBenefit(x: Ctx) {
  const { m } = x;
  const su = sourcesUses(m.proForma);
  const subsidy = su?.gap ?? null;
  if (!m.scenario.affordable && subsidy == null) return null;
  const a = abatementScenario(m);
  const units = m.proForma.plan.units;
  const fullTax = a ? a.taxOnAdded : null;
  return (
    <>
      <h2>Public cost and public benefit</h2>
      <p>
        <b>Public cost:</b>{" "}
        {subsidy != null ? <>a subsidy or land write-down of about {money(subsidy)} to break even at today’s sale prices{units ? ` (${money(subsidy / units)} per home)` : ""}{fn(x, "cost_config", "nc_sales")}</> : "the funding gap, which needs loan terms (see above)"}
        {a ? <>, plus {money(a.abatedTotal)} of property tax forgone if the illustrative abatement above is used</> : null}.
        {" "}<b>Public benefit:</b> {units ? `${units} new home${units === 1 ? "" : "s"}` : "new homes"}
        {m.scenario.affordable ? " at rents or prices limited by income (affordable mode)" : ""}
        {fullTax != null ? <>, and about {money(fullTax)} a year in new property tax once any abatement ends{fn(x, "millage")}</> : null}.
        {" "}This is a brief screen, not a fiscal impact study: it leaves out services the homes use, school costs, and wider effects on the neighborhood.
      </p>
    </>
  );
}

export function S14(x: Ctx) {
  const { m } = x;
  const cited = x.c.list();
  const t = x.tab();
  return (
    <Sec flow id="s14" no="14" title="Limiting conditions">
      <p>This study rests on the assumptions and limits below. Read the results with them in mind.</p>
      <h2>What the analysis assumes</h2>
      <ul>
        <li>Public records are correct as published: lot lines, lot size, assessed values, zoning districts and overlays, and past Zoning Board decisions.</li>
        <li>The building shape is a placeholder layout from our site-fit solver, not an architect’s design (Appendix C).</li>
        <li>Costs, loan terms, selling costs, months to sell or lease, and the tax abatement are editable defaults, each with a source label (Appendix C).</li>
        <li>Values come from recent recorded sales and rent indexes on the dates shown; markets change.</li>
        <li>Zoning rules are read from a hand-transcribed table of the City code{m.facts.zoning?.code ? ` for ${m.facts.zoning.code}` : ""}; the Zoning Administrator’s reading governs.</li>
      </ul>
      <h2>What was not inspected</h2>
      <ul>
        <li>No site visit, survey, title search, soil or geotechnical test, environmental assessment, or building inspection.</li>
        <li>No check of utilities at the curb, easements, deed restrictions, or liens.</li>
        <li>No appraisal and no contractor bid. No review of the seller’s price or terms.</li>
        <li>No conversation with the City, the Zoning Board, neighbors or community groups.</li>
      </ul>
      <h2>Out of scope</h2>
      <p>
        The developer’s capacity and financial strength (experience, balance sheet, credit, ability to raise equity or carry the project) are out of scope. So are
        tax, legal and lender underwriting, and the award of any subsidy or tax credit.
      </p>
      <h2>Data vintages</h2>
      <div className="tcap">Table {t}. Data sources cited in Sections 1–13 and their dates</div>
      <table>
        <thead><tr><th style={{ width: "6%" }}>#</th><th>Source</th><th>Publisher</th><th>Data date</th></tr></thead>
        <tbody>
          {cited.map((c) => (
            <tr key={c.key}><td>{c.n}</td><td className="small">{c.title}</td><td className="small">{c.publisher ?? "—"}</td><td className="small">{c.date ?? NOT_RECORDED}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Study generated {longDate(m.generatedDate)}. Results can change when any source is updated.</p>
    </Sec>
  );
}
