import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://easescore.ai"),
  title: "EaseScore.AI",
  description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
  icons: {
    icon: [
      { url: "/brand/favicon.ico" },
      { url: "/brand/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  openGraph: {
    title: "EaseScore.AI",
    description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
    url: "https://easescore.ai",
    siteName: "EaseScore.AI",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "EaseScore.AI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EaseScore.AI",
    description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
    images: ["/brand/og-image.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">
        {children}
      </body>
    </html>
  );
}
