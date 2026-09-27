// Precompute the parcel pane (public.parcel_pane) so the parcel page reads one row.
//
// Run: scripts/pane_all.sh [--parids "A,B"] [--hoods "A,B"] [--skip-hoods "A,B"] [--scope city|county]
//                          [--batch 40] [--sql-concurrency 2] [--workers N] [--budget-ms 20000] [--limit N]
//                          [--skip-done] [--dry]
//
// Per parcel it uses the same database functions the live page calls (parcel_facts,
// parcel_quickfit_input, parcel_ease_inputs, parcel_sales_comps, parcel_rent_comps), fetched in
// batches through the Management API; shared inputs (Zoning Board rates per district, permit
// times, prime rate, tap fees, recent new-construction sales) are loaded once. Worker threads run
// web/src/lib/pane-core.ts buildPane (the page's own code), so a row equals what the page computes live.
// A parcel over the time budget is skipped (no row: the page computes it live). Rows are upserted
// with the service key (never printed). Default workers: half the CPU cores.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { assumptions, score } from "@easescore/engine";
import { buildPane, fetchZbaCitywide, PANE_VERSION, toStored, type PaneInputs } from "../web/src/lib/pane-core";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = process.cwd();
const CITY_WHERE = "a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$'";

interface Shared {
  asOf: string;
  zba: Record<string, Json>;
  zbaCitywide: Record<string, score.ZbaReliefCounts> | null;
  permitTimes: Json;
  prime: { rate: number; date: string } | null;
  tapFeesCity: number | null;
  newSales: assumptions.SaleRecord[];
}

// ------------------------------------------------------------------------------ worker

if (!isMainThread) {
  const sh = workerData as Shared;
  parentPort!.on("message", (m: { id: number; row: Json }) => {
    try {
      const r = m.row;
      const facts = r.facts;
      const code = facts?.zoning?.code as string | undefined;
      const sales = r.sales ?? null;
      const inputs: PaneInputs = {
        parid: r.parid, asOf: sh.asOf, facts, quickfitInput: r.qf ?? null, easeInputs: r.ease ?? null,
        zba: code ? sh.zba[code] ?? null : null, zbaCitywide: sh.zbaCitywide, permitTimes: sh.permitTimes,
        sales, rent: r.rent ?? null,
        // Same as singleFamilyComps(): the parcel's own comps when they are single-family sales.
        sfComps: sales?.comparable_use === "single family" ? sales : r.sf ?? null,
        prime: sh.prime, tapFees: facts?.assessment?.is_pittsburgh === true ? sh.tapFeesCity : null,
        newSales: sh.newSales, compDetails: r.details ?? {},
      };
      parentPort!.postMessage({ id: m.id, stored: toStored(buildPane(inputs)) });
    } catch (e) {
      parentPort!.postMessage({ id: m.id, error: (e as Error).message });
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
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const text = await r.text();
    if (r.ok) return JSON.parse(text) as T;
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`SQL failed ${r.status}: ${text.slice(0, 300)}`);
    await sleep(2000 * 2 ** attempt);
  }
}

async function rpc<T = Json>(fn: string, body: Json): Promise<T | null> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.ok ? ((await r.json()) as T) : null;
}

async function upload(rows: Json[]) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/parcel_pane?on_conflict=parid`;
  const key = process.env.SUPABASE_SECRET_KEY!;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(chunk),
      });
      if (r.ok) break;
      const t = await r.text();
      if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`upload failed ${r.status}: ${t.slice(0, 300)}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (v: string) => v.split(",").map((x) => `'${x.trim().replace(/'/g, "''")}'`).filter((x) => x !== "''").join(",");

async function loadShared(): Promise<Shared> {
  const [today] = await sql<{ d: string }[]>("select current_date::text d");
  const asOf = today!.d;
  const codes = await sql<{ z: string }[]>("select distinct zone_code z from public.zoning where zone_code is not null order by 1");
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
  // Same reads as lib/proforma.ts primeRate() and tapFeesPerHome().
  const [prime] = await sql<{ value: number; date: string }[]>("select value::float8 value, date::text date from public.market_series where series_id = 'DPRIME' order by date desc limit 1");
  const fees = await sql<{ fee_type: string; amount: number }[]>("select fee_type, amount::float8 amount from public.utility_tap_fees where authority = 'Pittsburgh Water (PWSA)'");
  const home = fees.filter((t) => t.amount > 0 && /residential permit|connection fee tap 1 in \(normal|meter fee 5\/8/i.test(t.fee_type));
  // Recent new-construction sales county-wide: new_construction_comps() without the distance limit;
  // the engine keeps those within its widest radius of each parcel.
  const r = assumptions.COST_CONFIG.comps.newConstruction;
  const uses = [...r.singleFamilyUses, ...r.attachedUses].map((u) => `'${u}'`).join(",");
  const newSales = await sql<assumptions.SaleRecord[]>(`
    select s.parid, nullif(trim(concat_ws(' ', nullif(a.house_num, '0'), a.address)), '') address, s.sale_date::text "saleDate",
           s.price::float8 price, a.living_area_sqft::float8 "livingAreaSqft", a.year_built "yearBuilt", a.use_desc "use",
           ST_Y(p.centroid) lat, ST_X(p.centroid) lon,
           case when g.is_pittsburgh then g.neighborhood else g.municipality end area
    from public.sales_valid s join public.assessments a on a.parid = s.parid join public.parcels p on p.parid = s.parid
      left join public.parcel_geo g on g.parid = s.parid
    where s.sale_date >= ('${asOf}'::date - make_interval(years => ${r.years}))::date and s.sale_date <= '${asOf}'::date
      and s.price >= ${r.minPrice} and a.use_desc in (${uses})
      and a.year_built >= ${Number(asOf.slice(0, 4)) - r.years - r.maxAgeAtSaleYears} and a.living_area_sqft >= ${r.minLivingAreaSqft}
    order by s.sale_id`);
  return {
    asOf, zba, zbaCitywide: await fetchZbaCitywide(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!),
    permitTimes: Object.keys(permitTimes).length ? permitTimes : undefined,
    prime: prime && Number.isFinite(prime.value) ? { rate: prime.value / 100, date: prime.date } : null,
    tapFeesCity: home.length ? home.reduce((s, t) => s + t.amount, 0) : null,
    newSales: newSales.map((x) => ({ ...x, parid: x.parid.trim() })),
  };
}

/** The per-parcel inputs for a list of parcel IDs, one SQL statement (same functions the page calls). */
function batchSql(ids: string[]): string {
  const vals = ids.map((p) => `('${p.replace(/'/g, "''")}')`).join(",");
  return `
    with ids(parid) as (values ${vals}),
    base as (
      select parid, public.parcel_facts(parid) facts, public.parcel_quickfit_input(parid) qf, public.parcel_ease_inputs(parid) ease,
             public.parcel_sales_comps(parid) sales, public.parcel_rent_comps(parid) rent
      from ids)
    select b.parid, b.facts, b.qf, b.ease, b.sales, b.rent,
      case when b.sales->>'comparable_use' = 'single family' then null else public.parcel_sales_comps(b.parid, 5, 'SINGLE FAMILY') end sf,
      (select jsonb_object_agg(a.parid, jsonb_build_object('year_built', a.year_built, 'condition_desc', a.condition_desc))
         from public.assessments a where a.parid in (select c->>'parid' from jsonb_array_elements(b.sales->'comps') c)) details
    from base b`;
}

async function main() {
  loadEnv();
  const t0 = Date.now();
  const nWorkers = Number(arg("workers", String(Math.max(1, Math.floor(cpus().length / 2)))));
  const sqlConc = Number(arg("sql-concurrency", "2"));
  const batch = Number(arg("batch", "40"));
  const budgetMs = Number(arg("budget-ms", "20000"));
  const dry = flag("dry");

  // Parcel list: explicit IDs first, else the scope / neighborhood filter.
  let ids: string[];
  if (arg("parids", "")) ids = arg("parids", "").split(",").map((x) => x.trim()).filter(Boolean);
  else {
    const where = [arg("scope", "city") === "city" ? CITY_WHERE : `not (${CITY_WHERE})`,
      ...(arg("hoods", "") ? [`c.neighborhood in (${list(arg("hoods", ""))})`] : []),
      ...(arg("skip-hoods", "") ? [`(c.neighborhood is null or c.neighborhood not in (${list(arg("skip-hoods", ""))}))`] : []),
      ...(flag("skip-done") ? [`not exists (select 1 from public.parcel_pane x where x.parid = p.parid and x.config_version = '${PANE_VERSION}')`] : [])].join(" and ");
    const rows = await sql<{ parid: string }[]>(`select p.parid from public.parcels p join public.assessments a using (parid)
      left join public.parcel_context c using (parid) where ${where} order by c.neighborhood, p.parid ${arg("limit", "") ? `limit ${Number(arg("limit", ""))}` : ""}`);
    ids = rows.map((r) => r.parid.trim());
  }
  const shared = await loadShared();
  console.log(`${ids.length.toLocaleString()} parcels; shared inputs in ${((Date.now() - t0) / 1000).toFixed(1)}s (${Object.keys(shared.zba).length} districts, ${shared.newSales.length} new-construction sales); ${PANE_VERSION}; ${nWorkers} workers, ${sqlConc} SQL at a time`);

  const file = fileURLToPath(import.meta.url);
  const idle: Worker[] = Array.from({ length: nWorkers }, () => new Worker(file, { workerData: shared }));
  const waiters: ((w: Worker) => void)[] = [];
  const getWorker = () => new Promise<Worker>((res) => { const w = idle.pop(); if (w) res(w); else waiters.push(res); });
  const release = (w: Worker) => { const next = waiters.shift(); if (next) next(w); else idle.push(w); };
  let msgId = 0;
  const stats = { done: 0, written: 0, skipped: 0, failed: 0, noFacts: 0, bytes: 0 };
  const build = async (row: Json): Promise<Json | null> => {
    let w = await getWorker();
    const id = ++msgId;
    const out = await new Promise<{ stored?: Json; error?: string; timeout?: boolean }>((res) => {
      const timer = setTimeout(() => { w.off("message", on); res({ timeout: true }); }, budgetMs);
      const on = (m: Json) => { if (m.id === id) { clearTimeout(timer); w.off("message", on); res(m); } };
      w.on("message", on);
      w.postMessage({ id, row });
    });
    if (out.timeout) { void w.terminate(); w = new Worker(file, { workerData: shared }); }
    release(w);
    if (out.stored) return out.stored;
    if (out.timeout) stats.skipped++;
    else { stats.failed++; if (stats.failed <= 20) console.log(`  failed ${row.parid}: ${out.error?.slice(0, 160)}`); }
    return null;
  };

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += batch) chunks.push(ids.slice(i, i + batch));
  const doChunk = async (c: string[]) => {
    const ts = Date.now();
    let rows: Json[];
    try {
      rows = await sql<Json[]>(batchSql(c));
    } catch (e) {
      // A statement over the time limit: retry the halves once.
      if (c.length > 4) { const h = Math.ceil(c.length / 2); await doChunk(c.slice(0, h)); await doChunk(c.slice(h)); return; }
      stats.failed += c.length; console.log(`  batch failed (${c.length}): ${(e as Error).message.slice(0, 160)}`); return;
    }
    const fetchS = (Date.now() - ts) / 1000;
    const out: Json[] = [];
    for (const r of await Promise.all(rows.map(async (row) => {
      if (!row.facts) { stats.noFacts++; return null; }
      const stored = await build({ ...row, parid: String(row.parid).trim() });
      return stored ? { parid: stored.parid, config_version: PANE_VERSION, payload: stored, computed_at: new Date().toISOString() } : null;
    }))) if (r) out.push(r);
    for (const r of out) stats.bytes += JSON.stringify(r.payload).length;
    if (!dry && out.length) await upload(out);
    stats.done += c.length;
    stats.written += out.length;
    const el = (Date.now() - t0) / 1000;
    const rate = stats.done / el;
    console.log(`${stats.done.toLocaleString()}/${ids.length.toLocaleString()} (batch ${c.length}: fetch ${fetchS.toFixed(0)}s, total ${((Date.now() - ts) / 1000).toFixed(0)}s) · written ${stats.written}, skipped ${stats.skipped}, failed ${stats.failed}, no facts ${stats.noFacts} · ${rate.toFixed(2)}/s, ETA ${((ids.length - stats.done) / Math.max(rate, 1e-6) / 60).toFixed(0)} min · avg ${Math.round(stats.bytes / Math.max(stats.written, 1) / 1024)} KB`);
  };
  const queue = [...chunks];
  await Promise.all(Array.from({ length: sqlConc }, async () => { for (let c = queue.shift(); c; c = queue.shift()) await doChunk(c); }));
  for (const w of idle) await w.terminate();
  console.log(`done: ${stats.written} rows written of ${ids.length} parcels in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${stats.skipped} over the ${budgetMs} ms budget, ${stats.failed} failed, ${stats.noFacts} without facts${dry ? " [dry run]" : ""}`);
}

if (isMainThread) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
