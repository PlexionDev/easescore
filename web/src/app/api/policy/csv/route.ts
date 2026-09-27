import type { NextRequest } from "next/server";
import { leverSentence, parseKey, stateKey } from "@/lib/policy/model";
import { policyRows } from "@/lib/policy/data";

// GET /api/policy/csv?s=<key> -> CSV of every parcel the lever state touches, with homes allowed by right
// before and after. Parcel IDs and zoning only: no owner names.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const levers = parseKey(req.nextUrl.searchParams.get("s") ?? "base");
  const key = stateKey(levers);
  const rows = await policyRows(key);
  const date = new Date().toISOString().slice(0, 10);
  const head = ["parcel_id", "neighborhood", "zoning", "levers_that_apply", "homes_by_right_before", "homes_by_right_after", "homes_added",
    "building_type_after", "pencils_low", "pencils_likely", "pencils_high", "added_assessed_value_likely_usd"];
  const lines = [
    `# EaseScore.AI policy test, ${date}. Rule change: ${leverSentence(levers)}. Capacity is not production. Decision support only.`,
    head.join(","),
    ...rows.map((r) => [r.parid, r.neighborhood, r.zoning, r.touched.join("+"), r.units_before, r.units_after, r.units_delta,
      r.strategy_after, r.pencils_low, r.pencils_likely, r.pencils_high, r.av_delta_likely].map(esc).join(",")),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="EaseScore-policy-${key}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
