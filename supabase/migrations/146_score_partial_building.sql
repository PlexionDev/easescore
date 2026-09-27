-- Scoring honesty, part 2: a lot the score treated as empty although the County's land use says a
-- building stands there (an office tower or a condominium unit whose building value is recorded
-- elsewhere, so no building value, year built or footprint reached the score) is not presented as an
-- easy new-build site. It reads "Partial" like a parcel with no zoning loaded: no score, never counted
-- in a band, sorted after every scored parcel. The test mirrors the engine's score.buildingUnscored()
-- (engine/src/score/bands.ts: BUILDING_USE_RE / BUILDING_USE_EXCLUDE_RE); keep the patterns identical.
-- Additive: one function, one lookup table (parids only, filled from parcel_scores + assessments),
-- and the two read functions from migration 145 re-created to read it. parcel_scores is not rewritten.
-- Ties on the sort column break on: higher score, then more homes by right, then fewer months to a
-- permit, then parcel ID.

create or replace function public.score_building_unscored(p_vacant boolean, p_use text)
 returns boolean
 language sql
 immutable
 parallel safe
as $$
  select coalesce(p_vacant, false) and p_use is not null
     and p_use ~* 'OFFICE|CONDOMINIUM (UNIT|OFFICE)|RETL|RETAIL|RESTAURANT|WAREHOUSE|MANUFACTURING|GARAGE|APART|APT|HOTEL|MOTEL|STORE|BANK|HOSPITAL|CHURCH|BUILDING|FAMILY|ROWHOUSE|TOWNHOUSE|DWELLING|NURSING|THEAT|CLUB|BOWLING|SCHOOL|MIXED|SERVICE STATION|DAY CARE|FUNERAL|INDUSTRIAL|MEDICAL|CLINIC'
     and p_use !~* 'NO HOUSE|VACANT|LAND\y|LOTS'
$$;
grant execute on function public.score_building_unscored(boolean, text) to anon, authenticated, service_role;

-- Parcels the score treated as an empty lot that are not one: reason 'use' (the County's land use is a
-- building), 'footprint' (building footprints cover at least half of the lot), 'not_lot' (air rights or a
-- condominium common area: not a lot you can build on).
drop table if exists public.planner_building_unscored;
create table public.planner_building_unscored (
  parid    char(16) primary key,
  use_desc text,
  reason   text not null check (reason in ('use', 'footprint', 'not_lot')),
  footprint_share numeric
);
alter table public.planner_building_unscored enable row level security;
create policy planner_building_unscored_read on public.planner_building_unscored for select using (true);
grant select on public.planner_building_unscored to anon, authenticated;

with cov as (
  select s.parid, (sum(st_area(st_intersection(b.geom, p.geom)::geography)) / nullif(st_area(p.geom::geography), 0))::numeric share
  from public.parcel_scores s join public.parcels p on p.parid = s.parid join public.buildings b on st_intersects(b.geom, p.geom)
  where s.vacant group by s.parid, p.geom)
insert into public.planner_building_unscored (parid, use_desc, reason, footprint_share)
select s.parid, a.use_desc,
       case when a.use_desc ~* '^(AIR RIGHTS|COMMON AREA)$' then 'not_lot'
            when public.score_building_unscored(s.vacant, a.use_desc) then 'use' else 'footprint' end,
       round(c.share, 3)
from public.parcel_scores s
left join public.assessments a on a.parid = s.parid
left join cov c on c.parid = s.parid
where s.vacant and (a.use_desc ~* '^(AIR RIGHTS|COMMON AREA)$' or public.score_building_unscored(s.vacant, a.use_desc) or c.share >= 0.5);

CREATE OR REPLACE FUNCTION public.planner_query(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'score'::text, p_dir text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  f    jsonb := coalesce(p_filters, '{}');
  col  text := case p_sort when 'months' then 'months_to_permit' when 'transit' then 'transit_m' when 'lot' then 'lot_sqft'
                           when 'by_right_units' then 'by_right_units' when 'units_with_relief' then 'units_with_relief'
                           when 'address' then 'address' when 'neighborhood' then 'neighborhood' when 'zoning' then 'zoning'
                           else 'score' end;
  dir  text := case when lower(p_dir) in ('asc', 'desc') then lower(p_dir)
                    when col in ('months_to_permit', 'transit_m', 'address', 'neighborhood', 'zoning') then 'asc' else 'desc' end;
  rows jsonb;
  summary jsonb;
  partial jsonb;
  bands jsonb;
  k text;
  n int;
  pn int := 0;
begin
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x) - ''pk''), ''[]'') from (
       select m.parid, m.address,
              case when q.reason is not null then null else m.score end as score,
              case when q.reason is not null then ''Partial'' else m.band end as band,
              q.reason as partial_reason, q.use_desc as partial_use,
              case when q.reason is not null then null else m.range_lo end as range_lo,
              case when q.reason is not null then null else m.range_hi end as range_hi,
              m.preliminary, m.red_flag_count, m.red_flags,
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit, m.planning_badge,
              m.badge_score, m.badge_matches, m.factor_scores,
              case when q.reason is not null then null else m.best_strategy end as best_strategy,
              case when q.reason in (''use'', ''footprint'') then false else m.vacant end as vacant,
              m.owner_class, m.owner_type, m.owner_agency,
              case when m.owner_class = ''public'' then m.tax_delinquent end as tax_delinquent, m.zoning, m.neighborhood, m.council_district, m.municipality, m.lot_sqft, m.lon, m.lat,
              m.transit_m, m.hz_floodway, m.hz_landslide, m.hz_undermined, m.steep_share,
              case when q.reason is not null then null else m.cap_label end as cap_label,
              case when q.reason is not null then null else m.rehab_score end as rehab_score,
              case when q.reason is not null then null else m.rehab_band end as rehab_band,
              m.note, m.config_version, m.data_dates, m.computed_at
       from public.planner_rows(%L::jsonb) m
       left join lateral (select case when public.score_is_partial(m.municipality, m.zoning) then ''zoning'' when u.parid is not null then u.reason end reason, u.use_desc
                          from (select 1) one left join public.planner_building_unscored u on u.parid = m.parid) q on true
       where %L::jsonb->''bands'' is null or q.reason is null
       order by (q.reason is not null), m.%I %s nulls last, m.score desc nulls last, m.by_right_units desc nulls last, m.months_to_permit asc nulls last, m.parid
       limit $1 offset $2) x', f::text, f::text, col, dir)
    using least(greatest(coalesce(p_limit, 50), 1), 10000), greatest(coalesce(p_offset, 0), 0)
    into rows;
  select c.summary into summary from public.planner_summary_cache c where c.filters = f;
  if summary is null then summary := public.planner_summary(f); end if;
  -- Partial parcels are never counted in a band.
  execute format(
    'select coalesce(jsonb_object_agg(b, n), ''{}'') from (
       select coalesce(m.band, ''No score'') b, count(*)::int n from public.planner_rows(%L::jsonb) m
       left join public.planner_building_unscored u on u.parid = m.parid
       where public.score_is_partial(m.municipality, m.zoning) or u.parid is not null group by 1) x', f::text)
    into partial;
  if partial <> '{}'::jsonb then
    bands := coalesce(summary->'bands', '{}');
    for k, n in select key, value::int from jsonb_each_text(partial) loop
      bands := case when coalesce((bands->>k)::int, 0) - n > 0 then jsonb_set(bands, array[k], to_jsonb(coalesce((bands->>k)::int, 0) - n)) else bands - k end;
      pn := pn + n;
    end loop;
    if f->'bands' is null then
      bands := bands || jsonb_build_object('Partial', pn);
    else
      summary := jsonb_set(summary, '{total}', to_jsonb(greatest((summary->>'total')::int - pn, 0)));
    end if;
    summary := jsonb_set(summary, '{bands}', bands);
  end if;
  return summary || jsonb_build_object('rows', rows);
end $function$;

CREATE OR REPLACE FUNCTION public.planner_points_live(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  -- Filters as a literal so unused ones fold away (see planner_summary). Partial parcels: no score, band 'Partial', last.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_array(parid, lon, lat, score, band, top_blocker, address, by_right_units, units_with_relief)
                              order by p, score desc nulls last, parid), ''[]'')
     from (select s.parid, s.lon, s.lat, x.p,
                  case when x.p then null else s.score end score,
                  case when x.p then ''Partial'' else s.band end band,
                  s.top_blocker, s.address, s.by_right_units, s.units_with_relief
           from public.planner_rows(%L::jsonb) s
           left join public.planner_building_unscored u on u.parid = s.parid
           cross join lateral (select public.score_is_partial(s.municipality, s.zoning) or u.parid is not null p) x
           where s.lon is not null
             and (%L::jsonb->''bands'' is null or not x.p)
           order by x.p, s.score desc nulls last, s.parid
           limit $1) y', coalesce(p_filters, '{}')::text, coalesce(p_filters, '{}')::text)
    using least(greatest(coalesce(p_limit, 12000), 1), 30000)
    into out;
  return out;
end $function$;

update public.planner_summary_cache set points = public.planner_points_live(filters, 12000) where points is not null;
