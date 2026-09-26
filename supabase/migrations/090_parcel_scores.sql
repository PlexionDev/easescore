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
-- Filter predicate shared by the planner functions. Keys (all optional):
--   municipality, neighborhood, zoning, band, blocker (text) · lot_min, lot_max (sq ft)
--   vacant (true/false) · owner ('public' | 'tax_delinquent') · no_red_flags (true)
create or replace function public.planner_match(s public.parcel_scores, f jsonb)
returns boolean
language sql immutable
set search_path = public
as $$
  select (f->>'municipality' is null or s.municipality = f->>'municipality')
     and (f->>'neighborhood' is null or s.neighborhood = f->>'neighborhood')
     and (f->>'zoning' is null or s.zoning = f->>'zoning')
     and (f->>'band' is null or s.band = f->>'band')
     and (f->>'blocker' is null or s.top_blocker = f->>'blocker')
     and (f->>'lot_min' is null or s.lot_sqft >= (f->>'lot_min')::numeric)
     and (f->>'lot_max' is null or s.lot_sqft <= (f->>'lot_max')::numeric)
     and (f->>'vacant' is null or s.vacant = (f->>'vacant')::boolean)
     and (f->>'owner' is null
          or (f->>'owner' = 'public' and s.owner_class = 'public')
          or (f->>'owner' = 'tax_delinquent' and s.tax_delinquent))
     and (coalesce((f->>'no_red_flags')::boolean, false) = false or s.red_flag_count = 0)
$$;

create or replace function public.planner_query(p_filters jsonb default '{}', p_limit int default 50, p_offset int default 0,
                                                p_sort text default 'score')
returns jsonb
language sql stable
set search_path = public
as $$
  with m as (
    select s.* from public.parcel_scores s where public.planner_match(s, coalesce(p_filters, '{}'))
  ),
  page as (
    select m.parid, m.address, m.score, m.band, m.range_lo, m.range_hi, m.preliminary, m.red_flag_count, m.red_flags,
           m.top_blocker, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge, m.badge_score,
           m.factor_scores, m.best_strategy, m.vacant, m.owner_class, m.tax_delinquent, m.zoning, m.neighborhood,
           m.municipality, m.lot_sqft, m.lon, m.lat, m.config_version, m.data_dates, m.computed_at
    from m
    order by
      case p_sort when 'months' then m.months_to_permit end asc nulls last,
      case p_sort when 'by_right_units' then m.by_right_units
                  when 'units_with_relief' then m.units_with_relief end desc nulls last,
      case p_sort when 'lot' then m.lot_sqft end desc nulls last,
      m.score desc nulls last, m.parid
    limit least(greatest(coalesce(p_limit, 50), 1), 10000) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'bands', coalesce((select jsonb_object_agg(coalesce(band, 'No score'), n) from (select band, count(*) n from m group by 1) b), '{}'),
    'blockers', coalesce((select jsonb_agg(jsonb_build_object('blocker', top_blocker, 'n', n) order by n desc, top_blocker)
                          from (select top_blocker, count(*) n from m where top_blocker is not null group by 1 order by 2 desc, 1 limit 12) x), '[]'),
    'no_blocker', (select count(*) from m where top_blocker is null),
    'rows', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'));
$$;

create or replace function public.planner_points(p_filters jsonb default '{}', p_limit int default 5000)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(parid, lon, lat, score, band) order by score desc nulls last, parid), '[]')
  from (select s.parid, s.lon, s.lat, s.score, s.band from public.parcel_scores s
        where public.planner_match(s, coalesce(p_filters, '{}')) and s.lon is not null
        order by s.score desc nulls last, s.parid
        limit least(greatest(coalesce(p_limit, 5000), 1), 20000)) x
$$;

create or replace function public.planner_options()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'municipalities', (select coalesce(jsonb_agg(municipality order by municipality), '[]') from (select distinct municipality from public.parcel_scores where municipality is not null) x),
    'neighborhoods', (select coalesce(jsonb_agg(neighborhood order by neighborhood), '[]') from (select distinct neighborhood from public.parcel_scores where neighborhood is not null) x),
    'zoning', (select coalesce(jsonb_agg(zoning order by zoning), '[]') from (select distinct zoning from public.parcel_scores where zoning is not null) x),
    'blockers', (select coalesce(jsonb_agg(jsonb_build_object('blocker', top_blocker, 'n', n) order by n desc), '[]')
                 from (select top_blocker, count(*) n from public.parcel_scores where top_blocker is not null group by 1) x),
    'total', (select count(*) from public.parcel_scores),
    'config_versions', (select coalesce(jsonb_agg(distinct config_version), '[]') from public.parcel_scores),
    'computed_at', (select max(computed_at) from public.parcel_scores));
$$;

revoke all on function public.planner_match(public.parcel_scores, jsonb) from public;
revoke all on function public.planner_query(jsonb, int, int, text) from public;
revoke all on function public.planner_points(jsonb, int) from public;
revoke all on function public.planner_options() from public;
grant execute on function public.planner_match(public.parcel_scores, jsonb) to anon, authenticated, service_role;
grant execute on function public.planner_query(jsonb, int, int, text) to anon, authenticated, service_role;
grant execute on function public.planner_points(jsonb, int) to anon, authenticated, service_role;
grant execute on function public.planner_options() to anon, authenticated, service_role;
