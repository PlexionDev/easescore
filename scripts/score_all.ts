// Precompute Ease Scores for the planner view into public.parcel_scores.
//
// Run: scripts/score_all.sh [--scope city|county] [--buckets 200] [--from 0] [--to 199]
//                           [--workers N] [--sql-concurrency 4] [--budget-ms 8000] [--dry] [--verify 20]
//                           [--hoods "A,B"] [--skip-hoods "A,B"] [--munis "A,B"] [--pause-ms 0]
//
// How it works: parcels are split into hash buckets (abs(hashtext(parid)) % buckets) so each bulk
// query stays under the 2-minute statement limit. scripts/score_all.sql pulls the score inputs for
// one bucket set-based (same tables and rules as parcel_facts / parcel_quickfit_input /
// parcel_ease_inputs). Worker threads run the engine's score.scoreParcel with policy unlocks off,
// and rows are upserted over the Data API with the service key (never printed).
// Deterministic for the same data and config; every row records config_version and computed_at.
// --verify N scores N parcels both ways (bulk inputs vs. the per-parcel RPCs the parcel page uses)
// and reports any difference, without writing.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as score from "../engine/src/score/index";

type Json = any;
// Run from the repo root (scripts/score_all.sh does this); the bundle itself lives in a temp dir.
const ROOT = process.cwd();
const CITY_WHERE = "a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$'";

// ------------------------------------------------------------------------------ planner row

const NEW_BUILD_IDS = ["new_sf", "duplex", "three_four_unit", "townhouse_row"];

const VARIANCE_LABEL: [string, string][] = [
  ["min_lot_area", "Minimum lot size"],
  ["min_lot_area_per_unit", "Lot area per unit"],
  ["parking_per_unit", "Parking minimum"],
  ["max_lot_coverage", "Lot coverage limit"],
  ["max_far", "Floor area limit"],
  ["front_setback", "Setbacks"],
  ["rear_setback", "Setbacks"],
  ["side_setback", "Setbacks"],
  ["exterior_side_setback", "Setbacks"],
  ["max_height_ft", "Height limit"],
  ["max_height_stories", "Height limit"],
];

const RED_FLAG_LABEL: Record<string, string> = {
  floodway: "Floodway",
  no_access: "No street access",
  contamination_on_site: "Cleanup site on the lot",
};

const HAZARD_LABEL: Record<string, string> = {
  landslideProne: "Landslide-prone area",
  undermined: "Undermined (old mines)",
  slopeMovementOnLot: "Mapped slope movement",
  floodplain100yr: "Floodplain",
  contaminationOnOrAdjacent: "Cleanup site nearby",
  combinedSewer: "Combined-sewer area",
};

/**
 * The single factor or callout costing the most score points on the best strategy, in plain words.
 * A red flag always wins. Data gaps (e.g. sewer service not confirmed) are not blockers.
 * Returns null when nothing costs a full point.
 */
export function topBlocker(best: score.StrategyResult | null, cfg: score.EaseScoreConfig): string | null {
  return blockerList(best, cfg)[0] ?? null;
}

/**
 * The factors or callouts holding this strategy back, most costly first, in plain words: red flags, then a
 * v0.2 hazard band cap, then point losses (the first at 1+ points, the rest at 2+). Data gaps are not blockers.
 */
export function blockerList(best: score.StrategyResult | null, cfg: score.EaseScoreConfig): string[] {
  if (!best) return [];
  const head: string[] = best.redFlags.map((f) => RED_FLAG_LABEL[f.id] ?? f.title);
  // v0.2: a hazard band cap (mostly landslide-prone, or largely steep) is a binding constraint.
  const cap = (best as { cap?: { reason: string } | null }).cap;
  if (cap) head.push(/landslide/i.test(cap.reason) ? HAZARD_LABEL.landslideProne! : "Steep slope");
  const loss = new Map<string, number>();
  const add = (label: string | null, pts: number) => { if (label && pts > 0) loss.set(label, (loss.get(label) ?? 0) + pts); };
  const F = Object.fromEntries(best.factors.map((f) => [f.id, f])) as Record<string, score.FactorResult>;
  const pts = (f: score.FactorResult | undefined, lost: number) => (f ? (lost * f.weight) / 100 : 0);
  const approvalPts = pts(F.F5, cfg.f5.perDiscretionaryApproval);

  // F1 zoning: permission part vs. dimensional part.
  let permLabel: string | null = null;
  let dimLabel: string | null = null;
  const f1 = F.F1;
  if (f1 && f1.subscore != null) {
    const i = f1.inputs as Record<string, any>;
    const code = i.permissionCode as string | undefined;
    const permScore = Number(i.permissionScore ?? 100);
    const dim = Number(i.dimensionalFactor ?? 1);
    permLabel = i.lotOfRecordPath ? "Minimum lot size"
      : i.nonconforming ? "Nonconforming use"
        : code === "N" ? "Use not permitted"
          : code === "C" ? "Conditional use required"
            : code === "S" ? "Special exception required"
              : code === "A" ? "Administrator exception required" : null;
    if (i.fitStatus === "no_fit") dimLabel = "Lot too small for the building";
    else if (i.fitStatus === "variance") {
      const rules: string[] = i.varianceRules ?? [];
      dimLabel = VARIANCE_LABEL.find(([r]) => rules.includes(r))?.[1] ?? "Dimensional variance";
    } else if (i.fitStatus === "contextual") dimLabel = "Setbacks";
    add(permLabel, pts(f1, 100 - permScore));
    // Whatever the permission score does not explain is dimensional (v0.2 also caps variance paths).
    add(dimLabel, pts(f1, Math.max(permScore * (1 - dim), permScore - f1.subscore)));
  }

  // F2 terrain.
  const f2 = F.F2;
  if (f2 && f2.subscore != null) {
    const i = f2.inputs as Record<string, any>;
    const slopeSub = Number(i.slopeSubscore ?? f2.subscore);
    add("Steep slope", pts(f2, 100 - slopeSub));
    add("Small buildable area", pts(f2, slopeSub * (1 - Number(i.envelopeFactor ?? 1))));
  }

  // F3 hazards: split the lost points across the hits by the log of each multiplier.
  const f3 = F.F3;
  const hazardHits: string[] = [];
  if (f3 && f3.subscore != null) {
    const mult = cfg.f3.multipliers as Record<string, number>;
    for (const [k, v] of Object.entries(f3.inputs)) if (v === true && mult[k]) hazardHits.push(k);
    const logs = hazardHits.map((k) => -Math.log(mult[k]!));
    const sum = logs.reduce((s, x) => s + x, 0);
    hazardHits.forEach((k, j) => add(HAZARD_LABEL[k] ?? k, sum > 0 ? (pts(f3, 100 - f3.subscore!) * logs[j]!) / sum : 0));
  }

  // F4 access: frontage and service areas (unknown service is a data gap, not a blocker).
  const f4 = F.F4;
  if (f4 && f4.subscore != null) {
    const i = f4.inputs as Record<string, any>;
    const front = (cfg.f4.frontage as Record<string, number>)[i.frontage] ?? 0;
    add(i.frontage === "none" ? "No street access" : "No opened street frontage", pts(f4, (100 - front) * Number(i.utilitiesFactor ?? 1)));
    if (i.waterServed === false || i.sewerServed === false) add("Outside water/sewer service", pts(f4, front * (1 - Number(i.utilitiesFactor ?? 1))));
  }

  // F5 approvals: zoning approvals go to the zoning cause; the rest have their own labels.
  const f5 = F.F5;
  if (f5 && f5.subscore != null) {
    const i = f5.inputs as Record<string, any>;
    for (const a of (i.approvals ?? []) as string[]) {
      if (a === "dimensional_variance") add(dimLabel ?? "Dimensional variance", approvalPts);
      else if (a === "use_variance" || a === "special_exception" || a === "conditional_use" || a === "administrator_exception")
        add(permLabel ?? "Zoning approval required", approvalPts);
      else if (a === "historic_certificate") add("Historic district review", approvalPts);
      else if (a === "subdivision") add("Subdivision needed", approvalPts);
      else if (a === "site_plan_review") add("Site plan review", approvalPts);
    }
    if (i.historicDistrict) add("Historic district review", pts(f5, cfg.f5.historicDistrict));
    if (i.geotechRequired) {
      const cause = hazardHits.includes("landslideProne") ? HAZARD_LABEL.landslideProne!
        : hazardHits.includes("undermined") ? HAZARD_LABEL.undermined! : "Geotechnical report required";
      add(cause, pts(f5, cfg.f5.geotechRequired));
    }
    if (i.demolition) add("Existing building to demolish", pts(f5, cfg.f5.demolition));
  }

  // F6 readiness and F7 market.
  const f6 = F.F6;
  if (f6 && f6.subscore != null) {
    const i = f6.inputs as Record<string, any>;
    const title = Number(i.titleFactor ?? 1);
    add("Existing building", pts(f6, 100 - f6.subscore / title));
    add(i.publicOwner ? "Public-owner transfer" : "Tax-delinquent title", pts(f6, (f6.subscore / title) * (1 - title)));
  }
  const f7 = F.F7;
  if (f7 && f7.subscore != null) add("Low market activity", pts(f7, 100 - f7.subscore));

  // Ties broken by label so the order is deterministic. The top blocker needs at least one full point;
  // the rest of the list needs two, so a small drag (e.g. slightly below-median market activity) does not
  // count as holding a parcel back in the planner's share-of-parcels bars.
  const ranked = [...loss.entries()].filter(([, p]) => p > 1 + 1e-9)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const listed = ranked.filter(([, p], i) => i === 0 || p > 2 + 1e-9).map(([l]) => l);
  return [...new Set([...head, ...listed])];
}

function unitsSummary(res: score.EaseScoreResult): { byRight: number | null; withRelief: number | null } {
  let byRight: number | null = null;
  let withRelief: number | null = null;
  for (const s of res.strategies) {
    if (!NEW_BUILD_IDS.includes(s.strategy) || !s.applicable) continue;
    const i = (s.factors.find((f) => f.id === "F1")?.inputs ?? {}) as Record<string, any>;
    const code = i.permissionCode as string | undefined;
    const fit = i.fitStatus as string | undefined;
    if (!code || !fit) continue;
    const u = s.units ?? 0;
    const fits = fit === "by_right" || fit === "contextual";
    // Zoning was evaluated for this strategy, so both counts are known (0 when nothing fits).
    byRight = Math.max(byRight ?? 0, code === "P" && fits ? u : 0);
    withRelief = Math.max(withRelief ?? 0, code !== "N" && (fits || fit === "variance") ? u : 0);
  }
  return { byRight, withRelief };
}

/** Strategies that add homes. The planner ranks on the best of these; rehab is shown alongside. */
export const NEW_HOUSING = ["new_sf", "duplex", "three_four_unit", "townhouse_row", "adu"];

export function plannerRow(facts: Json, res: score.EaseScoreResult, computedAt: string, cfg: score.EaseScoreConfig) {
  // Same ordering as the engine's best pick (no red flags, score, evidence, strategy order), limited to new
  // housing. Options whose zoning could not be checked (ADU rules are not transcribed yet) rank only when no
  // option has a zoning answer: a missing factor is left out of the average and would otherwise float them up.

  const housing = res.strategies.filter((s) => NEW_HOUSING.includes(s.strategy));
  // Outside the City no option has a zoning answer; ADU still ranks last there (its own rules are unknown everywhere).
  const zoned = housing.filter((s) => s.factors.some((f) => f.id === "F1" && f.subscore != null));
  const notAdu = housing.filter((s) => s.strategy !== "adu" && s.applicable && s.score != null);
  const bestId = score.pickBest(zoned.length ? zoned : notAdu.length ? notAdu : housing, cfg.strategies);
  const best = res.strategies.find((s) => s.strategy === bestId) ?? null;
  const rehab = res.strategies.find((s) => s.strategy === "rehab_existing" && s.applicable && s.score != null) ?? null;
  const flags = best?.redFlags ?? res.strategies.find((s) => s.applicable)?.redFlags ?? [];
  const a = facts.assessment ?? {};
  const present = (a.fmv_building ?? 0) > 0 || !!a.year_built || (facts.building_footprint_sqft ?? 0) > 0;
  const units = unitsSummary(res);
  const blockers = blockerList(best, cfg);
  const ov = (layer: string) => (facts.overlays ?? []).some((o: Json) => o.layer === layer && o.share > 0);
  const floodway = (facts.flood_evidence?.floodway_share ?? 0) > 0
    || (facts.overlays ?? []).some((o: Json) => o.layer === "flood_fema_nfhl" && String(o.attrs?.subtype ?? "").toUpperCase() === "FLOODWAY" && o.share > 0);
  const steep = facts.slope_1m?.share_over_25 ?? facts.slope?.steep_share ?? null;
  const dates: Record<string, string | null> = {};
  for (const f of best?.factors ?? []) for (const [k, v] of Object.entries(f.dates)) if (v) dates[k] = v;
  return {
    parid: facts.parid,
    config_version: res.configVersion,
    best_strategy: bestId,
    score: best?.score ?? null,
    band: best?.band ?? null,
    range_lo: best?.range?.[0] ?? null,
    range_hi: best?.range?.[1] ?? null,
    preliminary: !!best?.labels.includes(score.PRELIMINARY),
    red_flag_count: flags.length,
    red_flags: flags.map((f) => ({ id: f.id, title: f.title })),
    top_blocker: blockers[0] ?? null,
    blockers,
    by_right_units: units.byRight,
    units_with_relief: units.withRelief,
    months_to_permit: best?.predictedMonthsToPermit?.months ?? null,
    planning_badge: best?.planningBadge.tier ?? null,
    badge_score: best?.planningBadge.points ?? null,
    factor_scores: best ? Object.fromEntries(best.factors.map((f) => [f.id, f.subscore])) : null,
    vacant: !present,
    // owner_class / owner_type / owner_agency / tax_delinquent / council_district come from
    // parcel_owner_class and parcel_geo (planner_attach_owner_geo, run at the end), so they are not sent here.
    zoning: facts.zoning?.code ?? null,
    neighborhood: facts.context?.neighborhood ?? null,
    municipality: facts.context?.municipality ?? a.municipality ?? null,
    lot_sqft: facts.lot_area_sqft_gis ?? a.lot_area_sqft ?? null,
    lon: facts.centroid?.lon ?? null,
    lat: facts.centroid?.lat ?? null,
    address: a.address || null,
    data_dates: dates,
    transit_m: facts.transit?.nearest_frequent_stop_m ?? null,
    hz_floodway: floodway,
    hz_landslide: ov("landslide_prone_pgh"),
    hz_undermined: facts.mines?.in_city_undermined === true || facts.mines?.in_mined_out === true || ov("undermined_pgh"),
    steep_share: steep,
    cap_label: (best as { cap?: { label: string } | null } | null)?.cap?.label ?? null,
    badge_matches: best ? Object.fromEntries(best.planningBadge.criteria.map((c) => [c.id, c.matched])) : null,
    rehab_score: rehab?.score ?? null,
    rehab_band: rehab?.band ?? null,
    computed_at: computedAt,
  };
}

// ------------------------------------------------------------------------------ input assembly

/** Front / street-side edges, same rule as parcel_quickfit_input (migration 025). */
export function pickFrontEdges(edges: { i: number; len: number; az: number; street_ft: number | null }[]) {
  const c = edges.filter((e) => e.street_ft != null && e.street_ft <= 45 && e.len >= 8)
    .sort((x, y) => x.street_ft! - y.street_ft! || y.len - x.len || x.i - y.i);
  if (!c.length) return { frontEdges: [] as number[], streetSideEdges: [] as number[] };
  const f = c[0]!;
  const parallel = (e: { az: number }) => {
    const m = (e.az - f.az + 540) % 180;
    return Math.abs(m) < 30 || Math.abs(m - 180) < 30;
  };
  return { frontEdges: c.filter(parallel).map((e) => e.i), streetSideEdges: c.filter((e) => !parallel(e)).map((e) => e.i) };
}

type Sample = { city: number[]; county: number[] };

/** Percentile rank against market_activity_sample, same formula as parcel_ease_inputs (ties count half). */
export function percentile(sorted: number[], act: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < act) lo = m + 1; else hi = m; }
  const lt = lo;
  hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! <= act) lo = m + 1; else hi = m; }
  const eq = lo - lt;
  // round(100 * (lt + eq/2) / n, 1), half away from zero, in exact integer arithmetic.
  const A = 1000 * (2 * lt + eq), B = 2 * n;
  return Math.floor((2 * A + B) / (2 * B)) / 10;
}

export interface Shared {
  rules: Record<string, Json>;
  zba: Record<string, Json>;
  permitTimes: Json;
  sample: Sample;
  today: string;
}

export function assemble(row: { parid: string; facts: Json; qf: Json; ease: Json }, sh: Shared) {
  const facts = row.facts;
  if (facts.zoning) facts.zoning.rules = sh.rules[facts.zoning.code] ?? null;
  const e = row.ease ?? {};
  const pgh = facts.assessment?.is_pittsburgh === true;
  const act = (e.sales ?? 0) + (e.permits ?? 0);
  const easeInputs = {
    env_sites: { on_parcel: e.on_parcel, adjacent_50ft: e.adjacent_50ft, active_on_parcel: e.active_on_parcel, active_on_or_adjacent: e.active_on_or_adjacent },
    market: {
      sales_3y_half_mile: e.sales ?? 0, completed_permits_3y_half_mile: pgh ? e.permits ?? 0 : null,
      percentile: percentile(pgh ? sh.sample.city : sh.sample.county, act), scope: pgh ? "city" : "county", as_of: sh.today,
    },
  };
  const q = row.qf;
  const quickfitInput = q && q.parcel ? { parcel: q.parcel, edges: q.edges ?? [], masks: q.masks ?? [], ...pickFrontEdges(q.edges ?? []) } : null;
  return { facts, quickfitInput, easeInputs, zba: facts.zoning ? sh.zba[facts.zoning.code] ?? null : null, pgh };
}

// ------------------------------------------------------------------------------ scoring

export const NOTE_NO_FIT = "Lot-fit test not run in the batch (large or irregular lot): unit counts omitted; open the parcel page for the site fit.";

/** Score one parcel. `fit: false` skips the QuickFit lot-fit test (fallback for solver errors / time budget). */
export function scoreOne(item: Json, shared: Shared, computedAt: string, fit = true) {
  const x = assemble(structuredClone(item), shared);
  const res = score.scoreParcel(x.facts, {
    quickfitInput: fit ? x.quickfitInput : null, easeInputs: x.easeInputs as score.EaseInputsRpc, zba: x.zba,
    permitTimes: x.pgh ? shared.permitTimes : undefined, unlocks: false,
  });
  const row = plannerRow(x.facts, res, computedAt, score.DEFAULT_CONFIG);
  return fit ? { ...row, note: null } : { ...row, by_right_units: null, units_with_relief: null, note: NOTE_NO_FIT };
}

if (!isMainThread) {
  const shared = workerData as Shared;
  parentPort!.on("message", (msg: { id: number; item: Json; computedAt: string }) => {
    try {
      parentPort!.postMessage({ id: msg.id, row: scoreOne(msg.item, shared, msg.computedAt) });
    } catch (err) {
      parentPort!.postMessage({ id: msg.id, error: (err as Error).message });
    }
  });
}

// ------------------------------------------------------------------------------ main

function loadEnv() {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sql<T = Json[]>(query: string): Promise<T> {
  const ref = /https:\/\/([^.]+)\./.exec(process.env.NEXT_PUBLIC_SUPABASE_URL!)![1];
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  SQL request error (${(e as Error).message}); retrying`);
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const text = await r.text();
    if (r.ok) return JSON.parse(text) as T;
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`SQL failed ${r.status}: ${text.slice(0, 400)}`);
    await sleep(2000 * 2 ** attempt);
  }
}

async function rpc<T = Json>(fn: string, body: Json): Promise<T | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? ((await r.json()) as T) : null;
}

async function upload(rows: Json[]) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/parcel_scores?on_conflict=parid`;
  const key = process.env.SUPABASE_SECRET_KEY!;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(chunk),
        });
      } catch (e) {
        // Network errors (e.g. "fetch failed") are retried like 5xx.
        if (attempt >= 5) throw e;
        console.log(`  upload request error (${(e as Error).message}); retrying`);
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (r.ok) break;
      const t = await r.text();
      if (attempt >= 5 || (r.status < 500 && r.status !== 429)) throw new Error(`upload failed ${r.status}: ${t.slice(0, 400)}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function loadShared(): Promise<Shared> {
  const [today, rulesRows, sampleRows, codes] = await Promise.all([
    sql<{ d: string }[]>("select current_date::text d"),
    sql<{ zone_code: string; rules: Json }[]>("select r.zone_code, to_jsonb(r) - 'zone_code' rules from public.zoning_rules r"),
    sql<{ scope: string; a: number[] }[]>("select scope, array_agg(activity order by activity) a from public.market_activity_sample group by 1"),
    sql<{ z: string }[]>("select distinct zone_code z from public.zoning where zone_code is not null order by 1"),
  ]);
  const zba: Record<string, Json> = {};
  for (let i = 0; i < codes.length; i += 8)
    await Promise.all(codes.slice(i, i + 8).map(async ({ z }) => { zba[z] = await rpc("zba_grant_rates", { p_district: z }); }));
  const q = score.DEFAULT_CONFIG.f5.permitTimeQueries;
  const [nb, rh] = await Promise.all([
    rpc("permit_time_estimate", { p_permit_type: q.new_build.permit_type, p_work_type: q.new_build.work_type }),
    rpc("permit_time_estimate", { p_permit_type: q.rehab.permit_type, p_work_type: q.rehab.work_type }),
  ]);
  const permitTimes: Json = {};
  if (nb) permitTimes.new_build = nb;
  if (rh) permitTimes.rehab = rh;
  const sample: Sample = { city: [], county: [] };
  for (const r of sampleRows) (sample as Record<string, number[]>)[r.scope] = r.a.map(Number);
  return {
    today: today[0]!.d,
    rules: Object.fromEntries(rulesRows.map((r) => [r.zone_code, r.rules])),
    zba, permitTimes: Object.keys(permitTimes).length ? permitTimes : undefined, sample,
  };
}

async function verify(n: number, shared: Shared, where: string) {
  // Same parcels through both paths: bulk inputs vs. the per-parcel RPCs (unlocks off in both).
  const template = readFileSync(join(ROOT, "scripts/score_all.sql"), "utf8");
  const rows = await sql<Json[]>(template.replaceAll("{{WHERE}}", () => `${where} and abs(hashtext(p.parid)) % 997 = 3`)
    .replace(/from b\nleft join/, "from (select * from b order by parid limit " + n + ") b\nleft join"));
  let same = 0;
  const cfg = score.DEFAULT_CONFIG;
  for (const row of rows) {
    const x = assemble(structuredClone(row), shared);
    const bulk = score.scoreParcel(x.facts, { quickfitInput: x.quickfitInput, easeInputs: x.easeInputs as score.EaseInputsRpc, zba: x.zba, permitTimes: x.pgh ? shared.permitTimes : undefined, unlocks: false });
    const [facts, qf, ease] = await Promise.all([
      rpc("parcel_facts", { p_parid: row.parid }), rpc("parcel_quickfit_input", { p_parid: row.parid }), rpc("parcel_ease_inputs", { p_parid: row.parid }),
    ]);
    if (!facts) { console.log(`  skip ${row.parid}: parcel_facts RPC returned nothing (timeout?)`); continue; }
    const zba = (facts as Json)?.zoning?.code ? await rpc("zba_grant_rates", { p_district: (facts as Json).zoning.code }) : null;
    const ref = score.scoreParcel(facts as Json, { quickfitInput: qf as Json, easeInputs: ease as Json, zba: zba as Json, permitTimes: score.isCityParcel(facts as Json) ? shared.permitTimes : undefined, unlocks: false });
    const a = plannerRow(x.facts, bulk, "", cfg), b = plannerRow(facts, ref, "", cfg);
    const keys = ["best_strategy", "rehab_score", "rehab_band", "score", "band", "range_lo", "range_hi", "red_flag_count", "top_blocker", "blockers", "by_right_units", "units_with_relief", "months_to_permit", "planning_badge", "badge_score", "factor_scores", "vacant", "zoning", "transit_m", "hz_floodway", "hz_landslide", "hz_undermined", "steep_share", "cap_label"] as const;
    const diff = keys.filter((k) => JSON.stringify((a as Json)[k]) !== JSON.stringify((b as Json)[k]));
    if (diff.length) console.log(`  DIFF ${row.parid}: ${diff.map((k) => `${k} bulk=${JSON.stringify((a as Json)[k])} rpc=${JSON.stringify((b as Json)[k])}`).join("; ")}`);
    else same++;
  }
  console.log(`verify: ${same}/${rows.length} parcels identical`);
}

async function main() {
  loadEnv();
  const scope = arg("scope", "city");
  const buckets = Number(arg("buckets", "200"));
  const from = Number(arg("from", "0"));
  const to = Number(arg("to", String(buckets - 1)));
  // Default: half the cores, so the dev server and browser checks keep running alongside.
  const nWorkers = Number(arg("workers", String(Math.max(1, Math.floor(cpus().length / 2)))));
  const sqlConc = Number(arg("sql-concurrency", "4"));
  const dry = flag("dry");
  // --hoods "A,B" scores only those neighborhoods (demo areas first); --skip-hoods "A,B" scores the rest.
  const hoodList = (v: string) => v.split(",").map((x) => `'${x.trim().replace(/'/g, "''")}'`).filter((x) => x !== "''").join(",");
  const hoodSql = (v: string) => `exists (select 1 from public.parcel_context c where c.parid = p.parid and c.neighborhood in (${hoodList(v)}))`;
  const where = [scope === "city" ? CITY_WHERE : `not (${CITY_WHERE})`,
    ...(arg("hoods", "") ? [hoodSql(arg("hoods", ""))] : []),
    ...(arg("skip-hoods", "") ? [`not ${hoodSql(arg("skip-hoods", ""))}`] : []),
    // --munis "WILKINSBURG,MILLVALE": only these municipalities (use with --scope county).
    ...(arg("munis", "") ? [`exists (select 1 from public.parcel_context c where c.parid = p.parid and c.muni_name in (${hoodList(arg("munis", ""))}))`] : [])].join(" and ");
  const t0 = Date.now();
  const shared = await loadShared();
  console.log(`shared inputs loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${Object.keys(shared.rules).length} rule rows, ${Object.keys(shared.zba).length} districts, sample city ${shared.sample.city.length} / county ${shared.sample.county.length}`);
  if (arg("dump-shared", "")) { writeFileSync(arg("dump-shared", ""), JSON.stringify(shared)); return; }
  if (flag("verify")) return verify(Number(arg("verify", "20")), shared, where);

  const template = readFileSync(join(ROOT, "scripts/score_all.sql"), "utf8");
  const budgetMs = Number(arg("budget-ms", "5000"));
  const file = fileURLToPath(import.meta.url);
  // Worker pool, one parcel per message. A parcel over the time budget has its worker terminated
  // and replaced; it is then scored without the lot-fit test (see NOTE_NO_FIT), as are solver errors.
  const idle: Worker[] = Array.from({ length: nWorkers }, () => new Worker(file, { workerData: shared }));
  const waiters: ((w: Worker) => void)[] = [];
  const getWorker = () => new Promise<Worker>((res) => { const w = idle.pop(); if (w) res(w); else waiters.push(res); });
  const release = (w: Worker) => { const next = waiters.shift(); if (next) next(w); else idle.push(w); };
  let msgId = 0;
  const stats = { parcels: 0, scored: 0, noFitTimeout: 0, noFitError: 0, failed: 0, bands: {} as Record<string, number>, blockers: {} as Record<string, number>, strategies: {} as Record<string, number> };
  const scoreItem = async (item: Json, computedAt: string): Promise<Json | null> => {
    let w = await getWorker();
    const id = ++msgId;
    const outcome = await new Promise<{ row?: Json; error?: string; timeout?: boolean }>((res) => {
      const timer = setTimeout(() => { w.off("message", on); res({ timeout: true }); }, budgetMs);
      const on = (m: Json) => { if (m.id === id) { clearTimeout(timer); w.off("message", on); res(m); } };
      w.on("message", on);
      w.postMessage({ id, item, computedAt });
    });
    if (outcome.timeout) { void w.terminate(); w = new Worker(file, { workerData: shared }); }
    release(w);
    if (outcome.row) return outcome.row;
    if (outcome.timeout) stats.noFitTimeout++;
    else { stats.noFitError++; if (stats.noFitError <= 20) console.log(`  solver error ${item.parid}: ${outcome.error?.slice(0, 120)}`); }
    try { return scoreOne(item, shared, computedAt, false); } catch (e) {
      stats.failed++; console.log(`  failed ${item.parid}: ${(e as Error).message.slice(0, 160)}`); return null;
    }
  };

  const doBucket = async (k: number) => {
    const ts = Date.now();
    const inputFile = arg("input-file", "");
    const rows = inputFile ? (JSON.parse(readFileSync(inputFile, "utf8")) as Json[])
      : await sql<Json[]>(template.replaceAll("{{WHERE}}", () => `${where} and abs(hashtext(p.parid)) % ${buckets} = ${k}`));
    const fetchS = (Date.now() - ts) / 1000;
    const computedAt = new Date().toISOString();
    const out = (await Promise.all(rows.map((r) => scoreItem(r, computedAt)))).filter((r): r is Json => !!r);
    for (const r of out) {
      stats.bands[r.band ?? "No score"] = (stats.bands[r.band ?? "No score"] ?? 0) + 1;
      stats.blockers[r.top_blocker ?? "(none)"] = (stats.blockers[r.top_blocker ?? "(none)"] ?? 0) + 1;
      stats.strategies[r.best_strategy ?? "(none)"] = (stats.strategies[r.best_strategy ?? "(none)"] ?? 0) + 1;
    }
    if (!dry) await upload(out);
    stats.parcels += rows.length;
    stats.scored += out.length;
    const el = (Date.now() - t0) / 1000;
    console.log(`bucket ${k}: ${rows.length} parcels (fetch ${fetchS.toFixed(0)}s, bucket ${((Date.now() - ts) / 1000).toFixed(0)}s) · total ${stats.scored.toLocaleString()} scored, no-fit ${stats.noFitTimeout} over budget + ${stats.noFitError} solver errors, ${stats.failed} failed, ${el.toFixed(0)}s elapsed, ${(stats.scored / el).toFixed(1)}/s`);
  };
  const queue = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  // --pause-ms: wait between bucket queries so live pages keep their share of the database.
  const pauseMs = Number(arg("pause-ms", "0"));
  await Promise.all(Array.from({ length: sqlConc }, async () => {
    for (let k = queue.shift(); k !== undefined; k = queue.shift()) { await doBucket(k); if (pauseMs) await sleep(pauseMs); }
  }));
  for (const w of idle) await w.terminate();
  if (!dry) {
    // Ownership and council district from their own tables, then the cached broad summaries.
    for (let k = 0; k < 8; k++)
      await sql(`select public.planner_attach_owner_geo(${k}, 8)`).catch((e) => console.log(`  owner/geo attach ${k} failed: ${(e as Error).message.slice(0, 160)}`));
    await sql("select public.planner_refresh_cache()").catch((e) => console.log(`  summary cache refresh failed: ${(e as Error).message.slice(0, 160)}`));
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`\ndone: ${stats.scored.toLocaleString()} of ${stats.parcels.toLocaleString()} parcels scored in ${secs.toFixed(0)}s; lot-fit skipped for ${stats.noFitTimeout} (over ${budgetMs} ms) + ${stats.noFitError} (solver errors); ${stats.failed} failed${dry ? " [dry run, nothing written]" : ""}`);
  console.log("bands:", JSON.stringify(stats.bands));
  console.log("best new-housing strategy:", JSON.stringify(stats.strategies));
  console.log("top blockers:", JSON.stringify(Object.entries(stats.blockers).sort((a, b) => b[1] - a[1]).slice(0, 15)));
}

if (isMainThread && process.env.SCORE_ALL_LIB !== "1") main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
