-- Pittsburgh zoning district standards transcribed from the Zoning Code (data/seed/pgh_zoning_rules.csv).
-- Use permissions: P permitted, C conditional use, S special exception, A administrator exception, N not permitted.
create table if not exists public.zoning_rules (
  zone_code                   text primary key,
  district_name               text,
  single_unit_detached        text,
  two_unit                    text,
  three_unit                  text,
  multi_unit                  text,
  min_lot_area_sqft           numeric,
  min_lot_area_per_unit_sqft  numeric,
  min_front_setback_ft        numeric,
  min_rear_setback_ft         numeric,
  min_side_setback_ft         numeric,
  max_height_ft               numeric,
  max_height_stories          numeric,
  max_far                     numeric,
  max_lot_coverage_pct        numeric,
  parking_per_unit            numeric,
  contextual_front_setback    boolean,
  citation                    text,
  confidence                  text,
  notes                       text
);
alter table public.zoning_rules enable row level security;
grant select on public.zoning_rules to anon, authenticated;
grant all on public.zoning_rules to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='zoning_rules' and policyname='public read') then
    create policy "public read" on public.zoning_rules for select to anon, authenticated using (true);
  end if;
end $$;
