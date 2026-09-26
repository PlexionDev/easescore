-- Measured building heights from USGS 3DEP lidar (classified point cloud, Entwine Point Tiles).
-- height_m = roof_p95_m - ground_m: 95th percentile of non-ground lidar returns inside the footprint
-- minus the median 1 m bare-earth DEM elevation in a ring just outside it (NAVD88 meters).
-- Null height_m = too few lidar points inside the footprint. Filled by scripts/building_heights.py.
create table if not exists public.building_heights (
  building_id  bigint primary key references public.buildings (id) on delete cascade,
  height_m     numeric,
  roof_p95_m   numeric,
  ground_m     numeric,
  points       int,
  source       text default 'USGS 3DEP lidar (PA_WesternPA_2019)',
  computed_at  timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['building_heights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
