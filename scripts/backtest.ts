// Backtest the pro forma on completed projects: new homes (single family, townhouse, rowhouse) built in
// the last years that then sold (County assessments year_built + valid sales). For each one the engine
// prices the same house (its living area, floors, lot and site facts) with the default assumptions and
// its actual first sale price; we compare our estimated total development cost with that price.
//
// Run: scripts/backtest.sh [--asof YYYY-MM-DD] [--years 6] [--tier good] [--limit N] [--out file.json]
// Parcels listed in .planning/private-parids.txt (one ID per line; private, gitignored) are skipped.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assumptions, type StrategyId } from "@easescore/engine";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = process.cwd();
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };

function loadEnv() {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}
async function sql<T = Json[]>(query: string): Promise<T> {
  const ref = /https:\/\/([^.]+)\./.exec(process.env.NEXT_PUBLIC_SUPABASE_URL!)![1];
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    });
    const text = await r.text();
    if (r.ok) return JSON.parse(text) as T;
    if (attempt >= 4) throw new Error(`SQL failed ${r.status}: ${text.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
  }
}
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * p, i = Math.floor(pos);
  return s[i]! + (s[Math.min(i + 1, s.length - 1)]! - s[i]!) * (pos - i);
};

async function main() {
  loadEnv();
  const asOf = arg("asof", "2026-09-27");
  const years = Number(arg("years", "6"));
  const tier = arg("tier", "");
  const limit = Number(arg("limit", "0"));
  const out = arg("out", "");
  const extra = JSON.parse(arg("over", "{}")) as assumptions.CostOverrides;
  const priv = existsSync(join(ROOT, ".planning/private-parids.txt"))
    ? readFileSync(join(ROOT, ".planning/private-parids.txt"), "utf8").split(/\s+/).filter(Boolean) : [];
  const not = priv.length ? `and s.parid not in (${priv.map((p) => `'${p}'`).join(",")})` : "";
  const cache = arg("cache", "");
  type Row = { parid: string; sale_date: string; price: number; living: number; stories: number | null; year_built: number; use: string; city: boolean; area: string | null };
  let sample: Row[];
  let facts: Map<string, Json>;
  if (cache && existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, "utf8")) as { sample: Row[]; facts: [string, Json][] };
    sample = c.sample.filter((x) => !priv.includes(x.parid));
    facts = new Map(c.facts);
  } else {
    sample = await sql<Row[]>(`
      select distinct on (s.parid) s.parid, s.sale_date::text sale_date, s.price::float8 price, a.living_area_sqft::float8 living, a.stories::float8 stories,
        a.year_built, a.use_desc "use", a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$' city,
        trim(case when g.is_pittsburgh then g.neighborhood else g.municipality end) area
      from public.sales_valid s join public.assessments a using (parid) left join public.parcel_geo g using (parid)
      where a.year_built >= ${Number(asOf.slice(0, 4)) - years} and extract(year from s.sale_date) >= a.year_built and s.sale_date <= '${asOf}'
        and s.price >= 75000 and a.use_desc in ('SINGLE FAMILY','TOWNHOUSE','ROWHOUSE') and a.living_area_sqft >= 600 ${not}
      order by s.parid, s.sale_date ${limit ? `limit ${limit}` : ""}`);
    console.error(`${sample.length} completed projects`);
    facts = new Map<string, Json>();
    for (let i = 0; i < sample.length; i += 40) {
      const ids = sample.slice(i, i + 40).map((x) => `('${x.parid}')`).join(",");
      const rows = await sql<{ parid: string; f: Json }[]>(`select parid, public.parcel_facts(parid) f from (values ${ids}) v(parid)`);
      for (const r of rows) facts.set(r.parid, r.f);
      process.stderr.write(".");
    }
    if (cache) writeFileSync(cache, JSON.stringify({ sample, facts: [...facts] }));
  }
  const [prime] = await sql<{ value: number; date: string }[]>("select value::float8 value, date::text date from public.market_series where series_id = 'DPRIME' order by date desc limit 1");
  const res: Json[] = [];
  for (const x of sample) {
    const f = facts.get(x.parid);
    if (!f) continue;
    const strategy: StrategyId = x.use === "SINGLE FAMILY" ? "new_sf" : "townhouse_row";
    const stories = x.stories && x.stories >= 1 ? x.stories : 2;
    const a = f.assessment ?? {};
    const pf: assumptions.ProFormaFacts = {
      slope_1m: f.slope_1m ?? null, overlays: f.overlays ?? null, mines: f.mines ?? null, site: { building_count: 0 },
      assessment: { use: null, fmv_land: a.fmv_land ?? null, fmv_total: a.fmv_land ?? null, living_area_sqft: null, is_pittsburgh: a.is_pittsburgh ?? null, lot_area_sqft: a.lot_area_sqft ?? null },
      property_tax: f.property_tax ?? null, transfer_tax: f.transfer_tax ?? null, building_footprint_sqft: null,
      flood_1pct_share: f.flood_1pct_share ?? null, flood_evidence: f.flood_evidence ?? null,
      owner_class: "private", area: x.area, lot_area_sqft_gis: f.lot_area_sqft_gis ?? null,
    } as assumptions.ProFormaFacts;
    const scheme = { units: 1, grossFloorAreaSf: x.living, netFloorAreaSf: x.living, footprintSf: Math.round(x.living / stories), stories };
    let r: assumptions.ProFormaResult;
    try {
      const plan = assumptions.buildDevelopmentInputs({
        strategy, facts: pf, scheme, comps: null, newComps: null, rents: null,
        primeRate: prime ? prime.value / 100 : null, primeRateDate: prime?.date ?? null, permitMonths: 4,
        overrides: { tenure: "sale", salePricePerUnit: x.price, ...(tier ? { tier } : {}), ...extra },
      });
      r = assumptions.evaluateDevelopment(plan);
    } catch (e) {
      console.error(x.parid, (e as Error).message);
      continue;
    }
    const b = (id: string) => r.budget.find((l) => l.id === id)?.amount ?? 0;
    res.push({
      parid: x.parid, city: x.city, attached: strategy !== "new_sf", area: x.area, built: x.year_built, sold: x.sale_date, price: x.price, living: x.living,
      land: b("land"), hard: r.budget.filter((l) => l.group === "hard").reduce((t, l) => t + (l.amount ?? 0), 0), slope: b("slope_adder") + b("retaining_walls"),
      tdc: r.tdc, profit: r.sale.profit, margin: r.sale.margin, missing: r.plan.missing.length > 0,
    });
  }
  const ok = res.filter((x) => x.tdc != null);
  const group = (name: string, xs: Json[]) => ({
    group: name, n: xs.length,
    medianPrice: Math.round(q(xs.map((x) => x.price), 0.5)),
    medianTdc: Math.round(q(xs.map((x) => x.tdc), 0.5)),
    medianCostToPrice: +q(xs.map((x) => x.tdc / x.price), 0.5).toFixed(3),
    medianError: +q(xs.map((x) => (x.tdc - x.price) / x.price), 0.5).toFixed(3),
    medianAbsError: +q(xs.map((x) => Math.abs(x.tdc - x.price) / x.price), 0.5).toFixed(3),
    shareLosing: +(xs.filter((x) => x.profit < 0).length / Math.max(1, xs.length)).toFixed(3),
    medianMargin: +q(xs.map((x) => x.margin), 0.5).toFixed(3),
    medianPpsf: Math.round(q(xs.map((x) => x.price / x.living), 0.5)),
    medianTdcPpsf: Math.round(q(xs.map((x) => x.tdc / x.living), 0.5)),
  });
  const summary = [
    group("All", ok),
    group("City, detached", ok.filter((x) => x.city && !x.attached)),
    group("City, attached", ok.filter((x) => x.city && x.attached)),
    group("Rest of County, detached", ok.filter((x) => !x.city && !x.attached)),
    group("Rest of County, attached", ok.filter((x) => !x.city && x.attached)),
    group("With a slope premium", ok.filter((x) => x.slope > 0)),
  ];
  console.log(JSON.stringify(summary, null, 1));
  if (out) writeFileSync(out, JSON.stringify({ asOf, years, tier: tier || "default", summary, rows: res }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
