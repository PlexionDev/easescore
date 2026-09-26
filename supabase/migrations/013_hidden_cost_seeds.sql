-- Researched hidden-cost facts (data/seed/*.csv, sources and confidence per row).
create table if not exists public.muni_transfer_requirements (
  muni_code                   text primary key,
  municipality                text,
  sewer_lateral_at_sale       text,   -- Y / N / unknown
  sewer_lateral_details       text,
  point_of_sale_inspection    text,
  pos_details                 text,
  occupancy_permit_at_resale  text,
  source_url                  text,
  confidence                  text    -- confirmed / partial / likely / unknown
);
create table if not exists public.realty_transfer_tax (
  jurisdiction       text,
  jurisdiction_type  text,            -- state / municipality / school_district
  muni_code          text,            -- set for municipality rows
  rate_pct           numeric,
  effective_date     date,
  source_url         text,
  confidence         text,
  primary key (jurisdiction, jurisdiction_type)
);
create table if not exists public.utility_tap_fees (
  id              bigint primary key,
  authority       text,
  service         text,
  fee_type        text,
  amount          numeric,
  unit            text,
  effective_date  date,
  source_url      text,
  confidence      text
);
do $$
declare t text;
begin
  foreach t in array array['muni_transfer_requirements','realty_transfer_tax','utility_tap_fees'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
