// Market tier of each area for comp matching: median $/SF of valid arm's-length sales of EXISTING
// homes (single-family, townhouse, rowhouse; built more than the new-construction age limit before the
// sale) in the last N years, by City neighborhood (City parcels) or municipality (elsewhere).
// Areas with fewer than tierMinSales sales are left out (tier unknown). No demographic fields are used.
// Writes engine/config/area-market-tiers.json. Usage: node scripts/area_tiers.mjs [asOf YYYY-MM-DD]
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const cost = JSON.parse(readFileSync("engine/config/cost-assumptions.v0.1.json", "utf8"));
const nc = cost.comps.newConstruction;
const sel = nc.selection;
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const uses = [...nc.singleFamilyUses, ...nc.attachedUses].map((u) => `'${u}'`).join(",");
const query = `
  with s as (
    select case when g.is_pittsburgh then g.neighborhood else g.municipality end area,
           s.price / a.living_area_sqft ppsf
    from public.sales_valid s
    join public.assessments a on a.parid = s.parid
    join public.parcel_geo g on g.parid = s.parid
    where s.sale_date > ('${asOf}'::date - make_interval(years => ${sel.tierYears}))::date and s.sale_date <= '${asOf}'::date
      and s.price >= ${nc.minPrice} and a.living_area_sqft >= ${nc.minLivingAreaSqft} and a.use_desc in (${uses})
      and a.year_built is not null and a.year_built < extract(year from s.sale_date) - ${nc.maxAgeAtSaleYears})
  select area, count(*)::int n, round(percentile_cont(0.5) within group (order by ppsf)::numeric, 1)::float8 median_ppsf
  from s where area is not null group by area having count(*) >= ${sel.tierMinSales} order by area`;
const ref = /https:\/\/([^.]+)\./.exec(process.env.NEXT_PUBLIC_SUPABASE_URL)[1];
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!r.ok) throw new Error(`SQL failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
const rows = await r.json();
const areas = {};
for (const x of rows) areas[x.area.trim()] = { medianPerSqft: x.median_ppsf, sales: x.n };
writeFileSync("engine/config/area-market-tiers.json", JSON.stringify({
  _note: "Market tier per area for new-construction comp matching: median $/SF of valid arm's-length sales of existing single-family, townhouse and rowhouse homes (built more than " + nc.maxAgeAtSaleYears + " years before the sale), by City neighborhood or municipality. Areas with fewer than " + sel.tierMinSales + " sales are omitted (tier unknown). Source: Allegheny County Property Sale Transactions and Assessments. No demographic data. Regenerate with node scripts/area_tiers.mjs.",
  asOf, years: sel.tierYears, minSales: sel.tierMinSales, areas,
}, null, 1) + "\n");
console.log(`${rows.length} areas written (as of ${asOf})`);
