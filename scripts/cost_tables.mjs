// Data tables the pro forma reads, built from our County data (no per-parcel query at page time):
//
// 1. engine/config/land-comps.v0.1.json — vacant-land sale prices by area (City neighborhood inside
//    Pittsburgh, municipality elsewhere). Private sales: arm's-length sale codes on the County
//    assessment record of VACANT LAND parcels (valid sale, time on market, no building assessment,
//    sale not analyzed) plus valid sales (sales_valid) of vacant land. Public transfers: the
//    "GOVT SALE" code (what agencies actually sold lots for). Price per sq ft of lot, quartiles.
// 2. engine/config/tax-assessment-ratio.v0.1.json — County assessed value of recently completed new
//    homes ÷ their first sale price (City / rest of County × detached / attached). City building
//    permit values for the same homes are reported beside it as a diagnostic only.
//
// Usage: node scripts/cost_tables.mjs [asOf YYYY-MM-DD]
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const ref = /https:\/\/([^.]+)\./.exec(process.env.NEXT_PUBLIC_SUPABASE_URL)[1];
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const CITY = "a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$'";
const LAND_FROM = "2019-01-01";
const r0 = (x) => (x == null ? null : Math.round(x));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ------------------------------------------------------------------ land
const rows = await sql(`
  select distinct on (parid, d) parid, d::text d, price, lot, kind, city, area from (
    select a.parid, a.last_sale_date d, a.last_sale_price::float8 price, a.lot_area_sqft::float8 lot,
           case when a.last_sale_code = 'GV' then 'public' else 'private' end kind, ${CITY} city,
           trim(case when g.is_pittsburgh then g.neighborhood else g.municipality end) area
    from public.assessments a left join public.parcel_geo g using (parid)
    where a.use_desc = 'VACANT LAND' and a.last_sale_code in ('0','14','16','AA','GV')
      and a.last_sale_date >= '${LAND_FROM}' and a.last_sale_date <= '${asOf}'
    union all
    select a.parid, s.sale_date, s.price::float8, a.lot_area_sqft::float8, 'private', ${CITY},
           trim(case when g.is_pittsburgh then g.neighborhood else g.municipality end)
    from public.sales_valid s join public.assessments a using (parid) left join public.parcel_geo g using (parid)
    where a.use_desc = 'VACANT LAND' and s.sale_date >= '${LAND_FROM}' and s.sale_date <= '${asOf}') u
  where price >= 100 and lot between 800 and 43560
  order by parid, d, kind`);
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p, i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
};
const stat = (xs) => xs.length ? {
  sales: xs.length, from: xs.map((x) => x.d).sort()[0], to: xs.map((x) => x.d).sort().at(-1),
  perSqft: [0.25, 0.5, 0.75].map((p) => r2(q(xs.map((x) => x.price / x.lot), p))),
  perLot: [0.25, 0.5, 0.75].map((p) => r0(q(xs.map((x) => x.price), p))),
  medianLotSqft: r0(q(xs.map((x) => x.lot), 0.5)),
} : null;
const MIN = 5;
const tiers = JSON.parse(readFileSync("engine/config/area-market-tiers.json", "utf8")).areas;
const band = JSON.parse(readFileSync("engine/config/cost-assumptions.v0.1.json", "utf8")).comps.newConstruction.selection.tierBand;
const areaNames = [...new Set(rows.map((x) => x.area).filter(Boolean))].sort();
const areas = {};
for (const a of areaNames) {
  const mine = rows.filter((x) => x.area === a);
  const city = mine[0].city;
  const entry = { city };
  for (const kind of ["private", "public"]) {
    const own = mine.filter((x) => x.kind === kind);
    if (own.length) entry[kind] = stat(own);
    // Too few here: pool the areas of the same market tier (±band of this area's median $/SF of home sales).
    const t = tiers[a]?.medianPerSqft;
    if (own.length < MIN && t) {
      const peers = Object.entries(tiers).filter(([, v]) => Math.abs(v.medianPerSqft / t - 1) <= band).map(([k]) => k);
      const pool = rows.filter((x) => x.kind === kind && x.city === city && peers.includes(x.area));
      if (pool.length >= MIN) entry[`${kind}Peers`] = { ...stat(pool), areas: new Set(pool.map((x) => x.area)).size, tierPerSqft: t, band };
    }
  }
  areas[a] = entry;
}
const wide = {};
for (const [k, city] of [["City of Pittsburgh", true], ["Allegheny County outside the City", false]])
  wide[k] = { private: stat(rows.filter((x) => x.city === city && x.kind === "private")), public: stat(rows.filter((x) => x.city === city && x.kind === "public")) };
writeFileSync("engine/config/land-comps.v0.1.json", JSON.stringify({
  _note: `Vacant-land sale prices by area (City neighborhood inside Pittsburgh, municipality elsewhere), ${LAND_FROM} to ${asOf}. Private: arm's-length sale codes on the County assessment record of VACANT LAND parcels (valid sale, time on market, no building assessment, sale not analyzed) plus valid sales of vacant land; nominal prices under $100 and lots outside 800 sq ft to 1 acre dropped. Public: the County's 'GOVT SALE' code, i.e. what agencies sold lots for. perSqft and perLot are [25th, median, 75th percentile]. Where an area has fewer than ${MIN} sales, *Peers pools the areas whose market tier (median $/SF of home sales, area-market-tiers.json) is within ±${Math.round(band * 100)}%, same side of the City line. Assessed land value is never used as a price. Source: Allegheny County Property Assessments and Property Sale Transactions. Regenerate with node scripts/cost_tables.mjs.`,
  asOf, from: LAND_FROM, minSales: MIN, areas, wide,
}) + "\n");
console.log(`land: ${areaNames.length} areas, ${rows.length} sales; wide ${JSON.stringify(wide)}`);

// ------------------------------------------------------------------ tax ratio
const TAX_BUILT_FROM = Number(asOf.slice(0, 4)) - 7;
const tax = await sql(`
  with nc as (
    select distinct on (s.parid) s.parid, s.sale_date, s.price::float8 price, a.county_total::float8 assessed, a.year_built,
      ${CITY} city, a.use_desc = 'SINGLE FAMILY' detached
    from public.sales_valid s join public.assessments a using (parid)
    where a.year_built >= ${TAX_BUILT_FROM} and extract(year from s.sale_date) >= a.year_built and s.sale_date <= '${asOf}'
      and s.price >= 75000 and a.use_desc in ('SINGLE FAMILY','TOWNHOUSE','ROWHOUSE') and a.living_area_sqft >= 600 and a.county_total > 0
    order by s.parid, s.sale_date),
  pv as (
    select p.parid, max(p.project_value)::float8 v from public.permits p join nc using (parid)
    where p.project_value > 0 and p.work_type ilike 'new%' and p.permit_type ilike '%build%' group by p.parid)
  select city, detached, count(*)::int n, min(sale_date)::text d0, max(sale_date)::text d1, min(year_built) y0, max(year_built) y1,
    percentile_cont(0.25) within group (order by assessed / price) q1, percentile_cont(0.5) within group (order by assessed / price) med,
    percentile_cont(0.75) within group (order by assessed / price) q3,
    count(pv.v)::int n_permit, percentile_cont(0.5) within group (order by pv.v / price) permit_med
  from nc left join pv using (parid) group by grouping sets ((city, detached), ())`);
const groups = {};
for (const x of tax) {
  const key = x.city == null ? "all" : `${x.city ? "city" : "county"}_${x.detached ? "detached" : "attached"}`;
  groups[key] = { sales: x.n, soldFrom: x.d0, soldTo: x.d1, builtFrom: x.y0, builtTo: x.y1, ratio: [r3(x.q1), r3(x.med), r3(x.q3)], permitDiagnostic: x.n_permit ? { permits: x.n_permit, medianPermitValueToPrice: r3(x.permit_med) } : null };
}
writeFileSync("engine/config/tax-assessment-ratio.v0.1.json", JSON.stringify({
  _note: `County assessed value (county_total, the value the tax bill uses) of new homes built ${TAX_BUILT_FROM} or later ÷ the price of their first valid sale after completion. Groups: City of Pittsburgh or rest of County × detached (single family) or attached (townhouse, rowhouse). ratio is [25th, median, 75th percentile]. City building-permit values for the same homes are shown as a diagnostic only and never used. Source: Allegheny County Property Assessments, Property Sale Transactions; City of Pittsburgh PLI permits. Regenerate with node scripts/cost_tables.mjs.`,
  asOf, builtFrom: TAX_BUILT_FROM, minSales: 20, groups,
}, null, 1) + "\n");
console.log(`tax: ${JSON.stringify(groups)}`);
