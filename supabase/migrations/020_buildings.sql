-- Building footprints, county-wide (Allegheny County GIS EGIS/Buildings).
-- Photogrammetrically compiled roof outlines; source has no height/stories/year
-- fields, so those columns are not created. parid is tagged after load by
-- largest-overlap spatial join to public.parcels (see scripts/ingest_layers.py).
create table if not exists public.buildings (
  id             bigint primary key,
  parid          char(16),
  status         text,   -- e.g. ACTIVE, DEMOLISHED (source lifecycle status)
  class          text,   -- e.g. RESIDENTIAL, COMMERCIAL/INDUSTRIAL, PUBLIC, OUT BUILDING
  land_use_code  numeric,
  geom           extensions.geometry(MultiPolygon, 4326)
);
create index if not exists buildings_geom_gix on public.buildings using gist (geom);
create index if not exists buildings_parid_idx on public.buildings (parid);

do $$
declare t text;
begin
  foreach t in array array['buildings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
