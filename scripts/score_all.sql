-- Bulk score inputs for scripts/score_all.ts: one row per parcel in a hash bucket, carrying the
-- slices of parcel_facts / parcel_quickfit_input / parcel_ease_inputs that the Ease Score reads.
-- Same tables and rules as those functions (supabase/migrations 010, 025, 080), written set-based:
--   * overlays: only the layers the score and the geotech rule read (landslide-prone, undermined,
--     1982 slope movement, historic districts, FEMA floodway), same share arithmetic;
--   * zoning: the district covering the largest share of the lot (rules are attached in the script);
--   * QuickFit: largest piece, 0.5 ft simplification, edges with distance to opened streets, masks
--     (front / street-side edges are picked in the script with the same rule as the SQL function);
--   * market: sale and completed-permit points are indexed once per call; the percentile rank
--     against market_activity_sample is computed in the script with the same formula.
-- Placeholders: {{WHERE}} filters public.assessments a / public.parcels p.

create temp table _sp as
  select q.centroid g from public.parcels q join public.sales_valid s on s.parid = q.parid
  where s.price >= 1000 and s.sale_date >= current_date - interval '3 years';
create index on _sp using gist (g);
create temp table _pp as
  select q.centroid g from public.parcels q join public.permits pm on pm.parid = q.parid
  where pm.status = 'Completed' and pm.permit_type in ('BUILDING', 'Building & Development Application')
    and pm.issue_date >= current_date - interval '3 years';
create index on _pp using gist (g);
analyze _sp;
analyze _pp;

with b as (
  select p.parid, p.geom, p.centroid, ST_Area(p.geom::geography) area_m2, a.house_num, a.address, a.muni_desc, a.municode,
         a.class_desc, a.use_desc, a.lot_area_sqft, a.year_built, a.fmv_building, a.condition_desc, a.as_of_date,
         a.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$' pgh
  from public.parcels p join public.assessments a using (parid)
  where {{WHERE}}
)
select b.parid,
  jsonb_build_object(
    'parid', b.parid,
    'lot_area_sqft_gis', round((b.area_m2 * 10.7639)::numeric, 0),
    'centroid', jsonb_build_object('lon', round(ST_X(b.centroid)::numeric, 6), 'lat', round(ST_Y(b.centroid)::numeric, 6)),
    'assessment', jsonb_build_object(
        'address', trim(concat_ws(' ', nullif(b.house_num, '0'), b.address)),
        'municipality', b.muni_desc, 'municode', b.municode, 'is_pittsburgh', b.pgh,
        'class', b.class_desc, 'use', b.use_desc,
        'lot_area_sqft', b.lot_area_sqft, 'year_built', nullif(b.year_built, 0),
        'fmv_building', b.fmv_building, 'condition', b.condition_desc, 'as_of', b.as_of_date),
    'zoning', (
      select jsonb_build_object('code', z.zone_code, 'type', z.zone_type)
      from public.zoning z where ST_Intersects(z.geom, b.geom)
      order by ST_Area(ST_Intersection(z.geom, b.geom)) desc limit 1),
    'overlays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'layer', o.layer, 'label', o.label,
               'attrs', case when o.layer = 'flood_fema_nfhl' then jsonb_build_object('subtype', o.attrs->>'subtype') end,
               'share', round((ST_Area(ST_Intersection(o.geom, b.geom)::geography) / nullif(b.area_m2, 0))::numeric, 3))
             order by o.layer)
      from public.overlays o
      where ST_Intersects(o.geom, b.geom)
        and (o.layer in ('landslide_prone_pgh', 'undermined_pgh', 'landslide_recorded', 'historic_district_pgh')
             or (o.layer = 'flood_fema_nfhl' and upper(o.attrs->>'subtype') = 'FLOODWAY'))), '[]'::jsonb),
    'flood_1pct_share', case when fl.parid is null then coalesce((
      select case when count(*) = 0 then 0 else
               round(least(1.0, sum(ST_Area(ST_Intersection(o.geom, b.geom)::geography)) / nullif(b.area_m2, 0))::numeric, 3) end
      from public.overlays o
      where o.layer = 'flood_fema_nfhl' and o.label in ('A', 'AE') and ST_Intersects(o.geom, b.geom)), 0) end,
    'slope', (select jsonb_build_object('steep_share', s.steep_share, 'resolution_m', 10)
              from public.parcel_slope s where s.parid = b.parid),
    'slope_1m', (select jsonb_build_object('share_over_25', s.share_over_25, 'resolution_m', 1)
                 from public.parcel_slope_1m s where s.parid = b.parid),
    'transit', (select jsonb_build_object('nearest_frequent_stop_m', t.nearest_frequent_stop_m)
                from public.parcel_transit t where t.parid = b.parid),
    'context', (select jsonb_build_object('municipality', c.muni_name, 'neighborhood', c.neighborhood,
                                          'public_owner', c.public_owner, 'tax_delinquent', c.tax_delinquent)
                from public.parcel_context c where c.parid = b.parid),
    'tract_designations', (select to_jsonb(d) - 'geoid' from public.parcel_tract pt join public.tract_designations d using (geoid)
                           where pt.parid = b.parid),
    'flood_evidence', case when fl.parid is not null then jsonb_build_object(
        'floodway_share', fl.floodway_share, 'sfha_share', fl.sfha_share, 'in_combined_sewer', fl.in_combined_sewer) end,
    'condemned', exists (select 1 from public.condemned c where c.parid = b.parid and c.status = 'Active'),
    'mines', (select jsonb_build_object('in_mined_out', pm.in_mined_out, 'in_city_undermined', pm.in_city_undermined)
              from public.parcel_mines pm where pm.parid = b.parid),
    'utilities', (select jsonb_build_object(
                    'water', jsonb_build_object('served', u.water_served),
                    'sewer', jsonb_build_object('served', u.sewer_served, 'status', u.sewer_status))
                  from public.parcel_utilities u where u.parid = b.parid)
  ) || coalesce((
    select jsonb_build_object(
      'building_footprint_sqft', ps.building_footprint_sqft, 'shares_wall', ps.shares_wall,
      'street_frontage', ps.street_frontage, 'landslides_within_300ft', ps.landslides_within_300ft,
      'red_bed_landslides_300ft', ps.red_bed_landslides_300ft)
    from public.parcel_site ps where ps.parid = b.parid), '{}'::jsonb) as facts,
  (select jsonb_build_object(
      'parcel', (select jsonb_agg(jsonb_build_array(round((ST_X(dp.geom) - ST_X(g.o))::numeric, 2), round((ST_Y(dp.geom) - ST_Y(g.o))::numeric, 2)) order by dp.path[1])
                 from ST_DumpPoints(g.ring) dp where dp.path[1] < ST_NPoints(g.ring)),
      'edges', (select jsonb_agg(jsonb_build_object('i', idx, 'len', round(len::numeric, 1), 'az', round(az::numeric, 1), 'street_ft', round(dist_ft::numeric, 1)) order by idx)
                from (select e.idx, ST_Length(e.seg) len, degrees(ST_Azimuth(ST_StartPoint(e.seg), ST_EndPoint(e.seg))) az,
                             (select min(ST_Distance(ST_Transform(s.geom, 2272), ST_LineInterpolatePoint(e.seg, 0.5)))
                                from public.streets s
                               where coalesce(s.paper_or_vacated, false) = false
                                 and ST_DWithin(s.geom, ST_Transform(ST_LineInterpolatePoint(e.seg, 0.5), 4326), 0.0012)) dist_ft
                      from (select i - 1 idx, ST_MakeLine(ST_PointN(g.ring, i), ST_PointN(g.ring, i + 1)) seg
                            from generate_series(1, ST_NPoints(g.ring) - 1) i) e) m),
      'masks', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'mode', mode, 'polygon', poly)), '[]')
                from (select case when o2.attrs->>'subtype' = 'FLOODWAY' then 'FEMA floodway'
                                  when o2.layer = 'landslide_prone_pgh' then 'Landslide-prone overlay (§906.04)'
                                  when o2.layer = 'undermined_pgh' then 'Undermined overlay (§906.05)' end label,
                             case when o2.attrs->>'subtype' = 'FLOODWAY' then 'cut' else 'flag' end mode,
                             (select jsonb_agg(r.ring) from (
                                select jsonb_agg(jsonb_build_array(round((ST_X(dp.geom) - ST_X(g.o))::numeric, 2), round((ST_Y(dp.geom) - ST_Y(g.o))::numeric, 2)) order by dp.path[2]) ring
                                from ST_DumpPoints(ST_ForcePolygonCCW(dd.geom)) dp group by dp.path[1] order by dp.path[1]) r) poly
                      from public.overlays o2,
                           ST_Dump(ST_Intersection(ST_Transform(o2.geom, 2272), g.g)) dd
                      where ST_Intersects(o2.geom, ST_Transform(g.g, 4326))
                        and ((o2.layer = 'flood_fema_nfhl' and o2.attrs->>'subtype' = 'FLOODWAY')
                             or o2.layer in ('landslide_prone_pgh', 'undermined_pgh'))
                        and ST_GeometryType(dd.geom) = 'ST_Polygon' and ST_Area(dd.geom) > 1) mm))
   from (select g0.g, ST_Centroid(g0.g) o, ST_ExteriorRing(g0.g) ring
         from (select ST_ForcePolygonCCW(ST_SimplifyPreserveTopology(ST_Transform(d.geom, 2272), 0.5)) g
               from ST_Dump(b.geom) d order by ST_Area(d.geom) desc limit 1) g0) g) as qf,
  jsonb_build_object(
    'on_parcel', (select count(*) from public.env_sites e where ST_Intersects(e.geom, b.geom)),
    'adjacent_50ft', (select count(*) from public.env_sites e
                      where ST_DWithin(e.geom, b.geom, 0.0003) and ST_DWithin(e.geom::geography, b.geom::geography, 15.24)),
    'active_on_parcel', (select count(*) from public.env_sites e
                         where ST_Intersects(e.geom, b.geom) and (e.status is null or e.status = 'ACTIVE')),
    'active_on_or_adjacent', (select count(*) from public.env_sites e
                              where ST_DWithin(e.geom, b.geom, 0.0003) and ST_DWithin(e.geom::geography, b.geom::geography, 15.24)
                                and (e.status is null or e.status = 'ACTIVE')),
    'sales', (select count(*) from _sp where ST_DWithin(_sp.g, b.centroid, 0.012)
                and ST_DWithin(_sp.g::geography, b.centroid::geography, 804.67)),
    'permits', case when b.pgh then (select count(*) from _pp where ST_DWithin(_pp.g, b.centroid, 0.012)
                and ST_DWithin(_pp.g::geography, b.centroid::geography, 804.67)) end
  ) as ease
from b
left join public.parcel_flood fl on fl.parid = b.parid;
