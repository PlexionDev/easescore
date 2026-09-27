-- Policy Analyst seat (/policy): "test a rule change".
--
-- policy_states   one row per lever state (key = engine/src/policy/levers.ts stateKey, e.g. "a35.m0").
--                 status queued -> running -> done; progress counters; the aggregated summary.
-- policy_results  one row per (lever state, parcel the state touches): capacity before/after, the quick
--                 pencil test in three scenarios and the added assessed value at build-out. Written by
--                 scripts/policy_batch.ts (throttled background job) with the service key.
-- policy_meta     shared inputs with their sources: new-construction value per sq ft by neighborhood,
--                 the assessment ratio, the millage used. Written by the same script.
--
-- Nothing here reads census or demographic data: capacity and pencils come from zoning, lot geometry,
-- hazards, access, sale prices and cost assumptions only. Read-only for the browser (RLS public read).

create table if not exists public.policy_states (
  key             text primary key,
  levers          jsonb not null,
  config_version  text,
  status          text not null default 'queued',   -- queued | running | done | failed
  done            int not null default 0,
  total           int,
  summary         jsonb,
  error           text,
  requested_at    timestamptz not null default now(),
  started_at      timestamptz,
  computed_at     timestamptz
);

create table if not exists public.policy_results (
  key              text not null,
  parid            char(16) not null,
  config_version   text not null,
  touched          text[] not null,
  units_before     int,
  units_after      int,
  units_delta      int not null default 0,
  score_before     int,
  score_after      int,
  band_after       text,
  strategy_after   text,
  pencils_low      boolean,
  pencils_likely   boolean,
  pencils_high     boolean,
  sale_value_likely numeric,
  av_delta_low     numeric not null default 0,
  av_delta_likely  numeric not null default 0,
  av_delta_high    numeric not null default 0,
  av_before        numeric,
  neighborhood     text,
  zoning           text,
  lon              double precision,
  lat              double precision,
  computed_at      timestamptz not null default now(),
  primary key (key, parid)
);
create index if not exists policy_results_delta_idx on public.policy_results (key, units_delta desc);
create index if not exists policy_results_hood_idx on public.policy_results (key, neighborhood);

create table if not exists public.policy_meta (
  id           text primary key,
  payload      jsonb not null,
  computed_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['policy_states', 'policy_results', 'policy_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- Aggregate one lever state. Homes are "additional homes allowed by right" (capacity, not production).
-- Pencil counts are homes on parcels whose by-right scheme passes the quick pencil test per scenario;
-- low <= likely <= high holds per parcel, so it holds for the sums.
create or replace function public.policy_summary(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$
  with r as (select * from public.policy_results where key = p_key),
  pos as (select * from r where units_delta > 0),
  hood as (
    select coalesce(neighborhood, 'Unknown') neighborhood, count(*) parcels, sum(units_delta) homes,
           count(*) filter (where coalesce(units_before, 0) = 0) newly,
           sum(units_delta) filter (where pencils_likely) homes_pencil
    from pos group by 1
  ),
  combo as (select array_to_string(touched, '+') levers, count(*) parcels, sum(units_delta) homes from pos group by 1)
  select jsonb_build_object(
    'key', p_key,
    'eligible', (select count(*) from r),
    'parcels_gaining', (select count(*) from pos),
    'newly_buildable', (select count(*) from pos where coalesce(units_before, 0) = 0),
    'homes', (select coalesce(sum(units_delta), 0) from pos),
    -- Homes that need no lot split (townhouse rows need a subdivision plan, an extra step): the low end.
    'homes_no_split', (select coalesce(sum(units_delta), 0) from pos where coalesce(strategy_after, '') <> 'townhouse_row'),
    'newly_no_split', (select count(*) from pos where coalesce(units_before, 0) = 0 and coalesce(strategy_after, '') <> 'townhouse_row'),
    'by_strategy', coalesce((select jsonb_object_agg(coalesce(strategy_after, 'none'), n) from (select strategy_after, sum(units_delta) n from pos group by 1) x), '{}'),
    'homes_lost', (select coalesce(sum(-units_delta), 0) from r where units_delta < 0),
    'homes_pencil', jsonb_build_object(
        'low', (select coalesce(sum(units_delta), 0) from pos where pencils_low),
        'likely', (select coalesce(sum(units_delta), 0) from pos where pencils_likely),
        'high', (select coalesce(sum(units_delta), 0) from pos where pencils_high)),
    'parcels_pencil', jsonb_build_object(
        'low', (select count(*) from pos where pencils_low),
        'likely', (select count(*) from pos where pencils_likely),
        'high', (select count(*) from pos where pencils_high)),
    'no_value_data', (select count(*) from pos where pencils_likely is null),
    'av_delta', jsonb_build_object(
        'low', (select coalesce(sum(av_delta_low), 0) from pos),
        'likely', (select coalesce(sum(av_delta_likely), 0) from pos),
        'high', (select coalesce(sum(av_delta_high), 0) from pos)),
    'av_before_gaining', (select coalesce(sum(av_before), 0) from pos),
    'by_neighborhood', coalesce((select jsonb_agg(to_jsonb(h) order by h.homes desc, h.neighborhood) from hood h), '[]'),
    'by_levers', coalesce((select jsonb_agg(to_jsonb(c) order by c.homes desc) from combo c), '[]'),
    'computed_at', (select max(computed_at) from r));
$$;

-- Map points for the "policy wave":
-- [parid, lon, lat, units_delta, touched levers, newly buildable, pencils likely, units_before].
create or replace function public.policy_points(p_key text, p_limit int default 20000)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(parid, lon, lat, units_delta, array_to_string(touched, '+'),
                                              coalesce(units_before, 0) = 0, pencils_likely, coalesce(units_before, 0))
                            order by units_delta desc, parid), '[]')
  from (select * from public.policy_results
        where key = p_key and units_delta > 0 and lon is not null
        order by units_delta desc, parid
        limit least(greatest(coalesce(p_limit, 20000), 1), 60000)) x
$$;

-- Queue a lever state for the background job (on-demand combinations). Idempotent; never touches a
-- finished state. Keys are validated to the stateKey alphabet so nothing else can be written.
create or replace function public.policy_request(p_key text, p_levers jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare s public.policy_states;
begin
  if p_key is null or length(p_key) > 40 or p_key !~ '^(base|[a-z0-9]+(\.[a-z0-9]+)*)$' then
    raise exception 'bad key';
  end if;
  insert into public.policy_states (key, levers, status) values (p_key, coalesce(p_levers, '{}'), 'queued')
  on conflict (key) do nothing;
  select * into s from public.policy_states where key = p_key;
  return jsonb_build_object('key', s.key, 'status', s.status, 'done', s.done, 'total', s.total);
end $$;

revoke all on function public.policy_summary(text) from public;
revoke all on function public.policy_points(text, int) from public;
revoke all on function public.policy_request(text, jsonb) from public;
grant execute on function public.policy_summary(text) to anon, authenticated, service_role;
grant execute on function public.policy_points(text, int) to anon, authenticated, service_role;
grant execute on function public.policy_request(text, jsonb) to anon, authenticated, service_role;
