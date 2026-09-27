-- Ownership class per parcel, for the Planner / Nonprofit seats.
-- The county assessment file publishes no owner names. The class is derived
-- by scripts/ingest_seats.py (owner_class) from: the WPRDC City-Owned
-- Properties inventory, the assessment's tax-exempt / GOVERNMENT class, and
-- the owner's change-notice mailing address matched against a short list of
-- verified public-agency and housing-nonprofit office addresses. Mailing
-- addresses are read locally from the raw file and never uploaded; only the
-- class (and, for public agencies only, the agency name) is stored.
create table if not exists public.parcel_owner_class (
  parid           char(16) primary key,
  owner_class     text not null check (owner_class in
                    ('city','ura','land_bank','hacp','county','other_public','nonprofit','private')),
  agency_name     text,        -- public agencies only; always null for nonprofit and private
  city_program    text,        -- City-Owned Properties inventory type (e.g. 'URA Transfer', 'PLB Transfer', 'CDC Property Reserve', 'Public Sale')
  basis           text not null, -- how the class was decided: city_inventory | mailing_address | government_class | none
  tax_delinquent  boolean not null default false,  -- open county tax lien (public.tax_delinquency)
  constraint agency_only_public check (agency_name is null or owner_class not in ('private','nonprofit'))
);
create index if not exists parcel_owner_class_class_idx on public.parcel_owner_class (owner_class);

do $$
declare t text;
begin
  foreach t in array array['parcel_owner_class'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
