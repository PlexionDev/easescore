-- Policy Analyst seat: geography and census CONTEXT for a lever state (never used to compute capacity,
-- pencils or scores; policy_results is written without reading any of this).
--
-- policy_tract_context  one row per census tract: ACS 2020-2024 context (median household income,
--                       renter share, rent burden, median gross rent, poverty) and recent sale-price
--                       change (median valid sale price, last 24 months vs the 24 months before, tracts
--                       with at least 8 sales in each window). Race and ethnicity are not copied here.
-- policy_places(key)    homes added by council district (parcel_geo) and assessed value added by school
--                       district with that district's millage (millage_rates), for the fiscal ledger.
-- policy_who(key)       homes added by tract joined to policy_tract_context, plus capacity shares in
--                       high-rent-burden and lower-income tracts and a displacement-risk flag.

create table if not exists public.policy_tract_context (
  geoid                 text primary key,
  name                  text,
  acs_year              text,
  households            numeric,
  median_hh_income      numeric,
  median_hh_income_moe  numeric,
  renter_share_pct      numeric,
  rent_burden_30_pct    numeric,
  rent_burden_50_pct    numeric,
  median_gross_rent     numeric,
  poverty_pct           numeric,
  sales_recent          int,
  sales_prior           int,
  price_change_pct      numeric,
  price_window          text
);

truncate public.policy_tract_context;
insert into public.policy_tract_context
with w as (select current_date d),
s as (
  select g.tract_geoid geoid, s.price, s.sale_date >= (select d from w) - interval '24 months' recent
  from public.sales_valid s join public.parcel_geo g using (parid)
  where s.price >= 10000 and s.sale_date >= (select d from w) - interval '48 months' and g.tract_geoid is not null
),
p as (
  select geoid,
         count(*) filter (where recent) n1, count(*) filter (where not recent) n0,
         percentile_cont(0.5) within group (order by price) filter (where recent) m1,
         percentile_cont(0.5) within group (order by price) filter (where not recent) m0
  from s group by 1
)
select a.geoid, a.name, a.acs_year::text, a.households, a.median_hh_income, a.median_hh_income_moe, a.renter_share_pct,
       a.rent_burden_30_pct, a.rent_burden_50_pct, a.median_gross_rent, a.poverty_pct,
       p.n1, p.n0,
       case when p.n1 >= 8 and p.n0 >= 8 and p.m0 > 0 then round(((p.m1 / p.m0 - 1) * 100)::numeric, 1) end,
       to_char((select d from w) - interval '48 months', 'YYYY-MM') || ' to ' || to_char((select d from w), 'YYYY-MM')
from public.acs_tract a left join p using (geoid);

do $$
begin
  alter table public.policy_tract_context enable row level security;
  grant select on public.policy_tract_context to anon, authenticated;
  grant all on public.policy_tract_context to service_role;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'policy_tract_context' and policyname = 'public read') then
    create policy "public read" on public.policy_tract_context for select to anon, authenticated using (true);
  end if;
end $$;

create or replace function public.policy_places(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$
  with pos as (
    select r.*, g.council_district, g.school_district
    from public.policy_results r left join public.parcel_geo g using (parid)
    where r.key = p_key and r.units_delta > 0
  ),
  d as (
    select council_district district, count(*) parcels, sum(units_delta) homes,
           count(*) filter (where coalesce(units_before, 0) = 0) newly, sum(units_delta) filter (where pencils_likely) homes_pencil
    from pos group by 1
  ),
  sd as (
    select coalesce(m.body_name, pos.school_district, 'Unknown') name, public.school_key(pos.school_district) school_key,
           max(m.mills) mills, max(m.year) "year", max(m.source_url) source_url,
           sum(av_delta_low) low, sum(av_delta_likely) likely, sum(av_delta_high) high, count(*) parcels
    from pos left join public.millage_rates m
      on m.body_type = 'school_district' and m.rate_type = 'general' and m.school_key = public.school_key(pos.school_district)
    group by 1, 2
  )
  select jsonb_build_object(
    'by_district', coalesce((select jsonb_agg(to_jsonb(d) order by d.homes desc) from d), '[]'),
    'by_school', coalesce((select jsonb_agg(to_jsonb(sd) order by sd.likely desc, sd.parcels desc) from sd), '[]'));
$$;

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
    from public.policy_tract_context c
    where c.median_hh_income is not null and c.geoid in (select distinct tract_geoid from public.parcel_geo where is_pittsburgh)
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

revoke all on function public.policy_places(text) from public;
revoke all on function public.policy_who(text) from public;
grant execute on function public.policy_places(text) to anon, authenticated, service_role;
grant execute on function public.policy_who(text) to anon, authenticated, service_role;
