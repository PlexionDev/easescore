-- City of Pittsburgh's 90 official neighborhoods (City of Pittsburgh GIS,
-- PGHWebNeighborhoods; already dissolved to one polygon per neighborhood).
create table if not exists public.neighborhoods (
  hood_no  int primary key,
  name     text not null,
  geom     extensions.geometry(MultiPolygon, 4326)
);
create index if not exists neighborhoods_geom_gix on public.neighborhoods using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['neighborhoods'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
