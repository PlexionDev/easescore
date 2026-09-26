-- Street centerlines, city (Pittsburgh PavementPublic) + county (Allegheny
-- County Addressing_Centerlines). id is prefixed 'pgh:' or 'co:' by source
-- since each side has its own OBJECTID sequence.
-- paper_or_vacated is only populated for city rows: the Pittsburgh source's
-- `class` field flags PAPER / VACATED streets explicitly; no equivalent flag
-- was found in the county source, so it is left null there rather than guessed.
create table if not exists public.streets (
  id                text primary key,
  source            text not null,   -- 'city' | 'county'
  name              text,
  street_type       text,            -- city: functional class (Local/Collector/Arterial/Alley...); county: TIGER FCC code
  paper_or_vacated  boolean,
  municode          text,
  geom              extensions.geometry(MultiLineString, 4326)
);
create index if not exists streets_geom_gix on public.streets using gist (geom);
create index if not exists streets_source_idx on public.streets (source);

do $$
declare t text;
begin
  foreach t in array array['streets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
