-- Per-parcel mine-subsidence facts, computed from public.overlays layers:
--   mined_out_dep    PA DEP digitized underground coal mined-out areas (DMO MOA)
--   coal_bearing     PA DEP Mine Subsidence Insurance risk map (confirmed / possible)
--   undermined_pgh   City of Pittsburgh undermined areas (UM-O, Code §906.05)
--   mine_map_sheets  PA Mine Map Atlas sheet index (PASDA / PA DEP)
-- Loaded by scripts/ingest_mines.py, which also runs the PREP section once, the
-- CHUNK statement for :chunk = 0..19, then CLEANUP.
-- Absence of a mapped mine is not proof that no mine exists: the maps are incomplete.

create table if not exists public.parcel_mines (
  parid               char(16) primary key,
  in_mined_out        boolean,   -- part of the lot lies over a mapped mined-out area
  mined_out_share     numeric,   -- share of the lot (0-1) over mapped mined-out areas
  dist_mined_out_ft   numeric,   -- feet from the lot to the nearest mapped mined-out area; 0 = touching/over; null = over 2,000 ft
  in_coal_bearing     boolean,   -- lot touches a DEP MSI risk area (coal present, confirmed or possible mining)
  msi_risk            text,      -- DEP MSI risk class at the lot: 'confirmed' | 'possible' | null
  in_city_undermined  boolean,   -- lot touches the City of Pittsburgh undermined area (UM-O)
  mine_map_url        text,      -- PA Mine Map Atlas viewer, opened on the most detailed sheet covering the lot
  sources             jsonb      -- source names, the mapped mines/seams within 500 ft, and the mine-map sheet details
);

do $$
declare t text;
begin
  foreach t in array array['parcel_mines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- PREP -----------------------------------------------------------------------
-- Subdivided copies of the polygon layers. Mined-out areas are kept in PA State
-- Plane South (EPSG:2272, US feet) so distances come out in feet.
drop table if exists public._mines_sub;
create table public._mines_sub as
  select source_id, extensions.ST_Subdivide(extensions.ST_MakeValid(
           extensions.ST_Transform(geom, 2272)), 128) g
  from public.overlays where layer = 'mined_out_dep';
create index on public._mines_sub using gist (g);
drop table if exists public._coal_sub;
create table public._coal_sub as
  select attrs->>'msi_class' msi_class, extensions.ST_Subdivide(geom, 128) g
  from public.overlays where layer = 'coal_bearing';
create index on public._coal_sub using gist (g);
drop table if exists public._um_sub;
create table public._um_sub as
  select extensions.ST_Subdivide(geom, 128) g from public.overlays where layer = 'undermined_pgh';
create index on public._um_sub using gist (g);
drop table if exists public._sheets;
create table public._sheets as
  select source_id, attrs, geom, extensions.ST_Area(geom) area
  from public.overlays where layer = 'mine_map_sheets';
create index on public._sheets using gist (geom);
alter table public._sheets enable row level security;
alter table public._mines_sub enable row level security;
alter table public._coal_sub enable row level security;
alter table public._um_sub enable row level security;
truncate public.parcel_mines;

-- CHUNK ----------------------------------------------------------------------
insert into public.parcel_mines
  (parid, in_mined_out, mined_out_share, dist_mined_out_ft, in_coal_bearing, msi_risk,
   in_city_undermined, mine_map_url, sources)
select p.parid,
       coalesce(m.share, 0) > 0,
       round(coalesce(m.share, 0)::numeric, 3),
       m.dist_ft,
       c.msi_risk is not null,
       c.msi_risk,
       u.hit,
       s.attrs->>'atlas_url',
       jsonb_strip_nulls(jsonb_build_object(
         'mined_out', 'PA DEP Digitized Mined Out Areas, Coal Underground (DMO MOA)',
         'coal_bearing', 'PA DEP Mine Subsidence Insurance risk map (MSI Risk Confirmed / Possible)',
         'city_undermined', 'City of Pittsburgh Undermined Areas (UM-O)',
         'mine_map', 'PA Mine Map Atlas (PASDA / PA DEP)',
         'mines_within_500ft', n.mines,
         'seams_within_500ft', n.seams,
         'mine_map_sheet', s.attrs->>'sheet_id',
         'mine_map_collection', s.attrs->>'collection',
         'mine_map_pdf', s.attrs->>'pdf_url'))
from public.parcels p
cross join lateral (select extensions.ST_Transform(p.geom, 2272) pg) t
cross join lateral (
  -- LEAST() ignores NULLs, so the no-overlap case must be coalesced to 0 inside it.
  select least(1.0, coalesce(extensions.ST_Area(extensions.ST_Union(
                      case when extensions.ST_Intersects(ms.g, t.pg)
                           then extensions.ST_Intersection(ms.g, t.pg) end)), 0)
                    / nullif(extensions.ST_Area(t.pg), 0)) share,
         round(min(extensions.ST_Distance(ms.g, t.pg))::numeric, 0) dist_ft
  from public._mines_sub ms
  where extensions.ST_DWithin(ms.g, t.pg, 2000)) m
cross join lateral (  -- mine names/seams, only for lots within 500 ft
  select jsonb_agg(distinct o.attrs->>'mine_name') filter (where o.attrs->>'mine_name' is not null) mines,
         jsonb_agg(distinct o.attrs->>'coal_seam') filter (where o.attrs->>'coal_seam' is not null) seams
  from public.overlays o
  where m.dist_ft <= 500 and o.layer = 'mined_out_dep'
    and o.source_id in (select x.source_id from public._mines_sub x
                        where extensions.ST_DWithin(x.g, t.pg, 500))) n
cross join lateral (
  select case when bool_or(cs.msi_class = 'confirmed') then 'confirmed'
              when count(*) > 0 then 'possible' end msi_risk
  from public._coal_sub cs where extensions.ST_Intersects(cs.g, p.geom)) c
cross join lateral (
  select exists (select 1 from public._um_sub us where extensions.ST_Intersects(us.g, p.geom)) hit) u
left join lateral (  -- smallest (most detailed) sheet whose footprint covers the lot centroid
  select c5.attrs from (
    select sh.attrs, sh.geom, sh.area, sh.source_id from public._sheets sh
    where sh.geom && p.centroid order by sh.area, sh.source_id limit 5) c5
  where extensions.ST_Intersects(c5.geom, p.centroid)
  order by c5.area, c5.source_id
  limit 1) s on true
where abs(hashtext(p.parid)) % 20 = :chunk;

-- CLEANUP --------------------------------------------------------------------
drop table if exists public._mines_sub;
drop table if exists public._coal_sub;
drop table if exists public._um_sub;
drop table if exists public._sheets;
