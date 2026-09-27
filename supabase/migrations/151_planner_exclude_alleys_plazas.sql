-- Planner / Developer fix (judge walkthrough item 1): an alley ("Penn Aly", 0009P00020000000) was the
-- Planner's #1 housing site and Market Square (four City parcels addressed "1 Market Sq") ranked 30-32.
-- Migration 148's lot-shape test missed them: Penn Aly is wider than 30 ft in places and Market Square
-- is a square plaza, and the County records both under ordinary government land-use codes (620/640).
--
-- Rule, in plain words. A PUBLICLY OWNED parcel (parcel_scores.owner_class = 'public') is moved to
-- "Other public land" (so it never ranks as a housing site) when any of these holds:
--
--   1. Alley (by name): the County address is on an alley (street suffix "ALY") and has no house
--      number.
--   2. Alley (by name and shape): the address is on a "WAY" (Pittsburgh's name for many alleys), it has
--      no house number, and the lot is a thin strip: nowhere 12 ft wide (its largest inscribed circle
--      is under 12 ft across), too narrow for any house. Wider "Way" lots (for example 18-20 ft lots on
--      Durango Way or Ladora Way) are real lots and stay in the rankings.
--   3. Public plaza: Market Square, the City-owned parcels addressed "Market Sq" downtown.
--
-- Private land is not touched (the "Other public land" card counts this table). Distances are in feet
-- (EPSG:2272, PA South state plane). At the time of writing: 1 alley by name, 25 thin "Way" strips,
-- 4 Market Square parcels.
--
-- Additive only: rows inserted into planner_other_public_land with new reason labels ("Alley",
-- "Public plaza"); no function is created or replaced here (migration 147/150's SECURITY DEFINER
-- settings and masked fields are left as they are), and no existing row or table is rewritten.
-- Note: migration 141 truncates and rebuilds this table, so if 141 is ever re-run, re-run 148 and this
-- file after it.

-- 1. Alleys by name (suffix ALY), no house number.
insert into public.planner_other_public_land (parid, reason)
select s.parid, 'Alley'
from public.parcel_scores s
join public.assessments a on a.parid = s.parid
where s.owner_class = 'public'
  and a.address ~ ' ALY$'
  and coalesce(nullif(trim(a.house_num), ''), '0') = '0'
on conflict (parid) do nothing;

-- 2. "Way" alleys: no house number and a thin strip (nowhere 12 ft wide).
insert into public.planner_other_public_land (parid, reason)
select s.parid, 'Alley'
from public.parcel_scores s
join public.assessments a on a.parid = s.parid
join public.parcels p on p.parid = s.parid
where s.owner_class = 'public'
  and a.address ~ ' WAY$'
  and coalesce(nullif(trim(a.house_num), ''), '0') = '0'
  and not exists (select 1 from public.planner_other_public_land x where x.parid = s.parid)
  and 2 * (st_maximuminscribedcircle(st_transform(p.geom, 2272))).radius < 12
on conflict (parid) do nothing;

-- 3. Public plazas: Market Square.
insert into public.planner_other_public_land (parid, reason)
select s.parid, 'Public plaza'
from public.parcel_scores s
join public.assessments a on a.parid = s.parid
where s.owner_class = 'public'
  and a.address ~ '^([0-9]+ )?MARKET SQ$'
on conflict (parid) do nothing;

-- Cached broad-view summaries and map points recomputed without the newly excluded parcels, as 148 did.
select public.planner_refresh_cache();
