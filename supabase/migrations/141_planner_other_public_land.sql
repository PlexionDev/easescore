-- Planner fix (TONIGHT-FINAL-PLAN.md §4.2): exclude land that cannot become housing from the
-- planner's rankings and show it as a separate "Other public land" group/count instead.
--
-- Land-use/class codes used (Allegheny County Property Assessments, public.assessments):
--   130  Right of way - residential   \  alleys / streets / right-of-way
--   530  Right of way - commercial    /
--   660  Public park                     parks (plazas are assessed under the same code; the county
--                                         data has no separate "plaza" use code)
--   456  Parking garage/lots           \  parking structures
--   777  Income producing parking lot  /
--   489  Commercial/utility            \  utility land
--   389  Industrial/utility            /
--   class_code = 'U' (Utilities)          utility land (broader class than the two use codes above)
-- Transit land has no distinct land-use code in the county data; identified instead by ownership
-- (owner_agency = 'Pittsburgh Regional Transit', set by planner_attach_owner_geo from
-- parcel_owner_class). Additive only: a new lookup table plus create-or-replace function changes.
-- No rewrite of parcel_scores or any other existing table.

create table if not exists public.planner_other_public_land (
  parid  char(16) primary key,
  reason text not null
);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planner_other_public_land' and policyname = 'public read') then
    alter table public.planner_other_public_land enable row level security;
    grant select on public.planner_other_public_land to anon, authenticated;
    grant all on public.planner_other_public_land to service_role;
    create policy "public read" on public.planner_other_public_land for select to anon, authenticated using (true);
  end if;
end $$;

truncate public.planner_other_public_land;

insert into public.planner_other_public_land (parid, reason)
select a.parid,
  case when a.use_code in ('130', '530') then 'Alley / street / right-of-way'
       when a.use_code = '660' then 'Park or plaza'
       when a.use_code in ('456', '777') then 'Parking structure or lot'
       else 'Utility land' end
from public.assessments a
where a.use_code in ('130', '530', '660', '456', '777', '489', '389') or a.class_code = 'U'
on conflict (parid) do nothing;

insert into public.planner_other_public_land (parid, reason)
select s.parid, 'Transit land'
from public.parcel_scores s
where s.owner_agency = 'Pittsburgh Regional Transit'
on conflict (parid) do nothing;

create index if not exists planner_other_public_land_reason_idx on public.planner_other_public_land (reason);

-- planner_rows(): same filters as migration 091, plus skip anything in the lookup above so it never
-- ranks as a housing site.
create or replace function public.planner_rows(f jsonb)
returns setof public.parcel_scores
language sql stable
-- No SET clause: it would stop Postgres from inlining this function into the caller's query.
as $$
  select s.* from public.parcel_scores s
  where not exists (select 1 from public.planner_other_public_land x where x.parid = s.parid)
    and (f->>'municipality' is null or s.municipality = f->>'municipality')
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
    and (f->>'has_blocker' is null
         or (f->>'has_blocker' = 'Low market activity' and s.top_blocker = 'Low market activity')
         or (f->>'has_blocker' <> 'Low market activity' and s.blockers @> array[f->>'has_blocker']))
    and (f->>'top_blocker' is null or s.top_blocker = f->>'top_blocker')
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0
             and (case when s.top_blocker = 'Low market activity' then s.blockers else array_remove(s.blockers, 'Low market activity') end)
                 <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$$;

-- planner_other_public_land_summary(filters): count/acres/breakdown for the excluded group, scoped by
-- the same geography filters as the ranked list (municipality, council district).
create or replace function public.planner_other_public_land_summary(p_filters jsonb default '{}')
returns jsonb
language sql stable
set search_path = public
as $$
  with m as (
    select s.lot_sqft, o.reason
    from public.parcel_scores s
    join public.planner_other_public_land o on o.parid = s.parid
    where (p_filters->>'municipality' is null or s.municipality = p_filters->>'municipality')
      and (p_filters->>'council_district' is null or s.council_district = p_filters->>'council_district')
  )
  select jsonb_build_object(
    'count', count(*),
    'acres', round(coalesce(sum(lot_sqft), 0) / 43560.0, 1),
    'by_reason', coalesce((select jsonb_object_agg(reason, n order by n desc) from (select reason, count(*) n from m group by 1) y), '{}')
  )
  from m
$$;
revoke all on function public.planner_other_public_land_summary(jsonb) from public;
grant execute on function public.planner_other_public_land_summary(jsonb) to anon, authenticated, service_role;

-- planner_summary(): same as migration 091, plus the other_public_land group.
create or replace function public.planner_summary(p_filters jsonb default '{}')
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  summary jsonb;
  opl jsonb;
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
                                from m, unnest(m.blockers) b where b <> 'Low market activity' or m.top_blocker = b group by 1 order by 2 desc, 1 limit 12) x), '[]'),
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
  opl := public.planner_other_public_land_summary(coalesce(p_filters, '{}'));
  return summary || jsonb_build_object('other_public_land', opl);
end $$;

-- Refresh the cached broad-view summaries (points are unaffected by this migration's row set change
-- for map markers other than removing the newly-excluded parcels, which planner_refresh_cache already
-- recomputes for points too).
select public.planner_refresh_cache();
