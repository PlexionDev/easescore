// Policy Analyst background job: precompute lever states into public.policy_results / policy_states.
//
// Run: scripts/policy_batch.sh [--keys base,a35,m0,pt,pn,a35.m0,a35.m0.pn] [--queue] [--buckets 200]
//                              [--from 0] [--to 199] [--workers 2] [--pause-ms 4000] [--budget-ms 30000]
//                              [--dry] [--prepare] [--limit-buckets N] [--refetch]
//
// Throttled on purpose: the database is shared with other batches and the live pages. At most 2 worker
// threads, one bulk query at a time, a pause between buckets, and bucket inputs cached on disk under
// data/raw/policy-cache/ (gitignored) so later lever states never query the parcel inputs again.
//
// Inputs are pulled with scripts/score_all.sql (the planner batch's bulk query, same tables and rules as
// the parcel page) and assembled the same way as scripts/score_all.ts, so with every lever off a parcel
// scores exactly as in parcel_scores. For each lever state only the parcels a lever applies to are
// rescored (engine/src/policy/levers.ts eligibility). --queue keeps polling policy_states for on-demand
// states requested from the page.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as score from "../engine/src/score/index";
import * as policy from "../engine/src/policy/index";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = process.cwd();
const CITY_WHERE = "a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$'";
export const POLICY_VERSION = `policy.2|score.${score.DEFAULT_CONFIG.version}`;

// ------------------------------------------------------------------------------ input assembly
// Same rules as scripts/score_all.ts (pickFrontEdges, percentile, assemble); copied, not imported,
// because that module registers its own worker message handler on import.

function pickFrontEdges(edges: { i: number; len: number; az: number; street_ft: number | null }[]) {
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

function percentile(sorted: number[], act: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < act) lo = m + 1; else hi = m; }
  const lt = lo;
  hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! <= act) lo = m + 1; else hi = m; }
  const eq = lo - lt;
  const A = 1000 * (2 * lt + eq), B = 2 * n;
  return Math.floor((2 * A + B) / (2 * B)) / 10;
}

interface ScoreShared {
  rules: Record<string, Json>;
  zba: Record<string, Json>;
  permitTimes: Json;
  sample: { city: number[]; county: number[] };
  today: string;
}

interface PolicyShared {
  values: Record<string, policy.ValueBand>;
  citywide: policy.ValueBand | null;
  ratio: number | null;
}

function toParcel(row: Json, sh: ScoreShared, ps: PolicyShared): policy.PolicyParcel {
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
  } as score.EaseInputsRpc;
  const q = row.qf;
  const quickfitInput = q && q.parcel ? { parcel: q.parcel, edges: q.edges ?? [], masks: q.masks ?? [], ...pickFrontEdges(q.edges ?? []) } : null;
  let frontageFt: number | null = null;
  if (quickfitInput) frontageFt = policy.lotWidthFt(quickfitInput.parcel as [number, number][], score.frontEdgesFor(quickfitInput).front[0]);
  const hood = facts.context?.neighborhood ?? null;
  const av = row.av ?? {};
  return {
    facts, quickfitInput, easeInputs,
    zba: facts.zoning ? sh.zba[facts.zoning.code] ?? null : null,
    permitTimes: pgh ? sh.permitTimes : undefined,
    frontageFt,
    assessed: { land: av.land ?? null, building: av.building ?? null, total: av.total ?? null },
    value: (hood && ps.values[hood]) || ps.citywide,
    assessmentRatio: ps.ratio,
  };
}

// ------------------------------------------------------------------------------ worker

if (!isMainThread) {
  const { sh, ps } = workerData as { sh: ScoreShared; ps: PolicyShared };
  const basis = policy.costBasis();
  parentPort!.on("message", (m: { id: number; item: Json; keys: string[]; computedAt: string; cached?: Json }) => {
    try {
      const p = toParcel(structuredClone(m.item), sh, ps);
      const states = m.keys.map((k) => [k, policy.parseKey(k)] as const);
      const pgh = p.facts.assessment?.is_pittsburgh === true;
      const lp = {
        pgh, zoneCode: p.facts.zoning?.code ?? null, rules: p.facts.zoning?.rules ?? null, frontageFt: p.frontageFt,
        transitM: p.facts.transit?.nearest_frequent_stop_m ?? null,
      };
      const rows: Json[] = [];
      // A parcel's result depends only on the levers that apply to it, so each distinct restricted
      // state is scored once (e.g. an R2 lot gets the same row for "m0" and "a35.m0").
      const memo = new Map<string, policy.ParcelOutcome>(Object.entries(m.cached?.eff ?? {}));
      let baseline: policy.Capacity | null = m.cached?.before ?? null;
      for (const [key, s] of states) {
        const touched = policy.eligibility(lp as policy.LeverParcel, s);
        if (!touched.length) continue;
        const eff = policy.stateKey(policy.restrict(s, touched));
        let o = memo.get(eff);
        if (!o) {
          baseline ??= policy.byRightCapacity(policy.scoreWith(p));
          o = policy.evaluateParcel(p, policy.parseKey(eff), baseline, basis);
          memo.set(eff, o);
        }
        rows.push({
          key, parid: p.facts.parid, config_version: POLICY_VERSION, touched: o.touched,
          units_before: o.before.units, units_after: o.after.units, units_delta: o.unitsDelta,
          score_before: o.before.score, score_after: o.after.score, band_after: o.after.band, strategy_after: o.after.strategy,
          pencils_low: o.pencils?.low ?? null, pencils_likely: o.pencils?.likely ?? null, pencils_high: o.pencils?.high ?? null,
          sale_value_likely: o.saleValue?.likely ?? null,
          av_delta_low: o.avDelta.low, av_delta_likely: o.avDelta.likely, av_delta_high: o.avDelta.high,
          av_before: p.assessed.total, neighborhood: p.facts.context?.neighborhood ?? null, zoning: p.facts.zoning?.code ?? null,
          lon: p.facts.centroid?.lon ?? null, lat: p.facts.centroid?.lat ?? null, computed_at: m.computedAt,
        });
      }
      parentPort!.postMessage({ id: m.id, rows, cache: baseline ? { before: baseline, eff: Object.fromEntries(memo) } : m.cached ?? null });
    } catch (e) {
      parentPort!.postMessage({ id: m.id, error: (e as Error).message });
    }
  });
}

// ------------------------------------------------------------------------------ I/O

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
      if (attempt >= 5) throw e;
      await sleep(3000 * 2 ** attempt);
      continue;
    }
    const text = await r.text();
    if (r.ok) return JSON.parse(text) as T;
    if (attempt >= 5 || (r.status < 500 && r.status !== 429)) throw new Error(`SQL failed ${r.status}: ${text.slice(0, 300)}`);
    await sleep(3000 * 2 ** attempt);
  }
}

async function rpc<T = Json>(fn: string, body: Json): Promise<T | null> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.ok ? ((await r.json()) as T) : null;
}

async function rest(path: string, method: string, body: Json, prefer = "return=minimal") {
  const key = process.env.SUPABASE_SECRET_KEY!;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: prefer }, body: JSON.stringify(body),
    });
    if (r.ok) return;
    const t = await r.text();
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${method} ${path.split("?")[0]} failed ${r.status}: ${t.slice(0, 300)}`);
    await sleep(2000 * 2 ** attempt);
  }
}

async function upsert(table: string, conflict: string, rows: Json[]) {
  for (let i = 0; i < rows.length; i += 1000)
    await rest(`${table}?on_conflict=${conflict}`, "POST", rows.slice(i, i + 1000), "resolution=merge-duplicates,return=minimal");
}

const setState = (key: string, patch: Json) => rest(`policy_states?key=eq.${encodeURIComponent(key)}`, "PATCH", patch);

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// ------------------------------------------------------------------------------ shared inputs

async function loadScoreShared(): Promise<ScoreShared> {
  const [today, rulesRows, sampleRows, codes] = await Promise.all([
    sql<{ d: string }[]>("select current_date::text d"),
    sql<{ zone_code: string; rules: Json }[]>("select r.zone_code, to_jsonb(r) - 'zone_code' rules from public.zoning_rules r"),
    sql<{ scope: string; a: number[] }[]>("select scope, array_agg(activity order by activity) a from public.market_activity_sample group by 1"),
    sql<{ z: string }[]>("select distinct zone_code z from public.zoning where zone_code is not null order by 1"),
  ]);
  const zba: Record<string, Json> = {};
  for (let i = 0; i < codes.length; i += 4)
    await Promise.all(codes.slice(i, i + 4).map(async ({ z }) => { zba[z] = await rpc("zba_grant_rates", { p_district: z }); }));
  const q = score.DEFAULT_CONFIG.f5.permitTimeQueries;
  const nb = await rpc("permit_time_estimate", { p_permit_type: q.new_build.permit_type, p_work_type: q.new_build.work_type });
  const rh = await rpc("permit_time_estimate", { p_permit_type: q.rehab.permit_type, p_work_type: q.rehab.work_type });
  const permitTimes: Json = {};
  if (nb) permitTimes.new_build = nb;
  if (rh) permitTimes.rehab = rh;
  const sample = { city: [] as number[], county: [] as number[] };
  for (const r of sampleRows) (sample as Record<string, number[]>)[r.scope] = r.a.map(Number);
  return {
    today: today[0]!.d, rules: Object.fromEntries(rulesRows.map((r) => [r.zone_code, r.rules])),
    zba, permitTimes: Object.keys(permitTimes).length ? permitTimes : undefined, sample,
  };
}

/** New-construction comps rule from the cost config: valid sales, last 3 years, built <= 10 years before sale. */
const NC_SALES = `
  select s.parid, s.sale_date, s.price, a.living_area_sqft, a.county_total, p.centroid g
  from public.sales_valid s join public.assessments a using (parid) join public.parcels p using (parid)
  where s.sale_date >= current_date - interval '3 years' and s.price >= 20000 and a.living_area_sqft >= 600
    and a.year_built >= extract(year from s.sale_date)::int - 10
    and a.use_desc in ('SINGLE FAMILY', 'TOWNHOUSE', 'ROWHOUSE')`;

async function prepare(): Promise<Json> {
  // Neighborhood value bands: nearest new-construction sales to each City neighborhood's center,
  // widening 1/4 -> 1/2 -> 1 -> 2 -> 3 miles until at least 5 (same rule as the parcel pro forma).
  const values = await sql<Json[]>(`
    with nc as materialized (${NC_SALES}),
    hood as (select name, ST_PointOnSurface(geom) c from public.neighborhoods),
    pick as (
      select h.name, r.mi, x.psf from hood h
      cross join lateral (select mi from unnest(array[0.25, 0.5, 1, 2, 3]) mi
                          where (select count(*) from nc where ST_DWithin(nc.g::geography, h.c::geography, mi * 1609.34)) >= 5
                          order by mi limit 1) r
      cross join lateral (select nc.price / nc.living_area_sqft psf from nc where ST_DWithin(nc.g::geography, h.c::geography, r.mi * 1609.34)) x)
    select name, mi, count(*) n,
           percentile_cont(0.25) within group (order by psf) p25,
           percentile_cont(0.5) within group (order by psf) p50,
           percentile_cont(0.75) within group (order by psf) p75
    from pick group by 1, 2 order by 1`);
  const city = await sql<Json[]>(`
    with nc as (${NC_SALES} and a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$')
    select count(*) n, max(sale_date)::text latest, min(sale_date)::text earliest,
           percentile_cont(0.25) within group (order by price / living_area_sqft) p25,
           percentile_cont(0.5) within group (order by price / living_area_sqft) p50,
           percentile_cont(0.75) within group (order by price / living_area_sqft) p75,
           percentile_cont(0.25) within group (order by county_total::numeric / price) r25,
           percentile_cont(0.5) within group (order by county_total::numeric / price) r50,
           percentile_cont(0.75) within group (order by county_total::numeric / price) r75
    from nc where county_total > 0`);
  const mill = await sql<Json[]>(`
    select body_type jurisdiction_type, body_code code, body_name name, mills, year, source_url from public.millage_rates
    where rate_type = 'general' and ((body_type = 'county' and body_code = '42003')
      or (body_type = 'municipality' and body_code = 'CITY_PGH') or (body_type = 'school_district' and school_key = 'PITTSBURGH'))
    order by year desc`);
  const c = city[0]!;
  const r2 = (x: number) => Math.round(Number(x) * 100) / 100;
  const payload = {
    values: Object.fromEntries(values.map((v) => [v.name, { p25: r2(v.p25), p50: r2(v.p50), p75: r2(v.p75), n: Number(v.n), radiusMi: Number(v.mi) }])),
    citywide: { p25: r2(c.p25), p50: r2(c.p50), p75: r2(c.p75), n: Number(c.n), radiusMi: null },
    ratio: { p25: Math.round(c.r25 * 1000) / 1000, p50: Math.round(c.r50 * 1000) / 1000, p75: Math.round(c.r75 * 1000) / 1000, n: Number(c.n) },
    sales_window: { earliest: c.earliest, latest: c.latest },
    millage: mill,
    rule: "Valid sales in the last 3 years of single-family, townhouse and rowhouse homes built no more than 10 years before the sale, at least 600 sq ft and $20,000 (Allegheny County sales and assessments). Value per finished sq ft; nearest to each neighborhood's center, widening from 1/4 mile to 3 miles until at least 5.",
    cost_basis: policy.costBasis(),
    policy_version: POLICY_VERSION,
  };
  await upsert("policy_meta", "id", [{ id: "inputs", payload, computed_at: new Date().toISOString() }]);
  return payload;
}

// ------------------------------------------------------------------------------ main

/** Districts where some lever can change by-right capacity: a housing use is permitted and a lever rule exists. */
function leverDistricts(rules: Record<string, Json>): string[] {
  return Object.entries(rules).filter(([code, r]) => {
    const eff = score.solverRules(code, r);
    const anyP = ["single_unit_detached", "two_unit", "three_unit", "multi_unit", "single_unit_attached"].some((k) => (eff as Json)[k] === "P");
    const lever = (eff.min_lot_area_sqft ?? 0) > 0 || (eff.min_lot_area_per_unit_sqft ?? 0) > 0 || (eff.parking_per_unit ?? 0) > 0
      || (eff.attached_parking_per_unit ?? 0) > 0 || policy.ATTACHED_DISTRICTS.test(code.toUpperCase());
    return anyP && lever && !policy.EXCLUDED_DISTRICTS.has(code.toUpperCase());
  }).map(([c]) => c).sort();
}

async function main() {
  loadEnv();
  const t0 = Date.now();
  const buckets = Number(arg("buckets", "200"));
  const from = Number(arg("from", "0"));
  const to = Number(arg("to", String(buckets - 1)));
  const nWorkers = Math.min(2, Math.max(1, Number(arg("workers", "2"))));
  const pauseMs = Number(arg("pause-ms", "4000"));
  const budgetMs = Number(arg("budget-ms", "6000"));
  const dry = flag("dry");
  const cacheDir = join(ROOT, "data/raw/policy-cache");
  mkdirSync(cacheDir, { recursive: true });

  const meta = flag("prepare") || !(await sql<Json[]>("select 1 from public.policy_meta where id = 'inputs'")).length
    ? await prepare()
    : (await sql<Json[]>("select payload from public.policy_meta where id = 'inputs'"))[0]!.payload;
  if (flag("prepare")) { console.log(`prepared: ${Object.keys(meta.values).length} neighborhood value bands; citywide ${JSON.stringify(meta.citywide)}; ratio ${JSON.stringify(meta.ratio)}`); return; }
  const ps: PolicyShared = { values: meta.values, citywide: meta.citywide, ratio: meta.ratio?.p50 ?? null };

  const shFile = join(cacheDir, "score-shared.json");
  const sh: ScoreShared = existsSync(shFile) && !flag("refetch") ? JSON.parse(readFileSync(shFile, "utf8")) : await loadScoreShared();
  writeFileSync(shFile, JSON.stringify(sh));
  const districts = leverDistricts(sh.rules);
  console.log(`shared inputs ready in ${((Date.now() - t0) / 1000).toFixed(0)}s; lever districts: ${districts.length}`);

  const file = fileURLToPath(import.meta.url);
  const spawn = () => new Worker(file, { workerData: { sh, ps } });
  const idle: Worker[] = Array.from({ length: nWorkers }, spawn);
  const waiters: ((w: Worker) => void)[] = [];
  const getWorker = () => new Promise<Worker>((res) => { const w = idle.pop(); if (w) res(w); else waiters.push(res); });
  const release = (w: Worker) => { const n = waiters.shift(); if (n) n(w); else idle.push(w); };
  let msgId = 0;
  const stats = { parcels: 0, rows: 0, timeouts: 0, errors: 0 };
  // Per-bucket outcome cache (data/raw/policy-cache/out-*.json): baseline capacity and every restricted
  // state already scored, so a later lever state reuses them instead of rerunning the solver.
  let outCache: Record<string, Json> = {};
  const run = async (item: Json, keys: string[], computedAt: string): Promise<Json[]> => {
    if (outCache[item.parid]?.skip) { stats.timeouts++; return []; }
    let w = await getWorker();
    const id = ++msgId;
    const out = await new Promise<{ rows?: Json[]; cache?: Json; error?: string; timeout?: boolean }>((res) => {
      const timer = setTimeout(() => { w.off("message", on); res({ timeout: true }); }, budgetMs);
      const on = (m: Json) => { if (m.id === id) { clearTimeout(timer); w.off("message", on); res(m); } };
      w.on("message", on);
      w.postMessage({ id, item, keys, computedAt, cached: outCache[item.parid] ?? null });
    });
    if (out.timeout) { void w.terminate(); w = spawn(); stats.timeouts++; outCache[item.parid] = { skip: true }; }
    release(w);
    if (out.error) { stats.errors++; if (stats.errors <= 10) console.log(`  error ${item.parid}: ${out.error.slice(0, 160)}`); }
    if (out.cache) outCache[item.parid] = out.cache;
    return out.rows ?? [];
  };

  const template = readFileSync(join(ROOT, "scripts/score_all.sql"), "utf8");
  const where = `${CITY_WHERE} and exists (select 1 from public.parcel_scores s where s.parid = p.parid and s.zoning = any(array[${districts.map((d) => `'${d}'`).join(",")}]))`;
  const loadBucket = async (k: number): Promise<Json[]> => {
    const f = join(cacheDir, `b${k}of${buckets}.json`);
    if (existsSync(f) && !flag("refetch")) return JSON.parse(readFileSync(f, "utf8"));
    const bw = `${where} and abs(hashtext(p.parid)) % ${buckets} = ${k}`;
    const rows = await sql<Json[]>(template.replaceAll("{{WHERE}}", () => bw));
    const av = await sql<Json[]>(`select a.parid, a.county_land land, a.county_building building, a.county_total total
      from public.assessments a join public.parcels p using (parid) where ${bw}`);
    const m = new Map(av.map((r) => [r.parid, { land: Number(r.land) || 0, building: Number(r.building) || 0, total: Number(r.total) || 0 }]));
    for (const r of rows) r.av = m.get(r.parid) ?? null;
    writeFileSync(f, JSON.stringify(rows));
    await sleep(pauseMs);
    return rows;
  };

  const runKeys = async (keys: string[]) => {
    const norm = [...new Set(keys.map((k) => policy.stateKey(policy.parseKey(k))))];
    console.log(`lever states: ${norm.join(", ")}`);
    if (!dry) {
      await upsert("policy_states", "key", norm.map((k) => ({ key: k, levers: policy.parseKey(k), config_version: POLICY_VERSION, status: "running", done: 0, total: to - from + 1, started_at: new Date().toISOString(), error: null })));
      for (const k of norm) await rest(`policy_results?key=eq.${encodeURIComponent(k)}&config_version=neq.${encodeURIComponent(POLICY_VERSION)}`, "DELETE", undefined);
    }
    const limit = Number(arg("limit-buckets", "0"));
    let done = 0;
    // Fetch the next bucket's inputs while this one is scored (still one bulk query at a time).
    let next: Promise<Json[]> | null = null;
    for (let k = from; k <= to && (!limit || done < limit); k++) {
      const tb = Date.now();
      const items = await (next ?? loadBucket(k));
      next = k < to && (!limit || done + 1 < limit) ? loadBucket(k + 1) : null;
      const cf = join(cacheDir, `out-b${k}of${buckets}-${POLICY_VERSION.replace(/[^a-z0-9.]/gi, "_")}.json`);
      outCache = existsSync(cf) ? JSON.parse(readFileSync(cf, "utf8")) : {};
      const computedAt = new Date().toISOString();
      const rows = (await Promise.all(items.map((it) => run(it, norm, computedAt)))).flat();
      writeFileSync(cf, JSON.stringify(outCache));
      stats.parcels += items.length;
      stats.rows += rows.length;
      done++;
      if (!dry) {
        await upsert("policy_results", "key,parid", rows);
        for (const key of norm) await setState(key, { done });
      }
      const el = (Date.now() - t0) / 1000;
      console.log(`bucket ${k}: ${items.length} parcels, ${rows.length} rows in ${((Date.now() - tb) / 1000).toFixed(0)}s · total ${stats.parcels} parcels, ${stats.rows} rows, ${stats.timeouts} over budget, ${stats.errors} errors, ${el.toFixed(0)}s`);
      await sleep(pauseMs);
    }
    if (!dry) for (const key of norm) {
      const s = await sql<Json[]>(`select public.policy_summary('${key.replace(/'/g, "")}') s`);
      const summary = { ...s[0]!.s, parcels_seen: stats.parcels, skipped: stats.timeouts, buckets: `${done} of ${to - from + 1}` };
      const k = key.replace(/'/g, "");
      const ctx = await sql<Json[]>(`select public.policy_places('${k}') places, public.policy_who('${k}') who`).catch(() => [{ places: null, who: null }]);
      await setState(key, { status: done === to - from + 1 ? "done" : "partial", summary, places: ctx[0]!.places, who: ctx[0]!.who, computed_at: new Date().toISOString(), done });
      console.log(`${key}: ${JSON.stringify({ homes: s[0]!.s.homes, parcels: s[0]!.s.parcels_gaining, newly: s[0]!.s.newly_buildable, pencil: s[0]!.s.homes_pencil })}`);
    }
  };

  if (flag("queue")) {
    // Poll for on-demand states requested from the page; one at a time.
    for (;;) {
      const q = await sql<Json[]>("select key from public.policy_states where status = 'queued' order by requested_at limit 1");
      if (!q.length) { await sleep(15000); continue; }
      const raw = String(q[0]!.key);
      const norm = policy.stateKey(policy.parseKey(raw));
      // Only canonical lever-state keys are computed; anything else is closed so the queue moves on.
      if (norm !== raw || norm === "base") { await setState(raw, { status: "failed", error: `not a canonical lever state (use ${norm})` }); continue; }
      await runKeys([raw]);
    }
  }
  await runKeys(arg("keys", policy.PRECOMPUTE_KEYS.join(",")).split(","));
  for (const w of idle) await w.terminate();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${JSON.stringify(stats)}${dry ? " [dry run]" : ""}`);
}

if (isMainThread) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
