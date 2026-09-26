import "server-only";

// Renders the print-first report route to a US Letter PDF with headless Chromium.
//
// Two passes: the first PDF is only used to find which page each section starts on (Chromium writes a
// named destination for every in-document link target, and the table of contents links to each
// section). Those page numbers are written into the TOC, and the second pass is the final PDF.
//
// LOCAL: uses puppeteer-core with an installed Chrome/Chromium. Set CHROME_PATH to override the
// auto-detected location.
//
// VERCEL (switch later, not needed locally):
//   1. npm i @sparticuz/chromium  (puppeteer-core is already a dependency; both are on Next's
//      built-in serverExternalPackages list, so no next.config change is needed)
//   2. In launchBrowser(), replace the VERCEL branch with:
//        const chromium = (await import("@sparticuz/chromium")).default;
//        return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
//   3. Keep `maxDuration` on the route (60 s is plenty; a report renders in a few seconds).

import { existsSync } from "node:fs";
import type { Browser, Page } from "puppeteer-core";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

const LOCAL_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    throw new Error("PDF rendering on Vercel needs @sparticuz/chromium; see the note at the top of src/lib/report/pdf.ts.");
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

export async function renderReportPdf(opts: RenderOptions): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
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
    const res = await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 45_000 });
    if (!res || !res.ok()) throw new Error(`Report page returned ${res?.status() ?? "no response"}`);
    await page.waitForSelector("[data-report-ready]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const first = await printPdf(page);
    const pages = await destinationPages(first);
    const filled = await page.evaluate((map: Record<string, number>) => {
      let n = 0;
      document.querySelectorAll<HTMLElement>("[data-toc]").forEach((el) => {
        const p = map[el.dataset.toc ?? ""];
        if (p) {
          el.textContent = String(p);
          n++;
        }
      });
      return n;
    }, pages);
    const final = filled ? await printPdf(page) : first;

    const doc = await PDFDocument.load(final);
    const when = new Date(`${opts.generatedDate}T12:00:00Z`);
    doc.setTitle(opts.title);
    doc.setAuthor("EaseScore.AI");
    doc.setSubject("Development feasibility study (decision support)");
    doc.setCreator("EaseScore.AI report renderer");
    doc.setProducer("EaseScore.AI");
    doc.setCreationDate(when);
    doc.setModificationDate(when);
    return await doc.save();
  } finally {
    await browser.close();
  }
}
