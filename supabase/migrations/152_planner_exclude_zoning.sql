-- Developer "Neighborhood infill" filter (judge walkthrough item 1c): planner_rows() accepts one new
-- optional key, exclude_zoning (a JSON array of zoning codes), and leaves out parcels in those
-- districts. The web app sends the downtown / high-density list (HIGH_DENSITY_ZONES in
-- web/src/lib/planner-query.ts: GT-A..GT-E, RIV-MU, RIV-IMU, RIV-NS, RIV-RM, UC-MU, UC-E, UPR-A, RM-H,
-- RM-VH, SP-*) when the filter is on. Parcels with no zoning on file are kept.
--
-- This body is the live definition (pg_get_functiondef on 2026-09-27) with that one condition added;
-- nothing else changes. planner_rows is plain LANGUAGE sql STABLE (no SECURITY DEFINER, no SET clause,
-- so it still inlines); CREATE OR REPLACE keeps its owner and grants. planner_query / planner_summary /
-- planner_points_live (SECURITY DEFINER per 147/150, with their masked fields) are not touched.

CREATE OR REPLACE FUNCTION public.planner_rows(f jsonb)
 RETURNS SETOF parcel_scores
 LANGUAGE sql
 STABLE
AS $function$
  select s.* from public.parcel_scores s
  where not exists (select 1 from public.planner_other_public_land x where x.parid = s.parid)
    and (f->>'municipality' is null or s.municipality = f->>'municipality')
    and (f->>'council_district' is null or s.council_district = f->>'council_district')
    -- "= any (array(...))" runs the list once (an init plan) and can use the column's index.
    and (f->'neighborhoods' is null or s.neighborhood = any (array(select jsonb_array_elements_text(f->'neighborhoods'))))
    and (f->'zoning' is null or s.zoning = any (array(select jsonb_array_elements_text(f->'zoning'))))
    -- Neighborhood infill (Developer): leave out the listed downtown / high-density districts. Lots with no
    -- zoning on file (outside the City) are kept.
    and (f->'exclude_zoning' is null or s.zoning is null or not (s.zoning = any (array(select jsonb_array_elements_text(f->'exclude_zoning')))))
    and (f->'bands' is null or s.band = any (array(select jsonb_array_elements_text(f->'bands'))))
    and (f->'parids' is null or s.parid = any (array(select jsonb_array_elements_text(f->'parids'))::char(16)[]))
    and (f->>'lot_min' is null or s.lot_sqft >= (f->>'lot_min')::numeric)
    and (f->>'lot_max' is null or s.lot_sqft <= (f->>'lot_max')::numeric)
    and (f->>'vacant' is null or s.vacant = (f->>'vacant')::boolean)
    and (f->>'owner' is null or s.owner_class = f->>'owner')
    and (f->'owner_types' is null or s.owner_type = any (array(select jsonb_array_elements_text(f->'owner_types'))))
    -- Tax-delinquent filter matches publicly owned land only, so it cannot reveal a private owner's status.
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
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0
             and (case when s.top_blocker = 'Low market activity' then s.blockers else array_remove(s.blockers, 'Low market activity') end)
                 <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$function$;
