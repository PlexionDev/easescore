-- City of Pittsburgh PLI permits (2019-present) and condemned / dead-end properties.
-- Owner, contractor, and free-text description fields are never loaded.
create table if not exists public.permits (
  permit_id      text primary key,
  parid          char(16),
  permit_type    text,
  work_type      text,
  res_or_comm    text,
  project_value  numeric,
  issue_date     date,
  status         text
);
create index if not exists permits_parid_idx on public.permits (parid);
create index if not exists permits_type_idx on public.permits (permit_type, work_type);

create table if not exists public.condemned (
  record_number        text primary key,
  parid                char(16),
  property_type        text,
  created              date,
  inspection_result    text,
  inspection_score     numeric,
  status               text
);
create index if not exists condemned_parid_idx on public.condemned (parid);

do $$
declare t text;
begin
  foreach t in array array['permits','condemned'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
