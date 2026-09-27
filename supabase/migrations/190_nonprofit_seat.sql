-- Nonprofit / CDC seat (/nonprofit): three read-only functions over tables that already exist.
--   nonprofit_area(p_hood)   -- one City neighborhood: outline, bbox and the census tracts it covers
--                               (ACS columns of public.tracts and public.acs_tract, HUD CHAS counts from
--                               public.chas_tract, HUD QCT/DDA designations), with the share of the
--                               neighborhood each tract covers; plus LIHTC projects within half a mile.
--   nonprofit_tract_map()    -- every tract, simplified, for the need map (choropleth).
--   nonprofit_sites(...)     -- candidate lots in a neighborhood from the precomputed parcel_scores,
--                               with the owning agency (public_owned) and the tract's QCT/DDA flags.
-- Census variables are returned for display only; they never feed a parcel score. Race/ethnicity
-- columns are not read here at all.

create or replace function public.nonprofit_area(p_hood text)
returns jsonb language sql stable security invoker as $$
  with h as (
    select name, geom from public.neighborhoods where lower(name) = lower(p_hood) limit 1
  ), t as (
    select t.geoid, t.name, t.acs_year, t.population, t.median_income, t.median_rent,
           t.rent_burden_30_pct, t.rent_burden_50_pct, t.vacancy_rate,
           coalesce(d.qct, false) as qct, coalesce(d.dda, false) as dda, coalesce(d.opportunity_zone, false) as oz,
           a.households, a.renter_hh, a.rent_burden_universe, a.rent_burden_30_n, a.rent_burden_50_n, a.poverty_pct, a.poverty_n, a.poverty_universe,
           case when c.geoid is null then null else jsonb_build_object(
             'vintage', c.vintage, 'hh_total', c.hh_total, 'hh_le30', c.hh_le30, 'hh_30_50', c.hh_30_50, 'hh_50_80', c.hh_50_80,
             'hh_80_100', c.hh_80_100, 'hh_gt100', c.hh_gt100, 'cb_le30', c.cb_le30, 'cb_30_50', c.cb_30_50, 'cb_50_80', c.cb_50_80,
             'cb_80_100', c.cb_80_100, 'rental_units_total', c.rental_units_total, 'rental_units_afford_le30', c.rental_units_afford_le30,
             'rental_units_afford_le50', c.rental_units_afford_le50, 'rental_units_afford_le80', c.rental_units_afford_le80) end as chas,
           st_area(st_intersection(t.geom, h.geom)::geography) as overlap_m2,
           st_area(t.geom::geography) as tract_m2,
           st_area(h.geom::geography) as hood_m2
    from public.tracts t
    join h on st_intersects(t.geom, h.geom)
    left join public.tract_designations d on d.geoid = t.geoid
    left join public.acs_tract a on a.geoid = t.geoid
    left join public.chas_tract c on c.geoid = t.geoid
  )
  select case when not exists (select 1 from h) then null else jsonb_build_object(
    'hood', (select name from h),
    'bbox', (select jsonb_build_array(st_xmin(e), st_ymin(e), st_xmax(e), st_ymax(e)) from (select st_extent(geom)::geometry as e from h) x),
    'outline', (select st_asgeojson(st_simplifypreservetopology(geom, 0.00005), 6)::jsonb from h),
    'tracts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'geoid', geoid, 'name', name, 'acs_year', acs_year, 'population', population,
        'median_income', median_income, 'median_rent', median_rent,
        'rent_burden_30_pct', rent_burden_30_pct, 'rent_burden_50_pct', rent_burden_50_pct, 'vacancy_rate', vacancy_rate,
        'qct', qct, 'dda', dda, 'opportunity_zone', oz,
        'households', households, 'renter_hh', renter_hh, 'rent_burden_universe', rent_burden_universe,
        'rent_burden_30_n', rent_burden_30_n, 'rent_burden_50_n', rent_burden_50_n,
        'poverty_pct', poverty_pct, 'poverty_n', poverty_n, 'poverty_universe', poverty_universe, 'chas', chas,
        'share_of_hood', round((overlap_m2 / nullif(hood_m2, 0))::numeric, 3),
        'share_of_tract', round((overlap_m2 / nullif(tract_m2, 0))::numeric, 3)
      ) order by overlap_m2 desc)
      from t where overlap_m2 / nullif(hood_m2, 0) >= 0.03 or overlap_m2 / nullif(tract_m2, 0) >= 0.5
    ), '[]'::jsonb),
    'lihtc', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hud_id', l.hud_id, 'project', l.project, 'address', l.address, 'n_units', l.n_units, 'li_units', l.li_units,
        'yr_pis', l.yr_pis, 'credit', l.credit, 'inside', st_intersects(l.geom, h.geom),
        'distance_mi', round((st_distance(l.geom::geography, h.geom::geography) / 1609.34)::numeric, 2)
      ) order by st_distance(l.geom::geography, h.geom::geography), l.project)
      from public.lihtc_projects l, h
      where st_dwithin(l.geom::geography, h.geom::geography, 805)
    ), '[]'::jsonb)
  ) end
$$;

create or replace function public.nonprofit_tract_map()
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'id', t.geoid,
    'properties', jsonb_build_object(
      'geoid', t.geoid, 'name', t.name, 'population', t.population,
      'rb30', t.rent_burden_30_pct, 'rb50', t.rent_burden_50_pct,
      'income', t.median_income, 'rent', t.median_rent, 'poverty', a.poverty_pct,
      'qct', coalesce(d.qct, false), 'dda', coalesce(d.dda, false)),
    'geometry', st_asgeojson(st_simplifypreservetopology(t.geom, 0.0004), 5)::jsonb
  )), '[]'::jsonb))
  from public.tracts t
  left join public.tract_designations d on d.geoid = t.geoid
  left join public.acs_tract a on a.geoid = t.geoid
  where coalesce(t.population, 0) > 0
$$;

create or replace function public.nonprofit_sites(
  p_hood text, p_public boolean default true, p_vacant boolean default true, p_clean boolean default true,
  p_min_units int default 0, p_limit int default 60
) returns jsonb language sql stable security invoker as $$
  with m as (
    select s.parid, s.address, s.score, s.band, s.best_strategy, s.by_right_units, s.units_with_relief,
           s.months_to_permit, s.red_flag_count, s.red_flags, s.top_blocker, s.zoning, s.lot_sqft,
           s.vacant, s.owner_class, s.tax_delinquent, s.municipality, s.lon, s.lat, s.preliminary,
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
$$;

grant execute on function public.nonprofit_area(text) to anon, authenticated;
grant execute on function public.nonprofit_tract_map() to anon, authenticated;
grant execute on function public.nonprofit_sites(text, boolean, boolean, boolean, int, int) to anon, authenticated;
