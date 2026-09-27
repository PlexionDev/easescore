import type { NextRequest } from "next/server";
import { leverSentence, parseKey, stateKey } from "@/lib/policy/model";
import { policyRows } from "@/lib/policy/data";

// GET /api/policy/csv?s=<key> -> CSV of the parcels that gain homes by right under the lever state (before
// and after); &all=1 -> every parcel a lever applies to, including those that gain nothing (full City).
// Parcel IDs and zoning only: no owner names.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const levers = parseKey(req.nextUrl.searchParams.get("s") ?? "base");
  const key = stateKey(levers);
  const all = req.nextUrl.searchParams.get("all") === "1";
  let rows;
  try {
    rows = await policyRows(key, !all);
  } catch {
    return new Response("Could not read the policy results; please try again in a moment.", { status: 503 });
  }
  const date = new Date().toISOString().slice(0, 10);
  const head = ["parcel_id", "neighborhood", "zoning", "levers_that_apply", "homes_by_right_before", "homes_by_right_after", "homes_added",
    "building_type_after", "pencils_low", "pencils_likely", "pencils_high", "added_assessed_value_likely_usd"];
  const lines = [
    `# EaseScore.AI policy test, ${date}. Rule change: ${leverSentence(levers)}. ${all ? "Every parcel a lever applies to, including those that gain no homes" : "Parcels that gain homes by right (add &all=1 for every parcel a lever applies to)"}. Capacity is not production. Decision support only.`,
    head.join(","),
    ...rows.map((r) => [r.parid, r.neighborhood, r.zoning, r.touched.join("+"), r.units_before, r.units_after, r.units_delta,
      r.strategy_after, r.pencils_low, r.pencils_likely, r.pencils_high, r.av_delta_likely].map(esc).join(",")),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="EaseScore-policy-${key}-${all ? "all-parcels" : "gaining"}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
