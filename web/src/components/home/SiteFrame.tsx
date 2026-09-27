import type { ReactNode } from "react";
import "@/app/home.css";
import { brandSans } from "./font";
import Footer from "./Footer";
import Header from "./Header";
import InfoDialogProvider from "./InfoDialog";

/**
 * Public-site chrome from the owner's homepage design: skip link, floating header, footer, shared dialog.
 * Everything the design styles lives under `.es-home`, so parcel, report and planner pages are untouched.
 *
 * - `home`: the homepage (header floats over the hero).
 * - `scoped` (default true): page content also takes the design's base styles. Pass false for pages with
 *   their own stylesheet (the long-form docs) so only the header and footer are styled by the design.
 */
export default async function SiteFrame({ children, home = false, scoped = true }: {
  children: ReactNode;
  home?: boolean;
  scoped?: boolean;
}) {
  const root = `es-home ${home ? "" : "es-page "}${brandSans.variable}`;
  if (scoped) {
    return (
      <div className={root}>
        <InfoDialogProvider>
          <a className="skip" href="#main">Skip to content</a>
          <div className="site-shell">
            <Header home={home} />
            <main id="main">{children}</main>
            <Footer home={home} />
          </div>
        </InfoDialogProvider>
      </div>
    );
  }
  return (
    <div className={`es-frame ${brandSans.variable}`}>
      <InfoDialogProvider scopeClass={root}>
        <div className={root}>
          <a className="skip" href="#main">Skip to content</a>
          <div className="site-shell"><Header /></div>
        </div>
        <main id="main">{children}</main>
        <div className={root}>
          <div className="site-shell"><Footer /></div>
        </div>
      </InfoDialogProvider>
    </div>
  );
}
