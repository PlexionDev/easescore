-- Tag every parcel with its school district (boundary layer vs. county assessment)
-- and, inside Pittsburgh, its PPS feeder-pattern attendance zones (2012-13 boundaries).
-- Run the PREP section once, then the CHUNK statement for :chunk = 0..19, then CLEANUP.

-- PREP -----------------------------------------------------------------------
create or replace function public.norm_district(n text) returns text
language sql immutable as $$
  select trim(regexp_replace(regexp_replace(
    regexp_replace(upper(coalesce(n,'')), '[^A-Z ]', ' ', 'g'),
    '\m(CITY OF|BOROUGH|BORO|TOWNSHIP|TWP|AREA|SCHOOL DISTRICT|SD)\M', '', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Polygons and outlines split into small pieces so point lookups stay fast.
drop table if exists public._sd_polys, public._sd_lines, public._pps_polys;
create table public._sd_polys as
  select name, extensions.ST_Subdivide(geom, 128) geom from public.school_districts;
create table public._sd_lines as
  select extensions.ST_Subdivide(extensions.ST_Boundary(geom), 64) geom from public.school_districts;
create table public._pps_polys as
  select level, school, extensions.ST_Subdivide(geom, 128) geom from public.pps_attendance_zones;
create index on public._sd_polys using gist (geom);
create index on public._sd_lines using gist (geom);
create index on public._pps_polys using gist (geom);
alter table public._sd_polys enable row level security;
alter table public._sd_lines enable row level security;
alter table public._pps_polys enable row level security;
truncate public.parcel_schools;

-- CHUNK ----------------------------------------------------------------------
insert into public.parcel_schools
  (parid, district, district_assessment, district_match, near_district_line_m,
   pps_elementary, pps_middle, pps_high)
select p.parid,
       sd.name,
       a.school_desc,
       case when sd.name is null or a.school_desc is null then null
            else public.norm_district(sd.name) = public.norm_district(a.school_desc) end,
       (select round(min(extensions.ST_Distance(l.geom::extensions.geography,
                                                p.centroid::extensions.geography))::numeric, 0)
          from public._sd_lines l
         where extensions.ST_DWithin(l.geom, p.centroid, 0.002)
           and extensions.ST_DWithin(l.geom::extensions.geography, p.centroid::extensions.geography, 150)),
       (select z.school from public._pps_polys z
         where z.level = 'elementary' and extensions.ST_Intersects(z.geom, p.centroid) limit 1),
       (select z.school from public._pps_polys z
         where z.level = 'middle' and extensions.ST_Intersects(z.geom, p.centroid) limit 1),
       (select z.school from public._pps_polys z
         where z.level = 'high' and extensions.ST_Intersects(z.geom, p.centroid) limit 1)
from public.parcels p
left join public.assessments a on a.parid = p.parid
left join lateral (
  select d.name from public._sd_polys d
  where extensions.ST_Intersects(d.geom, p.centroid) limit 1
) sd on true
where abs(hashtext(p.parid)) % 20 = :chunk;

-- CLEANUP --------------------------------------------------------------------
drop table if exists public._sd_polys, public._sd_lines, public._pps_polys;
