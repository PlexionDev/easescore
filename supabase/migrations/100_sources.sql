-- Source ledger for the seat datasets (Planner / Nonprofit / Policy).
-- One row per dataset pulled into the database, with where it came from, its
-- vintage and license, and which tables it feeds. Loaded by
-- scripts/ingest_seats.py; SOURCES.md is the human-readable twin.
create table if not exists public.sources (
  id         text primary key,          -- short stable key, e.g. 'acs5_2024'
  name       text not null,
  publisher  text not null,
  url        text not null,
  vintage    text not null,             -- data period / edition, e.g. '2020-2024 ACS 5-year'
  license    text not null,
  loaded_at  timestamptz not null default now(),
  tables     text[] not null default '{}',
  notes      text
);

do $$
declare t text;
begin
  foreach t in array array['sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
