-- parcel_facts(parid): every fact the score and requirements engines use, as one JSON object.
-- Deterministic and read-only. Each block carries its source so the UI can cite it.
-- Layers added later (buildings, streets, geology, soils, ...) extend this function.
-- County municipal code for a parcel: city wards (e.g. Pittsburgh 101-132) roll up to the city code.
create or replace function public.parcel_muni_code(m text) returns text
language sql stable set search_path = public as $$
  select case when exists (select 1 from public.municipalities where muni_code = m) then m
              when m ~ '^[0-9]+$' then ((m::int / 100) * 100)::text end
$$;

create or replace function public.parcel_facts(p_parid text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
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
                                'tax_delinquent', c.tax_delinquent, 'delinquency_band', c.delinquency_band,
                                'sources', 'County municipal boundaries; City neighborhoods & street trees; City-owned properties; County tax liens')
      from public.parcel_context c where c.parid = p.parid),
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
end $$;

revoke all on function public.parcel_facts(text) from public;
grant execute on function public.parcel_facts(text) to anon, authenticated, service_role;
