-- HUD Qualified Census Tracts + Difficult Development Areas (current year),
-- and CDFI Fund-designated Opportunity Zone tracts, for Allegheny County.
-- One row per tract in public.tracts (geoid is 2020-vintage, matching
-- public.tracts). QCT and DDA are current-year HUD designations; DDA is
-- published by HUD along ZCTA boundaries for metro areas (not by tract), so
-- dda here is true when the tract intersects a designated DDA ZIP. Opportunity
-- Zones were designated in 2018 against 2010-vintage tract boundaries; a
-- handful of tracts that were resplit in the 2020 census may not match by
-- geoid -- see scripts/ingest_finance.py / the load report for any such gaps.
create table if not exists public.tract_designations (
  geoid              text primary key,
  qct                boolean not null default false,
  dda                boolean not null default false,
  opportunity_zone   boolean not null default false,
  qct_source_url     text,
  dda_source_url     text,
  oz_source_url      text
);

do $$
declare t text;
begin
  foreach t in array array['tract_designations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
