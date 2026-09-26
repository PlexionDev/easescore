-- Per-parcel flood-risk rollup: FEMA floodway/SFHA/0.2%-annual-chance shares (computed by
-- intersecting parcel polygons with public.overlays layer 'flood_fema_nfhl'), tract-level
-- NFIP evidence, tract 311 flooding-request activity, and combined-sewer-area membership
-- (public.overlays layer 'combined_sewer'). Filled in chunks by scripts/ingest_flood.py
-- (parcel_flood()), same pattern as parcel_slope / parcel_transit / parcel_context.
create table if not exists public.parcel_flood (
  parid                  char(16) primary key,
  floodway_share         numeric not null default 0,  -- share of lot in FEMA FLOODWAY
  sfha_share             numeric not null default 0,  -- share of lot in zone A/AE (1% annual chance)
  x500_share             numeric not null default 0,  -- share of lot in zone X, 0.2% annual chance
  tract_nfip_claims_10y  int,
  tract_nfip_median_premium numeric,
  tract_nfip_policies    int,
  flooding_311_5y_tract  int,      -- count of flooding-related 311 requests, tract, trailing 5y
  in_combined_sewer      boolean not null default false
);

do $$
declare t text;
begin
  foreach t in array array['parcel_flood'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
