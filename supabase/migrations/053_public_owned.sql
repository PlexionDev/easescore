-- Institutionally-owned parcels (WPRDC "City-Owned Properties" -- eProperty Plus).
-- Individual/personal owners in the source are dropped at ingest; only rows whose
-- owner matched a known institutional category are kept (see scripts/ingest_context.py).
create table if not exists public.public_owned (
  parid          char(16) primary key,
  owner_category text not null,  -- City, Land Bank (PLB Transfer), URA, Housing Authority, School District, Other
  status         text            -- source current_status, e.g. "Available for Sale", "Permanent City Ownership"
);

do $$
declare t text;
begin
  foreach t in array array['public_owned'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
