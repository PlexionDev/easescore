-- Aggregated NFIP evidence (OpenFEMA FimaNfipPolicies "policies in force" snapshot +
-- FimaNfipClaims redacted claims), rolled up to census tract and ZIP for Allegheny County
-- (countyCode 42003). Row-level policy/claim records are never stored -- only counts,
-- medians/means, and per-year totals. See scripts/ingest_flood.py (nfip()).
create table if not exists public.nfip_by_tract (
  geoid                text primary key,   -- 11-digit tract GEOID
  policies_in_force    int not null default 0,
  premium_median       numeric,
  premium_mean         numeric,
  premium_policy_count int not null default 0,   -- policies behind the median/mean above
  claims_count_10y     int not null default 0,
  claims_total_paid_10y numeric not null default 0,
  claims_by_year       jsonb not null default '[]',  -- [{year, count, total_paid}, ...]
  most_recent_claim_year int,
  as_of_date           date,       -- OpenFEMA snapshot date
  source               text not null default 'FEMA OpenFEMA v2: FimaNfipPolicies, FimaNfipClaims (redacted, aggregated)'
);

create table if not exists public.nfip_by_zip (
  zip                  text primary key,   -- 5-digit ZIP
  policies_in_force    int not null default 0,
  premium_median       numeric,
  premium_mean         numeric,
  premium_policy_count int not null default 0,
  claims_count_10y     int not null default 0,
  claims_total_paid_10y numeric not null default 0,
  claims_by_year       jsonb not null default '[]',
  most_recent_claim_year int,
  as_of_date           date,
  source               text not null default 'FEMA OpenFEMA v2: FimaNfipPolicies, FimaNfipClaims (redacted, aggregated)'
);

do $$
declare t text;
begin
  foreach t in array array['nfip_by_tract','nfip_by_zip'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
