-- School district boundaries (countywide) and Pittsburgh Public Schools feeder-pattern
-- attendance zones. PPS zones date from the 2012-13 school year: always show them with
-- "verify with the district".
create table if not exists public.school_districts (
  id      bigint primary key,
  name    text not null,
  geom    extensions.geometry(MultiPolygon, 4326)
);
create index if not exists school_districts_geom_gix on public.school_districts using gist (geom);

create table if not exists public.pps_attendance_zones (
  level      text not null,   -- elementary | middle | high
  school_id  text not null,
  school     text,
  geom       extensions.geometry(MultiPolygon, 4326),
  primary key (level, school_id)
);
create index if not exists pps_zones_geom_gix on public.pps_attendance_zones using gist (geom);

-- Per-parcel school tags, computed in the database from parcel points.
create table if not exists public.parcel_schools (
  parid                  char(16) primary key,
  district               text,     -- from the boundary layer
  district_assessment    text,     -- school district named in the county assessment
  district_match         boolean,
  near_district_line_m   numeric,  -- distance to nearest district boundary (meters) when < 150
  pps_elementary         text,
  pps_middle             text,
  pps_high               text
);

do $$
declare t text;
begin
  foreach t in array array['school_districts','pps_attendance_zones','parcel_schools'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
