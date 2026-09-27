-- Street precedent: block faces and what the existing buildings on them look like.
--
-- METHOD (all distances in feet, PA State Plane South EPSG:2272):
--   * Fronting street = the nearest City street centerline (not paper/vacated; alleys and private
--     ways only lose ties) within 60 ft of the lot line. City centerline segments run intersection to
--     intersection, so one segment = one block.
--   * Block face = that street segment + the side of the street the lot's centroid falls on
--     (sign of the cross product of the segment direction and the centerline -> centroid vector).
--   * Primary building = the lot's largest footprint that is not an out-building.
--   * Front setback = distance(centerline, building) - distance(centerline, lot line): the gap from
--     the street-facing lot line to the footprint, measured perpendicular to the street. Roof
--     outlines include porches, so this is "to the roofline" (slightly shallow for deep eaves).
--   * Lot width and side yards = extents of the lot and the building projected on the street
--     direction (right for rectangular lots, approximate for irregular ones).
--   * Stories from the county assessment; units from the assessment use (1-4 family; 5+ left null).
--   * Nonconformity (lots with a building, 1 ft tolerance for measurement noise): front setback,
--     side setback (skipped for rowhouses/townhouses and R1A attached districts), lot area, lot area
--     per unit, stories vs the district's tabulated minimums.
-- Run PREP once, then CHUNK for :chunk = 0..49 one at a time with a pause between (shared DB), then AGG.

-- PREP -----------------------------------------------------------------------
create table if not exists public.parcel_block_face (
  parid            char(16) primary key,
  face_id          text not null,        -- '<street id>:<L|R>'
  street_id        text not null,
  street_name      text,
  pos_ft           numeric,              -- position of the lot centroid along the street
  street_gap_ft    numeric,              -- centerline to lot line
  zone_code        text,
  has_building     boolean not null,
  front_setback_ft numeric,
  side_min_ft      numeric,
  side_total_ft    numeric,
  lot_width_ft     numeric,
  lot_area_sf      numeric,
  building_sf      numeric,
  stories          numeric,
  units            int,
  year_built       int,
  nonconform       text[] not null default '{}',
  computed_at      timestamptz not null default now()
);
create index if not exists parcel_block_face_face_idx on public.parcel_block_face (face_id);

create table if not exists public.block_faces (
  face_id            text primary key,
  street_id          text not null,
  street_name        text,
  side               text not null,
  zone_code          text,                -- most common district on the face
  district_front_ft  numeric,
  n_lots             int not null,
  n_buildings        int not null,
  front_median_ft    numeric,
  front_p25_ft       numeric,
  front_p75_ft       numeric,
  front_min_ft       numeric,
  front_max_ft       numeric,
  side_min_median_ft numeric,
  lot_width_median_ft numeric,
  lot_area_median_sf numeric,
  stories_median     numeric,
  units_median       numeric,
  n_nonconform       int not null,
  nonconform_share   numeric,             -- of lots with a building
  top_rules          jsonb,               -- [{rule, n}] most violated first
  lon                double precision,
  lat                double precision,
  computed_at        timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['parcel_block_face', 'block_faces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- CHUNK ----------------------------------------------------------------------
insert into public.parcel_block_face
  (parid, face_id, street_id, street_name, pos_ft, street_gap_ft, zone_code, has_building, front_setback_ft,
   side_min_ft, side_total_ft, lot_width_ft, lot_area_sf, building_sf, stories, units, year_built, nonconform)
select m.parid, m.street_id || ':' || m.side, m.street_id, m.street_name, round(m.pos::numeric, 1), round(m.gap::numeric, 1),
       m.zone_code, m.bg is not null, round(m.front::numeric, 1), round(m.side_min::numeric, 1), round(m.side_total::numeric, 1),
       round(m.width::numeric, 1), round(m.area::numeric, 0), round(m.barea::numeric, 0), m.stories, m.units, m.year_built,
       array_remove(array[
         case when m.bg is not null and zr.min_front_setback_ft > 0 and m.front < zr.min_front_setback_ft - 1 then 'front_setback' end,
         case when m.bg is not null and zr.min_side_setback_ft > 0 and m.side_min < zr.min_side_setback_ft - 1
                   and not m.attached then 'side_setback' end,
         case when m.bg is not null and zr.min_lot_area_sqft > 0 and m.area < zr.min_lot_area_sqft - 1 then 'lot_area' end,
         case when m.bg is not null and zr.min_lot_area_per_unit_sqft > 0 and m.units > 1 and m.area < m.units * zr.min_lot_area_per_unit_sqft then 'lot_area_per_unit' end,
         case when m.bg is not null and zr.max_height_stories > 0 and m.stories > zr.max_height_stories then 'stories' end
       ], null)
from (
  select p.parid, s.id street_id, s.name street_name, ps.zoning zone_code,
         extensions.ST_Distance(s.part, g.g) gap,
         case when b.bg is null then null else greatest(0, extensions.ST_Distance(s.part, b.bg) - extensions.ST_Distance(s.part, g.g)) end front,
         case when b.bg is null then null else greatest(0, least(bx.lo - lx.lo, lx.hi - bx.hi)) end side_min,
         case when b.bg is null then null else greatest(0, (bx.lo - lx.lo) + (lx.hi - bx.hi)) end side_total,
         lx.hi - lx.lo width, extensions.ST_Area(g.g) area, extensions.ST_Area(b.bg) barea, b.bg,
         a.stories, a.year_built,
         -- rowhouses / townhouses and R1A (attached) lots build to the side line on purpose: no side check
         (a.use_desc in ('ROWHOUSE', 'TOWNHOUSE') or ps.zoning like 'R1A%') attached,
         case a.use_desc when 'SINGLE FAMILY' then 1 when 'ROWHOUSE' then 1 when 'TOWNHOUSE' then 1 when 'TWO FAMILY' then 2
                         when 'THREE FAMILY' then 3 when 'FOUR FAMILY' then 4 end units,
         extensions.ST_X(g.c) * s.ux + extensions.ST_Y(g.c) * s.uy pos,
         case when s.ux * (extensions.ST_Y(g.c) - extensions.ST_Y(s.cp)) - s.uy * (extensions.ST_X(g.c) - extensions.ST_X(s.cp)) > 0 then 'L' else 'R' end side
  from public.parcels p
  cross join lateral (
    select extensions.ST_Transform(d.geom, 2272) g, extensions.ST_Centroid(extensions.ST_Transform(d.geom, 2272)) c
    from extensions.ST_Dump(p.geom) d order by extensions.ST_Area(d.geom) desc limit 1) g
  cross join lateral (
    select x.id, x.name, x.part,
           sin(extensions.ST_Azimuth(extensions.ST_StartPoint(x.part), extensions.ST_EndPoint(x.part))) ux,
           cos(extensions.ST_Azimuth(extensions.ST_StartPoint(x.part), extensions.ST_EndPoint(x.part))) uy,
           extensions.ST_ClosestPoint(x.part, g.c) cp
    from (
      select st.id, st.name, st.street_type, pt.geom part
      from public.streets st
      cross join lateral (select extensions.ST_Transform(dd.geom, 2272) geom from extensions.ST_Dump(st.geom) dd) pt
      where st.source = 'city' and coalesce(st.paper_or_vacated, false) = false
        and extensions.ST_DWithin(st.geom, p.geom, 0.0004)
        and extensions.ST_Length(pt.geom) > 30
        and extensions.ST_DWithin(pt.geom, g.g, 60)
    ) x
    order by (x.street_type in ('Alley', 'Private', 'Private Road')), extensions.ST_Distance(x.part, g.g)
    limit 1) s
  left join lateral (
    select extensions.ST_Transform(bb.geom, 2272) bg from public.buildings bb
    where bb.parid = p.parid and coalesce(bb.class, '') not ilike 'OUT%'
    order by extensions.ST_Area(bb.geom) desc limit 1) b on true
  cross join lateral (
    select min(extensions.ST_X(dp.geom) * s.ux + extensions.ST_Y(dp.geom) * s.uy) lo,
           max(extensions.ST_X(dp.geom) * s.ux + extensions.ST_Y(dp.geom) * s.uy) hi
    from extensions.ST_DumpPoints(g.g) dp) lx
  left join lateral (
    select min(extensions.ST_X(dp.geom) * s.ux + extensions.ST_Y(dp.geom) * s.uy) lo,
           max(extensions.ST_X(dp.geom) * s.ux + extensions.ST_Y(dp.geom) * s.uy) hi
    from extensions.ST_DumpPoints(b.bg) dp) bx on true
  left join public.assessments a on a.parid = p.parid
  left join public.parcel_scores ps on ps.parid = p.parid
  where p.municode ~ '^1(0[1-9]|[12][0-9]|3[0-2])$'
    and abs(hashtext(p.parid)) % 50 = :chunk
) m
left join public.zoning_rules zr on zr.zone_code = m.zone_code
on conflict (parid) do update set
  face_id = excluded.face_id, street_id = excluded.street_id, street_name = excluded.street_name, pos_ft = excluded.pos_ft,
  street_gap_ft = excluded.street_gap_ft, zone_code = excluded.zone_code, has_building = excluded.has_building,
  front_setback_ft = excluded.front_setback_ft, side_min_ft = excluded.side_min_ft, side_total_ft = excluded.side_total_ft,
  lot_width_ft = excluded.lot_width_ft, lot_area_sf = excluded.lot_area_sf, building_sf = excluded.building_sf,
  stories = excluded.stories, units = excluded.units, year_built = excluded.year_built, nonconform = excluded.nonconform,
  computed_at = now();

-- AGG ------------------------------------------------------------------------
-- One statement over parcel_block_face (no geometry work except one centroid per face).
insert into public.block_faces
select f.face_id, min(f.street_id), min(f.street_name), right(f.face_id, 1),
       mode() within group (order by f.zone_code),
       (select zr.min_front_setback_ft from public.zoning_rules zr where zr.zone_code = mode() within group (order by f.zone_code)),
       count(*), count(*) filter (where f.has_building),
       percentile_cont(0.5) within group (order by f.front_setback_ft) filter (where f.has_building),
       percentile_cont(0.25) within group (order by f.front_setback_ft) filter (where f.has_building),
       percentile_cont(0.75) within group (order by f.front_setback_ft) filter (where f.has_building),
       min(f.front_setback_ft), max(f.front_setback_ft),
       percentile_cont(0.5) within group (order by f.side_min_ft) filter (where f.has_building),
       percentile_cont(0.5) within group (order by f.lot_width_ft),
       percentile_cont(0.5) within group (order by f.lot_area_sf),
       percentile_cont(0.5) within group (order by f.stories) filter (where f.has_building),
       percentile_cont(0.5) within group (order by f.units) filter (where f.has_building),
       count(*) filter (where cardinality(f.nonconform) > 0),
       round((count(*) filter (where cardinality(f.nonconform) > 0))::numeric / nullif(count(*) filter (where f.has_building), 0), 3),
       (select jsonb_agg(jsonb_build_object('rule', r.rule, 'n', r.n) order by r.n desc, r.rule)
          from (select u.rule, count(*) n from public.parcel_block_face x, unnest(x.nonconform) u(rule)
                where x.face_id = f.face_id group by u.rule) r),
       avg(extensions.ST_X(pc.centroid)), avg(extensions.ST_Y(pc.centroid)),
       now()
from public.parcel_block_face f
join public.parcels pc on pc.parid = f.parid
group by f.face_id
on conflict (face_id) do update set
  street_id = excluded.street_id, street_name = excluded.street_name, side = excluded.side, zone_code = excluded.zone_code,
  district_front_ft = excluded.district_front_ft, n_lots = excluded.n_lots, n_buildings = excluded.n_buildings,
  front_median_ft = excluded.front_median_ft, front_p25_ft = excluded.front_p25_ft, front_p75_ft = excluded.front_p75_ft,
  front_min_ft = excluded.front_min_ft, front_max_ft = excluded.front_max_ft, side_min_median_ft = excluded.side_min_median_ft,
  lot_width_median_ft = excluded.lot_width_median_ft, lot_area_median_sf = excluded.lot_area_median_sf,
  stories_median = excluded.stories_median, units_median = excluded.units_median, n_nonconform = excluded.n_nonconform,
  nonconform_share = excluded.nonconform_share, top_rules = excluded.top_rules, lon = excluded.lon, lat = excluded.lat,
  computed_at = now();

-- RPC ------------------------------------------------------------------------
-- parcel_street_precedent(parid): the lot's block face, every lot on it (measurements only, no owner
-- data) in street order, and nearby decided Zoning Board cases (within 800 m / half a mile, last 10 years).
-- Centerline data splits some blocks into short pieces: when the lot's own segment face has fewer than
-- 3 other measured buildings, a corner lot first switches to its other street when that face has more,
-- then the face widens to lots fronting the same-named street, on the same side
-- (judged against this lot's segment), within 400 ft along the street ('scope' = 'stretch').
create or replace function public.parcel_street_precedent(p_parid text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  pid  char(16) := p_parid;  -- parid columns are char(16): compare as char so the indexes are used
  me   parcel_block_face;
  part geometry;
  c0   geometry;
  ux   float8; uy float8;
  n_other int;
  scope text := 'face';
  switched boolean := false;
  lots jsonb;
  zba  jsonb;
begin
  select * into me from parcel_block_face where parid = pid;
  if me.parid is not null then
  select count(*) into n_other from parcel_block_face x where x.face_id = me.face_id and x.parid <> me.parid and x.has_building;

  -- Corner lots: when the chosen street's face has few measured buildings, use the other street the
  -- lot touches (within 5 ft of the nearest) whose face has the most.
  if n_other < 3 then
    declare alt record;
    begin
      select q.id, q.name, q.id || ':' || q.side face_id,
             (select count(*) from parcel_block_face x where x.face_id = q.id || ':' || q.side and x.parid <> pid and x.has_building) n
        into alt
      from (
        select st.id, st.name,
               case when sin(ST_Azimuth(ST_StartPoint(pt.geom), ST_EndPoint(pt.geom))) * (ST_Y(g.c) - ST_Y(ST_ClosestPoint(pt.geom, g.c)))
                       - cos(ST_Azimuth(ST_StartPoint(pt.geom), ST_EndPoint(pt.geom))) * (ST_X(g.c) - ST_X(ST_ClosestPoint(pt.geom, g.c))) > 0 then 'L' else 'R' end side
        from parcels p
        cross join lateral (select ST_Transform(d.geom, 2272) g, ST_Centroid(ST_Transform(d.geom, 2272)) c
                            from ST_Dump(p.geom) d order by ST_Area(d.geom) desc limit 1) g
        join streets st on st.source = 'city' and coalesce(st.paper_or_vacated, false) = false
                       and st.street_type not in ('Alley', 'Private', 'Private Road') and ST_DWithin(st.geom, p.geom, 0.0004)
        cross join lateral (select ST_Transform(dd.geom, 2272) geom from ST_Dump(st.geom) dd) pt
        where p.parid = pid and ST_Length(pt.geom) > 30 and ST_DWithin(pt.geom, g.g, me.street_gap_ft + 5)
      ) q
      order by 4 desc limit 1;
      if alt.n > n_other then
        me.face_id := alt.face_id; me.street_id := alt.id; me.street_name := alt.name; n_other := alt.n; switched := true;
      end if;
    end;
  end if;

  if (n_other < 3 or switched) and me.street_name is not null then
    select ST_Transform(p.centroid, 2272) into c0 from parcels p where p.parid = pid;
    select pt.geom into part
    from streets st, lateral (select ST_Transform(d.geom, 2272) geom from ST_Dump(st.geom) d) pt
    where st.id = me.street_id order by ST_Distance(pt.geom, c0) limit 1;
    ux := sin(ST_Azimuth(ST_StartPoint(part), ST_EndPoint(part)));
    uy := cos(ST_Azimuth(ST_StartPoint(part), ST_EndPoint(part)));
    with cand as (
      select x.*, ST_Transform(p.centroid, 2272) c
      from parcel_block_face x join parcels p on p.parid = x.parid
      where (x.street_name = me.street_name or x.parid = pid)
        and ST_DWithin(p.centroid, ST_Transform(c0, 4326), 0.002)
    ), sided as (
      select cand.*, ST_ClosestPoint(ST_MakeLine(ST_Translate(ST_StartPoint(part), -ux * 2000, -uy * 2000), ST_Translate(ST_EndPoint(part), ux * 2000, uy * 2000)), cand.c) cp
      from cand
    )
    select jsonb_agg(jsonb_build_object(
             'parid', y.parid, 'pos', round((ST_X(y.c) * ux + ST_Y(y.c) * uy)::numeric, 1), 'building', y.has_building, 'front', y.front_setback_ft,
             'sideMin', y.side_min_ft, 'width', y.lot_width_ft, 'area', y.lot_area_sf, 'stories', y.stories,
             'units', y.units, 'yearBuilt', y.year_built, 'nonconform', y.nonconform) order by ST_X(y.c) * ux + ST_Y(y.c) * uy)
      into lots
    from sided y
    where abs((ST_X(y.c) - ST_X(c0)) * ux + (ST_Y(y.c) - ST_Y(c0)) * uy) <= 400
      and sign(ux * (ST_Y(y.c) - ST_Y(y.cp)) - uy * (ST_X(y.c) - ST_X(y.cp)))
        = sign(ux * (ST_Y(c0) - ST_Y(ST_ClosestPoint(ST_MakeLine(ST_Translate(ST_StartPoint(part), -ux * 2000, -uy * 2000), ST_Translate(ST_EndPoint(part), ux * 2000, uy * 2000)), c0)))
             - uy * (ST_X(c0) - ST_X(ST_ClosestPoint(ST_MakeLine(ST_Translate(ST_StartPoint(part), -ux * 2000, -uy * 2000), ST_Translate(ST_EndPoint(part), ux * 2000, uy * 2000)), c0))));
    if switched or (select count(*) from jsonb_array_elements(lots) e where e->>'parid' <> p_parid and (e->>'building')::boolean) > n_other then
      scope := 'stretch';
    else
      lots := null;
    end if;
  end if;

  if lots is null then
    select jsonb_agg(jsonb_build_object(
             'parid', x.parid, 'pos', x.pos_ft, 'building', x.has_building, 'front', x.front_setback_ft,
             'sideMin', x.side_min_ft, 'width', x.lot_width_ft, 'area', x.lot_area_sf, 'stories', x.stories,
             'units', x.units, 'yearBuilt', x.year_built, 'nonconform', x.nonconform) order by x.pos_ft)
      into lots from parcel_block_face x where x.face_id = me.face_id;
  end if;
  end if;  -- me.parid is not null

  select coalesce(jsonb_agg(z order by z->>'decision_date' desc, z->>'case'), '[]') into zba from (
    select jsonb_build_object('case', c.case_number, 'decision_date', c.decision_date, 'address', c.address,
             'relief', r.relief_type, 'section', r.code_section, 'outcome', r.outcome,
             'distance_m', round(ST_Distance(pc.centroid::geography, me_p.centroid::geography)::numeric, 0)) z
    from parcels me_p
    join parcels pc on ST_DWithin(pc.centroid, me_p.centroid, 0.012)
                   and ST_DWithin(pc.centroid::geography, me_p.centroid::geography, 800)
    join zoning_cases c on c.parid = pc.parid
    join zoning_requests r on r.case_id = c.case_id
    where me_p.parid = pid and c.decision_date >= current_date - interval '10 years'
      and r.outcome is not null and r.relief_type in ('dimensional_variance', 'special_exception', 'use_variance')
    order by c.decision_date desc limit 12) q;

  return jsonb_build_object(
    'parid', p_parid, 'scope', scope, 'streetName', me.street_name, 'scopeFt', case when scope = 'stretch' then 400 end,
    'face', (select to_jsonb(bf) - 'computed_at' from block_faces bf where bf.face_id = me.face_id),  -- null: no block face (no street within 60 ft)
    'lots', lots, 'zba', zba);
end $$;
revoke all on function public.parcel_street_precedent(text) from public;
grant execute on function public.parcel_street_precedent(text) to anon, authenticated, service_role;
