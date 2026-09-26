-- Per-parcel site facts for the requirements engine, from buildings, streets, streams, wetlands,
-- recorded landslides, and cleanup sites. Distances use the catalog's thresholds.
-- Run PREP once, then CHUNK for :chunk = 0..49 (keeps each statement under the API timeout).

-- PREP -----------------------------------------------------------------------
create table if not exists public.parcel_site (
  parid                      char(16) primary key,
  building_footprint_sqft    numeric,
  building_count             int,
  shares_wall                boolean,   -- a building on this lot touches a building on another lot
  street_frontage            text,      -- street | paper | none  (centerline within 20 m of the lot)
  landslides_within_300ft    int,       -- recorded landslides (county Pomeroy inventory)
  red_bed_landslides_300ft   int,       -- of those, flagged as red-bed slides
  streams_within_100ft       boolean,
  wetlands_within_100ft      boolean,
  env_sites_within_500ft     int        -- PA DEP Land Recycling + EPA ACRES sites
);
alter table public.parcel_site enable row level security;
grant select on public.parcel_site to anon, authenticated;
grant all on public.parcel_site to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcel_site' and policyname='public read') then
    create policy "public read" on public.parcel_site for select to anon, authenticated using (true);
  end if;
end $$;

-- Big polygons (e.g. the three-rivers wetland feature) make distance checks slow: split them first.
drop table if exists public._wet_sub, public._slide_sub;
create table public._wet_sub as
  select extensions.ST_Subdivide(geom, 64) geom from public.overlays where layer = 'wetland_nwi';
create table public._slide_sub as
  select (attrs->>'red_beds' = 'Y') red_beds, source_id, extensions.ST_Subdivide(geom, 64) geom
  from public.overlays where layer = 'landslide_recorded';
create index on public._wet_sub using gist (geom);
create index on public._slide_sub using gist (geom);
alter table public._wet_sub enable row level security;
alter table public._slide_sub enable row level security;

-- CHUNK ----------------------------------------------------------------------
insert into public.parcel_site
select p.parid,
       (select round((sum(extensions.ST_Area(b.geom::extensions.geography)) * 10.7639)::numeric, 0)
          from public.buildings b where b.parid = p.parid),
       (select count(*) from public.buildings b where b.parid = p.parid),
       exists (select 1 from public.buildings b join public.buildings n
                 on extensions.ST_DWithin(b.geom, n.geom, 0.000003) and n.parid <> p.parid
               where b.parid = p.parid),
       case
         when exists (select 1 from public.streets s
                      where extensions.ST_DWithin(s.geom, p.geom, 0.0003) and extensions.ST_DWithin(s.geom::extensions.geography, p.geom::extensions.geography, 20)
                        and coalesce(s.paper_or_vacated, false) = false) then 'street'
         when exists (select 1 from public.streets s
                      where extensions.ST_DWithin(s.geom, p.geom, 0.0003) and extensions.ST_DWithin(s.geom::extensions.geography, p.geom::extensions.geography, 20)) then 'paper'
         else 'none' end,
       (select count(distinct o.source_id) from public._slide_sub o
          where extensions.ST_DWithin(o.geom, p.geom, 0.0013) and extensions.ST_DWithin(o.geom::extensions.geography, p.geom::extensions.geography, 91.44)),
       (select count(distinct o.source_id) from public._slide_sub o where o.red_beds
          and extensions.ST_DWithin(o.geom, p.geom, 0.0013) and extensions.ST_DWithin(o.geom::extensions.geography, p.geom::extensions.geography, 91.44)),
       exists (select 1 from public.streams s
               where extensions.ST_DWithin(s.geom, p.geom, 0.0005) and extensions.ST_DWithin(s.geom::extensions.geography, p.geom::extensions.geography, 30.48)),
       exists (select 1 from public._wet_sub o
               where extensions.ST_DWithin(o.geom, p.geom, 0.0005) and extensions.ST_DWithin(o.geom::extensions.geography, p.geom::extensions.geography, 30.48)),
       (select count(*) from public.env_sites e
          where extensions.ST_DWithin(e.geom, p.geom, 0.0021) and extensions.ST_DWithin(e.geom::extensions.geography, p.geom::extensions.geography, 152.4))
from public.parcels p
where abs(hashtext(p.parid)) % 50 = :chunk
on conflict (parid) do update set
  building_footprint_sqft = excluded.building_footprint_sqft, building_count = excluded.building_count,
  shares_wall = excluded.shares_wall, street_frontage = excluded.street_frontage,
  landslides_within_300ft = excluded.landslides_within_300ft, red_bed_landslides_300ft = excluded.red_bed_landslides_300ft,
  streams_within_100ft = excluded.streams_within_100ft, wetlands_within_100ft = excluded.wetlands_within_100ft,
  env_sites_within_500ft = excluded.env_sites_within_500ft;

-- CLEANUP ---------------------------------------------------------------------
drop table if exists public._wet_sub, public._slide_sub;
