-- Geography crosswalk for the seats: every parcel -> municipality, City
-- neighborhood, City Council district, census tract + block group, school
-- district, ZIP. Filled once by scripts/ingest_seats.py (parcel_geo), in
-- hashed chunks from parcel centroids; never computed at request time.

-- Pittsburgh City Council districts, 2022 map (current).
create table if not exists public.council_districts (
  district  int primary key,
  geom      extensions.geometry(MultiPolygon, 4326)
);
create index if not exists council_districts_geom_gix on public.council_districts using gist (geom);

-- Census block groups, Allegheny County, 2024 cartographic boundaries
-- (same vintage and generalization as public.tracts, so block group ->
-- tract nesting is exact by GEOID prefix).
create table if not exists public.block_groups (
  geoid        text primary key,     -- 12-digit block group GEOID
  tract_geoid  text not null,        -- first 11 digits
  aland_m2     numeric,
  geom         extensions.geometry(MultiPolygon, 4326)
);
create index if not exists block_groups_geom_gix on public.block_groups using gist (geom);
create index if not exists block_groups_tract_idx on public.block_groups (tract_geoid);

create table if not exists public.parcel_geo (
  parid              char(16) primary key,
  municipality       text,      -- municipality name (public.municipalities.name)
  muni_code          text,      -- public.municipalities.muni_code: City wards collapse to 100/200/300/400
  is_pittsburgh      boolean not null default false,  -- assessment MUNICODE 101-132 (NOT East Pittsburgh 822)
  neighborhood       text,      -- City of Pittsburgh neighborhood; null outside the City
  council_district   int,       -- City Council district (2022 map); null outside the City
  tract_geoid        text,      -- 2020 tract (public.tracts / public.parcel_tract)
  block_group_geoid  text,      -- 2020 block group (public.block_groups)
  school_district    text,      -- taxing school district from the assessment (SCHOOLDESC)
  school_code        text,
  zip                text       -- property ZIP from the assessment
);
create index if not exists parcel_geo_muni_idx on public.parcel_geo (muni_code);
create index if not exists parcel_geo_hood_idx on public.parcel_geo (neighborhood);
create index if not exists parcel_geo_council_idx on public.parcel_geo (council_district);
create index if not exists parcel_geo_tract_idx on public.parcel_geo (tract_geoid);
create index if not exists parcel_geo_bg_idx on public.parcel_geo (block_group_geoid);
create index if not exists parcel_geo_zip_idx on public.parcel_geo (zip);

do $$
declare t text;
begin
  foreach t in array array['council_districts','block_groups','parcel_geo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
