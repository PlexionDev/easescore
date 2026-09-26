"use client";

import dynamic from "next/dynamic";

// Client-only, code-split: the search UI renders first; Cesium arrives later (and only with a key).
const PhotorealHero = dynamic(() => import("./PhotorealHero"), { ssr: false });

export default function HeroBackdrop() {
  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY) return null;
  return <PhotorealHero />;
}
