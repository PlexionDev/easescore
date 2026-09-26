-- City of Pittsburgh street tree inventory (WPRDC "City of Pittsburgh Trees", DPW Forestry).
-- Only species and trunk diameter are kept; the source has no owner/personal fields.
create table if not exists public.street_trees (
  id      bigint primary key,
  common_name  text,
  dbh          numeric,  -- diameter at base/breast height, inches (source: diameter_base_height)
  geom         extensions.geometry(Point, 4326)
);
create index if not exists street_trees_geom_gix on public.street_trees using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['street_trees'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
