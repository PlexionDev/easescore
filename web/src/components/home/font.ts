import localFont from "next/font/local";

// The homepage's brand sans (Inter, SIL Open Font License 1.1), self-hosted from the app bundle.
// next/font adds a size-adjusted fallback face, so the swap from the system font causes no layout shift.
export const brandSans = localFont({
  src: "../../app/fonts/brand-sans.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-brand",
  fallback: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});
