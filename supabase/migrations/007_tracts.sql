-- Census ACS 5-year neighborhood context, at tract level, for Allegheny County
-- (state 42, county 003). See scripts/ingest_census.py for the loader.
create table if not exists public.tracts (
  geoid              text primary key,   -- 11-digit tract GEOID (state+county+tract)
  name               text,
  acs_year           int,
  population         int,
  median_income      numeric,   -- B19013_001E, household income (dollars)
  median_rent        numeric,   -- B25064_001E, gross rent (dollars)
  rent_burden_30_pct numeric,   -- share of renter households paying >= 30% of income on rent
  rent_burden_50_pct numeric,   -- share of renter households paying >= 50% of income on rent
  vacancy_rate       numeric,   -- share of housing units vacant
  geom               extensions.geometry(MultiPolygon, 4326)
);
create index if not exists tracts_geom_gix on public.tracts using gist (geom);

-- Per-parcel tract tag, computed in the database from parcel centroids.
create table if not exists public.parcel_tract (
  parid   char(16) primary key,
  geoid   text
);

do $$
declare t text;
begin
  foreach t in array array['tracts','parcel_tract'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
