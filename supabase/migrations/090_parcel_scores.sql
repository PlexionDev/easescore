-- Precomputed Ease Scores for the planner view (/planner): one row per parcel, written by
-- scripts/score_all.ts with the engine's score.scoreParcel (policy unlocks off). Every row records
-- the score config version and when it was computed. Read-only for the browser (RLS public read).
--
-- planner_query(filters, limit, offset, sort): the filtered, ranked page plus totals, band counts
--   and the most common blockers across the whole filtered set.
-- planner_points(filters, limit): compact [parid, lon, lat, score, band] rows for the map.
-- planner_options(): values for the filter dropdowns.

create table if not exists public.parcel_scores (
  parid              char(16) primary key,
  config_version     text not null,
  best_strategy      text,
  score              int,
  band               text,
  range_lo           int,
  range_hi           int,
  preliminary        boolean not null default false,
  red_flag_count     int not null default 0,
  red_flags          jsonb not null default '[]'::jsonb,
  top_blocker        text,
  by_right_units     int,
  units_with_relief  int,
  months_to_permit   numeric,
  planning_badge     text,
  badge_score        numeric,
  factor_scores      jsonb,
  vacant             boolean,
  owner_class        text,      -- 'public' (on the City-owned list) or 'private'; never an owner name
  tax_delinquent     boolean,
  zoning             text,
  neighborhood       text,
  municipality       text,
  lot_sqft           numeric,
  lon                double precision,
  lat                double precision,
  address            text,
  data_dates         jsonb,     -- data vintage per source used by the score
  computed_at        timestamptz not null default now()
);
-- Set when the lot-fit test could not run in the batch (solver error or over the time budget):
-- the score is kept, the unit counts are left empty, and the parcel page has the full result.
alter table public.parcel_scores add column if not exists note text;
-- Primary columns describe the best strategy that adds homes (new single-family, duplex, 3-4 units,
-- townhouse row, ADU); rehab of the existing building is kept alongside.
alter table public.parcel_scores add column if not exists rehab_score int;
alter table public.parcel_scores add column if not exists rehab_band text;
-- Planner filters (§2): every blocker costing a point (top first), frequent-transit distance, hazard
-- flags, the v0.2 band cap label, and which planning-badge criteria matched (for custom weights).
alter table public.parcel_scores add column if not exists blockers text[] not null default '{}';
alter table public.parcel_scores add column if not exists transit_m numeric;
alter table public.parcel_scores add column if not exists hz_floodway boolean;
alter table public.parcel_scores add column if not exists hz_landslide boolean;
alter table public.parcel_scores add column if not exists hz_undermined boolean;
alter table public.parcel_scores add column if not exists steep_share numeric;
alter table public.parcel_scores add column if not exists cap_label text;
alter table public.parcel_scores add column if not exists badge_matches jsonb;
-- Filled from parcel_owner_class / parcel_geo when those tables are loaded (agency names only).
alter table public.parcel_scores add column if not exists owner_agency text;
alter table public.parcel_scores add column if not exists council_district text;
-- owner_type: city · ura (includes the Land Bank) · hacp · county · other_public · nonprofit · private
-- (parcel_owner_class); owner_class rolls it up to public / nonprofit / private.
alter table public.parcel_scores add column if not exists owner_type text;
create index if not exists parcel_scores_blockers_gin on public.parcel_scores using gin (blockers);
create index if not exists parcel_scores_owner_type_idx on public.parcel_scores (owner_type);
create index if not exists parcel_scores_district_idx on public.parcel_scores (council_district);
create index if not exists parcel_scores_transit_idx on public.parcel_scores (transit_m);
create index if not exists parcel_scores_score_idx on public.parcel_scores (score desc nulls last, parid);
create index if not exists parcel_scores_muni_idx on public.parcel_scores (municipality);
create index if not exists parcel_scores_neigh_idx on public.parcel_scores (neighborhood);
create index if not exists parcel_scores_zoning_idx on public.parcel_scores (zoning);
create index if not exists parcel_scores_band_idx on public.parcel_scores (band);
create index if not exists parcel_scores_blocker_idx on public.parcel_scores (top_blocker);
create index if not exists parcel_scores_lot_idx on public.parcel_scores (lot_sqft);
create index if not exists parcel_scores_flags_idx on public.parcel_scores (red_flag_count);
create index if not exists parcel_scores_owner_idx on public.parcel_scores (owner_class, tax_delinquent, vacant);

do $$
declare t text;
begin
  foreach t in array array['parcel_scores'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- planner_attach_owner_geo(bucket, buckets): copy ownership (parcel_owner_class: agency names for public
-- owners only, never a private owner's name) and council district (parcel_geo) onto parcel_scores.
-- Run after each scoring pass, in hash buckets to stay under the statement limit.
create or replace function public.planner_attach_owner_geo(p_bucket int default 0, p_buckets int default 1)
returns int
language plpgsql volatile
set search_path = public
as $$
declare n int;
begin
  update public.parcel_scores s set
    owner_type = o.owner_class,
    owner_class = case when o.owner_class in ('city', 'ura', 'hacp', 'county', 'other_public') then 'public'
                       when o.owner_class = 'nonprofit' then 'nonprofit' else 'private' end,
    owner_agency = case o.owner_class when 'city' then 'City of Pittsburgh' when 'ura' then 'URA / Land Bank'
                                      when 'hacp' then 'Housing Authority (HACP)' when 'county' then 'Allegheny County'
                                      when 'other_public' then coalesce(o.agency_name, 'Other public')
                                      when 'nonprofit' then 'Nonprofit (approx.)' end,
    tax_delinquent = coalesce(o.tax_delinquent, s.tax_delinquent),
    council_district = coalesce(g.council_district::text, s.council_district)
  from public.parcel_owner_class o
  left join public.parcel_geo g on g.parid = o.parid
  where o.parid = s.parid and abs(hashtext(s.parid)) % greatest(p_buckets, 1) = p_bucket;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.planner_attach_owner_geo(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- planner_rows(filters): the filtered set. Keys (all optional):
--   municipality, council_district (text) · neighborhoods, zoning, bands, parids (arrays)
--   lot_min, lot_max (sq ft) · vacant (true/false) · owner ('public' | 'nonprofit' | 'private') · owner_types (array)
--   tax_delinquent (true)
--   no_red_flags, exclude_floodway, exclude_landslide, exclude_undermined, exclude_steep (true)
--   transit_max_m (meters to the nearest frequent-transit stop) · by_right_min (units)
--   has_blocker (text: the parcel lists it among its blockers) · top_blocker (text)
--   only_blocked_by (array: every blocker the parcel has is in this list, and it has at least one)
-- A set-returning SQL function (not a per-row predicate) so the filters run as plain expressions.
drop function if exists public.planner_match(public.parcel_scores, jsonb);
create or replace function public.planner_rows(f jsonb)
returns setof public.parcel_scores
language sql stable
-- No SET clause: it would stop Postgres from inlining this function into the caller's query.
as $$
  select s.* from public.parcel_scores s
  where (f->>'municipality' is null or s.municipality = f->>'municipality')
    and (f->>'council_district' is null or s.council_district = f->>'council_district')
    -- "= any (array(...))" runs the list once (an init plan) and can use the column's index.
    and (f->'neighborhoods' is null or s.neighborhood = any (array(select jsonb_array_elements_text(f->'neighborhoods'))))
    and (f->'zoning' is null or s.zoning = any (array(select jsonb_array_elements_text(f->'zoning'))))
    and (f->'bands' is null or s.band = any (array(select jsonb_array_elements_text(f->'bands'))))
    and (f->'parids' is null or s.parid = any (array(select jsonb_array_elements_text(f->'parids'))::char(16)[]))
    and (f->>'lot_min' is null or s.lot_sqft >= (f->>'lot_min')::numeric)
    and (f->>'lot_max' is null or s.lot_sqft <= (f->>'lot_max')::numeric)
    and (f->>'vacant' is null or s.vacant = (f->>'vacant')::boolean)
    and (f->>'owner' is null or s.owner_class = f->>'owner')
    and (f->'owner_types' is null or s.owner_type = any (array(select jsonb_array_elements_text(f->'owner_types'))))
    and (coalesce((f->>'tax_delinquent')::boolean, false) = false or s.tax_delinquent)
    and (coalesce((f->>'no_red_flags')::boolean, false) = false or s.red_flag_count = 0)
    and (coalesce((f->>'exclude_floodway')::boolean, false) = false or not coalesce(s.hz_floodway, false))
    and (coalesce((f->>'exclude_landslide')::boolean, false) = false or not coalesce(s.hz_landslide, false))
    and (coalesce((f->>'exclude_undermined')::boolean, false) = false or not coalesce(s.hz_undermined, false))
    and (coalesce((f->>'exclude_steep')::boolean, false) = false or coalesce(s.steep_share, 0) < 0.25)
    and (f->>'transit_max_m' is null or s.transit_m <= (f->>'transit_max_m')::numeric)
    and (f->>'by_right_min' is null or s.by_right_units >= (f->>'by_right_min')::int)
    and (f->>'has_blocker' is null or s.blockers @> array[f->>'has_blocker'])
    and (f->>'top_blocker' is null or s.top_blocker = f->>'top_blocker')
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0 and s.blockers <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$$;

-- planner_summary(filters): the summary panel for a filtered set: total, band counts, share of parcels
-- per blocker (a parcel can have several), by-right and with-relief capacity (all matching parcels, and
-- only those without red flags or a hazard cap), and public land. The filters go in as a literal (not a
-- parameter) so Postgres folds the unused ones away.
create or replace function public.planner_summary(p_filters jsonb default '{}')
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  summary jsonb;
begin
  execute format($q$
  with m as materialized (
    select s.band, s.blockers, s.top_blocker, s.by_right_units, s.units_with_relief, s.red_flag_count,
           s.cap_label, s.owner_class, s.owner_agency, s.lot_sqft
    from public.planner_rows(%L::jsonb) s),
  a as (
    select count(*) total,
           count(*) filter (where band = 'Easy') easy, count(*) filter (where band = 'Moderate') moderate,
           count(*) filter (where band = 'Hard') hard, count(*) filter (where band = 'Very hard') very_hard,
           count(*) filter (where band is null) no_score,
           count(*) filter (where cardinality(blockers) = 0) no_blocker,
           coalesce(sum(by_right_units), 0) br, coalesce(sum(by_right_units) filter (where red_flag_count = 0 and cap_label is null), 0) br_clean,
           coalesce(sum(units_with_relief), 0) rl, coalesce(sum(units_with_relief) filter (where red_flag_count = 0 and cap_label is null), 0) rl_clean,
           count(*) filter (where by_right_units > 0) with_br, count(*) filter (where by_right_units is null) units_unknown,
           count(*) filter (where owner_class = 'public') pub_n,
           coalesce(sum(lot_sqft) filter (where owner_class = 'public'), 0) pub_sf,
           count(*) filter (where owner_class = 'public' and red_flag_count = 0 and coalesce(units_with_relief, 0) > 0) pub_b_n,
           coalesce(sum(lot_sqft) filter (where owner_class = 'public' and red_flag_count = 0 and coalesce(units_with_relief, 0) > 0), 0) pub_b_sf
    from m)
  select jsonb_build_object(
    'total', a.total,
    'bands', jsonb_strip_nulls(jsonb_build_object('Easy', nullif(a.easy, 0), 'Moderate', nullif(a.moderate, 0), 'Hard', nullif(a.hard, 0),
                                                  'Very hard', nullif(a.very_hard, 0), 'No score', nullif(a.no_score, 0))),
    'blockers', coalesce((select jsonb_agg(jsonb_build_object('blocker', b, 'n', n, 'top', t) order by n desc, b)
                          from (select b, count(*) n, count(*) filter (where m.top_blocker = b) t
                                from m, unnest(m.blockers) b group by 1 order by 2 desc, 1 limit 12) x), '[]'),
    'top_blockers', coalesce((select jsonb_agg(jsonb_build_object('blocker', top_blocker, 'n', n) order by n desc, top_blocker)
                              from (select top_blocker, count(*) n from m where top_blocker is not null group by 1 order by 2 desc, 1 limit 12) x), '[]'),
    'no_blocker', a.no_blocker,
    'capacity', jsonb_build_object('by_right', a.br, 'by_right_clean', a.br_clean, 'relief', a.rl, 'relief_clean', a.rl_clean,
                                   'parcels_with_by_right', a.with_br, 'units_unknown', a.units_unknown),
    'public_land', jsonb_build_object('count', a.pub_n, 'acres', round(a.pub_sf / 43560.0, 1),
                                      'buildable_count', a.pub_b_n, 'buildable_acres', round(a.pub_b_sf / 43560.0, 1),
                                      'by_agency', coalesce((select jsonb_object_agg(g, n) from (select coalesce(owner_agency, 'City of Pittsburgh') g, count(*) n
                                                             from m where owner_class = 'public' group by 1) y), '{}')))
  from a$q$, coalesce(p_filters, '{}')::text)
  into summary;
  return summary;
end $$;

-- Summaries for the broad views (everything, and each municipality), which scan every row. Refreshed by
-- planner_refresh_cache() after each scoring run; planner_query() reads them for those exact filters.
create table if not exists public.planner_summary_cache (
  filters     jsonb primary key,
  summary     jsonb not null,
  computed_at timestamptz not null default now()
);
-- Map points for the same broad views, and (under the key {"__options": true}) the filter options.
alter table public.planner_summary_cache add column if not exists points jsonb;
do $$
declare t text;
begin
  foreach t in array array['planner_summary_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

create or replace function public.planner_refresh_cache()
returns int
language plpgsql volatile
set search_path = public
as $$
declare k jsonb; n int := 0;
begin
  delete from public.planner_summary_cache;
  for k in select '{}'::jsonb union all select jsonb_build_object('municipality', municipality) from (select distinct municipality from public.parcel_scores where municipality is not null) x loop
    insert into public.planner_summary_cache (filters, summary, points) values (k, public.planner_summary(k), public.planner_points_live(k, 12000));
    n := n + 1;
  end loop;
  insert into public.planner_summary_cache (filters, summary) values ('{"__options": true}', public.planner_options_live());
  return n;
end $$;
revoke all on function public.planner_refresh_cache() from public, anon, authenticated;

-- planner_query(filters, limit, offset, sort, dir): one page of ranked rows plus planner_summary().
-- plpgsql so the ORDER BY is a plain (whitelisted) column and a score sort can use its index.
drop function if exists public.planner_query(jsonb, int, int, text);
create or replace function public.planner_query(p_filters jsonb default '{}', p_limit int default 50, p_offset int default 0,
                                                p_sort text default 'score', p_dir text default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  f    jsonb := coalesce(p_filters, '{}');
  col  text := case p_sort when 'months' then 'months_to_permit' when 'transit' then 'transit_m' when 'lot' then 'lot_sqft'
                           when 'by_right_units' then 'by_right_units' when 'units_with_relief' then 'units_with_relief'
                           when 'address' then 'address' when 'neighborhood' then 'neighborhood' when 'zoning' then 'zoning'
                           else 'score' end;
  dir  text := case when lower(p_dir) in ('asc', 'desc') then lower(p_dir)
                    when col in ('months_to_permit', 'transit_m', 'address', 'neighborhood', 'zoning') then 'asc' else 'desc' end;
  rows jsonb;
  summary jsonb;
begin
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (
       select m.parid, m.address, m.score, m.band, m.range_lo, m.range_hi, m.preliminary, m.red_flag_count, m.red_flags,
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge,
              m.badge_score, m.badge_matches, m.factor_scores, m.best_strategy, m.vacant, m.owner_class, m.owner_type, m.owner_agency,
              m.tax_delinquent, m.zoning, m.neighborhood, m.council_district, m.municipality, m.lot_sqft, m.lon, m.lat,
              m.transit_m, m.hz_floodway, m.hz_landslide, m.hz_undermined, m.steep_share, m.cap_label,
              m.rehab_score, m.rehab_band, m.note, m.config_version, m.data_dates, m.computed_at
       from public.planner_rows(%L::jsonb) m
       order by m.%I %s nulls last, m.score desc nulls last, m.parid
       limit $1 offset $2) x', f::text, col, dir)
    using least(greatest(coalesce(p_limit, 50), 1), 10000), greatest(coalesce(p_offset, 0), 0)
    into rows;
  select c.summary into summary from public.planner_summary_cache c where c.filters = f;
  if summary is null then summary := public.planner_summary(f); end if;
  return summary || jsonb_build_object('rows', rows);
end $$;

-- Map points for the filtered set, highest scores first:
-- [parid, lon, lat, score, band, top_blocker, address, by_right_units, units_with_relief].
create or replace function public.planner_points_live(p_filters jsonb default '{}', p_limit int default 12000)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare out jsonb;
begin
  -- Filters as a literal so unused ones fold away (see planner_summary).
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_array(parid, lon, lat, score, band, top_blocker, address, by_right_units, units_with_relief)
                              order by score desc nulls last, parid), ''[]'')
     from (select s.parid, s.lon, s.lat, s.score, s.band, s.top_blocker, s.address, s.by_right_units, s.units_with_relief
           from public.planner_rows(%L::jsonb) s
           where s.lon is not null
           order by s.score desc nulls last, s.parid
           limit $1) x', coalesce(p_filters, '{}')::text)
    using least(greatest(coalesce(p_limit, 12000), 1), 30000)
    into out;
  return out;
end $$;

-- Cached for the broad views (see planner_refresh_cache), live otherwise.
create or replace function public.planner_points(p_filters jsonb default '{}', p_limit int default 12000)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare out jsonb;
begin
  if coalesce(p_limit, 12000) = 12000 then
    select c.points into out from public.planner_summary_cache c where c.filters = coalesce(p_filters, '{}') and c.points is not null;
  end if;
  return coalesce(out, public.planner_points_live(p_filters, p_limit));
end $$;

create or replace function public.planner_options_live()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'municipalities', (select coalesce(jsonb_agg(municipality order by municipality), '[]') from (select distinct municipality from public.parcel_scores where municipality is not null) x),
    'all_municipalities', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'type', type) order by name, type), '[]') from public.municipalities),
    'neighborhoods', (select coalesce(jsonb_agg(neighborhood order by neighborhood), '[]') from (select distinct neighborhood from public.parcel_scores where neighborhood is not null) x),
    'council_districts', (select coalesce(jsonb_agg(council_district order by council_district), '[]') from (select distinct council_district from public.parcel_scores where council_district is not null) x),
    'zoning', (select coalesce(jsonb_agg(zoning order by zoning), '[]') from (select distinct zoning from public.parcel_scores where zoning is not null) x),
    'blockers', (select coalesce(jsonb_agg(jsonb_build_object('blocker', b, 'n', n) order by n desc), '[]')
                 from (select b, count(*) n from public.parcel_scores, unnest(blockers) b group by 1) x),
    'total', (select count(*) from public.parcel_scores),
    'config_versions', (select coalesce(jsonb_agg(distinct config_version), '[]') from public.parcel_scores),
    'version_counts', (select coalesce(jsonb_object_agg(config_version, n), '{}') from (select config_version, count(*) n from public.parcel_scores group by 1) v),
    'computed_at', (select max(computed_at) from public.parcel_scores),
    'data_dates', (select coalesce(jsonb_object_agg(k, v), '{}') from (select k, max(v) v from public.parcel_scores, jsonb_each_text(data_dates) e(k, v)
                   where parid in (select parid from public.parcel_scores order by computed_at desc limit 200) group by 1) d));
$$;

create or replace function public.planner_options()
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare out jsonb;
begin
  select c.summary into out from public.planner_summary_cache c where c.filters = '{"__options": true}'::jsonb;
  return coalesce(out, public.planner_options_live());
end $$;

revoke all on function public.planner_rows(jsonb) from public;
revoke all on function public.planner_query(jsonb, int, int, text, text) from public;
revoke all on function public.planner_summary(jsonb) from public;
revoke all on function public.planner_points(jsonb, int) from public;
revoke all on function public.planner_points_live(jsonb, int) from public;
revoke all on function public.planner_options_live() from public;
revoke all on function public.planner_options() from public;
grant execute on function public.planner_rows(jsonb) to anon, authenticated, service_role;
grant execute on function public.planner_query(jsonb, int, int, text, text) to anon, authenticated, service_role;
grant execute on function public.planner_summary(jsonb) to anon, authenticated, service_role;
grant execute on function public.planner_points(jsonb, int) to anon, authenticated, service_role;
grant execute on function public.planner_points_live(jsonb, int) to anon, authenticated, service_role;
grant execute on function public.planner_options_live() to anon, authenticated, service_role;
grant execute on function public.planner_options() to anon, authenticated, service_role;
