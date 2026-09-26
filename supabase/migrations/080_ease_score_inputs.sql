-- Ease Score v0.1 inputs that parcel_facts does not already carry. Read-only STABLE functions plus
-- one small derived table (a fixed 1% sample of parcels used to rank market activity).
-- "City of Pittsburgh" = county municipal codes 101-132 (the 32 wards); East Pittsburgh (822) is not the City.
--
-- zba_grant_rates(district): granted / denied counts per relief type for decided cases that list
--   this zoning district. The engine only uses a rate when at least 5 cases are decided.
-- parcel_ease_inputs(parid): cleanup sites on or next to the lot, and market activity (valid sales
--   in the last 3 years + completed building permits within 1/2 mile) with its percentile rank.

-- ---------------------------------------------------------------------------------------------
create or replace function public.zba_grant_rates(p_district text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with req as (
    select r.relief_type, r.outcome, c.decision_date
    from public.zoning_cases c
    join public.zoning_requests r using (case_id)
    where r.relief_type is not null
      and upper(p_district) = any (string_to_array(upper(regexp_replace(coalesce(c.district, ''), '\s', '', 'g')), ','))
  )
  select jsonb_build_object(
    'district', p_district,
    'by_relief', coalesce((
      select jsonb_object_agg(relief_type, jsonb_build_object(
               'granted', granted, 'denied', denied, 'decided', granted + denied,
               'from', first_date, 'to', last_date))
      from (select relief_type,
                   count(*) filter (where outcome ilike 'grant%' or outcome ilike 'partial%') granted,
                   count(*) filter (where outcome ilike 'den%') denied,
                   min(decision_date) first_date, max(decision_date) last_date
            from req group by relief_type) x), '{}'::jsonb),
    'rules', 'Counts one row per requested item; granted = outcome "granted" or "partially granted"; denied = outcome "denied"; withdrawn, expired and pending items are not counted.',
    'source', 'Pittsburgh Zoning Board of Adjustment and City Council zoning decisions (zoning_cases / zoning_requests)');
$$;

revoke all on function public.zba_grant_rates(text) from public;
grant execute on function public.zba_grant_rates(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Market activity sample: 1% of parcels chosen by a hash of the parcel id (fixed, not random).
-- scope 'county' = valid sales only (every parcel); scope 'city' = sales + completed building
-- permits (Pittsburgh parcels only; the permit data covers the City only).
create table if not exists public.market_activity_sample (
  scope        text not null,
  parid        char(16) not null,
  sales_3y     int not null,
  permits_3y   int,
  activity     int not null,
  computed_on  date not null default current_date,
  primary key (scope, parid)
);
alter table public.market_activity_sample enable row level security;
grant select on public.market_activity_sample to anon, authenticated;
grant all on public.market_activity_sample to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'market_activity_sample' and policyname = 'public read') then
    create policy "public read" on public.market_activity_sample for select to anon, authenticated using (true);
  end if;
end $$;

-- REBUILD (run once; re-run after sales or permits are reloaded) ------------------------------
-- create temp table _sale_pts as
--   select p.centroid geom from public.sales_valid s join public.parcels p using (parid)
--   where s.price >= 1000 and s.sale_date >= current_date - interval '3 years';
-- create index on _sale_pts using gist (geom);
-- create temp table _permit_pts as
--   select p.centroid geom from public.permits pm join public.parcels p using (parid)
--   where pm.status = 'Completed' and pm.permit_type in ('BUILDING', 'Building & Development Application')
--     and pm.issue_date >= current_date - interval '3 years';
-- create index on _permit_pts using gist (geom);
-- delete from public.market_activity_sample;
-- insert into public.market_activity_sample (scope, parid, sales_3y, permits_3y, activity)
-- select sc.scope, x.parid, x.sales, case when sc.scope = 'city' then x.permits end,
--        x.sales + case when sc.scope = 'city' then x.permits else 0 end
-- from (
--   select p.parid, coalesce(a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$', false) pgh,
--     (select count(*) from _sale_pts s where extensions.ST_DWithin(s.geom, p.centroid, 0.012)
--        and extensions.ST_DWithin(s.geom::extensions.geography, p.centroid::extensions.geography, 804.67)) sales,
--     (select count(*) from _permit_pts s where extensions.ST_DWithin(s.geom, p.centroid, 0.012)
--        and extensions.ST_DWithin(s.geom::extensions.geography, p.centroid::extensions.geography, 804.67)) permits
--   from public.parcels p left join public.assessments a using (parid)
--   where abs(hashtext(p.parid)) % 100 = 0) x
-- cross join (values ('county'), ('city')) sc(scope)
-- where sc.scope = 'county' or x.pgh;

-- ---------------------------------------------------------------------------------------------
create or replace function public.parcel_ease_inputs(p_parid text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  p        record;
  pgh      boolean;
  sales    int;
  permits  int;
  act      int;
  v_scope  text;
  pctile   numeric;
  n        int;
  sample_on date;
begin
  select pp.parid, pp.geom, pp.centroid into p from public.parcels pp where pp.parid = p_parid;
  if not found then return null; end if;
  select coalesce(a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$', false) into pgh from public.assessments a where a.parid = p_parid;
  pgh := coalesce(pgh, false);

  select count(*) into sales
  from public.parcels q join public.sales_valid s on s.parid = q.parid
  where ST_DWithin(q.centroid, p.centroid, 0.012)
    and ST_DWithin(q.centroid::geography, p.centroid::geography, 804.67)
    and s.price >= 1000 and s.sale_date >= current_date - interval '3 years';

  if pgh then
    select count(*) into permits
    from public.parcels q join public.permits pm on pm.parid = q.parid
    where ST_DWithin(q.centroid, p.centroid, 0.012)
      and ST_DWithin(q.centroid::geography, p.centroid::geography, 804.67)
      and pm.status = 'Completed' and pm.permit_type in ('BUILDING', 'Building & Development Application')
      and pm.issue_date >= current_date - interval '3 years';
  end if;

  v_scope := case when pgh then 'city' else 'county' end;
  act := sales + coalesce(permits, 0);
  -- Percentile rank (0-100), ties counted half.
  select count(*), round(100.0 * (count(*) filter (where activity < act) + 0.5 * count(*) filter (where activity = act)) / nullif(count(*), 0), 1),
         max(computed_on)
    into n, pctile, sample_on
  from public.market_activity_sample m where m.scope = v_scope;

  return jsonb_build_object(
    'parid', p.parid,
    'env_sites', jsonb_build_object(
      'on_parcel', (select count(*) from public.env_sites e where ST_Intersects(e.geom, p.geom)),
      'adjacent_50ft', (select count(*) from public.env_sites e
                        where ST_DWithin(e.geom, p.geom, 0.0003) and ST_DWithin(e.geom::geography, p.geom::geography, 15.24)),
      'active_on_parcel', (select count(*) from public.env_sites e
                           where ST_Intersects(e.geom, p.geom) and (e.status is null or e.status = 'ACTIVE')),
      'active_on_or_adjacent', (select count(*) from public.env_sites e
                        where ST_DWithin(e.geom, p.geom, 0.0003) and ST_DWithin(e.geom::geography, p.geom::geography, 15.24)
                          and (e.status is null or e.status = 'ACTIVE')),
      'rules', 'Site points on the lot, or within 50 ft of it. EPA ACRES records carry no status and count as active.',
      'source', 'PA DEP Land Recycling Program; EPA ACRES brownfields'),
    'market', jsonb_build_object(
      'sales_3y_half_mile', sales,
      'completed_permits_3y_half_mile', permits,
      'activity', act,
      'percentile', pctile,
      'scope', v_scope,
      'sample_n', n,
      'sample_computed_on', sample_on,
      'as_of', current_date,
      'rules', case when pgh
        then 'Valid arm''s-length sales (price >= $1,000) plus completed building permits in the last 3 years within 1/2 mile, ranked against a fixed 1% sample of City parcels.'
        else 'Valid arm''s-length sales (price >= $1,000) in the last 3 years within 1/2 mile, ranked against a fixed 1% sample of county parcels. Permit data covers the City of Pittsburgh only.' end,
      'source', 'Allegheny County Property Sale Transactions; City of Pittsburgh PLI permits'));
end $$;

revoke all on function public.parcel_ease_inputs(text) from public;
grant execute on function public.parcel_ease_inputs(text) to anon, authenticated, service_role;
