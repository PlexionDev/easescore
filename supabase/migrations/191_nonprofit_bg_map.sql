-- Nonprofit / CDC seat: block-group level need map (same shading options as the tract map in 190).
--   nonprofit_bg_map()  -- every populated Allegheny County block group, simplified, with ACS 5-year
--                          rent burden (30%+, 50%+), median household income, median gross rent and
--                          poverty (C17002 for block groups). Area context only: never scored.
-- Rent burden is left null where fewer than 20 renter households have the ratio computed (too few to
-- shade; the map shows "no data"). One read of two indexed tables; the route caches it for an hour.
create or replace function public.nonprofit_bg_map()
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'vintage', (select max(vintage) from public.acs_bg),
    'acs_year', (select max(acs_year) from public.acs_bg),
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id', b.geoid,
      'properties', jsonb_build_object(
        'geoid', b.geoid, 'name', a.name, 'population', a.population,
        'rb30', case when coalesce(a.rent_burden_universe, 0) >= 20 then round(a.rent_burden_30_pct, 1) end,
        'rb50', case when coalesce(a.rent_burden_universe, 0) >= 20 then round(a.rent_burden_50_pct, 1) end,
        'income', a.median_hh_income, 'rent', a.median_gross_rent, 'poverty', round(a.poverty_pct, 1)),
      'geometry', st_asgeojson(st_simplifypreservetopology(b.geom, 0.0003), 5)::jsonb
    )), '[]'::jsonb))
  from public.block_groups b
  join public.acs_bg a on a.geoid = b.geoid
  where coalesce(a.population, 0) > 0
$$;

grant execute on function public.nonprofit_bg_map() to anon, authenticated;
