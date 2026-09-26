-- Maximum affordable monthly rent by AMI tier and bedroom count, Allegheny County.
-- Two sources, both kept (see `source`):
--   'derived_hud_il'  -- computed here from public.hud_income_limits using the
--                         standard LIHTC convention: 1.5 persons/bedroom (0BR = 1
--                         person; fractional persons averaged across the two
--                         bracketing household sizes), rent = 30% of that income / 12.
--                         60% AMI is not published by HUD for regular Income Limits;
--                         it is derived here as 1.2 x the 50% ("very low") limit.
--   'phfa_lihtc'      -- official PHFA LIHTC program rent limits (already computed
--                         and published by PHFA); prefer this over 'derived_hud_il'
--                         for the same (ami_pct, bedrooms) when both exist.
create table if not exists public.affordable_rent_limits (
  source          text not null,
  county          text not null default 'Allegheny',
  year            int not null,
  ami_pct         int not null,       -- 20/30/40/50/60/70/80
  bedrooms        int not null,       -- 0 = efficiency
  max_rent        numeric not null,
  formula         text,               -- populated for 'derived_hud_il' rows only
  effective_date  date,
  source_url      text not null,
  primary key (source, county, year, ami_pct, bedrooms)
);

do $$
declare t text;
begin
  foreach t in array array['affordable_rent_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
