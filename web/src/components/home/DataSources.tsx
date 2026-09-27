import Link from "next/link";
import { getT } from "@/lib/i18n/server";

const SOURCES = [1, 2, 3, 4, 5, 6] as const;

export default async function DataSources() {
  const { t } = await getT();
  return (
    <section className="data-section section" id="data" aria-labelledby="data-title">
      <div className="wrap data-grid">
        <div className="data-heading reveal">
          <p className="eyebrow">{t("data.eyebrow")}</p>
          <h2 id="data-title">{t("data.title1")}<br />{t("data.title2")}</h2>
          <p>{t("data.intro")}</p>
          <Link className="text-link" href="/methods">{t("data.link")} <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="sources reveal">
          {SOURCES.map((n) => (
            <div key={n} className="source">
              <span>{String(n).padStart(2, "0")}</span>
              <div><h3>{t(`data.s${n}.name`)}</h3><p>{t(`data.s${n}.what`)}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
