-- Tax millage rates, Allegheny County: the county, every municipality, and
-- every school district, from the Allegheny County Treasurer's published
-- millage listings. rate_type distinguishes the rare land/building split
-- (City of Clairton and its school district still split-rate; the City of
-- Pittsburgh repealed its split-rate tax in 2001 and is a single 'general'
-- rate). See scripts/ingest_finance.py.
create table if not exists public.millage (
  jurisdiction_type  text not null,   -- 'county' | 'municipality' | 'school_district'
  code               text not null,   -- municode for municipality; name-based slug otherwise
  name               text not null,
  rate_type          text not null default 'general',  -- 'general' | 'land' | 'building'
  mills              numeric not null,
  year               int not null,
  source_url         text not null,
  primary key (jurisdiction_type, code, rate_type, year)
);

do $$
declare t text;
begin
  foreach t in array array['millage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
