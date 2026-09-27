import { getT } from "@/lib/i18n/server";

const FAQS = [1, 2, 3, 4, 5] as const;

export default async function FAQ() {
  const { t } = await getT();
  return (
    <section className="faq-section section" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div>
          <p className="eyebrow">{t("faq.eyebrow")}</p>
          <h2 id="faq-title">{t("faq.title1")}<br />{t("faq.title2")}</h2>
        </div>
        <div className="faqs">
          {FAQS.map((n) => (
            <details key={n}><summary>{t(`faq.q${n}`)}</summary><p>{t(`faq.a${n}`)}</p></details>
          ))}
          <p style={{ fontSize: ".875rem", marginTop: 18 }}>
            {t("faq.helps")} <a href="/limitations#who-it-helps">{t("faq.helpsLink")}</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
