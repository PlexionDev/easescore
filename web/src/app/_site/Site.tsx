import Link from "next/link";
import type { ReactNode } from "react";
import { instrumentSans } from "./fonts";
import s from "./site.module.css";

const REPO_URL = "https://github.com/PlexionDev/easescore";

type NavKey = "check" | "planner" | "methods" | "limitations";

/** Shell for the public pages: paper background, header, footer. The parcel workspace keeps its own layout. */
export default function Site({ children, current }: { children: ReactNode; current?: NavKey }) {
  const nav: { key: NavKey; href: string; label: string }[] = [
    { key: "check", href: "/check", label: "Check a lot" },
    { key: "planner", href: "/planner", label: "Compare sites" },
    { key: "methods", href: "/methods", label: "Data and methods" },
    { key: "limitations", href: "/limitations", label: "Limitations" },
  ];
  return (
    <div className={`${s.site} ${instrumentSans.variable}`}>
      <a className={s.skip} href="#main">Skip to content</a>
      <header className={s.header}>
        <div className={`${s.wrap} ${s.bar}`}>
          <Link className={s.logo} href="/" aria-label="EaseScore.AI home">
            <Logo />
            <span>EaseScore<span className={s.tld}>.AI</span></span>
          </Link>
          <nav className={s.nav} aria-label="Main">
            <ul>
              {nav.map((n) => (
                <li key={n.key}>
                  <Link href={n.href} aria-current={current === n.key ? "page" : undefined}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.foot}`}>
          <p>
            Built for the AI for Housing Hackathon, Pittsburgh, 2026.<br />
            Not affiliated with Allegheny County or the City of Pittsburgh.
          </p>
          <ul>
            <li><Link href="/methods">Data and methods</Link></li>
            <li><Link href="/limitations">Limitations</Link></li>
            <li><Link href="/ai-use">AI tools used</Link></li>
            <li><a href={REPO_URL}>Source code</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M3 22c4-1 6-5 11-5s7 3 11 2" stroke="#0F6E74" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 16c4-1 6-6 11-6s7 3 11 2" stroke="#7F978A" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 10c4-1 6-6 11-6s7 3 11 2" stroke="#AFC0B6" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
