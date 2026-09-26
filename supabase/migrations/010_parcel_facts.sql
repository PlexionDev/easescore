-- parcel_facts(parid): every fact the score and requirements engines use, as one JSON object.
-- Deterministic and read-only. Each block carries its source so the UI can cite it.
-- Layers added later (buildings, streets, geology, soils, ...) extend this function.
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
        'is_pittsburgh', a.muni_desc ilike '%PITTSBURGH%',
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
                                'source', 'City of Pittsburgh Zoning Districts')
      from public.zoning z where ST_Intersects(z.geom, p.centroid) limit 1),
    -- Share of the lot (0-1) covered by each overlay feature.
    'overlays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'layer', o.layer, 'label', o.label, 'attrs', o.attrs,
               'share', round((ST_Area(ST_Intersection(o.geom, p.geom)::geography) / nullif(area_m2, 0))::numeric, 3))
             order by o.layer)
      from public.overlays o
      where ST_Intersects(o.geom, p.geom)
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
    'condemned', exists (select 1 from public.condemned c where c.parid = p.parid and c.status = 'Active')
  );
  return result;
end $$;

revoke all on function public.parcel_facts(text) from public;
grant execute on function public.parcel_facts(text) to anon, authenticated, service_role;
