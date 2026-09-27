import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";

export const metadata: Metadata = {
  title: "AI tools used — EaseScore.AI",
  description: "Which AI tools built EaseScore.AI, where AI appears in the product, and the checks that keep it from producing numbers.",
};

const DEV_TOOLS: [string, string, string][] = [
  ["Claude Code (Anthropic)", "Claude Opus 5.5 and Claude Sonnet 5", "Pair programming, planning, code generation, review passes, and research notes."],
  ["oh-my-claudecode", "Claude Code plugin", "Coordinates several Claude Code agents working on separate tasks."],
  ["ChatGPT (OpenAI)", "\u2014", "Homepage design and layout (HTML/CSS), later ported into the app."],
  ["ChatGPT image generation (OpenAI)", "\u2014", "Homepage images. They are AI-generated regional imagery: not photos of any lot or parcel, and not copyrighted photography."],
];

const TOC: [string, string][] = [
  ["summary", "In short"],
  ["building", "AI used to build the project"],
  ["product", "AI in the product"],
  ["checks", "The checks"],
  ["not", "Where AI is never used"],
];

export default function AiUsePage() {
  return (
    <Shell>
      <section className={d.pageHead} aria-labelledby="page-title">
        <div className={d.wrap}>
          <span className={d.eyebrow}>AI tools used</span>
          <h1 id="page-title">Where AI is used, and where it is not</h1>
          <p className={d.lede}>
            AI helped write the code, design the homepage and make its images, and it polishes some sentences on the page. It never calculates a score, a cost, a value or a return.
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
          <section id="summary" aria-labelledby="summary-h">
            <h2 id="summary-h">In short</h2>
            <ul>
              <li><strong>To build it:</strong> Claude Code, Anthropic&apos;s coding assistant. ChatGPT designed the homepage layout.</li>
              <li><strong>Images:</strong> homepage images were made with ChatGPT&apos;s image generation. They show the region in general, not any real lot, and are not photographs.</li>
              <li><strong>In the product:</strong> the Claude API (model <code>claude-sonnet-5</code>) rewords plain-English sentences that the engine has already written from computed results.</li>
              <li><strong>Guardrail:</strong> a validator rejects any AI sentence containing a number that is not in the computed data. The page then shows the engine&apos;s own sentence.</li>
            </ul>
          </section>

          <section id="building" aria-labelledby="building-h">
            <h2 id="building-h">AI used to build the project</h2>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className={d.table}>
                <thead>
                  <tr><th scope="col">Tool</th><th scope="col">Model or version</th><th scope="col">Used for</th></tr>
                </thead>
                <tbody>
                  {DEV_TOOLS.map(([tool, model, use]) => (
                    <tr key={tool}><th scope="row">{tool}</th><td>{model}</td><td>{use}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Weights and cost defaults live in versioned config files, marked as drafts awaiting expert review. Zoning code sections used by the
              engine were checked against the official text. All source code is public, with its full history.
            </p>
          </section>

          <section id="product" aria-labelledby="product-h">
            <h2 id="product-h">AI in the product</h2>
            <p>The parcel page has two places where AI may reword text:</p>
            <ul>
              <li><strong>Four answers:</strong> Can you build here? Does it pencil? What&apos;s in the way? What next?</li>
              <li><strong>Two-sentence summary:</strong> what the lot allows by right, and what might be possible with zoning relief.</li>
            </ul>
            <h3>How a sentence is made</h3>
            <ol className={d.steps}>
              <li>The engine computes the score, flags, approvals, budget, value and margin.</li>
              <li>The engine writes a template sentence for every answer from those results.</li>
              <li>The server sends Claude only the computed results and the template sentences, and asks for plainer wording at an 8th-grade reading level. The API key stays on the server.</li>
              <li>Each returned sentence is checked (see below). Sentences that pass are shown. Sentences that fail are replaced by the template.</li>
            </ol>
            <p>
              If the AI service is slow (over 8 seconds), returns an error, or is not configured, the page shows the template sentences. The app works fully without AI.
            </p>
          </section>

          <section id="checks" aria-labelledby="checks-h">
            <h2 id="checks-h">The checks</h2>
            <ul>
              <li><strong>Numbers:</strong> every number in an AI sentence must match a number in the computed data. Rounding the way a person would is allowed. Anything else is rejected.</li>
              <li><strong>Codes and districts:</strong> the summary may name only zoning districts and code sections that appear in the data.</li>
              <li><strong>Banned words:</strong> the summary may not use words such as &ldquo;guaranteed,&rdquo; &ldquo;definitely,&rdquo; &ldquo;impossible&rdquo; or &ldquo;risky,&rdquo; or advise buying or not buying.</li>
              <li><strong>Shape:</strong> the summary must be exactly two sentences. A failed summary gets one retry, then the template is used.</li>
              <li><strong>Fixed wording for precedent:</strong> whether nearby Zoning Board requests were usually approved, mixed, or usually denied is set by the case counts, not by the model.</li>
            </ul>
            <div className={d.info}>
              When the AI wording is used, the page says so: &ldquo;Worded by AI from the calculated results; every number checked against them.&rdquo; The parcel page also states that it is decision support only.
            </div>
          </section>

          <section id="not" aria-labelledby="not-h">
            <h2 id="not-h">Where AI is never used</h2>
            <ul>
              <li>The Ease Score, factor scores, red flags and review callouts</li>
              <li>The lot-fit test and the zoning rules</li>
              <li>The requirements checklist</li>
              <li>Costs, values, profit, margin, yield and every other number in the pro forma</li>
              <li>Months to a permit</li>
              <li>The numbers in the Feasibility Study PDF</li>
              <li>Views of a specific lot: the 3D views come from Google Photorealistic 3D Tiles and USGS lidar, not from an image generator</li>
            </ul>
            <p>
              These are deterministic code: the same parcel and data always give the same result. See <Link href="/methods">Data and methods</Link> for the rules
              and <Link href="/limitations">Limitations</Link> for the gaps.
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
