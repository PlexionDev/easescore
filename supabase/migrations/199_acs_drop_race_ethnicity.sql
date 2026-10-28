-- EaseScore stores no race or ethnicity data. Drops the ACS B03002 columns that 103 added to
-- acs_tract and acs_bg (no app code, view or function reads them), and takes B03002 out of the
-- ACS entry in the sources registry. scripts/ingest_seats.py no longer requests the table.

alter table public.acs_bg
  drop column if exists pop_race_universe,
  drop column if exists nh_white,
  drop column if exists nh_black,
  drop column if exists nh_asian,
  drop column if exists nh_other,
  drop column if exists nh_two_or_more,
  drop column if exists hispanic;

alter table public.acs_tract
  drop column if exists pop_race_universe,
  drop column if exists nh_white,
  drop column if exists nh_black,
  drop column if exists nh_asian,
  drop column if exists nh_other,
  drop column if exists nh_two_or_more,
  drop column if exists hispanic;

update public.sources
set name = 'American Community Survey 5-year estimates (tables B01003, B11005, B17001, C17002, B19013, B25003, B25064, B25070)',
    notes = 'No race or ethnicity tables are requested or stored. Block groups use C17002 for poverty (B17001 is tract-only).'
where id = 'acs5_2024';
