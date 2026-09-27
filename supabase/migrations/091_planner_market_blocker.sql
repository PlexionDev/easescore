-- Planner: count "Low market activity" as a blocker only where it is the parcel's top blocker.
--
-- scripts/score_all.ts lists every factor costing two or more points after the top blocker, and the
-- market-activity factor (F7) costs that on about 60% of parcels as a secondary item, so it swamped the
-- planner's share-of-parcels bars without saying anything about what holds a lot back. Each parcel keeps
-- it in its own blocker list (parcel_scores.blockers is unchanged); the planner's aggregates and blocker
-- filters treat it as a blocker only when it is top_blocker:
--   planner_rows: has_blocker 'Low market activity' matches top_blocker; only_blocked_by ignores it when secondary
--   planner_summary: the blocker bars skip it when secondary
--   planner_options_live: the blocker counts skip it when secondary
-- Mirrored in web/src/lib/planner-query.ts (matchRow, effectiveBlockers). Additive: create or replace only.
-- After applying, refresh the cached summaries (see the end of this file).

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
    and (f->>'has_blocker' is null
         or (f->>'has_blocker' = 'Low market activity' and s.top_blocker = 'Low market activity')
         or (f->>'has_blocker' <> 'Low market activity' and s.blockers @> array[f->>'has_blocker']))
    and (f->>'top_blocker' is null or s.top_blocker = f->>'top_blocker')
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0
             and (case when s.top_blocker = 'Low market activity' then s.blockers else array_remove(s.blockers, 'Low market activity') end)
                 <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$$;

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
  return summary;
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
                 from (select b, count(*) n from public.parcel_scores s, unnest(s.blockers) b where b <> 'Low market activity' or s.top_blocker = b group by 1) x),
    'total', (select count(*) from public.parcel_scores),
    'config_versions', (select coalesce(jsonb_agg(distinct config_version), '[]') from public.parcel_scores),
    'version_counts', (select coalesce(jsonb_object_agg(config_version, n), '{}') from (select config_version, count(*) n from public.parcel_scores group by 1) v),
    'computed_at', (select max(computed_at) from public.parcel_scores),
    'data_dates', (select coalesce(jsonb_object_agg(k, v), '{}') from (select k, max(v) v from public.parcel_scores, jsonb_each_text(data_dates) e(k, v)
                   where parid in (select parid from public.parcel_scores order by computed_at desc limit 200) group by 1) d));
$$;

-- Refresh the cached broad-view summaries and options (points are unchanged by this migration).
update public.planner_summary_cache set summary = public.planner_summary(filters) where filters <> '{"__options": true}'::jsonb;
update public.planner_summary_cache set summary = public.planner_options_live() where filters = '{"__options": true}'::jsonb;
