-- parcel_quickfit_input(parid): everything the QuickFit solver needs for one parcel, in FEET.
-- Coordinates: PA State Plane South (EPSG:2272, US survey feet), shifted so the parcel centroid is
-- (0, 0). "toLonLat" gives the affine to convert solver output back to lon/lat for the map.
create or replace function public.parcel_quickfit_input(p_parid text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  g        geometry;   -- largest piece of the parcel, EPSG:2272
  o        geometry;   -- origin (centroid), EPSG:2272
  ring     geometry;
  pts      jsonb;
  edges    jsonb;
  fronts   int[];
  sides    int[];
  masks    jsonb;
  zba      jsonb;
  o_ll     geometry;
  ex       geometry;
  ny       geometry;
  a        jsonb;
  pieces   int;
begin
  select ST_ForcePolygonCCW(ST_SimplifyPreserveTopology(ST_Transform(d.geom, 2272), 0.5))
    into g
  from parcels p, ST_Dump(p.geom) d where p.parid = p_parid
  order by ST_Area(d.geom) desc limit 1;
  if g is null then return null; end if;
  select ST_NumGeometries(geom) into pieces from parcels where parid = p_parid;
  o := ST_Centroid(g);
  ring := ST_ExteriorRing(g);

  -- Vertices relative to the origin (open ring).
  select jsonb_agg(jsonb_build_array(round((ST_X(dp.geom) - ST_X(o))::numeric, 2), round((ST_Y(dp.geom) - ST_Y(o))::numeric, 2)) order by dp.path[1])
    into pts
  from ST_DumpPoints(ring) dp where dp.path[1] < ST_NPoints(ring);

  -- Edges with length and distance from the edge midpoint to the nearest opened street centerline.
  with e as (
    select i - 1 idx,
           ST_MakeLine(ST_PointN(ring, i), ST_PointN(ring, i + 1)) seg
    from generate_series(1, ST_NPoints(ring) - 1) i
  ), m as (
    select idx, ST_Length(seg) len,
           degrees(ST_Azimuth(ST_StartPoint(seg), ST_EndPoint(seg))) az,
           (select min(ST_Distance(ST_Transform(s.geom, 2272), ST_LineInterpolatePoint(seg, 0.5)))
              from streets s
             where coalesce(s.paper_or_vacated, false) = false
               and ST_DWithin(s.geom, ST_Transform(ST_LineInterpolatePoint(seg, 0.5), 4326), 0.0012)) dist_ft
    from e
  )
  select jsonb_agg(jsonb_build_object('i', idx, 'len', round(len::numeric, 1), 'az', round(az::numeric, 1), 'street_ft', round(dist_ft::numeric, 1)) order by idx)
    into edges from m;

  -- Front = the edge nearest a street (≥ 8 ft long, within 45 ft of a centerline) plus edges roughly
  -- parallel to it; other near-street edges are street sides (corner lots).
  with c as (
    select (x->>'i')::int i, (x->>'len')::numeric len, (x->>'az')::numeric az, (x->>'street_ft')::numeric d
    from jsonb_array_elements(edges) x
    -- centerline within 45 ft of the edge midpoint ≈ the edge abuts that street's right-of-way
    where (x->>'street_ft') is not null and (x->>'street_ft')::numeric <= 45 and (x->>'len')::numeric >= 8
  ), f as (select * from c order by d, len desc limit 1)
  select array_agg(c.i order by c.d) filter (where abs(mod((c.az - f.az + 540)::numeric, 180) - 0) < 30 or abs(mod((c.az - f.az + 540)::numeric, 180) - 180) < 30),
         array_agg(c.i order by c.d) filter (where not (abs(mod((c.az - f.az + 540)::numeric, 180)) < 30 or abs(mod((c.az - f.az + 540)::numeric, 180) - 180) < 30))
    into fronts, sides
  from c, f;

  -- Masks: floodway is cut from the envelope; hazard overlays only flag.
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'mode', mode, 'polygon', poly)), '[]')
    into masks
  from (
    select case when o2.attrs->>'subtype' = 'FLOODWAY' then 'FEMA floodway'
                when o2.layer = 'landslide_prone_pgh' then 'Landslide-prone overlay (§906.04)'
                when o2.layer = 'undermined_pgh' then 'Undermined overlay (§906.05)' end label,
           case when o2.attrs->>'subtype' = 'FLOODWAY' then 'cut' else 'flag' end mode,
           (select jsonb_agg(r.ring) from (
              select jsonb_agg(jsonb_build_array(round((ST_X(dp.geom) - ST_X(o))::numeric, 2), round((ST_Y(dp.geom) - ST_Y(o))::numeric, 2)) order by dp.path[2]) ring
              from ST_DumpPoints(ST_ForcePolygonCCW(dd.geom)) dp group by dp.path[1] order by dp.path[1]) r) poly
    from overlays o2,
         ST_Dump(ST_Intersection(ST_Transform(o2.geom, 2272), g)) dd
    where ST_Intersects(o2.geom, ST_Transform(g, 4326))
      and ((o2.layer = 'flood_fema_nfhl' and o2.attrs->>'subtype' = 'FLOODWAY')
           or o2.layer in ('landslide_prone_pgh', 'undermined_pgh'))
      and ST_GeometryType(dd.geom) = 'ST_Polygon' and ST_Area(dd.geom) > 1
  ) m;

  -- Historical ZBA outcomes by relief type and code section (for variance odds).
  select coalesce(jsonb_agg(jsonb_build_object('reliefType', relief_type, 'codeSection', code_section, 'granted', g2, 'denied', d2)), '[]')
    into zba
  from (select relief_type, code_section,
               count(*) filter (where outcome ilike 'grant%') g2, count(*) filter (where outcome ilike 'den%') d2
        from zoning_requests where relief_type is not null and code_section is not null
        group by 1, 2) z;

  -- Affine to convert solver feet back to lon/lat around the origin.
  o_ll := ST_Transform(o, 4326);
  ex := ST_Transform(ST_Translate(o, 1000, 0), 4326);
  ny := ST_Transform(ST_Translate(o, 0, 1000), 4326);
  a := jsonb_build_object('lon0', ST_X(o_ll), 'lat0', ST_Y(o_ll),
         'lon_per_x', (ST_X(ex) - ST_X(o_ll)) / 1000, 'lat_per_x', (ST_Y(ex) - ST_Y(o_ll)) / 1000,
         'lon_per_y', (ST_X(ny) - ST_X(o_ll)) / 1000, 'lat_per_y', (ST_Y(ny) - ST_Y(o_ll)) / 1000);

  return jsonb_build_object(
    'units', 'ft', 'crs', 'EPSG:2272 shifted to centroid',
    'parcel', pts, 'edges', edges,
    'frontEdges', coalesce(to_jsonb(fronts), '[]'), 'streetSideEdges', coalesce(to_jsonb(sides), '[]'),
    'masks', masks, 'zbaCounts', zba, 'toLonLat', a,
    'pieces', pieces,
    'notes', jsonb_build_array(
      case when pieces > 1 then format('This parcel has %s separate pieces; QuickFit uses the largest one.', pieces) end,
      'Front edges are inferred from the nearest opened street centerline; confirm on a survey.',
      'Only the FEMA floodway is cut from the buildable area; steep-slope areas are not cut yet.') - 'null');
end $$;

revoke all on function public.parcel_quickfit_input(text) from public;
grant execute on function public.parcel_quickfit_input(text) to anon, authenticated, service_role;
