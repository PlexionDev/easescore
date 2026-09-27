-- Planner equity rule: the tax-delinquent filter applies to publicly owned land only, to avoid targeting
-- private owners in distress.
--  * planner_rows(): with tax_delinquent on, only publicly owned parcels (owner_class 'public': City, URA /
--    Land Bank, HACP, County, other public) pass. Every other key is unchanged from migration 131.
--  * planner_query(): rows carry tax_delinquent only for publicly owned parcels (null otherwise), so the
--    table, CSV and staff memo never show a private owner's delinquency. Otherwise unchanged.
-- Same signatures; CREATE OR REPLACE keeps the grants. No data is rewritten.

CREATE OR REPLACE FUNCTION public.planner_rows(f jsonb)
 RETURNS SETOF parcel_scores
 LANGUAGE sql
 STABLE
AS $function$
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
    -- Tax delinquency only ever narrows publicly owned land (never private owners in distress).
    and (coalesce((f->>'tax_delinquent')::boolean, false) = false or (s.tax_delinquent and s.owner_class = 'public'))
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
    -- Block conformity (migration 130): the lot's block face has 3+ measured buildings and at least
    -- this share of them would not meet today's code.
    and (f->>'block_nonconform_min' is null or exists (
          select 1 from public.parcel_block_face pb join public.block_faces bf on bf.face_id = pb.face_id
          where pb.parid = s.parid and bf.n_buildings >= 3 and bf.nonconform_share >= (f->>'block_nonconform_min')::numeric))
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0
             and (case when s.top_blocker = 'Low market activity' then s.blockers else array_remove(s.blockers, 'Low market activity') end)
                 <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$function$;

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
begin
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (
       select m.parid, m.address, m.score, m.band, m.range_lo, m.range_hi, m.preliminary, m.red_flag_count, m.red_flags,
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge,
              m.badge_score, m.badge_matches, m.factor_scores, m.best_strategy, m.vacant, m.owner_class, m.owner_type, m.owner_agency,
              case when m.owner_class = ''public'' then m.tax_delinquent end as tax_delinquent, m.zoning, m.neighborhood, m.council_district, m.municipality, m.lot_sqft, m.lon, m.lat,
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
end $function$;

-- Cached summaries computed under the old rule (small table, one statement).
delete from public.planner_summary_cache where filters ? 'tax_delinquent';
