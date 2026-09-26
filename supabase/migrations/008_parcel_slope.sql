-- Terrain slope per parcel from the USGS 3DEP elevation model (10 m cells).
create table if not exists public.parcel_slope (
  parid           char(16) primary key,
  slope_mean_pct  numeric,   -- average slope across the parcel, percent
  steep_share     numeric,   -- share of the parcel steeper than 25% (0-1)
  cells           int        -- 10 m cells averaged; 0 = sampled at one interior point
);
alter table public.parcel_slope enable row level security;
grant select on public.parcel_slope to anon, authenticated;
grant all on public.parcel_slope to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcel_slope' and policyname='public read') then
    create policy "public read" on public.parcel_slope for select to anon, authenticated using (true);
  end if;
end $$;
