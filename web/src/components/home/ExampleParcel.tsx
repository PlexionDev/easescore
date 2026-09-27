import Image from "next/image";
import { ExampleReportLink, ReceiptButton, type ReceiptKey } from "./Receipt";
import { getT } from "@/lib/i18n/server";
import type { Key } from "@/lib/i18n";

const EXPLANATIONS = [1, 2, 3, 4] as const;

const FACTS: { id: ReceiptKey; value: string; unit: string; label: Key }[] = [
  { id: "steep", value: "62", unit: "%", label: "ex.fact.steep" },
  { id: "slope", value: "31", unit: "%", label: "ex.fact.slope" },
  { id: "transit", value: "380", unit: " m", label: "ex.fact.transit" },
];

// Illustrative values only, labelled as such on the card. Not computed from the engine.
const BARS: { id: ReceiptKey; label: Key; pct: number; low?: boolean }[] = [
  { id: "zoning", label: "ex.bar.zoning", pct: 70 },
  { id: "terrain", label: "ex.bar.terrain", pct: 15, low: true },
  { id: "hazards", label: "ex.bar.hazards", pct: 65 },
  { id: "access", label: "ex.bar.access", pct: 60 },
  { id: "approvals", label: "ex.bar.approvals", pct: 55 },
];

export default async function ExampleParcel() {
  const { t } = await getT();
  return (
    <section className="understanding section" id="how-it-works" aria-labelledby="example-title">
      <div className="wrap">
        <div className="section-intro reveal">
          <div>
            <p className="eyebrow">{t("ex.eyebrow")}</p>
            <h2 id="example-title">{t("ex.title1")}<br />{t("ex.title2")}</h2>
          </div>
          <p>{t("ex.intro")}</p>
        </div>
        <div className="example-grid">
          <div className="explanations">
            {EXPLANATIONS.map((n) => (
              <article key={n} className="explanation reveal">
                <span>{String(n).padStart(2, "0")}</span>
                <div>
                  <h3>{t(`ex.e${n}a`)}<br />{t(`ex.e${n}b`)}</h3>
                  <p>{t(`ex.e${n}`)}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="parcel-stage reveal" id="example-parcel">
            <article className="parcel-card" aria-label={t("ex.cardAria")}>
              <div className="parcel-top">
                <span className="parcel-wordmark">EaseScore<span>.AI</span></span>
                <span className="sample-tag">{t("ex.sampleTag")}</span>
              </div>
              <div className="parcel-photo">
                <Image
                  src="/home/images/hillside-homes.webp"
                  width={1200}
                  height={675}
                  alt={t("ex.photoAlt")}
                  sizes="(max-width:850px) min(540px, 100vw), 620px"
                />
                <span>{t("ex.photoCaption")}</span>
              </div>
              <div className="parcel-body">
                <div className="parcel-heading">
                  <div>
                    <p className="mini-label">{t("ex.overview")}</p>
                    <h3>{t("ex.cardTitle")}</h3>
                    <p>{t("ex.cardSub")}</p>
                  </div>
                  <div className="score"><strong>54</strong><span>{t("ex.band")}</span></div>
                </div>
                <div className="parcel-facts">
                  {FACTS.map((f) => (
                    <ReceiptButton key={f.id} id={f.id}>
                      <strong>{f.value}<span>{f.unit}</span></strong>
                      <span>{t(f.label)}</span>
                    </ReceiptButton>
                  ))}
                </div>
                <div className="score-bars" role="group" aria-label={t("ex.barsAria")}>
                  {BARS.map((b) => (
                    <ReceiptButton key={b.id} id={b.id} className="score-row">
                      <span>{t(b.label)}</span>
                      <span className="track"><i className={b.low ? "low" : undefined} style={{ width: `${b.pct}%` }} /></span>
                      <span className="receipt" aria-hidden="true">↗</span>
                      <span className="sr-only">{t("ex.barSr", { pct: b.pct })}</span>
                    </ReceiptButton>
                  ))}
                  <div className="unscored"><span>{t("ex.unscored")}</span><span>{t("ex.unscoredValue")}</span></div>
                </div>
                <div className="risk-note">
                  <span aria-hidden="true">!</span>
                  <p><strong>{t("ex.reviewTitle")}</strong>{t("ex.reviewBody")}</p>
                </div>
                <p className="parcel-summary">
                  {t("ex.summary")}
                </p>
                <ExampleReportLink />
                <p className="example-disclosure">{t("ex.disclosure")}</p>
              </div>
            </article>
            <p className="stage-caption"><span aria-hidden="true">↖</span> {t("ex.caption")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
