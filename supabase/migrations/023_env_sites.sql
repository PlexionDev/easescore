-- Environmental cleanup / brownfield sites: PA DEP Land Recycling Cleanup
-- Locations (groundwater + waste media) and EPA ACRES brownfields, Allegheny Co.
-- CLIENT_NAME / ORGANIZATION_NAME (may name an individual site owner) are never
-- loaded; only the site/facility name from the public record is kept.
create table if not exists public.env_sites (
  id             text primary key,   -- 'dep:<media>:<id>' | 'epa:<objectid>'
  source         text not null,      -- 'pa_dep' | 'epa_acres'
  name           text,
  facility_type  text,
  media          text,                -- groundwater | waste (PA DEP only; null for EPA)
  status         text,
  geom           extensions.geometry(Point, 4326)
);
create index if not exists env_sites_geom_gix on public.env_sites using gist (geom);
create index if not exists env_sites_source_idx on public.env_sites (source);

do $$
declare t text;
begin
  foreach t in array array['env_sites'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
