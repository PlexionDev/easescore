import { Instrument_Sans } from "next/font/google";

// Self-hosted at build time by next/font: no request to Google from the visitor's browser.
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-instrument",
  display: "swap",
});
