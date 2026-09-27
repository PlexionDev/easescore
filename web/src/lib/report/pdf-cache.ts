import "server-only";

// Rendered Feasibility Study PDFs, cached by parcel + pane/config version + report version + build +
// the full query (which includes the generated date) + a hash of any captured images.
//
// - Memory: the last few PDFs per server process.
// - Disk: <repo>/.cache/report-pdf locally (gitignored); the OS temp dir on Vercel (per instance,
//   lost on a cold start). No Supabase Storage bucket exists for this, so none is used (see DECISIONS.md).
// - Entries expire after a day (the date is in the key anyway); ?fresh=1 skips the cache.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PANE_VERSION } from "@/lib/pane-core";
import { pdfKeyMaterial } from "./cache-core";

const TTL_MS = 24 * 3600_000;
const MEM_MAX = 12;
const ROOT = existsSync(join(process.cwd(), "engine")) ? process.cwd() : resolve(process.cwd(), "..");
const DIR = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? join(tmpdir(), "report-pdf") : join(ROOT, ".cache", "report-pdf");
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? gitHead();

/** Local builds: the checked-out commit, so a new commit never serves an older PDF (uncommitted edits: use ?fresh=1). */
function gitHead(): string {
  try {
    const head = readFileSync(join(ROOT, ".git", "HEAD"), "utf8").trim();
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    return ref ? readFileSync(join(ROOT, ".git", ref), "utf8").trim() : head;
  } catch {
    return "local";
  }
}

const mem = new Map<string, { at: number; pdf: Uint8Array }>();

/**
 * Header value the PDF renderer sends with its request for the report page, so the page knows it is
 * being printed for download (full rent-comp street addresses) rather than viewed on screen (block
 * level). Derived from the server's secret key: the same on every instance, never sent to a browser.
 * null when no secret is configured (the report then shows block-level addresses everywhere).
 */
export function printToken(): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY;
  return secret ? createHash("sha256").update(`easescore-report-print\n${secret}`).digest("hex").slice(0, 40) : null;
}
export const PRINT_HEADER = "x-easescore-report-print";

export function pdfCacheKey(parid: string, reportVersion: string, query: URLSearchParams, images?: Record<string, string>): string {
  return createHash("sha256").update(pdfKeyMaterial(parid, PANE_VERSION, reportVersion, BUILD, [...query.entries()], images)).digest("hex").slice(0, 32);
}

export function getCachedPdf(key: string): Uint8Array | null {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pdf;
  try {
    const file = join(DIR, `${key}.pdf`);
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < TTL_MS) {
      const pdf = new Uint8Array(readFileSync(file));
      remember(key, pdf);
      return pdf;
    }
  } catch {
    // A missing or unreadable cache is a miss.
  }
  return null;
}

export function putCachedPdf(key: string, pdf: Uint8Array): void {
  remember(key, pdf);
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, `${key}.pdf`), pdf);
  } catch {
    // Read-only disk: memory only.
  }
}

function remember(key: string, pdf: Uint8Array) {
  mem.delete(key);
  mem.set(key, { at: Date.now(), pdf });
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
}
