-- EaseScore.AI core tables. Join key everywhere: parid (16-char Allegheny County parcel ID).
-- Personal data is dropped at ingest: no owner mailing addresses, deed book/page, or legal descriptions.
-- RLS is enabled on every table; the browser (anon/authenticated) gets read-only access.

create extension if not exists postgis with schema extensions;

-- 1. Property assessments (one row per parcel)
create table if not exists public.assessments (
  parid              char(16) primary key,
  house_num          text,
  address            text,
  unit               text,
  city               text,
  zip                text,
  municode           text,
  muni_desc          text,
  school_code        text,
  school_desc        text,
  neigh_code         text,
  neigh_desc         text,
  tax_code           text,
  tax_desc           text,
  owner_type         text,     -- category only (e.g. REGULAR, CORPORATION); never a name
  class_code         text,
  class_desc         text,
  use_code           text,
  use_desc           text,
  lot_area_sqft      numeric,
  homestead          boolean,
  clean_green        boolean,
  abatement          boolean,
  last_sale_date     date,
  last_sale_price    numeric,
  last_sale_code     text,
  last_sale_desc     text,
  county_land        numeric,
  county_building    numeric,
  county_total       numeric,
  fmv_land           numeric,
  fmv_building       numeric,
  fmv_total          numeric,
  style_desc         text,
  stories            numeric,
  year_built         int,
  grade_desc         text,
  condition_desc     text,
  cdu_desc           text,
  living_area_sqft   numeric,
  tax_year           int,
  as_of_date         date
);
create index if not exists assessments_muni_idx on public.assessments (municode);
create index if not exists assessments_class_idx on public.assessments (class_code);

-- 2. Parcel boundaries (WGS84)
create table if not exists public.parcels (
  parid          char(16) primary key,
  map_block_lot  text,
  municode       text,
  calc_acreage   numeric,
  geom           extensions.geometry(MultiPolygon, 4326),
  centroid       extensions.geometry(Point, 4326)
);
create index if not exists parcels_geom_gix on public.parcels using gist (geom);
create index if not exists parcels_centroid_gix on public.parcels using gist (centroid);

-- Read access for the app; writes only via server (service_role bypasses RLS).
do $$
declare t text;
begin
  foreach t in array array['assessments','parcels'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
