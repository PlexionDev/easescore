
// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "faq.q1": "How is the score calculated?",
  "faq.a1": "Seven factors are scored from 0 to 100 and weighted: zoning, terrain, hazards, access, approvals, the lot itself and nearby market activity. Bands: few, some, significant or major barriers. The score measures barriers to building, not whether it’s a good investment; money is kept separate, in the “does it pencil” result and a market-strength signal. The weights are published on the data and methods page; the example card above uses illustrative values.",
  "faq.q2": "Does it cover the whole county?",
  "faq.a2": "Parcels, terrain, hazards and sales cover all of Allegheny County. Detailed zoning rules are loaded for the City of Pittsburgh first. Elsewhere there is no numeric score: a partial screen shows the known facts (lot, slope, hazards, existing building, market). Confirm zoning with the municipality.",
  "faq.q3": "What does AI do here?",
  "faq.a3": "It helps find a parcel from a plain question and writes the short summary from the calculated results. It never calculates a score, a cost or a return.",
  "faq.q4": "Is this legal, zoning or financial advice?",
  "faq.a4": "No. It is a starting point for a decision. Confirm zoning with the permitting office, costs with local bids and financing with your lender.",
  "faq.q5": "What happens to what I type?",
  "faq.a5": "Searches are used only to find the parcel and are not tied to an account. There is no account or sign-in.",
};

const FAQS = [1, 2, 3, 4, 5] as const;

export default async function FAQ() {
  return (
    <section className="faq-section section" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div>
          <p className="eyebrow">A little clarity</p>
          <h2 id="faq-title">Questions<br />before you start.</h2>
        </div>
        <div className="faqs">
          {FAQS.map((n) => (
            <details key={n}><summary>{TEXT[`faq.q${n}`]}</summary><p>{TEXT[`faq.a${n}`]}</p></details>
          ))}
          <p style={{ fontSize: ".875rem", marginTop: 18 }}>
            {"Who this helps, who it could hurt, and what it gets wrong:"} <a href="/limitations#who-it-helps">read the limitations</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
