-- HUD Income Limits (FY current), Pittsburgh, PA HUD Metro FMR Area, Allegheny
-- County (entity id 4200399999). 30/50/80% AMI (HUD's "extremely low" /
-- "very low" / "low" bands) by household size 1-8, plus the area median
-- family income. HUD does not publish a 60% band directly for regular
-- Income Limits -- see public.affordable_rent_limits for the derived 60%
-- figure. See scripts/ingest_finance.py.
create table if not exists public.hud_income_limits (
  year           int not null,
  area_code      text not null,
  county_name    text,
  median_income  numeric,
  il30_p1 numeric, il30_p2 numeric, il30_p3 numeric, il30_p4 numeric,
  il30_p5 numeric, il30_p6 numeric, il30_p7 numeric, il30_p8 numeric,
  il50_p1 numeric, il50_p2 numeric, il50_p3 numeric, il50_p4 numeric,
  il50_p5 numeric, il50_p6 numeric, il50_p7 numeric, il50_p8 numeric,
  il80_p1 numeric, il80_p2 numeric, il80_p3 numeric, il80_p4 numeric,
  il80_p5 numeric, il80_p6 numeric, il80_p7 numeric, il80_p8 numeric,
  source_url text not null default 'https://www.huduser.gov/portal/dataset/fmr-api.html',
  primary key (year, area_code)
);

do $$
declare t text;
begin
  foreach t in array array['hud_income_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
