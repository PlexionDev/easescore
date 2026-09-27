import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale, getPreferredLocale } from "@/lib/i18n/server";
import UntranslatedNote from "@/components/i18n/UntranslatedNote";

export const metadata: Metadata = {
  title: "EaseScore.AI",
  description: "Development Ease Score and feasibility for every parcel in Allegheny County.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // <html lang> is Spanish only on fully translated pages; LocaleProvider keeps it in step on client navigation.
  const [lang, preferred] = await Promise.all([getLocale(), getPreferredLocale()]);
  return (
    <html lang={lang} className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">
        <LocaleProvider preferred={preferred}>
          {children}
          <UntranslatedNote />
        </LocaleProvider>
      </body>
    </html>
  );
}
