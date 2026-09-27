import type { NextRequest } from "next/server";
import { renderReportPdf } from "@/lib/report/pdf";
import { filtersToQuery, parseDir, parseFilters, parseSort } from "@/lib/planner";

// GET /api/planner/memo?<filters>&ids=<shortlist>  -> staff memo PDF (cover + one page per shortlisted parcel)
// Renders /planner/memo (print page) with headless Chromium, like the parcel report.
export const maxDuration = 60;
// Chromium (puppeteer-core + @sparticuz/chromium) needs the Node.js runtime; give the function ~2 GB in Vercel settings.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const f = parseFilters(q);
  const sort = parseSort(q.get("sort"));
  const shortlist = (q.get("shortlist") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[0-9A-Z]{16}$/.test(x)).slice(0, 25);
  const page = filtersToQuery(f);
  page.set("sort", sort);
  page.set("dir", parseDir(q.get("dir"), sort));
  if (shortlist.length) page.set("shortlist", shortlist.join(","));
  if (q.get("pinned") === "1") page.set("pinned", "1");
  const date = new Date().toISOString().slice(0, 10);
  page.set("date", date);
  try {
    const pdf = await renderReportPdf({ url: `${req.nextUrl.origin}/planner/memo?${page.toString()}`, title: "EaseScore.AI staff memo: candidate housing sites", generatedDate: date });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${q.get("download") === "0" ? "inline" : "attachment"}; filename="EaseScore-staff-memo-${date}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`Could not render the memo: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}
