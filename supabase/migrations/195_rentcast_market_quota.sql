-- RentCast quota protection + ZIP market-statistics cache (additive; no data rewrites).
--
-- 1. rentcast_calls: one row per RentCast request we attempt (reserved BEFORE it is sent).
--    No keys, no response bodies: when, endpoint, caller (route name), ZIP, HTTP status.
-- 2. rentcast_reserve(): the only way to get permission for a live call. Atomic under concurrent
--    serverless calls (transaction-scoped advisory lock), limits hard-coded here so no caller can
--    raise them: 50 calls per day and 800 per calendar month, both in US Eastern time
--    (America/New_York). Every attempted request counts, whatever its outcome. After RentCast itself
--    answers with a quota response (HTTP 429 or 402) no more calls are allowed that day. A ZIP
--    already asked for in the last 10 minutes is refused ('recent'): concurrent requests for the same
--    ZIP (two panels on one page, two serverless instances) make one call, not several.
-- 3. rent_market_cache: RentCast /v1/markets rental statistics by ZIP (whitelisted per-bedroom
--    numbers only), with the retrieval time. Read through rent_market_get() (max age 30 days).
--    RentCast API Terms §1 allow storing and displaying API data (no retention limit stated);
--    30 days is our own freshness choice (.planning/DECISIONS.md).

create table if not exists public.rentcast_calls (
  id         bigserial primary key,
  called_at  timestamptz not null default now(),
  endpoint   text not null,
  caller     text not null,
  zip        text,
  status     text not null default 'reserved'
);
create index if not exists rentcast_calls_called_at_idx on public.rentcast_calls (called_at);
alter table public.rentcast_calls enable row level security;
revoke all on public.rentcast_calls from anon, authenticated;
grant all on public.rentcast_calls to service_role;
grant usage, select on sequence public.rentcast_calls_id_seq to service_role;

create table if not exists public.rent_market_cache (
  zip           text primary key check (zip ~ '^[0-9]{5}$'),
  retrieved_at  timestamptz not null default now(),
  by_bedroom    jsonb not null
);
alter table public.rent_market_cache enable row level security;
revoke all on public.rent_market_cache from anon, authenticated;
grant all on public.rent_market_cache to service_role;

-- p_day_cap can only LOWER the daily limit (e.g. RENTCAST_DAILY_CAP=5 on a demo night); never raise it.
drop function if exists public.rentcast_reserve(text, text, text);
create or replace function public.rentcast_reserve(p_endpoint text, p_caller text, p_zip text, p_day_cap int default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  day_limit   int := least(50, greatest(coalesce(p_day_cap, 50), 0));
  month_limit constant int := 800;
  now_et   timestamp := now() at time zone 'America/New_York';
  day_from timestamptz := date_trunc('day', now_et) at time zone 'America/New_York';
  mon_from timestamptz := date_trunc('month', now_et) at time zone 'America/New_York';
  n_day int; n_month int; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rentcast_reserve'));
  if exists (select 1 from public.rentcast_calls where called_at >= day_from and status in ('429', '402')) then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'day_limit', day_limit, 'month_limit', month_limit);
  end if;
  if exists (select 1 from public.rentcast_calls where zip = p_zip and endpoint = p_endpoint and called_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'recent', 'day_limit', day_limit, 'month_limit', month_limit);
  end if;
  select count(*) filter (where called_at >= day_from), count(*) into n_day, n_month
    from public.rentcast_calls where called_at >= mon_from;
  if n_day >= day_limit then
    return jsonb_build_object('ok', false, 'reason', 'day', 'day', n_day, 'month', n_month, 'day_limit', day_limit, 'month_limit', month_limit);
  end if;
  if n_month >= month_limit then
    return jsonb_build_object('ok', false, 'reason', 'month', 'day', n_day, 'month', n_month, 'day_limit', day_limit, 'month_limit', month_limit);
  end if;
  insert into public.rentcast_calls (endpoint, caller, zip) values (left(p_endpoint, 80), left(p_caller, 80), left(p_zip, 10))
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'day', n_day + 1, 'month', n_month + 1, 'day_limit', day_limit, 'month_limit', month_limit);
end;
$$;

create or replace function public.rentcast_record(p_id bigint, p_status text)
returns void
language sql volatile security definer
set search_path = public
as $$
  update public.rentcast_calls set status = left(p_status, 40) where id = p_id and status = 'reserved';
$$;

create or replace function public.rent_market_get(p_zip text, p_max_age_days int default 30)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('zip', zip, 'retrieved_at', retrieved_at, 'by_bedroom', by_bedroom)
  from public.rent_market_cache
  where zip = p_zip and retrieved_at > now() - make_interval(days => least(greatest(p_max_age_days, 0), 30));
$$;

revoke all on function public.rentcast_reserve(text, text, text, int) from public, anon, authenticated;
revoke all on function public.rentcast_record(bigint, text) from public, anon, authenticated;
grant execute on function public.rentcast_reserve(text, text, text, int) to service_role;
grant execute on function public.rentcast_record(bigint, text) to service_role;
revoke all on function public.rent_market_get(text, int) from public;
grant execute on function public.rent_market_get(text, int) to anon, authenticated, service_role;
