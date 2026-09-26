-- Per-parcel transit access, computed from public.parcels.centroid against
-- public.transit_stops. Run the PREP section once, then the CHUNK statement
-- for :chunk = 0..19, then CLEANUP.

create table if not exists public.parcel_transit (
  parid                     char(16) primary key,
  nearest_frequent_stop_m   numeric,  -- distance (meters) to nearest "frequent" stop; null if none within 1600m
  nearest_any_stop_m        numeric,  -- distance (meters) to nearest stop; null if none within 1600m
  frequent_stops_800m       int       -- count of "frequent" stops within 800m
);

do $$
declare t text;
begin
  foreach t in array array['parcel_transit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- PREP -----------------------------------------------------------------------
drop table if exists public._stops_geog;
create table public._stops_geog as
  select stop_id, frequent, geom::extensions.geography geog from public.transit_stops;
create index on public._stops_geog using gist (geog);
alter table public._stops_geog enable row level security;
truncate public.parcel_transit;

-- CHUNK ----------------------------------------------------------------------
insert into public.parcel_transit
  (parid, nearest_frequent_stop_m, nearest_any_stop_m, frequent_stops_800m)
select p.parid,
       (select round(min(extensions.ST_Distance(s.geog, p.centroid::extensions.geography))::numeric, 0)
          from public._stops_geog s
         where s.frequent and extensions.ST_DWithin(s.geog, p.centroid::extensions.geography, 1600)),
       (select round(min(extensions.ST_Distance(s.geog, p.centroid::extensions.geography))::numeric, 0)
          from public._stops_geog s
         where extensions.ST_DWithin(s.geog, p.centroid::extensions.geography, 1600)),
       (select count(*) from public._stops_geog s
         where s.frequent and extensions.ST_DWithin(s.geog, p.centroid::extensions.geography, 800))
from public.parcels p
where abs(hashtext(p.parid)) % 20 = :chunk;

-- CLEANUP --------------------------------------------------------------------
drop table if exists public._stops_geog;
