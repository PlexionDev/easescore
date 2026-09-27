-- Policy seat speed: finished lever states keep their geography and census context (written by
-- scripts/policy_batch.ts when a state completes), so the page never aggregates 100k rows live.
alter table public.policy_states add column if not exists places jsonb;
alter table public.policy_states add column if not exists who jsonb;

-- Tracts that hold City parcels, marked once instead of scanning parcel_geo on every call.
alter table public.policy_tract_context add column if not exists in_city boolean not null default false;
update public.policy_tract_context c set in_city = exists (select 1 from public.parcel_geo g where g.tract_geoid = c.geoid and g.is_pittsburgh);

create or replace function public.policy_who(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$
  with pos as (
    select g.tract_geoid geoid, r.units_delta
    from public.policy_results r join public.parcel_geo g using (parid)
    where r.key = p_key and r.units_delta > 0
  ),
  t as (select geoid, count(*) parcels, sum(units_delta) homes from pos group by 1),
  city as (
    select percentile_cont(0.5) within group (order by c.median_hh_income) med_income
    from public.policy_tract_context c where c.median_hh_income is not null and c.in_city
  ),
  j as (
    select t.*, c.name, c.acs_year, c.median_hh_income, c.median_hh_income_moe, c.renter_share_pct, c.rent_burden_30_pct,
           c.rent_burden_50_pct, c.median_gross_rent, c.poverty_pct, c.price_change_pct,
           (c.rent_burden_30_pct >= 50 and c.price_change_pct >= 15) displacement_flag
    from t left join public.policy_tract_context c using (geoid)
  )
  select jsonb_build_object(
    'acs_year', (select max(acs_year) from j),
    'price_window', (select max(price_window) from public.policy_tract_context),
    'city_median_income', (select round(med_income::numeric, 0) from city),
    'homes', (select coalesce(sum(homes), 0) from j),
    'homes_with_income', (select coalesce(sum(homes), 0) from j where median_hh_income is not null),
    'homes_below_city_median', (select coalesce(sum(homes), 0) from j, city where median_hh_income < city.med_income),
    'homes_high_burden', (select coalesce(sum(homes), 0) from j where rent_burden_30_pct >= 50),
    'homes_majority_renter', (select coalesce(sum(homes), 0) from j where renter_share_pct >= 50),
    'homes_displacement_flag', (select coalesce(sum(homes), 0) from j where displacement_flag),
    'tracts', coalesce((select jsonb_agg(to_jsonb(j) order by j.homes desc) from (select * from j order by homes desc limit 60) j), '[]'));
$$;
