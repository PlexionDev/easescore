-- millage_rates: one read shape over the existing public.millage table (065)
-- for the Policy seat's fiscal ledger -- county, every municipality, every
-- school district, current year, with source. A view, so there is one copy
-- of the numbers. muni_code maps the City rows (CITY_PGH, ...) to the
-- public.municipalities / public.parcel_geo code; school_key is a normalized
-- name: join with public.school_key(parcel_geo.school_district).
create or replace function public.school_key(n text) returns text
language sql immutable as $$
  select replace(
    regexp_replace(regexp_replace(upper(n), '[^A-Z]', '', 'g'), '(CITY|BORO|TWP|TOWNSHIP|AREA)$', ''),
    'WESTJEFFERSONHILLS', 'WESTJEFFERSON')
$$;
grant execute on function public.school_key(text) to anon, authenticated, service_role;

create or replace view public.millage_rates with (security_invoker = true) as
select
  m.jurisdiction_type as body_type,     -- county | municipality | school_district
  m.code              as body_code,
  m.name              as body_name,
  m.rate_type,                          -- general | land | building (split-rate: Clairton, McKeesport)
  m.year,
  m.mills,
  m.source_url,
  case m.code when 'CITY_PGH' then '100' when 'CITY_CLAIRTON' then '200'
              when 'CITY_DUQUESNE' then '300' when 'CITY_MCKEESPORT' then '400'
              else case when m.jurisdiction_type = 'municipality' then m.code end end as muni_code,
  case when m.jurisdiction_type = 'school_district' then public.school_key(m.name) end as school_key
from public.millage m;

grant select on public.millage_rates to anon, authenticated;
grant all on public.millage_rates to service_role;
