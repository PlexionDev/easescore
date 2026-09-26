import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EaseScore.AI — v0.5 test build",
  description: "Internal test interface for the EaseScore.AI data and requirements engine.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">{children}</body>
    </html>
  );
}
