import type { NextRequest } from "next/server";
import { renderReportPdf } from "@/lib/report/pdf";
import { todayIso } from "@/lib/report/load";

// GET  /api/report/<parid>?<same query as the report page>  -> PDF download
// POST /api/report/<parid>  { query?: string, images?: { context?, terrain?, analysis? } }
//      images are data URLs (PNG/JPEG/WebP) from the app's "Capture view"; they are served to the
//      page only inside the renderer and never stored.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PARID = /^[0-9A-Z]{16}$/i;
const SLOTS = ["context", "terrain", "analysis"] as const;
const MAX_IMAGE_CHARS = 8_000_000;

async function respond(req: NextRequest, parid: string, query: URLSearchParams, images?: Record<string, string>) {
  if (!PARID.test(parid)) return new Response("Invalid parcel id", { status: 400 });
  const q = new URLSearchParams(query);
  q.delete("download");
  for (const s of SLOTS) {
    if (images?.[s]) q.set(`img_${s}`, `/__report-img/${s}`);
  }
  const date = todayIso(Object.fromEntries(q));
  if (!q.has("date")) q.set("date", date);
  const url = `${req.nextUrl.origin}/parcel/${encodeURIComponent(parid)}/report?${q.toString()}`;
  try {
    const pdf = await renderReportPdf({ url, images, title: `EaseScore.AI Feasibility Study — ${parid}`, generatedDate: date });
    const inline = query.get("download") === "0";
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="EaseScore-Feasibility-${parid}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`Could not render the PDF: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/report/[parid]">) {
  const { parid } = await ctx.params;
  return respond(req, parid, req.nextUrl.searchParams);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/report/[parid]">) {
  const { parid } = await ctx.params;
  let body: { query?: string; images?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("Expected a JSON body", { status: 400 });
  }
  const images: Record<string, string> = {};
  for (const s of SLOTS) {
    const v = body.images?.[s];
    if (typeof v === "string" && v.length < MAX_IMAGE_CHARS && /^data:image\/(png|jpeg|webp);base64,/.test(v)) images[s] = v;
  }
  return respond(req, parid, new URLSearchParams(typeof body.query === "string" ? body.query.replace(/^\?/, "") : ""), images);
}
