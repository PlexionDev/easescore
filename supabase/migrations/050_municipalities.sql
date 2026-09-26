-- Municipal boundaries, all 130 Allegheny County municipalities (Allegheny County GIS,
-- via WPRDC "Allegheny County Municipal Boundaries"). muni_code matches the county
-- assessment file's MUNICODE convention (verified after load in scripts/ingest_context.py).
create table if not exists public.municipalities (
  muni_code  text primary key,
  name       text not null,
  type       text,   -- e.g. BOROUGH, TOWNSHIP, CITY
  geom       extensions.geometry(MultiPolygon, 4326)
);
create index if not exists municipalities_geom_gix on public.municipalities using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['municipalities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
