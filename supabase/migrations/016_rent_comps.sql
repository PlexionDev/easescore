-- Zillow Observed Rent Index (ZORI, all homes, smoothed, monthly) by ZIP for Allegheny County.
create table if not exists public.zori_zip (
  zip    text not null,
  month  date not null,
  rent   numeric,
  primary key (zip, month)
);
alter table public.zori_zip enable row level security;
grant select on public.zori_zip to anon, authenticated;
grant all on public.zori_zip to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='zori_zip' and policyname='public read') then
    create policy "public read" on public.zori_zip for select to anon, authenticated using (true);
  end if;
end $$;

-- ZIP centroids from parcel centroids (for "nearest ZIP with data" when a ZIP has no index).
create or replace view public.zip_centroids with (security_invoker = true) as
  select left(a.zip, 5) zip, extensions.ST_Centroid(extensions.ST_Collect(p.centroid)) geom, count(*) parcels
  from public.assessments a join public.parcels p using (parid)
  where a.zip ~ '^[0-9]{5}' group by 1;
grant select on public.zip_centroids to anon, authenticated;

-- parcel_rent_comps(parid): rent evidence for the parcel's ZIP, never silently estimated.
-- Sources: ZORI (market index by ZIP), HUD Small Area FMR (by ZIP and bedrooms), RentEase (when available).
create or replace function public.parcel_rent_comps(p_parid text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  z       text;
  zc      extensions.geometry;
  zori_z  text;
  note    text;
  zori    jsonb;
  fmr     jsonb;
begin
  select left(a.zip, 5) into z from assessments a where a.parid = p_parid;
  if z is null then return jsonb_build_object('status', 'insufficient comps', 'note', 'Parcel has no ZIP code on record.'); end if;

  zori_z := z;
  if not exists (select 1 from zori_zip where zip = z) then
    select geom into zc from zip_centroids where zip = z;
    select zz.zip into zori_z
    from (select distinct zip from zori_zip) zz join zip_centroids c using (zip)
    order by ST_Distance(c.geom::geography, zc::geography) limit 1;
    note := format('No Zillow rent index for ZIP %s; using the nearest ZIP with one (%s, %s mi away).', z, zori_z,
      (select round((ST_Distance(c.geom::geography, zc::geography) / 1609.34)::numeric, 1) from zip_centroids c where c.zip = zori_z));
  end if;

  select jsonb_build_object(
      'zip', zori_z,
      'latest_month', max(month), 'latest_rent', (array_agg(rent order by month desc))[1],
      'rent_12m_ago', (select rent from zori_zip x where x.zip = zori_z and x.month = (select max(month) from zori_zip where zip = zori_z) - interval '1 year'),
      'months', count(*), 'from', min(month), 'to', max(month),
      'source', 'Zillow Observed Rent Index (ZORI), all homes, smoothed — Zillow Research')
    into zori
  from zori_zip where zip = zori_z and month >= (select max(month) from zori_zip) - interval '5 years';

  select jsonb_build_object('year', f.year, 'zip', f.zip, 'br0', f.br0, 'br1', f.br1, 'br2', f.br2, 'br3', f.br3, 'br4', f.br4,
                            'level', case when f.zip is null then 'metro' else 'small area (ZIP)' end,
                            'source', 'HUD Fair Market Rents')
    into fmr
  from hud_fmr f where f.zip = z or f.zip is null order by (f.zip is null) limit 1;

  return jsonb_build_object(
    'kind', 'rent',
    'zip', z,
    'status', case when zori is null and fmr is null then 'insufficient comps' else 'ok' end,
    'note', note,
    'zori', zori,
    'hud_fmr', fmr,
    'rentease', jsonb_build_object('status', 'not available', 'note', 'RentEase listings are not loaded yet.'),
    'rules', 'Index and benchmark rents only; listing-level rent comps require RentEase or licensed data');
end $$;
revoke all on function public.parcel_rent_comps(text) from public;
grant execute on function public.parcel_rent_comps(text) to anon, authenticated, service_role;
