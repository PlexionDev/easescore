-- Scoring honesty: no numeric Ease Score where the parcel's zoning is not loaded.
-- Zoning rules exist only for City of Pittsburgh districts (the score's zoning factor, F1, is missing
-- elsewhere, and for the few City parcels with no zoning district). Those parcels read "Partial" in the
-- Planner and Developer tables, map, summaries, staff memo and CSV: never counted in a band, and sorted
-- after every scored parcel. parcel_scores is not rewritten; the stored score and band stay as computed,
-- and only these read functions change what they return.
--  * score_is_partial(): the one test (same as the engine's score.zoningLoaded: City parcel + district).
--  * planner_query(): partial rows return score, range and rehab score null and band 'Partial'; they sort
--    after scored rows; with a band filter they are left out; the summary's band counts move them to
--    'Partial' (so they are never counted as a band).
--  * planner_points_live(): same for map points (score null, band 'Partial', drawn last).
-- Same signatures; CREATE OR REPLACE keeps the grants.

create or replace function public.score_is_partial(p_municipality text, p_zoning text)
 returns boolean
 language sql
 immutable
 parallel safe
as $$ select p_municipality is distinct from 'PITTSBURGH' or p_zoning is null $$;
grant execute on function public.score_is_partial(text, text) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.planner_query(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'score'::text, p_dir text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  partial jsonb;
  bands jsonb;
  k text;
  n int;
  pn int := 0;
begin
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (
       select m.parid, m.address,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.score end as score,
              case when public.score_is_partial(m.municipality, m.zoning) then ''Partial'' else m.band end as band,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.range_lo end as range_lo,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.range_hi end as range_hi,
              m.preliminary, m.red_flag_count, m.red_flags,
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge,
              m.badge_score, m.badge_matches, m.factor_scores, m.best_strategy, m.vacant, m.owner_class, m.owner_type, m.owner_agency,
              case when m.owner_class = ''public'' then m.tax_delinquent end as tax_delinquent, m.zoning, m.neighborhood, m.council_district, m.municipality, m.lot_sqft, m.lon, m.lat,
              m.transit_m, m.hz_floodway, m.hz_landslide, m.hz_undermined, m.steep_share,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.cap_label end as cap_label,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.rehab_score end as rehab_score,
              case when public.score_is_partial(m.municipality, m.zoning) then null else m.rehab_band end as rehab_band,
              m.note, m.config_version, m.data_dates, m.computed_at
       from public.planner_rows(%L::jsonb) m
       where %L::jsonb->''bands'' is null or not public.score_is_partial(m.municipality, m.zoning)
       order by public.score_is_partial(m.municipality, m.zoning), m.%I %s nulls last, m.score desc nulls last, m.parid
       limit $1 offset $2) x', f::text, f::text, col, dir)
    using least(greatest(coalesce(p_limit, 50), 1), 10000), greatest(coalesce(p_offset, 0), 0)
    into rows;
  select c.summary into summary from public.planner_summary_cache c where c.filters = f;
  if summary is null then summary := public.planner_summary(f); end if;
  -- Partial parcels (zoning not loaded) are never counted in a band.
  execute format(
    'select coalesce(jsonb_object_agg(b, n), ''{}'') from (
       select coalesce(m.band, ''No score'') b, count(*)::int n from public.planner_rows(%L::jsonb) m
       where public.score_is_partial(m.municipality, m.zoning) group by 1) x', f::text)
    into partial;
  if partial <> '{}'::jsonb then
    bands := coalesce(summary->'bands', '{}');
    for k, n in select key, value::int from jsonb_each_text(partial) loop
      bands := case when coalesce((bands->>k)::int, 0) - n > 0 then jsonb_set(bands, array[k], to_jsonb(coalesce((bands->>k)::int, 0) - n)) else bands - k end;
      pn := pn + n;
    end loop;
    if f->'bands' is null then
      bands := bands || jsonb_build_object('Partial', pn);
    else
      summary := jsonb_set(summary, '{total}', to_jsonb(greatest((summary->>'total')::int - pn, 0)));
    end if;
    summary := jsonb_set(summary, '{bands}', bands);
  end if;
  return summary || jsonb_build_object('rows', rows);
end $function$;

CREATE OR REPLACE FUNCTION public.planner_points_live(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  -- Filters as a literal so unused ones fold away (see planner_summary). Partial parcels: no score, band 'Partial', last.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_array(parid, lon, lat, score, band, top_blocker, address, by_right_units, units_with_relief)
                              order by p, score desc nulls last, parid), ''[]'')
     from (select s.parid, s.lon, s.lat, public.score_is_partial(s.municipality, s.zoning) p,
                  case when public.score_is_partial(s.municipality, s.zoning) then null else s.score end score,
                  case when public.score_is_partial(s.municipality, s.zoning) then ''Partial'' else s.band end band,
                  s.top_blocker, s.address, s.by_right_units, s.units_with_relief
           from public.planner_rows(%L::jsonb) s
           where s.lon is not null
             and (%L::jsonb->''bands'' is null or not public.score_is_partial(s.municipality, s.zoning))
           order by public.score_is_partial(s.municipality, s.zoning), s.score desc nulls last, s.parid
           limit $1) x', coalesce(p_filters, '{}')::text, coalesce(p_filters, '{}')::text)
    using least(greatest(coalesce(p_limit, 12000), 1), 30000)
    into out;
  return out;
end $function$;

-- Cached map points (a handful of rows: all parcels and one per municipality) recomputed with the new rule.
update public.planner_summary_cache set points = public.planner_points_live(filters, 12000) where points is not null;
