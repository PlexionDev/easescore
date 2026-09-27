import Link from "next/link";
import CreditsButton from "./Credits";
import { getT } from "@/lib/i18n/server";

const REPO_URL = "https://github.com/PlexionDev/easescore";

export default async function Footer({ home = false }: { home?: boolean }) {
  const { t } = await getT();
  const base = home ? "" : "/";
  return (
    <footer>
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="brand" href="/">EaseScore<span className="brand-ai">.AI</span></Link>
            <p>{t("brand.tagline")}</p>
          </div>
          <div className="footer-links">
            <div>
              <h2>{t("footer.platform")}</h2>
              <Link href="/#parcel-search">{t("footer.checkLot")}</Link>
              <Link href="/planner">{t("footer.compare")}</Link>
              <Link href="/policy">{t("footer.policy")}</Link>
            </div>
            <div>
              <h2>{t("footer.evidence")}</h2>
              <Link href="/methods">{t("footer.methods")}</Link>
              <Link href="/limitations">{t("footer.limitations")}</Link>
              <Link href="/ai-use">{t("footer.aiUse")}</Link>
            </div>
            <div>
              <h2>{t("footer.project")}</h2>
              <a href={`${base}#who-its-for`}>{t("footer.who")}</a>
              <a href={`${base}#faq`}>{t("footer.questions")}</a>
              <CreditsButton />
              <a href={REPO_URL}>GitHub</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>{t("footer.built1")}<br />{t("footer.built2")}</p>
          <p>{t("footer.img1")}<br />{t("footer.img2")}</p>
        </div>
      </div>
    </footer>
  );
}
