-- Planner: block conformity (street precedent, migration 130).
--  * planner_rows() gains one filter key, block_nonconform_min (0-1): lots on block faces with 3+ measured
--    buildings where at least that share of the buildings would not meet today's code. Every other key
--    is unchanged from migration 091.
--  * block_conformity_points(): one point per block face with 3+ measured buildings, for the map layer:
--    [lon, lat, share nonconforming, buildings, top violated rule, street name].

create or replace function public.planner_rows(f jsonb)
returns setof public.parcel_scores
language sql stable
-- No SET clause: it would stop Postgres from inlining this function into the caller's query.
as $$
  select s.* from public.parcel_scores s
  where (f->>'municipality' is null or s.municipality = f->>'municipality')
    and (f->>'council_district' is null or s.council_district = f->>'council_district')
    -- "= any (array(...))" runs the list once (an init plan) and can use the column's index.
    and (f->'neighborhoods' is null or s.neighborhood = any (array(select jsonb_array_elements_text(f->'neighborhoods'))))
    and (f->'zoning' is null or s.zoning = any (array(select jsonb_array_elements_text(f->'zoning'))))
    and (f->'bands' is null or s.band = any (array(select jsonb_array_elements_text(f->'bands'))))
    and (f->'parids' is null or s.parid = any (array(select jsonb_array_elements_text(f->'parids'))::char(16)[]))
    and (f->>'lot_min' is null or s.lot_sqft >= (f->>'lot_min')::numeric)
    and (f->>'lot_max' is null or s.lot_sqft <= (f->>'lot_max')::numeric)
    and (f->>'vacant' is null or s.vacant = (f->>'vacant')::boolean)
    and (f->>'owner' is null or s.owner_class = f->>'owner')
    and (f->'owner_types' is null or s.owner_type = any (array(select jsonb_array_elements_text(f->'owner_types'))))
    and (coalesce((f->>'tax_delinquent')::boolean, false) = false or s.tax_delinquent)
    and (coalesce((f->>'no_red_flags')::boolean, false) = false or s.red_flag_count = 0)
    and (coalesce((f->>'exclude_floodway')::boolean, false) = false or not coalesce(s.hz_floodway, false))
    and (coalesce((f->>'exclude_landslide')::boolean, false) = false or not coalesce(s.hz_landslide, false))
    and (coalesce((f->>'exclude_undermined')::boolean, false) = false or not coalesce(s.hz_undermined, false))
    and (coalesce((f->>'exclude_steep')::boolean, false) = false or coalesce(s.steep_share, 0) < 0.25)
    and (f->>'transit_max_m' is null or s.transit_m <= (f->>'transit_max_m')::numeric)
    and (f->>'by_right_min' is null or s.by_right_units >= (f->>'by_right_min')::int)
    and (f->>'has_blocker' is null
         or (f->>'has_blocker' = 'Low market activity' and s.top_blocker = 'Low market activity')
         or (f->>'has_blocker' <> 'Low market activity' and s.blockers @> array[f->>'has_blocker']))
    and (f->>'top_blocker' is null or s.top_blocker = f->>'top_blocker')
    -- Block conformity (migration 130): the lot's block face has 3+ measured buildings and at least
    -- this share of them would not meet today's code.
    and (f->>'block_nonconform_min' is null or exists (
          select 1 from public.parcel_block_face pb join public.block_faces bf on bf.face_id = pb.face_id
          where pb.parid = s.parid and bf.n_buildings >= 3 and bf.nonconform_share >= (f->>'block_nonconform_min')::numeric))
    and (f->'only_blocked_by' is null
         or (cardinality(s.blockers) > 0
             and (case when s.top_blocker = 'Low market activity' then s.blockers else array_remove(s.blockers, 'Low market activity') end)
                 <@ array(select jsonb_array_elements_text(f->'only_blocked_by'))))
$$;

create or replace function public.block_conformity_points()
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(round(bf.lon::numeric, 5), round(bf.lat::numeric, 5), bf.nonconform_share, bf.n_buildings,
                                              bf.top_rules->0->>'rule', bf.street_name)), '[]')
  from public.block_faces bf
  where bf.n_buildings >= 3 and bf.nonconform_share is not null and bf.lon is not null
$$;
grant execute on function public.block_conformity_points() to anon, authenticated, service_role;

-- Policy "Match the block" screen (not a rescoring): residential lots whose block face (3+ measured
-- buildings) is looser than the code on at least one rule the lever relaxes (engine/src/policy/levers.ts
-- MATCH_BLOCK: front = block median - 2 ft; side = block median, never under 3 ft; lot area = 90% of the
-- block median). Homes unlocked need the policy batch (not precomputed for the demo). One row, refreshed
-- by rerunning this statement after scripts/block_faces.sh.
create table if not exists public.policy_block_screen (
  id          text primary key,
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.policy_block_screen enable row level security;
grant select on public.policy_block_screen to anon, authenticated;
grant all on public.policy_block_screen to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='policy_block_screen' and policyname='public read') then
    create policy "public read" on public.policy_block_screen for select to anon, authenticated using (true);
  end if;
end $$;

insert into public.policy_block_screen (id, payload)
with e as (
  select pb.parid, s.neighborhood, s.vacant,
         (zr.min_front_setback_ft > 0 and floor(bf.front_median_ft - 2) < zr.min_front_setback_ft) f,
         (zr.min_side_setback_ft > 0 and greatest(3, floor(bf.side_min_median_ft)) < zr.min_side_setback_ft) sd,
         (zr.min_lot_area_sqft > 0 and round(bf.lot_area_median_sf * 0.9) < zr.min_lot_area_sqft) la
  from public.parcel_block_face pb
  join public.block_faces bf using (face_id)
  join public.zoning_rules zr on zr.zone_code = pb.zone_code
  join public.parcel_scores s on s.parid = pb.parid
  where pb.zone_code ~ '^(R1D|R1A|R2|R3|RM)-' and bf.n_buildings >= 3
), x as (select * from e where f or sd or la)
select 'mb', jsonb_build_object(
  'parcels', (select count(*) from x), 'vacant', (select count(*) from x where vacant),
  'neighborhoods', (select count(distinct neighborhood) from x),
  'by_rule', jsonb_build_object('front', (select count(*) from x where f), 'side', (select count(*) from x where sd), 'lot_area', (select count(*) from x where la)),
  'residential_with_block', (select count(*) from e),
  'top_vacant', (select jsonb_agg(t) from (select neighborhood, count(*) filter (where vacant) vacant from x group by 1 order by 2 desc, 1 limit 5) t))
on conflict (id) do update set payload = excluded.payload, computed_at = now();
