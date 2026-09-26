-- Per-parcel slope from USGS 3DEP 1-meter lidar DEM (project PA_WesternPA_2019).
-- max_pct is the single steepest 1 m cell (sensitive to walls and curbs); p95_pct is more robust.
create table if not exists public.parcel_slope_1m (
  parid          char(16) primary key,
  mean_pct       numeric,
  max_pct        numeric,
  p95_pct        numeric,
  share_over_15  numeric,
  share_over_25  numeric,
  share_over_40  numeric,
  cells_1m       int,
  steep_25       boolean   -- any 1 m cell steeper than 25%
);
alter table public.parcel_slope_1m enable row level security;
grant select on public.parcel_slope_1m to anon, authenticated;
grant all on public.parcel_slope_1m to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcel_slope_1m' and policyname='public read') then
    create policy "public read" on public.parcel_slope_1m for select to anon, authenticated using (true);
  end if;
end $$;
