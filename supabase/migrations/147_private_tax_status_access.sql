-- Privacy: the public (anon / authenticated) Data API can no longer read a private owner's tax status.
-- Tax status (county tax liens) is shown only for publicly owned land (parcel_scores.owner_class = 'public').
--
--   1. public.tax_delinquency: no access at all for anon / authenticated (RLS stays on).
--   2. parcel_scores, parcel_context, parcel_owner_class: SELECT is granted column by column, leaving out
--      the tax-status columns (parcel_scores.tax_delinquent and badge_matches, whose
--      "vacant_tax_delinquent" key is derived from tax status; parcel_context.tax_delinquent and
--      delinquency_band; parcel_owner_class.tax_delinquent). No data is changed or deleted.
--   3. Anon-callable functions that read those columns run as SECURITY DEFINER with a fixed search_path.
--      Their output is masked where it carried tax status:
--        nonprofit_sites  tax_delinquent only for public land
--        parcel_facts     context.tax_delinquent / delinquency_band only for public land
--        planner_query    badge_matches without "vacant_tax_delinquent" for non-public land
--                         (tax_delinquent was already masked to public land)
--      planner_summary, planner_points_live, planner_options_live, planner_other_public_land_summary:
--      SECURITY DEFINER only (ALTER, body unchanged); none returns tax status.
--   4. planner_rows returns raw parcel_scores rows, so anon / authenticated can no longer call it
--      directly (it is called only from the definer functions above). Its tax-delinquent filter now
--      matches public land only, so a filtered count cannot reveal a private owner's status.
--   5. planner_attach_owner_geo / planner_refresh_cache: no execute for PUBLIC / anon / authenticated.
--
-- WARNING: CREATE OR REPLACE FUNCTION resets SECURITY DEFINER to INVOKER. Any later redefinition of
-- nonprofit_sites, parcel_facts, planner_query, planner_summary, planner_points_live,
-- planner_options_live or planner_other_public_land_summary MUST restate
-- "security definer set search_path = public, extensions, pg_temp", or it will fail for anon
-- (column grants) or, worse, stop masking. Redefinitions of planner_rows must keep the public-only
-- tax filter; privileges survive CREATE OR REPLACE.
-- WARNING: a column added to parcel_scores / parcel_context / parcel_owner_class later is NOT readable
-- by anon until granted: "grant select (new_col) on public.<table> to anon, authenticated;".
--
-- ROLLBACK (restores the pre-147 access; run in one transaction):
--   begin;
--   grant select, references, trigger, truncate, maintain on public.tax_delinquency, public.parcel_scores,
--     public.parcel_context, public.parcel_owner_class to anon, authenticated;
--   -- The masked bodies below can stay: same signatures and output shape, only private tax values
--   -- are null / omitted. Access is restored by the grants above and these:
--   alter function public.planner_summary(jsonb) security invoker;
--   alter function public.planner_points_live(jsonb, integer) security invoker;
--   alter function public.planner_options_live() security invoker;
--   alter function public.planner_other_public_land_summary(jsonb) security invoker;
--   alter function public.planner_query(jsonb, integer, integer, text, text) security invoker;
--   alter function public.nonprofit_sites(text, boolean, boolean, boolean, integer, integer) security invoker;
--   grant execute on function public.planner_rows(jsonb) to anon, authenticated;
--   commit;
--   (parcel_facts was already SECURITY DEFINER before 147; leave it definer.)

begin;

-- 1. tax_delinquency: closed to the public API.
revoke all on table public.tax_delinquency from public, anon, authenticated;

-- 2. Column grants without the tax-status columns.
revoke all on table public.parcel_scores from public, anon, authenticated;
grant select (parid, config_version, best_strategy, score, band, range_lo, range_hi, preliminary,
              red_flag_count, red_flags, top_blocker, by_right_units, units_with_relief, months_to_permit,
              planning_badge, badge_score, factor_scores, vacant, owner_class, zoning, neighborhood,
              municipality, lot_sqft, lon, lat, address, data_dates, computed_at, note, rehab_score,
              rehab_band, blockers, transit_m, hz_floodway, hz_landslide, hz_undermined, steep_share,
              cap_label, owner_agency, council_district, owner_type)
  on public.parcel_scores to anon, authenticated;

revoke all on table public.parcel_context from public, anon, authenticated;
grant select (parid, muni_name, neighborhood, street_trees_15m, public_owner)
  on public.parcel_context to anon, authenticated;

revoke all on table public.parcel_owner_class from public, anon, authenticated;
grant select (parid, owner_class, agency_name, city_program, basis)
  on public.parcel_owner_class to anon, authenticated;

-- 3. Functions whose output carried tax status: re-created (masked) as SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.nonprofit_sites(p_hood text, p_public boolean DEFAULT true, p_vacant boolean DEFAULT true, p_clean boolean DEFAULT true, p_min_units integer DEFAULT 0, p_limit integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  with m as (
    select s.parid, s.address, s.score, s.band, s.best_strategy, s.by_right_units, s.units_with_relief,
           s.months_to_permit, s.red_flag_count, s.red_flags, s.top_blocker, s.zoning, s.lot_sqft,
           s.vacant, s.owner_class,
           case when s.owner_class = 'public' then s.tax_delinquent end as tax_delinquent,  -- private: never sent
           s.municipality, s.lon, s.lat, s.preliminary,
           coalesce(oc.agency_name, po.owner_category) as agency, oc.owner_class as agency_class, oc.city_program,
           po.status as agency_status
    from public.parcel_scores s
    left join public.public_owned po on po.parid = s.parid
    left join public.parcel_owner_class oc on oc.parid = s.parid
    where s.neighborhood = p_hood
      and (not p_public or s.owner_class = 'public')
      and (not p_vacant or s.vacant)
      and (not p_clean or s.red_flag_count = 0)
      and coalesce(s.by_right_units, 0) >= coalesce(p_min_units, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.score desc nulls last, r.by_right_units desc nulls last, r.parid)
      from (
        select m.*, pt.geoid, coalesce(d.qct, false) as qct, coalesce(d.dda, false) as dda
        from m
        left join public.parcel_tract pt on pt.parid = m.parid
        left join public.tract_designations d on d.geoid = pt.geoid
        order by m.score desc nulls last, m.by_right_units desc nulls last, m.parid
        limit greatest(1, least(coalesce(p_limit, 60), 200))
      ) r
    ), '[]'::jsonb)
  )
$function$;

CREATE OR REPLACE FUNCTION public.parcel_facts(p_parid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  p          record;
  a          record;
  area_m2    double precision;
  result     jsonb;
begin
  select * into p from public.parcels where parid = p_parid;
  if not found then
    return null;
  end if;
  select * into a from public.assessments where parid = p_parid;
  area_m2 := ST_Area(p.geom::geography);

  result := jsonb_build_object(
    'parid', p.parid,
    'lot_area_sqft_gis', round((area_m2 * 10.7639)::numeric, 0),
    'centroid', jsonb_build_object('lon', round(ST_X(p.centroid)::numeric, 6),
                                   'lat', round(ST_Y(p.centroid)::numeric, 6)),
    'assessment', case when a.parid is null then null else jsonb_build_object(
        'address', trim(concat_ws(' ', nullif(a.house_num, '0'), a.address)),
        'municipality', a.muni_desc, 'municode', a.municode,
        -- City of Pittsburgh = wards 101-132 (a name match would also catch East Pittsburgh, 822).
        'is_pittsburgh', a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$',
        'class', a.class_desc, 'use', a.use_desc, 'owner_type', a.owner_type,
        'lot_area_sqft', a.lot_area_sqft, 'year_built', nullif(a.year_built, 0),
        'stories', a.stories, 'living_area_sqft', a.living_area_sqft,
        'fmv_land', a.fmv_land, 'fmv_building', a.fmv_building, 'fmv_total', a.fmv_total,
        'condition', a.condition_desc, 'abatement', a.abatement, 'homestead', a.homestead,
        'last_sale_date', a.last_sale_date, 'last_sale_price', a.last_sale_price,
        'as_of', a.as_of_date,
        'source', 'Allegheny County Property Assessments') end,
    'zoning', (
      select jsonb_build_object('code', z.zone_code, 'type', z.zone_type,
                                'source', 'City of Pittsburgh Zoning Districts',
                                'rules', (select to_jsonb(r) - 'zone_code' from public.zoning_rules r
                                          where r.zone_code = z.zone_code))
      -- District covering the largest share of the lot (a centre point can land in a neighbouring district).
      from public.zoning z where ST_Intersects(z.geom, p.geom)
      order by ST_Area(ST_Intersection(z.geom, p.geom)) desc limit 1),
    -- Share of the lot (0-1) covered by each overlay feature.
    'overlays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'layer', o.layer, 'label', o.label, 'attrs', o.attrs,
               'share', round((ST_Area(ST_Intersection(o.geom, p.geom)::geography) / nullif(area_m2, 0))::numeric, 3))
             order by o.layer)
      from public.overlays o
      where ST_Intersects(o.geom, p.geom)
        and o.layer <> 'mine_map_sheets'  -- the sheet link is in the 'mines' block
        and not (o.layer = 'flood_fema_nfhl' and o.label = 'X'
                 and coalesce(o.attrs->>'subtype', '') not ilike '%0.2 PCT%')), '[]'::jsonb),
    'flood_1pct_share', coalesce((
      -- LEAST() ignores NULLs, so guard the no-overlap case explicitly.
      select case when count(*) = 0 then 0 else
               round(least(1.0, sum(ST_Area(ST_Intersection(o.geom, p.geom)::geography)) / nullif(area_m2, 0))::numeric, 3) end
      from public.overlays o
      where o.layer = 'flood_fema_nfhl' and o.label in ('A', 'AE') and ST_Intersects(o.geom, p.geom)), 0),
    'slope', (
      select jsonb_build_object('mean_pct', s.slope_mean_pct, 'steep_share', s.steep_share,
                                'cells', s.cells, 'resolution_m', 10, 'source', 'USGS 3DEP elevation')
      from public.parcel_slope s where s.parid = p.parid),
    'slope_1m', (
      select jsonb_build_object('mean_pct', s.mean_pct, 'max_pct', s.max_pct, 'p95_pct', s.p95_pct,
                                'share_over_15', s.share_over_15, 'share_over_25', s.share_over_25, 'share_over_40', s.share_over_40,
                                'steep_25', s.steep_25, 'cells', s.cells_1m, 'resolution_m', 1,
                                'source', 'USGS 3DEP 1 m lidar DEM (PA_WesternPA_2019)')
      from public.parcel_slope_1m s where s.parid = p.parid),
    'schools', (
      select to_jsonb(ps) - 'parid' from public.parcel_schools ps where ps.parid = p.parid),
    'transit', (
      select jsonb_build_object('nearest_frequent_stop_m', t.nearest_frequent_stop_m,
                                'nearest_any_stop_m', t.nearest_any_stop_m,
                                'frequent_stops_800m', t.frequent_stops_800m,
                                'source', 'Pittsburgh Regional Transit GTFS (weekday 7-9am)')
      from public.parcel_transit t where t.parid = p.parid),
    'tract', (
      select to_jsonb(t) - 'geom' from public.parcel_tract pt join public.tracts t using (geoid)
      where pt.parid = p.parid),
    'permits', jsonb_build_object(
      'count_5y', (select count(*) from public.permits pm where pm.parid = p.parid
                     and pm.issue_date >= current_date - interval '5 years'),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('type', permit_type, 'work', work_type,
                                                               'date', issue_date) order by issue_date desc)
                          from (select * from public.permits pm where pm.parid = p.parid
                                order by issue_date desc limit 5) x), '[]'::jsonb)),
    'context', (
      select jsonb_build_object('municipality', c.muni_name, 'neighborhood', c.neighborhood,
                                'street_trees_15m', c.street_trees_15m, 'public_owner', c.public_owner,
                                -- Tax status only for publicly owned land (parcel_scores.owner_class = 'public'); private lots get nulls.
                                'tax_delinquent', case when pub.is_public then c.tax_delinquent end,
                                'delinquency_band', case when pub.is_public then c.delinquency_band end,
                                'sources', 'County municipal boundaries; City neighborhoods & street trees; City-owned properties; County tax liens')
      from public.parcel_context c
      cross join lateral (select exists (select 1 from public.parcel_scores s
                                         where s.parid = p.parid and s.owner_class = 'public') as is_public) pub
      where c.parid = p.parid),
    -- Municipal sale requirements and combined realty transfer tax (state + municipality + school district).
    'muni_rules', (
      select to_jsonb(m) - 'muni_code' from public.muni_transfer_requirements m
      where m.muni_code = public.parcel_muni_code(a.municode)),
    'transfer_tax', (
      with parts as (
        select jurisdiction, jurisdiction_type, rate_pct, confidence from public.realty_transfer_tax
        where jurisdiction_type = 'state'
        union all
        select jurisdiction, jurisdiction_type, rate_pct, confidence from public.realty_transfer_tax
        where jurisdiction_type = 'municipality' and muni_code = public.parcel_muni_code(a.municode)
        union all
        (select jurisdiction, jurisdiction_type, rate_pct, confidence from public.realty_transfer_tax r
         where r.jurisdiction_type = 'school_district' and r.muni_code = public.parcel_muni_code(a.municode)
         order by (public.norm_district(split_part(r.jurisdiction, ' School District', 1))
                   = public.norm_district((select district from public.parcel_schools s where s.parid = p.parid))) desc
         limit 1))
      select jsonb_build_object('total_pct', sum(rate_pct), 'parts', jsonb_agg(to_jsonb(parts)),
                                'source', 'PA Dept. of Revenue; Allegheny County local realty transfer tax rates')
      from parts),
    -- 2026 millage: county + municipality (city wards roll up) + school district. Mills per $1,000 of assessed value.
    'property_tax', (
      with muni as (
        select case when exists (select 1 from public.millage m where m.jurisdiction_type = 'municipality' and m.code = a.municode) then a.municode
                    when a.municode ~ '^1[0-9]{2}$' then 'CITY_PGH'
                    when a.municode ~ '^2[0-9]{2}$' then 'CITY_CLAIRTON'
                    when a.municode ~ '^3[0-9]{2}$' then 'CITY_DUQUESNE'
                    when a.municode ~ '^4[0-9]{2}$' then 'CITY_MCKEESPORT' end as code),
      sd as (select district from public.parcel_schools s where s.parid = p.parid),
      parts as (
        select jurisdiction_type, name, rate_type, mills from public.millage where jurisdiction_type = 'county'
        union all
        select m.jurisdiction_type, m.name, m.rate_type, m.mills from public.millage m, muni
        where m.jurisdiction_type = 'municipality' and m.code = muni.code
        union all
        (select m.jurisdiction_type, m.name, m.rate_type, m.mills from public.millage m, sd
         where m.jurisdiction_type = 'school_district'
           and public.norm_district(sd.district) like public.norm_district(m.name) || '%'
         order by (public.norm_district(sd.district) = public.norm_district(m.name)) desc, length(m.name) desc
         limit 2))
      select jsonb_build_object(
        'year', 2026,
        'general_mills', sum(mills) filter (where rate_type = 'general'),
        'parts', jsonb_agg(to_jsonb(parts)),
        'split_rate', bool_or(rate_type in ('land', 'building')),
        'source', 'Allegheny County Treasurer 2026 millage listings')
      from parts),
    'tract_designations', (
      select to_jsonb(d) - 'geoid' from public.parcel_tract pt join public.tract_designations d using (geoid)
      where pt.parid = p.parid),
    'hud_fmr', (
      select jsonb_build_object('year', f.year, 'zip', f.zip, 'br0', f.br0, 'br1', f.br1, 'br2', f.br2,
                                'br3', f.br3, 'br4', f.br4,
                                'level', case when f.zip is null then 'metro' else 'small area (ZIP)' end,
                                'source', 'HUD Fair Market Rents')
      from public.hud_fmr f where f.zip = left(a.zip, 5) or f.zip is null
      order by (f.zip is null) limit 1),
    'flood_evidence', (
      select jsonb_build_object('floodway_share', f.floodway_share, 'sfha_share', f.sfha_share, 'x500_share', f.x500_share,
                                'tract_nfip_claims_10y', f.tract_nfip_claims_10y, 'tract_nfip_median_premium', f.tract_nfip_median_premium,
                                'tract_nfip_policies', f.tract_nfip_policies, 'flooding_311_5y_tract', f.flooding_311_5y_tract,
                                'in_combined_sewer', f.in_combined_sewer,
                                'sources', 'FEMA NFHL; OpenFEMA NFIP redacted policies & claims (aggregated by tract); Pittsburgh 311; PWSA/3RWW combined sewersheds')
      from public.parcel_flood f where f.parid = p.parid),
    'condemned', exists (select 1 from public.condemned c where c.parid = p.parid and c.status = 'Active'),
    -- Mine subsidence (040_parcel_mines). Mine maps are incomplete: no mapped mine is not proof of no mine.
    'mines', (
      select jsonb_build_object(
               'in_mined_out', pm.in_mined_out, 'mined_out_share', pm.mined_out_share,
               'dist_mined_out_ft', pm.dist_mined_out_ft, 'in_coal_bearing', pm.in_coal_bearing,
               'msi_risk', pm.msi_risk, 'in_city_undermined', pm.in_city_undermined,
               'mine_map_url', pm.mine_map_url,
               'mines_within_500ft', pm.sources->'mines_within_500ft',
               'seams_within_500ft', pm.sources->'seams_within_500ft',
               'mine_map_sheet', pm.sources->>'mine_map_sheet',
               'mine_map_pdf', pm.sources->>'mine_map_pdf',
               'sources', jsonb_build_object(
                 'mined_out', pm.sources->>'mined_out', 'coal_bearing', pm.sources->>'coal_bearing',
                 'city_undermined', pm.sources->>'city_undermined', 'mine_map', pm.sources->>'mine_map'),
               'caveat', 'Mine maps are incomplete; absence of a mapped mine is not proof that no mine exists.')
      from public.parcel_mines pm where pm.parid = p.parid)
  );
  -- Site facts used directly by requirement rules (buildings, streets, water, landslides, cleanup sites).
  result := result || coalesce((
    select jsonb_build_object(
      'building_footprint_sqft', ps.building_footprint_sqft,
      'shares_wall', ps.shares_wall,
      'street_frontage', ps.street_frontage,
      'landslides_within_300ft', ps.landslides_within_300ft,
      'red_bed_landslides_300ft', ps.red_bed_landslides_300ft,
      'streams_or_wetlands_within_100ft', ps.streams_within_100ft or ps.wetlands_within_100ft,
      'env_sites_within_500ft', ps.env_sites_within_500ft,
      'site', jsonb_build_object('building_count', ps.building_count, 'streams_within_100ft', ps.streams_within_100ft,
                                 'wetlands_within_100ft', ps.wetlands_within_100ft,
                                 'sources', 'County building footprints & centerlines; City centerlines (paper streets); county landslide inventory; USGS NHD; USFWS NWI; PA DEP Land Recycling; EPA ACRES'))
    from public.parcel_site ps where ps.parid = p.parid), '{}'::jsonb);
  -- Water / sewer service (081_utilities). Boundaries are approximate; sewer has no public
  -- service-area layer, so it stays 'unknown' rather than assumed served.
  result := result || jsonb_build_object('utilities', (
    select jsonb_build_object(
             'water', jsonb_build_object('served', u.water_served, 'system', u.water_system,
                                         'pwsid', u.water_pwsid, 'owner_type', w.owner_type,
                                         'dist_to_service_area_m', u.water_dist_m, 'source', u.water_source),
             'sewer', jsonb_build_object('served', u.sewer_served, 'status', u.sewer_status, 'source', u.sewer_source),
             'computed_at', u.computed_at,
             'caveat', 'Service-area maps are approximate and show where a public system serves, not whether this lot has a connection. Confirm with the utility.')
    from public.parcel_utilities u left join public.water_service_areas w on w.pwsid = u.water_pwsid
    where u.parid = p.parid));
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.planner_query(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'score'::text, p_dir text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
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
    'select coalesce(jsonb_agg(to_jsonb(x) - ''pk''), ''[]'') from (
       select m.parid, m.address,
              case when q.reason is not null then null else m.score end as score,
              case when q.reason is not null then ''Partial'' else m.band end as band,
              q.reason as partial_reason, q.use_desc as partial_use,
              case when q.reason is not null then null else m.range_lo end as range_lo,
              case when q.reason is not null then null else m.range_hi end as range_hi,
              m.preliminary, m.red_flag_count, m.red_flags,
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge,
              m.badge_score,
              case when m.owner_class = ''public'' then m.badge_matches else m.badge_matches - ''vacant_tax_delinquent'' end as badge_matches,
              m.factor_scores,
              case when q.reason is not null then null else m.best_strategy end as best_strategy,
              case when q.reason in (''use'', ''footprint'') then false else m.vacant end as vacant,
              m.owner_class, m.owner_type, m.owner_agency,
              case when m.owner_class = ''public'' then m.tax_delinquent end as tax_delinquent, m.zoning, m.neighborhood, m.council_district, m.municipality, m.lot_sqft, m.lon, m.lat,
              m.transit_m, m.hz_floodway, m.hz_landslide, m.hz_undermined, m.steep_share,
              case when q.reason is not null then null else m.cap_label end as cap_label,
              case when q.reason is not null then null else m.rehab_score end as rehab_score,
              case when q.reason is not null then null else m.rehab_band end as rehab_band,
              m.note, m.config_version, m.data_dates, m.computed_at
       from public.planner_rows(%L::jsonb) m
       left join lateral (select case when public.score_is_partial(m.municipality, m.zoning) then ''zoning'' when u.parid is not null then u.reason end reason, u.use_desc
                          from (select 1) one left join public.planner_building_unscored u on u.parid = m.parid) q on true
       where %L::jsonb->''bands'' is null or q.reason is null
       order by (q.reason is not null), m.%I %s nulls last, m.score desc nulls last, m.by_right_units desc nulls last, m.months_to_permit asc nulls last, m.parid
       limit $1 offset $2) x', f::text, f::text, col, dir)
    using least(greatest(coalesce(p_limit, 50), 1), 10000), greatest(coalesce(p_offset, 0), 0)
    into rows;
  select c.summary into summary from public.planner_summary_cache c where c.filters = f;
  if summary is null then summary := public.planner_summary(f); end if;
  -- Partial parcels are never counted in a band.
  execute format(
    'select coalesce(jsonb_object_agg(b, n), ''{}'') from (
       select coalesce(m.band, ''No score'') b, count(*)::int n from public.planner_rows(%L::jsonb) m
       left join public.planner_building_unscored u on u.parid = m.parid
       where public.score_is_partial(m.municipality, m.zoning) or u.parid is not null group by 1) x', f::text)
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

-- 3b. Read-only functions with no tax status in their output: definer, body unchanged.
alter function public.planner_summary(jsonb) security definer set search_path = public, extensions, pg_temp;
alter function public.planner_points_live(jsonb, integer) security definer set search_path = public, extensions, pg_temp;
alter function public.planner_options_live() security definer set search_path = public, extensions, pg_temp;
alter function public.planner_other_public_land_summary(jsonb) security definer set search_path = public, extensions, pg_temp;

-- 4. planner_rows returns raw rows: internal only.
revoke execute on function public.planner_rows(jsonb) from public, anon, authenticated;

-- 5. Batch / admin functions.
revoke execute on function public.planner_attach_owner_geo(integer, integer) from public, anon, authenticated;
revoke execute on function public.planner_refresh_cache() from public, anon, authenticated;

commit;
