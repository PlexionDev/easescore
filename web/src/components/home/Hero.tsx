import { getImageProps } from "next/image";
import SearchBox from "./SearchBox";
import { SEARCH_ID } from "./constants";
import { getT } from "@/lib/i18n/server";

export default async function Hero() {
  const { t } = await getT();
  const HERO_ALT = t("hero.alt");
  // Art direction: a lighter crop-safe image on phones, the full-size scene elsewhere.
  const common = { alt: HERO_ALT, sizes: "100vw", fetchPriority: "high" as const, loading: "eager" as const };
  const { props: { srcSet: mobile } } = getImageProps({
    ...common, src: "/home/images/hero-rivers-placeholder.webp", width: 1000, height: 563,
  });
  const { props: { srcSet: desktop, ...img } } = getImageProps({
    ...common, src: "/home/images/hero-rivers.webp", width: 1672, height: 941,
  });

  return (
    <section className="hero" aria-labelledby="hero-title">
      <picture className="hero-image">
        <source media="(max-width:640px)" srcSet={mobile} />
        <source srcSet={desktop} />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
        <img {...img} />
      </picture>
      <div className="hero-shade" />
      <div className="hero-content">
        <p className="eyebrow light">{t("hero.eyebrow")}</p>
        <h1 id="hero-title">{t("hero.title1")}<br />{t("hero.title2")}</h1>
        <p className="hero-location">{t("hero.location")}</p>
        <p className="hero-description">
          {t("hero.desc1")}<br className="desktop-break" /> {t("hero.desc2")}
        </p>
        <SearchBox id={SEARCH_ID} icon shortcut tryExample />
      </div>
      <div className="hero-bottom">
        <a href="#who-its-for">{t("hero.explore")} <span aria-hidden="true">↓</span></a>
        <span>{t("hero.imageNote")}</span>
      </div>
    </section>
  );
}
