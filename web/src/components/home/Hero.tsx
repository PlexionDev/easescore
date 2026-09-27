import { getImageProps } from "next/image";
import { preload } from "react-dom";
import SearchBox from "./SearchBox";
import { SEARCH_ID } from "./constants";

export default async function Hero() {
  const HERO_ALT = "AI-generated aerial interpretation of Pittsburgh’s three rivers, Point State Park, downtown skyline, and green hills.";
  // Art direction: a lighter crop-safe image on phones, the full-size scene elsewhere.
  const common = { alt: HERO_ALT, sizes: "100vw", fetchPriority: "high" as const, loading: "eager" as const };
  const { props: { srcSet: mobile } } = getImageProps({
    ...common, src: "/home/images/hero-rivers-placeholder.webp", width: 1000, height: 563,
  });
  const { props: { srcSet: desktop, ...img } } = getImageProps({
    ...common, src: "/home/images/hero-rivers.webp", width: 1672, height: 941,
  });
  // The hero is the page's LCP: preload exactly the variant the <picture> will pick (same media split,
  // same srcset and sizes) from <head>, ahead of the stylesheets, so it is the first image on the wire.
  const MOBILE = "(max-width:640px)";
  preload("/home/images/hero-rivers-placeholder.webp", { as: "image", imageSrcSet: mobile, imageSizes: "100vw", media: MOBILE, fetchPriority: "high" });
  preload("/home/images/hero-rivers.webp", { as: "image", imageSrcSet: desktop, imageSizes: "100vw", media: "(min-width:640.02px)", fetchPriority: "high" });

  return (
    <section className="hero" aria-labelledby="hero-title">
      <picture className="hero-image">
        <source media={MOBILE} srcSet={mobile} />
        <source srcSet={desktop} />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
        <img {...img} />
      </picture>
      <div className="hero-shade" />
      <div className="hero-content">
        <p className="eyebrow light">Pittsburgh & Allegheny County</p>
        <h1 id="hero-title">See what it takes<br />to build.</h1>
        <p className="hero-location">On any lot in Allegheny County.</p>
        <p className="hero-description">
          {"Zoning, slope, old mines, flood risk and cost,"}<br className="desktop-break" /> {"with a source behind every number."}
        </p>
        <SearchBox id={SEARCH_ID} icon shortcut tryExample />
      </div>
      <div className="hero-bottom">
        <a href="#who-its-for">{"Explore what’s possible"} <span aria-hidden="true">↓</span></a>
        <span>AI-generated regional imagery</span>
      </div>
    </section>
  );
}
