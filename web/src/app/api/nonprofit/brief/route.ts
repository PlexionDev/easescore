import { todayET } from "@/lib/date";
import type { NextRequest } from "next/server";
import { renderReportPdf } from "@/lib/report/pdf";
import { parseState, stateToQuery } from "@/lib/nonprofit/types";

// GET /api/nonprofit/brief?<same query as /nonprofit> -> advocacy brief PDF (2–4 pages), printed from
// /nonprofit/brief with the shared Chromium pipeline. Nothing is stored.

export const maxDuration = 60;
// Chromium (puppeteer-core + @sparticuz/chromium) needs the Node.js runtime; give the function ~2 GB in Vercel settings.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = parseState(req.nextUrl.searchParams);
  const q = stateToQuery(s);
  q.delete("step");
  const date = todayET();
  q.set("date", date);
  const url = `${req.nextUrl.origin}/nonprofit/brief?${q.toString()}`;
  try {
    const pdf = await renderReportPdf({ url, title: `EaseScore.AI Advocacy Brief — ${s.hood}`, generatedDate: date });
    const inline = req.nextUrl.searchParams.get("download") === "0";
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="EaseScore-Advocacy-Brief-${s.hood.replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`Could not render the brief: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}
