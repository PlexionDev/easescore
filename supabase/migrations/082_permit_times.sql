-- City of Pittsburgh permit processing time: observed durations, the current review queue, and
-- PLI's published review targets (SLAs). Filled by scripts/ingest_permit_times.py.
--
-- permit_timing: application-to-issue days by type. EMPTY as of 2026-09-26: no public City dataset
--   carries an application/submission date for PLI permits (WPRDC "PLI Permits" has issue_date only;
--   the OneStopPGH Insights layer leaves submitted_date blank for PLI permit types). The table and
--   the function are ready for it; permit_time_estimate() says so in 'timing_note'.
-- permit_queue:  snapshot of PLI/DCP "List of Permits Pending Review" (age = as_of - last submission).
-- permit_targets: PLI "Application Review Order and Service Level Agreements" (business days).
--
-- permit_type vocabulary (normalized): Building (BDA / BUILDING / BP), Electrical, Mechanical,
-- Demolition, Fire Alarm, Suppression System, Floodplain, Sign, Occupancy Only,
-- Occupant Load Placard, Land Operations, Storm Water. structure_type: Residential | Commercial | All.

create table if not exists public.permit_timing (
  permit_type     text not null,
  work_type       text not null default 'All',
  structure_type  text not null default 'All',
  n               int,
  median_days     numeric,
  p80_days        numeric,
  date_from       date,
  date_to         date,
  computed_at     timestamptz not null default now(),
  primary key (permit_type, work_type, structure_type)
);

create table if not exists public.permit_queue (
  permit_type            text not null,
  structure_type         text not null,          -- Residential | Commercial | Unspecified | All
  pending_count          int,                    -- distinct permit numbers in the queue
  median_age_days        numeric,                -- as_of - submitted (last submission, resets on revision)
  p80_age_days           numeric,
  median_scheduled_days  numeric,                -- City's "Expected Date" - submitted: scheduled review time
  p80_scheduled_days     numeric,
  as_of                  date not null,          -- "Date Created" printed on the spreadsheet
  source_url             text,
  primary key (permit_type, structure_type, as_of)
);

create table if not exists public.permit_targets (
  permit_type           text not null,
  structure_type        text not null,           -- Residential | Commercial
  review_round          text not null check (review_round in ('initial', 'revision')),
  target_days           int not null,            -- business days, as published
  target_calendar_days  int,                     -- ceil(business days * 7 / 5); ignores holidays
  scope_note            text,
  source_url            text not null,
  as_of                 date,                    -- page "last updated" date
  primary key (permit_type, structure_type, review_round)
);

do $$
declare t text;
begin
  foreach t in array array['permit_timing', 'permit_queue', 'permit_targets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- Map any PLI permit-type spelling (WPRDC permits table, queue spreadsheet, or free input) to the
-- normalized vocabulary above.
create or replace function public.permit_type_norm(t text) returns text
language sql immutable set search_path = public as $$
  select case
    when t is null then null
    when t ~* 'demol' then 'Demolition'
    when t ~* 'building|^bda|^bp$' then 'Building'
    when t ~* 'electric' then 'Electrical'
    when t ~* 'mechanic' then 'Mechanical'
    when t ~* 'fire alarm' then 'Fire Alarm'
    when t ~* 'suppression' then 'Suppression System'
    when t ~* 'flood' then 'Floodplain'
    when t ~* 'occupant load' then 'Occupant Load Placard'
    when t ~* 'occupancy' then 'Occupancy Only'
    when t ~* 'land op' then 'Land Operations'
    when t ~* 'storm' then 'Storm Water'
    when t ~* 'sign' then 'Sign'
    else initcap(trim(regexp_replace(t, '\s*permit$', '', 'i'))) end
$$;

-- permit_time_estimate(permit_type, work_type[, structure]): everything known about how long a
-- City of Pittsburgh permit takes, as one JSON object. structure defaults to Residential.
create or replace function public.permit_time_estimate(p_permit_type text, p_work_type text,
                                                       p_structure text default 'Residential')
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with k as (
    select public.permit_type_norm(p_permit_type) pt,
           coalesce(nullif(trim(p_work_type), ''), 'All') wt,
           case when p_structure ~* '^comm' then 'Commercial' else 'Residential' end st),
  tm as (
    select t.* from public.permit_timing t, k
    where t.permit_type = k.pt and t.work_type in (k.wt, 'All') and t.structure_type in (k.st, 'All')
    order by (t.work_type = k.wt) desc, (t.structure_type = k.st) desc limit 1),
  tg as (
    select max(target_days) filter (where review_round = 'initial') initial_bd,
           max(target_days) filter (where review_round = 'revision') revision_bd,
           max(target_calendar_days) filter (where review_round = 'initial') initial_cd,
           max(source_url) url, max(as_of) as_of
    from public.permit_targets t, k where t.permit_type = k.pt and t.structure_type = k.st),
  q as (
    select qq.* from public.permit_queue qq, k
    where qq.permit_type = k.pt and qq.structure_type = k.st
      and qq.as_of = (select max(as_of) from public.permit_queue))
  select jsonb_build_object(
    'permit_type', k.pt, 'work_type', k.wt, 'structure', k.st,
    'median_days', tm.median_days, 'p80_days', tm.p80_days, 'n', coalesce(tm.n, 0),
    'date_from', tm.date_from, 'date_to', tm.date_to,
    'timing_available', tm.n is not null,
    'timing_note', case when tm.n is null then
      'No public City dataset publishes application dates for PLI permits, so application-to-issue times cannot be measured. Use the published review target and the current queue instead.' end,
    'target_days', tg.initial_bd,
    'target_unit', 'business days (first review)',
    'target_revision_days', tg.revision_bd,
    'target_calendar_days', tg.initial_cd,
    'target_source_url', tg.url, 'target_as_of', tg.as_of,
    'queue_pending', coalesce(q.pending_count, 0),
    'queue_median_age_days', q.median_age_days, 'queue_p80_age_days', q.p80_age_days,
    'queue_median_scheduled_days', q.median_scheduled_days, 'queue_p80_scheduled_days', q.p80_scheduled_days,
    'queue_as_of', (select max(as_of) from public.permit_queue),
    'sources', 'City of Pittsburgh PLI: Permit Application Review SLAs; List of Permits Pending Review; WPRDC PLI Permits',
    'caveat', 'Targets cover one review round; each revision request restarts the clock. Zoning, historic, and other agency reviews are extra.')
  from k left join tm on true left join tg on true left join q on true
$$;

revoke all on function public.permit_time_estimate(text, text, text) from public;
grant execute on function public.permit_time_estimate(text, text, text) to anon, authenticated, service_role;
grant execute on function public.permit_type_norm(text) to anon, authenticated, service_role;
