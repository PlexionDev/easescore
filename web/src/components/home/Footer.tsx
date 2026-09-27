import Link from "next/link";
import CreditsButton from "./Credits";

const REPO_URL = "https://github.com/PlexionDev/easescore";

export default function Footer({ home = false }: { home?: boolean }) {
  const base = home ? "" : "/";
  return (
    <footer>
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="brand" href="/">EaseScore<span className="brand-ai">.AI</span></Link>
            <p>Intelligent Feasibility</p>
          </div>
          <div className="footer-links">
            <div>
              <h2>Platform</h2>
              <Link href="/#parcel-search">Check a lot</Link>
              <Link href="/planner">Compare sites</Link>
              <Link href="/policy">Policy simulator</Link>
            </div>
            <div>
              <h2>Evidence</h2>
              <Link href="/methods">Data &amp; methods</Link>
              <Link href="/limitations">Limitations</Link>
              <Link href="/ai-use">AI tools used</Link>
            </div>
            <div>
              <h2>Project</h2>
              <a href={`${base}#who-its-for`}>Who it’s for</a>
              <a href={`${base}#faq`}>Questions</a>
              <CreditsButton />
              <a href={REPO_URL}>GitHub</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>Built for the AI for Housing Hackathon, Pittsburgh, 2026.<br />Not affiliated with Allegheny County or the City of Pittsburgh.</p>
          <p>AI-generated imagery.<br />Representative scenes, not parcel evidence.</p>
        </div>
      </div>
    </footer>
  );
}
