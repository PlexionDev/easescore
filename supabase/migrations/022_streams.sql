-- Streams (USGS National Hydrography Dataset flowlines, clipped to the county).
-- public.overlays is polygon-only, so lines get their own table.
create table if not exists public.streams (
  id         bigint primary key,
  name       text,
  flow_type  text,   -- perennial | intermittent | ephemeral (from NHD FCode)
  geom       extensions.geometry(MultiLineString, 4326)
);
create index if not exists streams_geom_gix on public.streams using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['streams'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
