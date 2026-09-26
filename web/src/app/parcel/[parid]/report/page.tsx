import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, Source_Serif_4 } from "next/font/google";
import { loadReport } from "@/lib/report/load";
import { buildSources } from "@/lib/report/sources";
import { configVersionOf } from "@/lib/report/score";
import { titleCase } from "@/lib/report/assess";
import {
  AppA, AppB, AppC, AppD, AppE, AppF, Contents, Cover, DISCLAIMER, REPORT_VERSION,
  S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, type Ctx,
} from "./sections";
import "./report.css";

// Print-first Feasibility Study. Open it in a browser to read it; /api/report/[parid] renders it to PDF.

// Static weights (not the variable fonts): Chromium embeds static fonts as real text fonts in the PDF,
// which keeps the file small and the letter spacing exact in every viewer.
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--font-serif", display: "block" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "block" });

export const metadata: Metadata = {
  title: "Feasibility Study — EaseScore.AI",
  robots: { index: false },
};

/** Escape a value for a CSS string literal. */
const cssStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

export default async function ReportPage({ params, searchParams }: PageProps<"/parcel/[parid]/report">) {
  const { parid } = await params;
  const sp = await searchParams;
  const m = await loadReport(parid, sp);
  if (!m) notFound();

  let fig = 0;
  let tab = 0;
  const x: Ctx = { m, c: buildSources(m), fig: () => ++fig, tab: () => ++tab };

  // Sections run as plain functions, in reading order, so footnote/figure/table numbers are stable.
  const body = [Cover(x), Contents(), S1(x), S2(x), S3(x), S4(x), S5(x), S6(x), S7(x), S8(x), S9(x), S10(x), S11(x), S12(x), S13(x), AppA(x), AppB(x), AppC(x), AppD(x), AppE(x), AppF()];

  const address = titleCase(m.facts.assessment?.address) || parid;
  const header = `${address} · Parcel ${parid}`;
  const footer = `${DISCLAIMER} Generated ${m.generatedDate} · EaseScore config ${configVersionOf(m.score)} · ${REPORT_VERSION}`;
  const pageCss = `
@page {
  @top-left { content: ${cssStr(header)}; font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #5f6b7a; vertical-align: bottom; padding-bottom: 8pt; }
  @top-right { content: "EaseScore.AI Feasibility Study"; font: 600 7.5pt "Helvetica Neue", Arial, sans-serif; color: #234e70; vertical-align: bottom; padding-bottom: 8pt; }
  @bottom-left { content: ${cssStr(footer)}; font: 6.5pt "Helvetica Neue", Arial, sans-serif; color: #5f6b7a; vertical-align: top; padding-top: 8pt; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #1f2933; vertical-align: top; padding-top: 8pt; }
}
@page :first {
  @top-left { content: none; } @top-right { content: none; }
}`;

  return (
    <div className={`rpt ${serif.variable} ${sans.variable}`} data-report-ready="1">
      <style>{pageCss}</style>
      {body.map((el, i) => (
        <Fragment key={i}>{el}</Fragment>
      ))}
    </div>
  );
}
