-- Planner / Developer fix (Planner audit B1, B2): streets, alleys, right-of-way strips and parks still
-- ranked as top housing sites after migration 141, because the County records many of them under
-- ordinary land-use codes (vacant land 100/400, municipal/county/state government 610-640, urban
-- renewal 730), not the right-of-way (130/530) or park (660) codes 141 keys on.
--
-- Rule, in plain words. A PUBLICLY OWNED parcel (parcel_scores.owner_class = 'public') is moved to
-- "Other public land" (so it never ranks as a housing site) when any of these holds:
--
--   1. Park or open space (zoned P): its zoning district is P (Parks and Open Space). Public parkland
--      can't be sold for housing without a legal process (PA Donated or Dedicated Property Act).
--
--   2. Street or right-of-way (lot shape), either test, and only for parcels with NO house number:
--      a. Street corridor: at least 60% of the lot lies within 20 ft of a mapped street centerline
--         (i.e. the lot is mostly roadway), and the lot is nowhere wider than 80 ft (its largest
--         inscribed circle is <= 80 ft across). The width cap keeps large redevelopment sites that
--         merely have streets crossing them (e.g. the Lower Hill) in the list. Centerlines that are
--         driveways or parking aisles (County A74), walkways/trails (A71), non-road features (H10),
--         private or park roads, or paper/vacated streets don't count.
--      b. Right-of-way strip: nowhere wider than 30 ft and at least 10 times longer than it is wide
--         (length = area / width). A 20 x 100 ft city lot (5:1) or a 21 x 179 ft deep lot (8.5:1) is
--         not caught; a 19 x 527 ft or 7 x 432 ft strip is.
--
-- A missing house number alone never excludes a lot (most real vacant lots are recorded by street
-- name only); geometry decides. Private land is not touched (the "Other public land" card counts
-- this table). Distances are in feet (EPSG:2272, PA South state plane).
--
-- Additive only: rows inserted into planner_other_public_land with new reason labels; no function is
-- created or replaced here (so migration 147's SECURITY DEFINER settings are left as they are), and no
-- existing row or table is rewritten. Note: migration 141 truncates and rebuilds this table, so if 141
-- is ever re-run, re-run this file after it.

-- 1. Parks and open space.
insert into public.planner_other_public_land (parid, reason)
select s.parid, 'Park or open space (zoned P)'
from public.parcel_scores s
where s.owner_class = 'public' and s.zoning = 'P'
on conflict (parid) do nothing;

-- 2. Streets and right-of-way, decided by lot shape.
insert into public.planner_other_public_land (parid, reason)
select m.parid, 'Street or right-of-way (lot shape)'
from (
  select c.parid, c.area, c.w,
         (select st_area(st_intersection(c.g, st_union(st_buffer(st_transform(t.geom, 2272), 20))))
            from public.streets t
           where st_dwithin(t.geom, c.g4, 0.0003)
             and coalesce(t.street_type, '') not in ('A74', 'A71', 'H10', 'Private', 'Private Road', 'Park Road')
             and t.paper_or_vacated is not true) as near_street
  from (
    select s.parid, g.g, p.geom as g4, st_area(g.g) as area, 2 * (st_maximuminscribedcircle(g.g)).radius as w
    from public.parcel_scores s
    join public.assessments a on a.parid = s.parid
    join public.parcels p on p.parid = s.parid
    cross join lateral (select st_transform(p.geom, 2272) as g) g
    where s.owner_class = 'public'
      and coalesce(nullif(trim(a.house_num), ''), '0') = '0'
      and not exists (select 1 from public.planner_other_public_land x where x.parid = s.parid)
  ) c
  where c.area > 0 and c.w > 0
) m
where (coalesce(m.near_street, 0) / m.area >= 0.6 and m.w <= 80)
   or (m.w < 30 and m.area / m.w >= 10 * m.w)
on conflict (parid) do nothing;

-- Cached broad-view summaries and map points (all parcels, one per municipality, options) recomputed
-- without the newly excluded parcels, as migration 141 did.
select public.planner_refresh_cache();
