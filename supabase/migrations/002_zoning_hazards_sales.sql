-- Zoning (City of Pittsburgh only — no county-wide zoning layer exists).
create table if not exists public.zoning (
  id              bigint primary key,
  zone_code       text,        -- e.g. R1D-L, LNC, UI
  zone_type       text,        -- full_zoning_type
  legend_type     text,
  municode        text,
  geom            extensions.geometry(MultiPolygon, 4326)
);
create index if not exists zoning_geom_gix on public.zoning using gist (geom);

-- Hazard and environmental overlays, one table keyed by layer name.
-- layer: flood_fema_nfhl | landslide_prone_pgh | undermined_pgh | greenway_pgh
create table if not exists public.overlays (
  layer        text not null,
  source_id    text not null,
  label        text,         -- e.g. flood zone AE / X, landslide-prone
  attrs        jsonb,
  geom         extensions.geometry(MultiPolygon, 4326),
  primary key (layer, source_id)
);
create index if not exists overlays_geom_gix on public.overlays using gist (geom);
create index if not exists overlays_layer_idx on public.overlays (layer);

-- Valid, arm's-length sales only (county SALECODE '0' = VALID SALE).
-- No buyer/seller names exist in the source; deed book/page is not kept.
create table if not exists public.sales_valid (
  sale_id       bigint primary key,
  parid         char(16) not null,
  sale_date     date,
  record_date   date,
  price         numeric,
  municode      text,
  school_code   text,
  instr_type    text
);
create index if not exists sales_valid_parid_idx on public.sales_valid (parid);
create index if not exists sales_valid_date_idx on public.sales_valid (sale_date);

do $$
declare t text;
begin
  foreach t in array array['zoning','overlays','sales_valid'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
