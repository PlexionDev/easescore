import type { Metadata } from "next";
import Link from "next/link";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";

export const metadata: Metadata = {
  title: "Accessibility — EaseScore.AI",
  description: "What EaseScore.AI does for people who use a keyboard, a screen reader or reduced motion, how we checked it, and what is not done yet.",
};

const TOC: [string, string][] = [
  ["summary", "In short"],
  ["done", "What works today"],
  ["checked", "How we checked"],
  ["gaps", "What is not done yet"],
  ["contact", "Tell us"],
];

export default function AccessibilityPage() {
  return (
    <Shell>
      <section className={d.pageHead} aria-labelledby="page-title">
        <div className={d.wrap}>
          <span className={d.eyebrow}>Accessibility</span>
          <h1 id="page-title">Accessibility statement</h1>
          <p className={d.lede}>
            We aim for WCAG 2.2 level AA, the standard public agencies are moving to. We built accessibility into the pages themselves. There is no overlay widget. This page says what works, how we checked it, and what is still missing.
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
              <li><strong>Maps and 3D have text equals.</strong> The parcel page has a &ldquo;Describe this view&rdquo; panel. The Planner, Policy and Nonprofit maps have a Table view.</li>
              <li><strong>Everything works from the keyboard,</strong> including moving the maps and the 3D view.</li>
              <li><strong>Screen readers hear changes.</strong> New results are announced after a filter, slider or what-if change.</li>
              <li><strong>The PDF report is tagged,</strong> with real text, bookmarks, a set language and alt text on the site plan and charts.</li>
              <li><strong>It is not finished.</strong> We have not yet tested with disabled users. See <a href="#gaps">what is not done yet</a>.</li>
            </ul>
          </section>

          <section id="done" aria-labelledby="done-h">
            <h2 id="done-h">What works today</h2>
            <h3>Seeing the maps and 3D without seeing them</h3>
            <ul>
              <li>On a parcel page, <strong>Describe this view</strong> (next to the view buttons) gives the view in words: lot size, slope, the share of the lot in each hazard or rule overlay, existing buildings, the setbacks, the area left to build on, and the studied building. It is built from the same numbers the map draws.</li>
              <li>The <strong>Planner</strong> has a Table view. The ranked table lists the same parcels as the map, in score order.</li>
              <li>The <strong>Policy</strong> page has a Table view. It hides the map and opens the neighborhood and council-district tables.</li>
              <li>The <strong>Nonprofit</strong> need map has a Table view. It lists the census tracts or block groups in the map&apos;s area, with every value.</li>
              <li>Score bands use words (Easy, Moderate, Hard), not color alone.</li>
            </ul>
            <h3>Keyboard</h3>
            <ul>
              <li>2D and terrain maps: Tab to the map, then use the arrow keys to pan and + or − to zoom. On the parcel terrain map, Shift with the arrow keys rotates and tilts.</li>
              <li>3D Photoreal view: Tab to it, then the arrow keys orbit and tilt, + and − zoom, and Home resets the view. The on-screen camera buttons do the same things.</li>
              <li>Sliders never need dragging: the seat and Build it in 3D sliders have − and + buttons next to their value, and the build-quality slider has a button for each tier. All sliders also move with the arrow keys.</li>
              <li>Receipts, drawers and menus are buttons: they open with Enter or Space, not on hover.</li>
            </ul>
            <h3>Screen readers</h3>
            <ul>
              <li>Pages have one main area, labeled regions and headings in order, so you can jump around by landmark or heading.</li>
              <li>Changes are announced politely: the number of parcels after a Planner filter, the headline ranges after a Policy lever, the new layout after a Build it in 3D change, and the new result after a &ldquo;Does it pencil?&rdquo; edit.</li>
            </ul>
            <h3>Motion</h3>
            <ul>
              <li>If your device asks for reduced motion, the map fly-in, the slow orbit, the Policy map&apos;s &ldquo;wave&rdquo; and page animations are turned off. The view jumps straight to where it ends.</li>
            </ul>
            <h3>The PDF report</h3>
            <ul>
              <li>The Feasibility Study PDF is a tagged PDF. It has real text (not pictures of text), bookmarks for each section, and its language set to English. The site plan and charts have alt text written from their own numbers.</li>
            </ul>
          </section>

          <section id="checked" aria-labelledby="checked-h">
            <h2 id="checked-h">How we checked</h2>
            <ul>
              <li>An automated scan with axe-core (WCAG 2.0, 2.1 and 2.2, levels A and AA, plus best practices) on the main pages: home, a parcel page, its report, the Planner, Policy and Nonprofit pages, and the methods, limitations and AI pages.</li>
              <li>A reading of each page&apos;s accessibility tree, the structure a screen reader uses, along the main path: search, parcel page, a receipt, and the report.</li>
              <li>Keyboard checks of the maps, the 3D view, the sliders and the Table view buttons.</li>
            </ul>
            <p>Automated tools find only some problems. These checks are a start, not proof that the site is fully accessible.</p>
          </section>

          <section id="gaps" aria-labelledby="gaps-h">
            <h2 id="gaps-h">What is not done yet</h2>
            <ul>
              <li><strong>No testing with disabled users yet.</strong> We have not run a full session with VoiceOver, JAWS or NVDA by a person who uses them every day.</li>
              <li><strong>The PDF</strong> uses the tags Chrome writes when it prints. We have not checked it with a PDF accessibility checker.</li>
              <li><strong>Map dots</strong> on the Planner, Policy and Nonprofit maps can&apos;t be reached one by one with the keyboard. Use the tables, which list the same parcels (Planner) or the same totals by area (Policy, Nonprofit).</li>
              <li><strong>The Policy map&apos;s hover card</strong> (one parcel&apos;s homes before and after) needs a mouse. The tables have the totals, not each parcel.</li>
              <li><strong>The 3D Photoreal city</strong> comes from Google. We can describe our lot, rules and building, but not every detail of the photo mesh.</li>
              <li><strong>Small screens and 200% zoom:</strong> the parcel page&apos;s floating panels can crowd the map on narrow screens. Scroll the side panel, or use the report.</li>
              <li><strong>Spanish:</strong> some newer text, including &ldquo;Describe this view,&rdquo; is in English only for now.</li>
            </ul>
          </section>

          <section id="contact" aria-labelledby="contact-h">
            <h2 id="contact-h">Tell us</h2>
            <p>
              If something doesn&apos;t work for you, open an issue on <a href="https://github.com/PlexionDev/easescore/issues">GitHub</a> and say which page and what happened.
              See also <Link href="/limitations">Limitations</Link> and <Link href="/methods">Data and methods</Link>.
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
