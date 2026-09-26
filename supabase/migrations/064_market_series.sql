-- FRED series snapshots relevant to residential feasibility: mortgage rates,
-- prime rate, Treasury yield, residential construction PPI, and the
-- Pittsburgh MSA house price index. Latest value + date, plus 12 months of
-- history per series. See scripts/ingest_finance.py.
create table if not exists public.market_series (
  series_id  text not null,
  title      text,
  date       date not null,
  value      numeric,
  units      text,
  source     text not null default 'fred',
  primary key (series_id, date)
);
create index if not exists market_series_series_idx on public.market_series (series_id, date desc);

do $$
declare t text;
begin
  foreach t in array array['market_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
