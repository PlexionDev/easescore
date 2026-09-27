import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EaseScore.AI",
  description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">{children}</body>
    </html>
  );
}
