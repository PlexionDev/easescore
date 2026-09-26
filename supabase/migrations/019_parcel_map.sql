-- parcel_map(parid): GeoJSON for the map around one parcel (within ~250 m), simplified for display.
-- Each feature carries "kind" so the map can style and toggle it.
create or replace function public.parcel_map(p_parid text, p_radius_m numeric default 250)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  subj  record;
  deg   double precision;
  area  geometry;
  feats jsonb;
begin
  select parid, geom, centroid into subj from parcels where parid = p_parid;
  if not found then return null; end if;
  deg := p_radius_m / 84000.0;
  area := ST_Expand(subj.geom, deg);

  with f as (
    select 'parcel' kind, subj.parid::text id, null::text label, subj.geom g, null::text height_source
    union all
    select 'neighbor', p.parid, null, ST_SimplifyPreserveTopology(p.geom, 0.000003), null
      from parcels p where p.geom && area and p.parid <> subj.parid
    union all
    -- Height measured from USGS lidar (building_heights) when available; otherwise estimated from the
    -- county-recorded story count (3.2 m per story + 1.5 m roof), 2 stories if unknown.
    select 'building', b.id::text,
           round(coalesce(h.height_m, coalesce(nullif(a.stories, 0), 2) * 3.2 + 1.5)::numeric, 1)::text,
           ST_SimplifyPreserveTopology(b.geom, 0.000003),
           case when h.height_m is not null then 'lidar' else 'estimate' end
      from buildings b
      left join assessments a on a.parid = b.parid
      left join building_heights h on h.building_id = b.id
      where b.geom && area
    union all
    select 'zoning', z.id::text, z.zone_code, ST_Intersection(ST_SimplifyPreserveTopology(z.geom, 0.00001), area), null
      from zoning z where z.geom && area
    union all
    select case when o.layer = 'flood_fema_nfhl' then
                  case when o.attrs->>'subtype' = 'FLOODWAY' then 'floodway'
                       when o.label in ('A', 'AE') then 'flood_100'
                       else 'flood_500' end
                else o.layer end,
           o.layer || ':' || o.source_id, o.label, ST_Intersection(ST_SimplifyPreserveTopology(o.geom, 0.00001), area), null
      from overlays o
      where o.geom && area
        and o.layer in ('flood_fema_nfhl', 'landslide_prone_pgh', 'undermined_pgh', 'mined_out_dep', 'landslide_recorded',
                        'historic_district_pgh', 'wetland_nwi', 'greenway_pgh', 'combined_sewer')
        and not (o.layer = 'flood_fema_nfhl' and o.label = 'X' and coalesce(o.attrs->>'subtype', '') not ilike '%0.2 PCT%')
    union all
    select 'street', s.id::text, s.name, ST_Intersection(s.geom, area), null from streets s where s.geom && area
    union all
    select 'stream', s.id::text, s.name, ST_Intersection(s.geom, area), null from streams s where s.geom && area
  )
  select jsonb_agg(jsonb_build_object(
           'type', 'Feature',
           'properties', jsonb_build_object('kind', kind, 'id', id, 'label', label,
                                            'height_m', case when kind = 'building' then label::numeric end,
                                            'height_source', height_source),
           'geometry', ST_AsGeoJSON(g, 7)::jsonb))
    into feats
  from f where g is not null and not ST_IsEmpty(g);

  return jsonb_build_object(
    'type', 'FeatureCollection',
    'bbox', jsonb_build_array(ST_XMin(area), ST_YMin(area), ST_XMax(area), ST_YMax(area)),
    'center', jsonb_build_array(ST_X(subj.centroid), ST_Y(subj.centroid)),
    'features', coalesce(feats, '[]'::jsonb));
end $$;

revoke all on function public.parcel_map(text, numeric) from public;
grant execute on function public.parcel_map(text, numeric) to anon, authenticated, service_role;
