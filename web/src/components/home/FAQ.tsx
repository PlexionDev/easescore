const FAQS: [string, string][] = [
  ["How is the score calculated?", "Seven factors are scored from 0 to 100 and weighted: zoning, terrain, hazards, access, approvals, the lot itself and nearby market activity. Money is kept separate, in the “does it pencil” result. The weights are published on the data and methods page; the example card above uses illustrative values."],
  ["Does it cover the whole county?", "Parcels, terrain, hazards and sales cover all of Allegheny County. Detailed zoning rules are loaded for the City of Pittsburgh first. Elsewhere, confirm zoning with the municipality."],
  ["What does AI do here?", "It helps find a parcel from a plain question and writes the short summary from the calculated results. It never calculates a score, a cost or a return."],
  ["Is this legal, zoning or financial advice?", "No. It is a starting point for a decision. Confirm zoning with the permitting office, costs with local bids and financing with your lender."],
  ["What happens to what I type?", "Searches are used only to find the parcel and are not tied to an account. There is no account or sign-in."],
];

export default function FAQ() {
  return (
    <section className="faq-section section" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div>
          <p className="eyebrow">A little clarity</p>
          <h2 id="faq-title">Questions<br />before you start.</h2>
        </div>
        <div className="faqs">
          {FAQS.map(([q, a]) => (
            <details key={q}><summary>{q}</summary><p>{a}</p></details>
          ))}
          <p style={{ fontSize: ".875rem", marginTop: 18 }}>
            Who this helps, who it could hurt, and what it gets wrong: <a href="/limitations#who-it-helps">read the limitations</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
