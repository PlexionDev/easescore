-- Lots we can't verify never score "Few barriers" (FINAL-HOUR P0 item 2). Three new Partial reasons in
-- public.planner_building_unscored (migration 146), which planner_query / planner_points_live already
-- read as Partial (no score, never in a band, sorted last). The app maps each reason to its text
-- (engine/src/score/bands.ts partialText; keep the tests identical to lotUnverifiable() there):
--   'no_outline'   no mapped lot outline (no GIS geometry)          -> "No lot outline; fit not verified."
--   'lot_mismatch' County recorded lot area and the mapped outline differ by more than 2x
--                                                                    -> "Review required: lot size mismatch; survey first."
--   'large_site'   mapped lot over 2 acres (87,120 sq ft)            -> "Large site: not modeled (EaseScore models 1–4 home buildings)."
-- Additive: widen the reason check, INSERT rows (an existing reason from 146 wins), refresh the cached
-- map points. No function is created or replaced; parcel_scores is not rewritten.

alter table public.planner_building_unscored drop constraint if exists planner_building_unscored_reason_check;
alter table public.planner_building_unscored add constraint planner_building_unscored_reason_check
  check (reason in ('use', 'footprint', 'not_lot', 'no_outline', 'lot_mismatch', 'large_site'));

insert into public.planner_building_unscored (parid, use_desc, reason, footprint_share)
select s.parid, a.use_desc, r.reason, null
from public.parcel_scores s
left join public.assessments a on a.parid = s.parid
left join public.parcels p on p.parid = s.parid
cross join lateral (select case
    when p.geom is null or st_isempty(p.geom) or st_area(p.geom) = 0 then 'no_outline'
    when a.lot_area_sqft > 0 and s.lot_sqft > 0
         and greatest(a.lot_area_sqft, s.lot_sqft) > 2 * least(a.lot_area_sqft, s.lot_sqft) then 'lot_mismatch'
    when s.lot_sqft > 87120 then 'large_site' end reason) r
where r.reason is not null
on conflict (parid) do nothing;

update public.planner_summary_cache set points = public.planner_points_live(filters, 12000) where points is not null;
