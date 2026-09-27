-- Policy seat: narrower, documented homes range and per-neighborhood pencil columns (additive).
-- homes_mid / newly_mid: the likely value of the "homes allowed by right" range (see the comment in the body).
-- by_neighborhood rows now carry homes_pencil as 0 instead of null when nothing pencils, plus homes_pencil_high
-- and homes_no_split. Same signature, same grants. The stored summaries are refreshed from policy_results
-- below (no batch rerun): summary || policy_summary(key) keeps the batch's own keys (skipped, parcels_seen).

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
           coalesce(sum(units_delta) filter (where pencils_likely), 0) homes_pencil,
           coalesce(sum(units_delta) filter (where pencils_high), 0) homes_pencil_high,
           coalesce(sum(units_delta) filter (where coalesce(strategy_after, '') not in ('townhouse_row', 'adu_unsized')), 0) homes_no_split
    from pos group by 1
  ),
  combo as (select array_to_string(touched, '+') levers, count(*) parcels, sum(units_delta) homes from pos group by 1)
  select jsonb_build_object(
    'key', p_key,
    'eligible', (select count(*) from r),
    'parcels_gaining', (select count(*) from pos),
    'newly_buildable', (select count(*) from pos where coalesce(units_before, 0) = 0),
    'homes', (select coalesce(sum(units_delta), 0) from pos),
    -- The low end: homes that need no lot split (townhouse rows need a subdivision plan, an extra step)
    -- and, for the ADU lever, only lots where the ADU footprint check passes ('adu_unsized' = it did not).
    'homes_no_split', (select coalesce(sum(units_delta), 0) from pos where coalesce(strategy_after, '') not in ('townhouse_row', 'adu_unsized')),
    'newly_no_split', (select count(*) from pos where coalesce(units_before, 0) = 0 and coalesce(strategy_after, '') not in ('townhouse_row', 'adu_unsized')),
    -- The middle of the range: the no-split homes plus homes that need the extra step (a lot split for a townhouse
    -- row; for ADUs, a lot where the footprint check did not pass) only where the scheme pencils at high prices,
    -- i.e. where the extra step could pay off at all. low <= mid <= homes holds per parcel.
    'homes_mid', (select coalesce(sum(units_delta), 0) from pos where coalesce(strategy_after, '') not in ('townhouse_row', 'adu_unsized') or pencils_high),
    'newly_mid', (select count(*) from pos where coalesce(units_before, 0) = 0 and (coalesce(strategy_after, '') not in ('townhouse_row', 'adu_unsized') or pencils_high)),
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

update public.policy_states set summary = summary || public.policy_summary(key)
where status = 'done' and summary is not null;
