-- RentCast rental listings cache (asking rents by bedroom count near a location).
-- RentCast API Terms §1 permit storing API data and displaying it to users (checked 2026-09-27).
-- Rows hold listing facts only (address, beds, baths, size, type, asking rent, distance, last seen,
-- year built) — never listing ids, owner, agent, office or contact fields.
-- Key = location rounded to ~100 m ("40.441,-79.981"), one row per bedroom count.
-- Written server-side with the secret key (lib/rents/rentcast.ts); read through rent_cache_get().
create table if not exists public.rentcast_cache (
  loc_key     text not null,
  bedrooms    int  not null,
  lat         double precision not null,
  lon         double precision not null,
  fetched_at  timestamptz not null default now(),
  listings    jsonb not null,
  primary key (loc_key, bedrooms)
);
alter table public.rentcast_cache enable row level security;
grant all on public.rentcast_cache to service_role;
revoke all on public.rentcast_cache from anon, authenticated;

create or replace function public.rent_cache_get(p_loc_key text, p_max_age_days int default 30)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(bedrooms::text, jsonb_build_object('fetched_at', fetched_at, 'listings', listings)), '{}'::jsonb)
  from public.rentcast_cache
  where loc_key = p_loc_key and fetched_at > now() - make_interval(days => p_max_age_days);
$$;
revoke all on function public.rent_cache_get(text, int) from public;
grant execute on function public.rent_cache_get(text, int) to anon, authenticated, service_role;
