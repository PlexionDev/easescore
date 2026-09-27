import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EaseScore.AI",
    short_name: "EaseScore.AI",
    description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8f7",
    theme_color: "#156b54",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
