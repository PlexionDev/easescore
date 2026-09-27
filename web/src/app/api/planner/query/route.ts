import type { NextRequest } from "next/server";
import { PAGE_SIZE, parseDir, parseFilters, parseSort, plannerQuery } from "@/lib/planner";

// Filtered, ranked page of precomputed scores plus the summary panel (bands, blockers, capacity, public land).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const page = Math.max(0, Math.floor(Number(q.get("page") ?? 0)) || 0);
  const sort = parseSort(q.get("sort"));
  try {
    const res = await plannerQuery(parseFilters(q), sort, parseDir(q.get("dir"), sort), PAGE_SIZE, page * PAGE_SIZE);
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load planner results." }, { status: 502 });
  }
}
