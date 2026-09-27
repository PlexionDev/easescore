import type { NextRequest } from "next/server";
import { CSV_COLUMNS, csvLine, filtersToQuery, parseDir, parseFilters, parseSort, plannerOptions, plannerQuery, sourcesCsv } from "@/lib/planner";

const CHUNK = 5000;

// GET /api/planner/export?<filters>&sort=&dir=            CSV of the whole filtered set, in table order
// GET /api/planner/export?kind=sources                      CSV of sources and data dates
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const stamp = new Date().toISOString().slice(0, 10);
  if (q.get("kind") === "sources") {
    const o = await plannerOptions().catch(() => null);
    return new Response(sourcesCsv(o?.data_dates ?? {}, o?.config_versions ?? [], o?.computed_at ?? null), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="easescore-planner-sources-${stamp}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const f = parseFilters(q);
  const sort = parseSort(q.get("sort"));
  const dir = parseDir(q.get("dir"), sort);
  const origin = req.nextUrl.origin;
  const encoder = new TextEncoder();
  const tag = filtersToQuery(f).toString() ? "filtered" : "all";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(CSV_COLUMNS.join(",") + "\n"));
      try {
        for (let offset = 0; ; offset += CHUNK) {
          const res = await plannerQuery(f, sort, dir, CHUNK, offset);
          if (res.rows.length) controller.enqueue(encoder.encode(res.rows.map((r, i) => csvLine(r, offset + i + 1, origin)).join("\n") + "\n"));
          if (res.rows.length < CHUNK) break;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="easescore-planner-${tag}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
