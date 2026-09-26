-- parcel_sales_comps(parid): nearby valid arm's-length sales of similar property.
-- Rules (docs/ENGINE.md, Comps v0.2): county SALECODE '0' only; prices under $1,000 excluded;
-- same property use (vacant land compares to vacant land); last 5 years; nearest first.
-- Needs at least 5 comps: search widens ¼ → ½ → 1 → 2 → 3 miles and says so. If still under 5,
-- the result is flagged "insufficient comps" — never estimated.
create or replace function public.parcel_sales_comps(p_parid text, p_years int default 5)
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
  cand       jsonb;
  inside     jsonb;
begin
  select p.parid, p.centroid, a.use_desc, a.class_desc into subj
  from parcels p left join assessments a using (parid) where p.parid = p_parid;
  if not found then return null; end if;
  use_group := case when subj.use_desc ilike '%VACANT%' then 'VACANT' else coalesce(subj.use_desc, subj.class_desc) end;

  -- One indexed search at the widest radius, held in memory; each step is counted from this list.
  select coalesce(jsonb_agg(jsonb_build_object(
           'parid', p.parid, 'address', trim(concat_ws(' ', nullif(a.house_num, '0'), a.address)), 'use', a.use_desc,
           'sale_date', s.sale_date, 'price', s.price, 'living_area_sqft', a.living_area_sqft, 'lot_area_sqft', a.lot_area_sqft,
           'price_per_sqft', case when use_group = 'VACANT' then round(s.price / nullif(a.lot_area_sqft, 0), 2)
                                  else round(s.price / nullif(a.living_area_sqft, 0), 2) end,
           'distance_mi', round((ST_Distance(p.centroid::geography, subj.centroid::geography) / 1609.34)::numeric, 3))), '[]')
    into cand
  from parcels p
  join assessments a on a.parid = p.parid
  join sales_valid s on s.parid = p.parid
  where ST_DWithin(p.centroid, subj.centroid, radii_mi[array_length(radii_mi, 1)] * 1609.34 / 84000.0)
    and p.parid <> subj.parid
    and s.price >= 1000
    and s.sale_date >= current_date - make_interval(years => p_years)
    and (case when use_group = 'VACANT' then a.use_desc ilike '%VACANT%' else a.use_desc = use_group end);

  foreach r in array radii_mi loop
    select count(*) into n from jsonb_array_elements(cand) c where (c->>'distance_mi')::numeric <= r;
    steps := steps || format('%s within %s mi', n, r);
    used := r;
    exit when n >= 5;
  end loop;

  select coalesce(jsonb_agg(c order by (c->>'distance_mi')::numeric), '[]') into inside
  from jsonb_array_elements(cand) c where (c->>'distance_mi')::numeric <= used;
  select coalesce(jsonb_agg(c order by (c->>'distance_mi')::numeric), '[]') into comps
  from (select c from jsonb_array_elements(inside) c order by (c->>'distance_mi')::numeric limit 25) x;

  return jsonb_build_object(
    'kind', 'sales',
    'comparable_use', case when use_group = 'VACANT' then 'vacant land' else lower(use_group) end,
    'count', n, 'search_steps', to_jsonb(steps), 'radius_mi', used, 'years', p_years,
    'sufficient', n >= 5,
    'status', case when n >= 5 then 'ok' else 'insufficient comps' end,
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

revoke all on function public.parcel_sales_comps(text, int) from public;
grant execute on function public.parcel_sales_comps(text, int) to anon, authenticated, service_role;
