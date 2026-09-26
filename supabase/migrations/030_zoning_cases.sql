-- Zoning decisions: one row per case, one row per requested item, plus the
-- inventory of where each Allegheny County municipality posts zoning decisions.
-- Keyed on parcel + address only: no applicant, attorney, owner, or neighbor names.
-- Every row links to its source document (source_url).

create table if not exists public.zoning_cases (
  case_id             text primary key,     -- '<jurisdiction>:<body>:<case_number>'
  jurisdiction        text not null,        -- e.g. 'Pittsburgh'
  case_number         text,                 -- e.g. '50 of 2025' or Legistar file number
  parid               char(16),             -- matched parcel; null when ambiguous/unmatched
  address             text,
  district            text,                 -- zoning district(s) as written
  ward                text,
  neighborhood        text,
  application_number  text,                 -- e.g. BDA-2025-01234
  hearing_date        date,
  decision_date       date,
  body                text not null,        -- ZBA / ZHB / Planning Commission / City Council / HRC
  source_url          text not null,
  source_quality      text not null,        -- formal_decision / agenda / minutes / OCR
  status              text,                 -- decided / pending / withdrawn / ...
  lot_block           text,                 -- as printed (e.g. 126-C-195), used for parid match
  request_summary     text,                 -- name-scrubbed free text
  opposition          boolean,              -- whether opposition appeared (never who)
  permit_id           text,                 -- linked public.permits.permit_id (Source F)
  collected_at        timestamptz not null default now()
);
create index if not exists zoning_cases_parid_idx on public.zoning_cases (parid);
create index if not exists zoning_cases_juris_idx on public.zoning_cases (jurisdiction, body, decision_date);
create index if not exists zoning_cases_app_idx on public.zoning_cases (application_number);

create table if not exists public.zoning_requests (
  request_id       text primary key,        -- '<case_id>#<n>'
  case_id          text not null references public.zoning_cases (case_id) on delete cascade,
  relief_type      text,                    -- variance / special_exception / use_variance / dimensional / conditional_use / other
  code_section     text,
  required_value   text,
  requested_value  text,
  outcome          text,                    -- granted / denied / partially_granted / withdrawn / pending / other
  conditions       text                     -- name-scrubbed free text
);
create index if not exists zoning_requests_case_idx on public.zoning_requests (case_id);
create index if not exists zoning_requests_relief_idx on public.zoning_requests (relief_type, outcome);

-- PART 3 step 1: one row per Allegheny County municipality.
create table if not exists public.municipal_zoning_sources (
  municode           text primary key,
  municipality       text not null,
  website_url        text,
  platform           text,                  -- CivicPlus / ecode360 / custom / none / ...
  zhb_page_url       text,
  zhb_page_exists    boolean,
  decisions_posted   boolean,
  agendas_posted     boolean,
  minutes_posted     boolean,
  years_available    text,                  -- e.g. '2019-2026'
  notes              text,
  checked_at         date
);

do $$
declare t text;
begin
  foreach t in array array['zoning_cases','zoning_requests','municipal_zoning_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
