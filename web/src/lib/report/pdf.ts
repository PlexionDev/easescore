import "server-only";

// Renders the print-first report route to a US Letter PDF with headless Chromium.
//
// Table of contents page numbers: Chromium writes a named destination for every in-document link
// target (the TOC links to each section), so a printed PDF says which page each section starts on.
// The last page map seen for the parcel is written into the TOC before the first print; when the
// printed PDF agrees with it (the usual case once a parcel has been printed), that print is final.
// Otherwise the numbers are corrected and the page is printed once more.
//
// One Chromium process is shared by all requests (a new tab per PDF), relaunched if it dies.
//
// LOCAL: uses puppeteer-core with an installed Chrome/Chromium. Set CHROME_PATH to override the
// auto-detected location.
//
// VERCEL: uses @sparticuz/chromium (serverless Chromium). puppeteer-core and @sparticuz/chromium are on
// Next's built-in serverExternalPackages list; next.config.ts adds the package's bin/ folder to the four
// PDF routes' traced files (outputFileTracingIncludes), since the tracer misses it. PDF routes keep
// `maxDuration` and need ~2 GB of function memory (see .planning deploy notes).

import { existsSync } from "node:fs";
import type { Browser, Page } from "puppeteer-core";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from "pdf-lib";
import { samePageMap } from "./cache-core";
import { PRINT_HEADER, printToken } from "./pdf-cache";

const LOCAL_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

let shared: Promise<Browser> | null = null;

/** The shared browser (launched on first use; relaunched after a crash or disconnect). */
function sharedBrowser(): Promise<Browser> {
  if (!shared) {
    const p = launchBrowser();
    shared = p;
    p.then((b) => b.on("disconnected", () => { if (shared === p) shared = null; }), () => { if (shared === p) shared = null; });
  }
  return shared;
}

/** Page maps by parcel (section id → page), so the TOC is usually right on the first print. */
const pageMaps = new Map<string, Record<string, number>>();

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: [...chromium.args, "--font-render-hinting=none"], executablePath: await chromium.executablePath(), headless: true });
  }
  const executablePath = process.env.CHROME_PATH || LOCAL_CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chrome or Chromium found. Install one or set CHROME_PATH.");
  return puppeteer.launch({ executablePath, headless: true, args: ["--font-render-hinting=none"] });
}

export interface RenderOptions {
  /** Absolute URL of the report page to print. */
  url: string;
  /** Images served to the page under /__report-img/<slot> (from a POST body), as data URLs. */
  images?: Record<string, string>;
  title: string;
  /** YYYY-MM-DD; stamped as the PDF creation date so the file metadata is reproducible too. */
  generatedDate: string;
  /** Key for the remembered page map (the parcel ID). */
  mapKey?: string;
  /** BCP 47 language of the document text (PDF /Lang); default en-US. */
  lang?: string;
}

function decodeDataUrl(d: string): { type: string; body: Buffer } | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(d);
  return m ? { type: m[1]!, body: Buffer.from(m[2]!, "base64") } : null;
}

/** Map named destinations (section ids) to 1-based page numbers. */
async function destinationPages(pdf: Uint8Array): Promise<Record<string, number>> {
  const doc = await PDFDocument.load(pdf);
  const pageRefs = doc.getPages().map((p) => p.ref.toString());
  const out: Record<string, number> = {};
  const record = (name: string, v: unknown) => {
    const arr = v instanceof PDFRef ? doc.context.lookup(v) : v;
    const dest = arr instanceof PDFDict ? arr.lookup(PDFName.of("D")) : arr;
    if (dest instanceof PDFArray) {
      const idx = pageRefs.indexOf(dest.get(0).toString());
      if (idx >= 0) out[name] = idx + 1;
    }
  };
  const dests = doc.catalog.lookup(PDFName.of("Dests"));
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) record(k.decodeText(), v);
  return out;
}

async function printPdf(page: Page): Promise<Uint8Array> {
  return page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true, outline: true });
}

const fillToc = (page: Page, map: Record<string, number>) =>
  page.evaluate((m: Record<string, number>) => {
    let n = 0;
    document.querySelectorAll<HTMLElement>("[data-toc]").forEach((el) => {
      const p = m[el.dataset.toc ?? ""];
      if (p) {
        el.textContent = String(p);
        n++;
      }
    });
    return n;
  }, map);


/**
 * Chromium tags each HTML <figure> as a PDF Figure, and the chart inside it (an SVG with role="img" and
 * alt text) as a second Figure. The outer one has no /Alt, which PDF checkers flag, and giving it one would
 * hide the chart's own alt text (Alt replaces a Figure's content). So a Figure without /Alt that contains a
 * Figure with /Alt is retagged as a /Div: the caption stays readable text and the chart keeps its alt.
 */
function retagFigureWrappers(doc: PDFDocument) {
  const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (!(root instanceof PDFDict)) return;
  const FIG = PDFName.of("Figure");
  const kids = (d: PDFDict): PDFDict[] => {
    const k = d.lookup(PDFName.of("K"));
    const arr = k instanceof PDFArray ? k.asArray() : k ? [k] : [];
    return arr.map((x) => (x instanceof PDFRef ? doc.context.lookup(x) : x)).filter((x): x is PDFDict => x instanceof PDFDict);
  };
  const isFig = (d: PDFDict) => d.lookup(PDFName.of("S")) === FIG;
  const hasAltFigure = (d: PDFDict, depth = 0): boolean =>
    depth < 40 && kids(d).some((c) => (isFig(c) && !!c.lookup(PDFName.of("Alt"))) || hasAltFigure(c, depth + 1));
  const seen = new Set<PDFDict>();
  const walk = (d: PDFDict, depth = 0) => {
    if (seen.has(d) || depth > 200) return;
    seen.add(d);
    if (isFig(d) && !d.lookup(PDFName.of("Alt")) && hasAltFigure(d)) d.set(PDFName.of("S"), PDFName.of("Div"));
    for (const c of kids(d)) walk(c, depth + 1);
  };
  walk(root);
}

export async function renderReportPdf(opts: RenderOptions): Promise<Uint8Array> {
  const t0 = performance.now();
  const lap = (step: string) => console.log(`[timing] report_pdf ${opts.mapKey ?? ""} ${step} ${(performance.now() - t0).toFixed(0)}ms`);
  let browser = await sharedBrowser();
  let page: Page;
  try {
    page = await browser.newPage();
  } catch {
    // The shared browser died between requests: start a new one.
    shared = null;
    browser = await sharedBrowser();
    page = await browser.newPage();
  }
  try {
    if (opts.images && Object.keys(opts.images).length) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = new URL(req.url());
        const slot = u.pathname.startsWith("/__report-img/") ? u.pathname.slice("/__report-img/".length) : null;
        const img = slot ? decodeDataUrl(opts.images![slot] ?? "") : null;
        if (slot) void (img ? req.respond({ status: 200, contentType: img.type, body: img.body }) : req.respond({ status: 404, body: "" }));
        else void req.continue();
      });
    }
    await page.emulateMediaType("print");
    const token = printToken();
    if (token) await page.setExtraHTTPHeaders({ [PRINT_HEADER]: token });
    // "load" fires once the streamed page has fully arrived (sections, fonts, images); no idle wait.
    const res = await page.goto(opts.url, { waitUntil: "load", timeout: 45_000 });
    if (!res || !res.ok()) throw new Error(`Report page returned ${res?.status() ?? "no response"}`);
    // Inside .rpt: streamed sections first arrive in a hidden holder and count only once React has
    // swapped them in for the first look (the swap can lag the arrival by a frame or two).
    // The seat print pages (memo, packet, brief) are not streamed and mark their root element instead.
    // Their streamed content can also sit in a hidden holder while a route's loading screen shows, so a seat
    // page counts as ready only once its root is outside any [hidden] element.
    await page.waitForFunction(() => {
      if (document.querySelector(".rpt [data-report-ready], .rpt [data-report-error]")) return true;
      const seat = document.querySelector(".memo[data-report-ready], .pk[data-report-ready], .br[data-report-ready]");
      return !!seat && !seat.closest("[hidden]");
    }, { timeout: 30_000 });
    if (await page.$(".rpt [data-report-error]")) throw new Error("No data for this parcel right now. Try again in a minute.");
    await page.evaluate(() => Promise.all([document.fonts.ready, ...Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))]).then(() => true));
    lap("page");

    const known = opts.mapKey ? pageMaps.get(opts.mapKey) : undefined;
    if (known) await fillToc(page, known);
    let out = await printPdf(page);
    lap("print1");
    const pages = await destinationPages(out);
    if (!known || !samePageMap(known, pages)) {
      if (await fillToc(page, pages)) {
        out = await printPdf(page);
        lap("print2");
      }
    }
    if (opts.mapKey) {
      pageMaps.set(opts.mapKey, pages);
      if (pageMaps.size > 200) pageMaps.delete(pageMaps.keys().next().value!);
    }

    const doc = await PDFDocument.load(out);
    const when = new Date(`${opts.generatedDate}T12:00:00Z`);
    doc.setTitle(opts.title);
    doc.setAuthor("EaseScore.AI");
    doc.setSubject("Development feasibility study (decision support)");
    doc.setCreator("EaseScore.AI report renderer");
    doc.setProducer("EaseScore.AI");
    doc.setCreationDate(when);
    doc.setModificationDate(when);
    // Accessibility: document language for screen readers (the tags and outline come from Chromium's
    // tagged print), and viewers show the title rather than the file name.
    doc.catalog.set(PDFName.of("Lang"), PDFString.of(opts.lang ?? "en-US"));
    retagFigureWrappers(doc);
    const prefs = doc.catalog.lookup(PDFName.of("ViewerPreferences"));
    if (prefs instanceof PDFDict) prefs.set(PDFName.of("DisplayDocTitle"), doc.context.obj(true));
    else doc.catalog.set(PDFName.of("ViewerPreferences"), doc.context.obj({ DisplayDocTitle: true }));
    const bytes = await doc.save();
    lap("save");
    return bytes;
  } finally {
    await page.close().catch(() => undefined);
  }
}
