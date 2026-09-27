-- ACS 5-year (2020-2024, the latest release) neighborhood indicators for the
-- Nonprofit and Policy seats, at tract and block-group level, Allegheny
-- County. Loaded by scripts/ingest_seats.py (acs). Census API, public domain.
--
-- RACE / ETHNICITY (B03002) IS CONTEXT ONLY. It is shown aggregated for an
-- area in equity reporting and must never feed any parcel score, rank,
-- filter default or eligibility rule. See docs/DATA.md.
--
-- Poverty: tracts use B17001 (poverty status); B17001 is not published for
-- block groups, so block groups use C17002 (ratio of income to poverty
-- level, < 1.00). poverty_table records which one.
create table if not exists public.acs_tract (
  geoid                 text primary key,
  name                  text,
  vintage               text not null,  -- '2020-2024 ACS 5-year'
  acs_year              int not null,   -- 2024
  population            int,
  households            int,            -- B25003_001
  owner_hh              int,            -- B25003_002
  renter_hh             int,            -- B25003_003
  renter_share_pct      numeric,
  median_hh_income      numeric,        -- B19013_001 (dollars, inflation-adjusted to acs_year)
  median_hh_income_moe  numeric,
  median_gross_rent     numeric,        -- B25064_001
  median_gross_rent_moe numeric,
  rent_burden_universe  int,            -- B25070_001 - B25070_011 (renters with burden computed)
  rent_burden_30_n      int,            -- B25070_007..010 (30%+ of income)
  rent_burden_50_n      int,            -- B25070_010 (50%+)
  rent_burden_30_pct    numeric,
  rent_burden_50_pct    numeric,
  poverty_universe      int,
  poverty_n             int,
  poverty_pct           numeric,
  poverty_table         text,           -- 'B17001' | 'C17002'
  hh_with_children      int,            -- B11005_002 (households with one or more people under 18)
  hh_with_children_pct  numeric,
  -- race / ethnicity, B03002 (context only, never scored)
  pop_race_universe     int,            -- B03002_001
  nh_white              int,            -- B03002_003
  nh_black              int,            -- B03002_004
  nh_asian              int,            -- B03002_006
  nh_other              int,            -- B03002_005 + 007 + 008 (AIAN, NHPI, other)
  nh_two_or_more        int,            -- B03002_009
  hispanic              int             -- B03002_012
);

create table if not exists public.acs_bg (like public.acs_tract including all);
alter table public.acs_bg add column if not exists tract_geoid text;
create index if not exists acs_bg_tract_idx on public.acs_bg (tract_geoid);

do $$
declare t text;
begin
  foreach t in array array['acs_tract','acs_bg'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
