-- City of Pittsburgh 311 requests related to flooding / sewer backup / catch basins /
-- storm drainage, counted by census tract and year (no parcel or personal fields exist
-- in the source; free-text fields, if any, are never loaded). Source: WPRDC "Pittsburgh
-- 311 Data". See scripts/ingest_flood.py (flooding_311()).
create table if not exists public.flooding_311 (
  geoid        text not null,   -- 11-digit tract GEOID
  request_type text not null,   -- 311 "subject": Flooding, Drainage - Street,
                                 -- "Catch Basins, Grates, and Sewers", Sewers
  year         int not null,
  count        int not null,
  primary key (geoid, request_type, year)
);
create index if not exists flooding_311_geoid_idx on public.flooding_311 (geoid);

do $$
declare t text;
begin
  foreach t in array array['flooding_311'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
