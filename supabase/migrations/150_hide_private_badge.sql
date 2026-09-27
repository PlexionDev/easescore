-- Privacy: the planning-priority badge (planning_badge, badge_score, badge_matches) is shown only for
-- publicly owned land (parcel_scores.owner_class = 'public'). Its "vacant and tax-delinquent" criterion
-- (badge_matches.vacant_tax_delinquent, worth 5 of the badge's points) would otherwise let someone infer
-- a private owner's tax-lien status from the badge tier or points alone, even though migration 147 has
-- already kept the raw tax_delinquent column itself private. Paul approved: "hide it on private parcels".
--
-- Based on the CURRENT live definition of planner_query (read via pg_get_functiondef before writing this
-- file: migration 147's version, unchanged by 148/149). Restates SECURITY DEFINER + the same search_path,
-- keeps 147's tax-status masking (tax_delinquent, and badge_matches without 'vacant_tax_delinquent' for
-- non-public rows) and every 145/146/148 behavior (partial screening, sort, band accounting) unchanged.
-- Additive on top of that: for owner_class <> 'public', planning_badge, badge_score and badge_matches are
-- all returned null (not just the one key), so no badge tier or point total is shown for private land.
--
-- planner_points_live, nonprofit_sites and parcel_facts do not output any badge field (checked against
-- their current live definitions), so they need no change here. planner_summary, planner_options_live and
-- planner_other_public_land_summary output no per-parcel row and no badge field either.
--
-- parcel_scores column grants: planning_badge and badge_score are currently anon/authenticated-readable
-- directly via REST (checked with information_schema.column_privileges); badge_matches already is not
-- (migration 090 never granted it). Revoked here and re-granted with those two columns left out, so the
-- masking above cannot be bypassed by reading the table directly. No app code reads them directly today
-- (grepped web/src, engine/src): planner_query is the only anon-callable output of a badge field, and
-- planner-query.ts / BadgeSettings.tsx / EaseScorePanel.tsx now also gate their own display on
-- owner_class = 'public' so a saved custom weight profile cannot recompute a tier for a private parcel.
--
-- WARNING: CREATE OR REPLACE FUNCTION resets SECURITY DEFINER to INVOKER. Any later redefinition of
-- planner_query MUST restate "security definer set search_path = public, extensions, pg_temp", or it will
-- fail for anon (column grants) or, worse, stop masking. A column added to parcel_scores later is NOT
-- readable by anon until granted (see migration 147's warning); planning_badge and badge_score are not to
-- be added back to that grant unless this masking is redone at the same time.
--
-- ROLLBACK (restores pre-150 access to planning_badge / badge_score; run in one transaction):
--   begin;
--   grant select (planning_badge, badge_score) on public.parcel_scores to anon, authenticated;
--   CREATE OR REPLACE FUNCTION public.planner_query(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'score'::text, p_dir text DEFAULT NULL::text)
--    RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
--   AS $function$
--   -- (the migration 147 body: badge_matches masked to omit 'vacant_tax_delinquent' for non-public rows,
--   -- planning_badge and badge_score always returned as stored -- see supabase/migrations/147_private_tax_status_access.sql)
--   $function$;
--   commit;
--   (parcel_facts, nonprofit_sites, planner_points_live are untouched by this migration; no rollback needed for them.)

begin;

-- 1. Column grants without planning_badge / badge_score (badge_matches was already excluded by 090/147).
revoke all on table public.parcel_scores from public, anon, authenticated;
grant select (parid, config_version, best_strategy, score, band, range_lo, range_hi, preliminary,
              red_flag_count, red_flags, top_blocker, by_right_units, units_with_relief, months_to_permit,
              factor_scores, vacant, owner_class, zoning, neighborhood,
              municipality, lot_sqft, lon, lat, address, data_dates, computed_at, note, rehab_score,
              rehab_band, blockers, transit_m, hz_floodway, hz_landslide, hz_undermined, steep_share,
              cap_label, owner_agency, council_district, owner_type)
  on public.parcel_scores to anon, authenticated;

-- 2. planner_query: badge fields null for private land (owner_class <> 'public'); everything else unchanged
--    from the current live (147) definition.
CREATE OR REPLACE FUNCTION public.planner_query(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'score'::text, p_dir text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
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
              m.top_blocker, m.blockers, m.by_right_units, m.units_with_relief, m.months_to_permit,
              case when m.owner_class = ''public'' then m.planning_badge end as planning_badge,
              case when m.owner_class = ''public'' then m.badge_score end as badge_score,
              case when m.owner_class = ''public'' then m.badge_matches end as badge_matches,
              m.factor_scores,
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

commit;
