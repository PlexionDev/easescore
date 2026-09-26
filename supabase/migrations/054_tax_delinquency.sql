-- Parcels with at least one currently-unsatisfied tax lien (Allegheny County Department
-- of Court Records, via WPRDC "Allegheny County Tax Liens (Filed and Satisfied)").
-- No debtor/owner name is in this source at all -- only lien type, amount, and dates.
create table if not exists public.tax_delinquency (
  parid            char(16) primary key,
  lien_count       int not null,      -- count of unsatisfied liens
  years_delinquent int not null,      -- count of distinct tax years with an unsatisfied lien
  latest_year      int,               -- most recent tax year with an unsatisfied lien
  amount_band      text               -- bucketed sum of unsatisfied lien amounts: <1k, 1k-5k, 5k-15k, 15k+
);

do $$
declare t text;
begin
  foreach t in array array['tax_delinquency'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='public read') then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    end if;
  end loop;
end $$;
