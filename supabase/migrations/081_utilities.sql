-- Public water service areas (PA DEP) and per-parcel water / sewer service flags.
-- Filled by scripts/ingest_utilities.py. Service-area boundaries are approximate (PA DEP says so);
-- "served" means "inside a mapped public water supplier's service area", not "has a connection".
--
-- Sewer: no public, license-permitted sewer SERVICE-AREA layer exists for Allegheny County
-- (WPRDC, PASDA, PA DEP eMapPA, and county GIS were searched 2026-09-26). The PWSA combined
-- sewersheds and the ALCOSAN basin outlines are drainage basins, not service boundaries, so every
-- parcel is sewer_status = 'unknown' until a real service-area layer is found.

create table if not exists public.water_service_areas (
  pwsid         text primary key,   -- PA DEP public water system ID (PWS_ID)
  name          text,
  owner_type    text,               -- Authority | Municipal | Private Investor Owned | ...
  gw_source     boolean,            -- system draws groundwater
  sw_source     boolean,            -- system draws surface water
  interconnect  boolean,            -- buys water through an interconnection
  last_date     date,               -- DEP's last boundary edit
  geom          extensions.geometry(MultiPolygon, 4326)  -- clipped to Allegheny County
);
create index if not exists water_service_areas_geom_gix on public.water_service_areas using gist (geom);

create table if not exists public.parcel_utilities (
  parid          char(16) primary key,
  water_served   boolean,           -- true: centroid inside a service area; false: >= 100 m outside every
                                    -- service area; null: within 100 m of a boundary (approximate) or no data
  water_system   text,              -- smallest service area containing the centroid (else nearest, for context)
  water_pwsid    text,
  water_dist_m   numeric,           -- 0 inside; else distance from centroid to the nearest service area
  water_source   text,
  sewer_served   boolean,
  sewer_status   text not null default 'unknown' check (sewer_status in ('served', 'not_served', 'unknown')),
  sewer_source   text,
  computed_at    timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['water_service_areas', 'parcel_utilities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
