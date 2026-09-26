-- HUD Fair Market Rents (FY current), Pittsburgh, PA HUD Metro FMR Area
-- (METRO38300M38300 -- Allegheny, Beaver, Butler, Fayette, Washington, and
-- Westmoreland counties). One MSA-level row (zip null) plus Small Area FMRs
-- by ZIP for zip codes that appear in public.assessments (i.e. actually in
-- Allegheny County). See scripts/ingest_finance.py.
create table if not exists public.hud_fmr (
  year        int not null,
  area_code   text not null,     -- HUD entity id, e.g. 'METRO38300M38300'
  zip         text not null,     -- 'MSA' = MSA-level (standard FMR); else Small Area FMR by ZIP
  br0         numeric,           -- efficiency
  br1         numeric,
  br2         numeric,
  br3         numeric,
  br4         numeric,
  area_name   text,
  source_url  text not null default 'https://www.huduser.gov/portal/dataset/fmr-api.html',
  primary key (year, area_code, zip)
);
create index if not exists hud_fmr_zip_idx on public.hud_fmr (zip);

do $$
declare t text;
begin
  foreach t in array array['hud_fmr'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
