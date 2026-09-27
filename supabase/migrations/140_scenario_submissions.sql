-- Scenario data loop (TODO item 6): anonymous pro forma / QuickFit scenarios.
--
-- Privacy rules enforced here:
--   * No personal identifiers: there is no column for a name, email, phone, IP, user agent, referrer,
--     account/session/request ID, cookie or free text. Time is kept to the day only (no timestamp).
--   * The parcel is core: parid is kept; address and municipality are filled from the County
--     assessment by the trigger below (never taken from the browser).
--   * RLS on and no policies: anon/authenticated cannot read or write the table. Inserts come only
--     from the server route (/api/scenarios) with the service key.
--   * One row per parcel + strategy + scheme + day + canonical params (dedupe_key, a SHA-256 made
--     by the server).
--   * Aggregates are public only through scenario_community_medians(), which returns nothing for a
--     group with fewer than 5 scenarios. Engine defaults never change from this table automatically.

create table if not exists public.scenario_submissions (
  id           bigint generated always as identity primary key,
  day          date not null,
  parid        char(16) not null references public.parcels (parid),
  address      text,
  municode     text,
  strategy     text not null check (strategy ~ '^[a-z0-9_]{1,40}$'),
  scheme       text not null check (length(scheme) <= 64),
  tier         text check (tier is null or tier ~ '^[a-z0-9_.-]{1,40}$'),
  params       jsonb not null,
  line_per_sf  jsonb not null default '{}'::jsonb,
  summary      jsonb not null,
  dedupe_key   text not null unique check (dedupe_key ~ '^[0-9a-f]{64}$')
);
create index if not exists scenario_submissions_group_idx on public.scenario_submissions (strategy, tier, municode);

alter table public.scenario_submissions enable row level security;
revoke all on public.scenario_submissions from anon, authenticated;
grant all on public.scenario_submissions to service_role;
-- (no policies on purpose: nothing is readable or writable with the publishable key)

-- Address and municipality come from the County assessment, not from the request.
create or replace function public.scenario_submissions_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select nullif(trim(concat_ws(' ', a.house_num, a.address)), ''), a.municode
    into new.address, new.municode
    from public.assessments a where a.parid = new.parid;
  return new;
end $$;
drop trigger if exists scenario_submissions_fill on public.scenario_submissions;
create trigger scenario_submissions_fill before insert on public.scenario_submissions
  for each row execute function public.scenario_submissions_fill();

-- Community medians of user-entered budget lines ($ per finished sq ft), n >= 5 enforced here.
-- One vote per parcel + scheme + day: that group's own median first, then the median of those, so one
-- visitor editing a line many times on one lot in one day counts once.
-- scope 'area' = same municipality; scope 'all' = every area, same strategy and tier.
create or replace function public.scenario_community_medians(p_strategy text, p_tier text, p_municode text)
returns table (line_id text, scope text, median_per_sf numeric, n integer)
language sql stable security definer set search_path = public as $$
  with vals as (
    select s.parid, s.scheme, s.day, s.municode, kv.key as line_id, (kv.value)::text::numeric as v
      from public.scenario_submissions s, jsonb_each(s.line_per_sf) kv
     where s.strategy = p_strategy
       and s.tier is not distinct from p_tier
       and jsonb_typeof(kv.value) = 'number'
  ), votes as (
    select parid, scheme, day, municode, line_id,
           percentile_cont(0.5) within group (order by v) as v
      from vals group by parid, scheme, day, municode, line_id
  ), agg as (
    select line_id, 'area'::text as scope, percentile_cont(0.5) within group (order by v) as m, count(*)::int as n
      from votes where p_municode is not null and municode = p_municode group by line_id
    union all
    select line_id, 'all'::text, percentile_cont(0.5) within group (order by v), count(*)::int
      from votes group by line_id
  )
  select line_id, scope, round(m::numeric, 2), n from agg where n >= 5;
$$;
revoke all on function public.scenario_community_medians(text, text, text) from public;
grant execute on function public.scenario_community_medians(text, text, text) to anon, authenticated, service_role;
revoke all on function public.scenario_submissions_fill() from public, anon, authenticated;
