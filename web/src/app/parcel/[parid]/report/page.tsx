import { Fragment, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { PRINT_HEADER, printToken } from "@/lib/report/pdf-cache";
import localFont from "next/font/local";
import { loadReport, loadReportHead, type ReportHead, type ReportModel } from "@/lib/report/load";
import { buildSources } from "@/lib/report/sources";
import { configVersionOf } from "@/lib/report/score";
import { num, titleCase } from "@/lib/report/assess";
import {
  AppA, AppB, AppC, AppD, AppE, AppF, Contents, Cover, DISCLAIMER, REPORT_VERSION,
  S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, type Ctx,
} from "./sections";
import "./report.css";

// Print-first Feasibility Study. Open it in a browser to read it; /api/report/[parid] renders it to PDF.
// Streaming: the first look (address, best option, the two-sentence summary) comes from the parcel
// pane alone and is on screen at once; the full study (every section, in reading order so the
// footnote, figure and table numbers stay stable) streams in behind a Suspense boundary and replaces it.

// Static weights (not the variable fonts): Chromium embeds static fonts as real text fonts in the PDF,
// which keeps the file small and the letter spacing exact in every viewer.
// All fonts are bundled with the app (no build-time download from Google Fonts): Source Serif 4 and
// Archivo Narrow from @fontsource (SIL OFL 1.1), Inter from the homepage's brand font file.
const serif = localFont({ variable: "--font-serif", display: "block", src: [
  { path: "../../../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2", weight: "400", style: "normal" },
  { path: "../../../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2", weight: "400", style: "italic" },
  { path: "../../../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2", weight: "600", style: "normal" },
  { path: "../../../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-italic.woff2", weight: "600", style: "italic" },
] });
const sans = localFont({ src: "../../../fonts/brand-sans.woff2", weight: "100 900", style: "normal", variable: "--font-sans", display: "block" });
// Condensed sans for the site plan sheet (EA-101).
const narrow = localFont({ variable: "--font-narrow", display: "block", src: [
  { path: "../../../../../node_modules/@fontsource/archivo-narrow/files/archivo-narrow-latin-400-normal.woff2", weight: "400", style: "normal" },
  { path: "../../../../../node_modules/@fontsource/archivo-narrow/files/archivo-narrow-latin-600-normal.woff2", weight: "600", style: "normal" },
  { path: "../../../../../node_modules/@fontsource/archivo-narrow/files/archivo-narrow-latin-700-normal.woff2", weight: "700", style: "normal" },
] });

export const metadata: Metadata = {
  title: "Feasibility Study — EaseScore.AI",
  robots: { index: false },
};

/** Escape a value for a CSS string literal. */
const cssStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

export default async function ReportPage({ params, searchParams }: PageProps<"/parcel/[parid]/report">) {
  const { parid } = await params;
  const sp = await searchParams;
  // The full model starts now (it shares the pane read with the first look below).
  const model = loadReport(parid, sp);
  model.catch(() => undefined);
  const head = await loadReportHead(parid, sp);
  if (!head) notFound();
  const token = printToken();
  const print = !!token && (await headers()).get(PRINT_HEADER) === token;
  return (
    <div className={`rpt ${serif.variable} ${sans.variable} ${narrow.variable}`}>
      <Suspense fallback={<FirstLook head={head} />}>
        <FullStudy parid={parid} model={model} print={print} />
      </Suspense>
    </div>
  );
}

/** Shown while the full study loads: the summary from the parcel pane (same numbers as the parcel page). */
function FirstLook({ head }: { head: ReportHead }) {
  const where = [head.neighborhood, head.municipality].filter(Boolean).join(", ");
  return (
    <section className="sec" id="first-look" aria-busy="true">
      <h1>
        <span className="secno">1</span>
        Summary in plain English
      </h1>
      <p className="lead">
        <b>{titleCase(head.address) || `Parcel ${head.parid}`}</b>
        {where ? ` · ${where}` : ""} · Parcel {head.parid}
        {head.zoning ? ` · ${head.zoning} zoning` : ""}
        {head.lotAreaSf ? ` · ${num(head.lotAreaSf)} sq ft lot` : ""}
      </p>
      {head.summary.map((t, i) => <p key={i}>{t}</p>)}
      {head.best && (
        <p>
          Easiest option by the Ease Score: <b>{head.best.label}</b>
          {head.best.score != null ? `, ${head.best.score} (${head.best.band ?? "no band"})` : ""}.
        </p>
      )}
      <p className="small muted" role="status">
        Preparing the full study (site, zoning, market, budget, returns, risks and appendices)
        {head.paneSource === "live" ? "; this parcel is being analyzed for the first time" : ""}…
      </p>
    </section>
  );
}

async function FullStudy({ parid, model, print }: { parid: string; model: Promise<ReportModel | null>; print: boolean }) {
  const m = await model;
  if (!m) {
    return (
      <section className="sec" data-report-error="1">
        <h1>Feasibility Study unavailable</h1>
        <p>The data for parcel {parid} could not be read right now. Reload the page in a minute.</p>
      </section>
    );
  }

  let fig = 0;
  let tab = 0;
  const x: Ctx = { m, c: buildSources(m), fig: () => ++fig, tab: () => ++tab, print };

  // Sections run as plain functions, in reading order, so footnote/figure/table numbers are stable.
  const body = [Cover(x), Contents(), S1(x), S2(x), S3(x), S4(x), S5(x), S6(x), S7(x), S8(x), S9(x), S10(x), S11(x), S12(x), S13(x), S14(x), AppA(x), AppB(x), AppC(x), AppD(x), AppE(x), AppF()];

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
}
@page sheet {
  @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 6.5pt "Helvetica Neue", Arial, sans-serif; color: #5f6b7a; vertical-align: middle; }
}`;

  return (
    <>
      <style>{pageCss}</style>
      {body.map((el, i) => (
        <Fragment key={i}>{el}</Fragment>
      ))}
      <span hidden data-report-ready="1" />
    </>
  );
}
