-- Pittsburgh Regional Transit (PRT) stops, from the static GTFS feed.
-- Frequency is measured against a representative weekday service (Mon-Fri, no
-- exceptions) in the feed's current schedule period.

create table if not exists public.transit_stops (
  stop_id             text primary key,
  stop_name           text,
  peak_trips_per_hour  numeric,   -- weekday trips/hour, 7-9am
  weekday_trips       int,        -- total weekday trips at this stop
  frequent            boolean,    -- peak_trips_per_hour >= 4 (every 15 min or better)
  geom                extensions.geometry(Point, 4326)
);
create index if not exists transit_stops_geom_gix on public.transit_stops using gist (geom);

do $$
declare t text;
begin
  foreach t in array array['transit_stops'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
