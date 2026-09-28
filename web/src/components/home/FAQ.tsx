
// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "faq.q1": "What is EaseScore?",
  "faq.a1": "A free tool that shows what it takes to build housing on a lot in Allegheny County. Type an address or parcel ID and you get the lot’s zoning, slope, hazards, approvals and an estimated budget in one place, with a source behind every number. There is no account or sign-in.",
  "faq.q2": "What does the Ease Score measure?",
  "faq.a2": "How many barriers stand between a lot and new housing: zoning, terrain, hazards, access, approvals, the lot itself and nearby market activity. It reads Few, Some, Significant or Major barriers. It measures barriers to building, not whether it’s a good investment; money is kept separate, in the pro forma.",
  "faq.q3": "What happens when data is missing?",
  "faq.a3": "EaseScore says so instead of guessing. Missing values stay missing, never filled with a zero or a favorable assumption. Zoning rules are loaded for the City of Pittsburgh only; elsewhere, and where the building on a lot can’t be verified, the lot shows a Partial screen with no score and only the facts we have.",
  "faq.q4": "Where does the data come from, and how current is it?",
  "faq.a4": "Public records: Allegheny County parcels, assessments and sales; City of Pittsburgh zoning, permits and hazard maps; USGS elevation data; FEMA flood maps; Pennsylvania DEP mine and environmental records; HUD rents and income limits; Census data; and ZIP-level asking rents from RentCast, with HUD Fair Market Rents as the fallback. Receipts and reports show each source and its date.",
  "faq.q5": "Where do construction costs come from?",
  "faq.a5": "Published Pittsburgh builder price ranges by build quality, with the builder’s fee removed using NAHB’s 2024 cost survey, so the figure is the cost to build. The default is Standard infill at $190 per square foot. The construction loan uses the latest bank prime rate in our data plus 1.0 point. Every line shows its source and can be edited.",
  "faq.q6": "Why do so many lots not pencil?",
  "faq.a6": "In many Pittsburgh neighborhoods, building a new home costs more than new homes sell for. That is the market, not a bug. A lot pencils when the estimate meets the 15% target margin (editable), and a margin from zero up to the target is a thin margin. Where a lot doesn’t pencil, EaseScore shows how large the gap is.",
  "faq.q7": "What if the City disagrees with EaseScore?",
  "faq.a7": "The City’s decision always governs. Zoning results cite the section of the code they rely on, so staff and applicants can see what was applied. EaseScore is decision support only, not legal, zoning or financial advice.",
  "faq.q8": "What does AI do here, and what doesn’t it do?",
  "faq.a8": "AI (Claude) only rewords the plain-language answers and the short summary from results the code already calculated; search, scoring and every number are ordinary code. It never calculates a score, cost, rent, tax or return. A validator checks every number in an AI-written sentence against the calculation; if one doesn’t match, the standard sentence is shown instead.",
  "faq.q9": "Who could this hurt, and what does it get wrong?",
  "faq.a9": "It could be misused to target owners in financial trouble, so private owners’ names are never shown and tax-delinquency status is shown only for publicly owned land. Estimates can be wrong, so they come as ranges with sources and are not advice.",
};

const FAQS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

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
            <details key={n}>
              <summary>{TEXT[`faq.q${n}`]}</summary>
              <p>
                {TEXT[`faq.a${n}`]}
                {n === 9 && <> <a href="/limitations#who-it-helps">Read the limitations</a>.</>}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
