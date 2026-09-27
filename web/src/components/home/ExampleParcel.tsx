import Image from "next/image";
import { ExampleReportLink, ReceiptButton, type ReceiptKey } from "./Receipt";

// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "ex.eyebrow": "A clearer view of the lot",
  "ex.e1a": "The score shows the barriers,",
  "ex.e1b": "not whether to buy.",
  "ex.e1": "Seven factors, each with a bar. Tap the receipt beside any bar to see the records and rules behind it, with dates.",
  "ex.e2a": "Problems are named,",
  "ex.e2b": "not averaged away.",
  "ex.e2": "Landslide areas, old mines and flood zones lower the score and appear as their own callouts, with the code sections that apply.",
  "ex.e3a": "The summary is written",
  "ex.e3b": "from the numbers.",
  "ex.e3": "Two sentences on what the lot allows today and what could be possible with approval. Every figure in them comes from the calculation, never from guesswork.",
  "ex.e4a": "The feasibility study is",
  "ex.e4b": "ready to share.",
  "ex.e4": "Site, zoning, process, market, costs, returns and risks in one cited document you can print or save as a PDF.",
  "ex.fact.steep": "Steeper than 25%",
  "ex.fact.slope": "Average slope",
  "ex.fact.transit": "To frequent transit",
  "ex.bar.zoning": "Zoning",
  "ex.bar.terrain": "Terrain",
  "ex.bar.hazards": "Hazards",
  "ex.bar.access": "Access",
  "ex.bar.approvals": "Approvals",
};
const EXPLANATIONS = [1, 2, 3, 4] as const;

const FACTS: { id: ReceiptKey; value: string; unit: string; label: string }[] = [
  { id: "steep", value: "62", unit: "%", label: "ex.fact.steep" },
  { id: "slope", value: "31", unit: "%", label: "ex.fact.slope" },
  { id: "transit", value: "380", unit: " m", label: "ex.fact.transit" },
];

// Illustrative values only, labelled as such on the card. Not computed from the engine.
const BARS: { id: ReceiptKey; label: string; pct: number; low?: boolean }[] = [
  { id: "zoning", label: "ex.bar.zoning", pct: 70 },
  { id: "terrain", label: "ex.bar.terrain", pct: 15, low: true },
  { id: "hazards", label: "ex.bar.hazards", pct: 65 },
  { id: "access", label: "ex.bar.access", pct: 60 },
  { id: "approvals", label: "ex.bar.approvals", pct: 55 },
];

export default async function ExampleParcel() {
  return (
    <section className="understanding section" id="how-it-works" aria-labelledby="example-title">
      <div className="wrap">
        <div className="section-intro reveal">
          <div>
            <p className="eyebrow">A clearer view of the lot</p>
            <h2 id="example-title">One lot. One page.<br />Every number sourced.</h2>
          </div>
          <p>Each parcel opens to a short, visual summary. The full feasibility study is one click away when you need the detail.</p>
        </div>
        <div className="example-grid">
          <div className="explanations">
            {EXPLANATIONS.map((n) => (
              <article key={n} className="explanation reveal">
                <span>{String(n).padStart(2, "0")}</span>
                <div>
                  <h3>{TEXT[`ex.e${n}a`]}<br />{TEXT[`ex.e${n}b`]}</h3>
                  <p>{TEXT[`ex.e${n}`]}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="parcel-stage reveal" id="example-parcel">
            <article className="parcel-card" aria-label={"Illustrative parcel summary, not a verified assessment"}>
              <div className="parcel-top">
                <span className="parcel-wordmark">EaseScore<span>.AI</span></span>
                <span className="sample-tag">Illustrative example</span>
              </div>
              <div className="parcel-photo">
                <Image
                  src="/home/images/hillside-homes.webp"
                  width={1200}
                  height={675}
                  alt={"AI-generated regional neighborhood illustration. It does not depict a real parcel."}
                  sizes="(max-width:850px) min(540px, 100vw), 620px"
                />
                <span>Regional illustration · Not a photo of this lot</span>
              </div>
              <div className="parcel-body">
                <div className="parcel-heading">
                  <div>
                    <p className="mini-label">Parcel overview</p>
                    <h3>Example hillside lot</h3>
                    <p>Illustrative parcel, residential zoning</p>
                  </div>
                  <div className="score" title="Measures barriers to building, not whether it's a good investment."><strong>54</strong><span>Significant barriers</span></div>
                </div>
                <div className="parcel-facts">
                  {FACTS.map((f) => (
                    <ReceiptButton key={f.id} id={f.id}>
                      <strong>{f.value}<span>{f.unit}</span></strong>
                      <span>{TEXT[f.label]}</span>
                    </ReceiptButton>
                  ))}
                </div>
                <div className="score-bars" role="group" aria-label={"Illustrative factor values"}>
                  {BARS.map((b) => (
                    <ReceiptButton key={b.id} id={b.id} className="score-row">
                      <span>{TEXT[b.label]}</span>
                      <span className="track"><i className={b.low ? "low" : undefined} style={{ width: `${b.pct}%` }} /></span>
                      <span className="receipt" aria-hidden="true">↗</span>
                      <span className="sr-only">{`: ${b.pct}, view explanation`}</span>
                    </ReceiptButton>
                  ))}
                  <div className="unscored"><span>Lot & market factors</span><span>Not supplied in example</span></div>
                </div>
                <div className="risk-note">
                  <span aria-hidden="true">!</span>
                  <p><strong>Review required</strong>Illustrative landslide-overlay flag. Geotechnical review needs confirmation.</p>
                </div>
                <p className="parcel-summary">
                  {"The example assumes one single-family home by right and a stepped foundation for the steep slope. A duplex would require a separate zoning review."}
                </p>
                <ExampleReportLink />
                <p className="example-disclosure">Example layout. All parcel values, zoning and risk statements are illustrative and unverified.</p>
              </div>
            </article>
            <p className="stage-caption"><span aria-hidden="true">↖</span> {"A receipt behind every number. Try a factor above."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
