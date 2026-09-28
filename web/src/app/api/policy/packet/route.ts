import { todayET } from "@/lib/date";
import type { NextRequest } from "next/server";
import { renderReportPdf } from "@/lib/report/pdf";
import { parseKey, scenarioFromQuery, scenarioToQuery, stateKey } from "@/lib/policy/model";

// GET /api/policy/packet?s=<key>[&abate=100x10][&name=...] -> 3-page council packet PDF.
// Renders the print page /policy/packet with headless Chromium (same pipeline as the parcel report).
export const maxDuration = 60;
// Chromium (puppeteer-core + @sparticuz/chromium) needs the Node.js runtime; give the function ~2 GB in Vercel settings.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sc = scenarioFromQuery(q);
  const key = stateKey(parseKey(q.get("s") ?? "base"));
  const page = scenarioToQuery(sc);
  const name = (q.get("name") ?? "").replace(/[^\w .,'()&-]/g, "").slice(0, 80);
  if (name) page.set("name", name);
  const date = todayET();
  page.set("date", date);
  try {
    const pdf = await renderReportPdf({ url: `${req.nextUrl.origin}/policy/packet?${page.toString()}`, title: `EaseScore.AI council packet: ${name || key}`, generatedDate: date });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${q.get("download") === "0" ? "inline" : "attachment"}; filename="EaseScore-council-packet-${(name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)) || key}-${date}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`Could not render the council packet: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}
