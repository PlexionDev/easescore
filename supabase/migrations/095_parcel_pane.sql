-- Fast parcel page.
--
-- 1. parcel_pane: one precomputed row per parcel with everything the parcel pane needs by default
--    (facts, comps summaries, the Ease Score for every strategy, new-construction and after-repair
--    comps per strategy). Written by scripts/pane_all.ts with the service key; the page reads one row
--    and applies the visitor's choices (?strategy=, pf_*, project answers) on top. Parcels without a
--    row, or with a row from another config version, are computed live. Read-only for the browser.
-- 2. new_construction_comps: recent new-construction sales around a parcel, replacing the county-wide
--    paged Data API reads the page used to make. Returns candidate sale records only; the engine's
--    newConstructionCompsFor applies the comp rules (dates, size, age at sale, radius steps).
-- 3. parcel_sales_comps: same inputs and output as migration 083, but searches radius by radius and
--    stops at the first with 5 comps instead of pulling every sale within 3 miles first.

create table if not exists public.parcel_pane (
  parid           char(16) primary key,
  config_version  text not null,
  payload         jsonb not null,
  computed_at     timestamptz not null default now()
);

do $$
begin
  alter table public.parcel_pane enable row level security;
  grant select on public.parcel_pane to anon, authenticated;
  grant all on public.parcel_pane to service_role;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'parcel_pane' and policyname = 'public read') then
    create policy "public read" on public.parcel_pane for select to anon, authenticated using (true);
  end if;
end $$;

-- Candidate sale records for new-construction comps: valid sales from p_as_of minus p_years to p_as_of,
-- price >= p_min_price, one of p_uses, living area >= p_min_sqft, built no earlier than
-- (as-of year - p_years - p_max_age), parcel centroid within about p_max_mi of the subject.
create or replace function public.new_construction_comps(
  p_parid text, p_as_of date, p_years int, p_max_age int, p_min_sqft numeric, p_min_price numeric, p_max_mi numeric, p_uses text[])
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare out jsonb;
begin
  -- Recent new-home sales county-wide are about a thousand rows: filter them first, then by distance.
  -- Run through EXECUTE so it is planned with the actual values (a generic plan took over a minute).
  execute '  with subj as (select centroid from parcels where parid = $1),
  recent as materialized (
    select s.sale_id, s.parid, s.sale_date, s.price, a.house_num, a.address, a.living_area_sqft, a.year_built, a.use_desc
    from sales_valid s
    join assessments a on a.parid = s.parid
    where s.sale_date >= ($2 - make_interval(years => $3))::date
      and s.sale_date <= $2
      and s.price >= $6
      and a.use_desc = any ($8)
      and a.year_built >= extract(year from $2)::int - $3 - $4
      and a.living_area_sqft >= $5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           ''parid'', r.parid,
           ''address'', nullif(trim(concat_ws('' '', nullif(r.house_num, ''0''), r.address)), ''''),
           ''saleDate'', r.sale_date, ''price'', r.price, ''livingAreaSqft'', r.living_area_sqft, ''yearBuilt'', r.year_built,
           ''use'', r.use_desc, ''lat'', ST_Y(p.centroid), ''lon'', ST_X(p.centroid)) order by r.sale_id), ''[]''::jsonb)
  from recent r
  join parcels p on p.parid = r.parid
  cross join subj
  -- Plain distance test on the few candidates (an index search around the subject would visit ~100k parcels).
  where ST_Distance(p.centroid, subj.centroid) <= $7 * 1609.34 / 84000.0'
    into out using p_parid, p_as_of, p_years, p_max_age, p_min_sqft, p_min_price, p_max_mi, p_uses;
  return out;
end $$;

revoke all on function public.new_construction_comps(text, date, int, int, numeric, numeric, numeric, text[]) from public;
grant execute on function public.new_construction_comps(text, date, int, int, numeric, numeric, numeric, text[]) to anon, authenticated, service_role;

-- Same contract as 083 (which also replaced the two-argument version from 015). The degree radius used for the index search (r * 1609.34 / 84000) is wider
-- than r miles everywhere in the county, so each step's exact (geography) count matches 083's.
drop function if exists public.parcel_sales_comps(text, int);
create or replace function public.parcel_sales_comps(p_parid text, p_years int default 5, p_use text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  subj       record;
  radii_mi   numeric[] := array[0.25, 0.5, 1, 2, 3];
  r          numeric;
  n          int;
  used       numeric;
  comps      jsonb;
  use_group  text;
  steps      text[] := '{}';
  inside     jsonb;
  fallback   text;
begin
  select p.parid, p.centroid, a.use_desc, a.class_desc into subj
  from parcels p left join assessments a using (parid) where p.parid = p_parid;
  if not found then return null; end if;
  use_group := case when p_use is not null then upper(p_use)
                    when subj.use_desc ilike '%VACANT%' then 'VACANT' else coalesce(subj.use_desc, subj.class_desc) end;
  if use_group <> 'VACANT' and not exists (
      select 1 from sales_valid s join assessments a using (parid)
      where a.use_desc = use_group and s.price >= 1000 and s.sale_date >= current_date - make_interval(years => p_years) limit 1) then
    fallback := format('No valid sales of "%s" property in the last %s years; showing single-family sales as a reference.', lower(use_group), p_years);
    use_group := 'SINGLE FAMILY';
  end if;

  foreach r in array radii_mi loop
    select coalesce(jsonb_agg(c order by (c->>'distance_mi')::numeric), '[]') into inside
    from (
      select jsonb_build_object(
               'parid', p.parid, 'address', trim(concat_ws(' ', nullif(a.house_num, '0'), a.address)), 'use', a.use_desc,
               'sale_date', s.sale_date, 'price', s.price, 'living_area_sqft', a.living_area_sqft, 'lot_area_sqft', a.lot_area_sqft,
               'price_per_sqft', case when use_group = 'VACANT' then round(s.price / nullif(a.lot_area_sqft, 0), 2)
                                      else round(s.price / nullif(a.living_area_sqft, 0), 2) end,
               'distance_mi', round((ST_Distance(p.centroid::geography, subj.centroid::geography) / 1609.34)::numeric, 3)) c
      from parcels p
      join assessments a on a.parid = p.parid
      join sales_valid s on s.parid = p.parid
      where ST_DWithin(p.centroid, subj.centroid, r * 1609.34 / 84000.0)
        and p.parid <> subj.parid
        and s.price >= 1000
        and s.sale_date >= current_date - make_interval(years => p_years)
        and (case when use_group = 'VACANT' then a.use_desc ilike '%VACANT%' else a.use_desc = use_group end)
    ) x
    where (c->>'distance_mi')::numeric <= r;
    n := jsonb_array_length(inside);
    steps := steps || format('%s within %s mi', n, r);
    used := r;
    exit when n >= 5;
  end loop;

  select coalesce(jsonb_agg(c order by (c->>'distance_mi')::numeric), '[]') into comps
  from (select c from jsonb_array_elements(inside) c order by (c->>'distance_mi')::numeric limit 25) x;

  return jsonb_build_object(
    'kind', 'sales',
    'comparable_use', case when use_group = 'VACANT' then 'vacant land' else lower(use_group) end,
    'count', n, 'search_steps', to_jsonb(steps), 'radius_mi', used, 'years', p_years,
    'sufficient', n >= 5,
    'status', case when n >= 5 then 'ok' else 'insufficient comps' end,
    'fallback_note', fallback,
    'note', case
      when n >= 5 and used > radii_mi[1] then format('Search widened to %s mi to reach 5 comps (%s).', used, array_to_string(steps, '; '))
      when n < 5 then format('Insufficient comps: only %s comparable sale(s) within %s mi in the last %s years (%s). No estimate is made.', n, used, p_years, array_to_string(steps, '; '))
      end,
    'date_range', (select jsonb_build_object('from', min((c->>'sale_date')::date), 'to', max((c->>'sale_date')::date))
                   from jsonb_array_elements(inside) c),
    'median_price', (select percentile_cont(0.5) within group (order by (c->>'price')::numeric) from jsonb_array_elements(inside) c),
    'median_price_per_sqft', (select percentile_cont(0.5) within group (order by (c->>'price_per_sqft')::numeric)
                              from jsonb_array_elements(inside) c where c->>'price_per_sqft' is not null),
    'comps', coalesce(comps, '[]'),
    'rules', 'Valid arm''s-length sales only (county sale code 0), price ≥ $1,000, same property use, nearest first; comps list shows up to 25',
    'source', 'Allegheny County Property Sale Transactions');
end $$;

revoke all on function public.parcel_sales_comps(text, int, text) from public;
grant execute on function public.parcel_sales_comps(text, int, text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
