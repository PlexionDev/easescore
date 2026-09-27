-- City neighborhood outlines, simplified, as one GeoJSON FeatureCollection: the base layer of the
-- council packet's printed map (no basemap tiles in a PDF). Public boundaries only.
create or replace function public.policy_hood_outlines()
returns jsonb
language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
           'type', 'Feature', 'properties', jsonb_build_object('name', name),
           'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0004), 5)::jsonb)), '[]'))
  from public.neighborhoods
$$;
revoke all on function public.policy_hood_outlines() from public;
grant execute on function public.policy_hood_outlines() to anon, authenticated, service_role;
