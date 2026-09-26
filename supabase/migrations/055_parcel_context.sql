-- parcel_context(parid): municipality/neighborhood/street-tree/public-ownership/tax-lien
-- summary for every parcel. Filled in chunks from scripts/ingest_context.py (parcel_context()),
-- the same way parcel_schools/parcel_transit/buildings.parid are tagged after load.
create table if not exists public.parcel_context (
  parid             char(16) primary key,
  muni_name         text,
  neighborhood      text,
  street_trees_15m  int,
  public_owner      text,     -- public_owned.owner_category, if any
  tax_delinquent    boolean not null default false,
  delinquency_band  text
);

do $$
declare t text;
begin
  foreach t in array array['parcel_context'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
