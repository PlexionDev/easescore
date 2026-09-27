-- HUD CHAS (Comprehensive Housing Affordability Strategy) and the HUD LIHTC
-- project database, Allegheny County. Loaded by scripts/ingest_seats.py
-- (chas, lihtc). See SOURCES.md / public.sources for vintages.
--
-- chas_tract: tract level, from HUD's official eGIS feature service "ACS 5YR
-- CHAS Estimate Data by Tract" (2020 tracts). The huduser.gov bulk download
-- of the newer 2018-2022 tract file sits behind a bot challenge and was not
-- fetched. Income bands are HUD Area Median Family Income (HAMFI).
-- Counts are households; cost burden = housing cost > 30% of income,
-- severe = > 50%. Columns named after the HUD field they come from.
create table if not exists public.chas_tract (
  geoid          text primary key,
  vintage        text not null,
  hh_total       int,   -- T2_EST1
  hh_le30        int,   -- T8_LE30        (<= 30% HAMFI)
  hh_30_50       int,   -- T8_GT30_LE50
  hh_50_80       int,   -- T8_GT50_LE80
  hh_80_100      int,   -- T8_GT80_LE100
  hh_gt100       int,   -- T8_GT100
  cb_le30        int,   -- T8_LE30_CB     cost-burdened households in band
  cb_30_50       int,   -- T8_GT30_LE50_CB
  cb_50_80       int,   -- T8_GT50_LE80_CB
  cb_80_100      int,   -- T8_GT80_LE100_CB
  scb_le30       int,   -- T8_LE30_CB50   severely cost-burdened
  scb_30_50      int,   -- T8_GT30_LE50_CB50
  scb_50_80      int,   -- T8_GT50_LE80_CB50
  scb_80_100     int,   -- T8_GT80_LE100_CB50
  renter_cb_le30 int,   -- T8_LE30_CB_R
  rental_units_total        int,  -- RENT_DENOM
  rental_units_afford_le30  int,  -- AFF_AVAIL_30_R  rental units affordable at <= 30% HAMFI
  rental_units_afford_le50  int,  -- AFF_AVAIL_50_R
  rental_units_afford_le80  int,  -- AFF_AVAIL_80_R
  attrs          jsonb  -- every published field, as received
);

-- chas_area: the latest CHAS (2018-2022) for the county and each municipality
-- (county subdivision), from the HUD User CHAS API. Households by HAMFI band
-- and tenure (HUD fields A1-A18); all other fields kept raw in attrs.
create table if not exists public.chas_area (
  level          text not null,   -- 'county' | 'municipality'
  geoid          text not null,   -- county FIPS '42003' or county-subdivision FIPS (5 digits)
  muni_code      text,            -- public.municipalities.muni_code where matched
  name           text not null,
  vintage        text not null,   -- '2018-2022'
  owner_le30 int, renter_le30 int, total_le30 int,        -- A1-A3
  owner_30_50 int, renter_30_50 int, total_30_50 int,     -- A4-A6
  owner_50_80 int, renter_50_80 int, total_50_80 int,     -- A7-A9
  owner_80_100 int, renter_80_100 int, total_80_100 int,  -- A10-A12
  owner_gt100 int, renter_gt100 int, total_gt100 int,     -- A13-A15
  owner_total int, renter_total int, hh_total int,        -- A16-A18
  attrs          jsonb,
  primary key (level, geoid)
);

-- lihtc_projects: HUD LIHTC database (placed-in-service projects), Allegheny
-- County points. Contact person, company, and company address fields are
-- never loaded.
create table if not exists public.lihtc_projects (
  hud_id       text primary key,
  project      text,
  address      text,
  city         text,
  zip          text,
  n_units      int,
  li_units     int,
  n_0br int, n_1br int, n_2br int, n_3br int, n_4br int,
  yr_pis       int,     -- year placed in service
  yr_alloc     int,
  credit       text,    -- HUD code: 1 = 30% PV (4%), 2 = 70% PV (9%), 3 = both, 4 = TCEP only
  construction_type text, -- HUD TYPE: 1 new construction, 2 acq+rehab, 3 both
  non_profit   boolean, -- NON_PROF sponsor flag
  target_pop   text,
  qct          boolean,
  dda          boolean,
  tract_geoid  text,    -- 2020 tract from public.tracts (point in polygon)
  geom         extensions.geometry(Point, 4326)
);
create index if not exists lihtc_projects_geom_gix on public.lihtc_projects using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['chas_tract','chas_area','lihtc_projects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
