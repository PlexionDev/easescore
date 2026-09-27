-- Address search: the street name must match (a house number alone never wins).
--
-- Before: "5000 Penn Ave" returned 5000 5TH AVE, because word_similarity() let the shared " AVE"
-- trigrams carry a different street once the house number matched; "3500 Butler St" returned nothing
-- because no parcel has that exact number; the municipality bonus was given to every parcel outside
-- the City (split_part() of "Wilkinsburg" on ' - ' is '', and LIKE '%%' is always true); and the
-- county street ("SOUTH AVE") was compared with the normalized query ("S AVE"), so exact matches ranked
-- below look-alikes.
--
-- Now:
--  * Both sides are normalized with norm_street().
--  * The candidate's street core (its name without the suffix, e.g. PENN, BUTLER, S NEGLEY / NEGLEY)
--    must appear as whole words in the query, or be a near-exact typo of it (word_similarity >= 0.8).
--  * Municipality words in the query ("... Wilkinsburg", "... Pittsburgh") add 0.25 when they name the
--    parcel's municipality, 0.1 when they name its mailing city.
--  * When the exact house number isn't on that street, the nearest numbers on the same street (within
--    +/- 100) are returned, labelled match = 'nearby number'.

create or replace function public.search_parcels(q text, max_results integer default 25)
 returns table(parid text, house_num text, address text, city text, zip text, muni_desc text, use_desc text, match text, score real)
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  raw     text := upper(trim(coalesce(q, '')));
  alnum   text := regexp_replace(upper(coalesce(q, '')), '[^A-Z0-9]', '', 'g');
  zip5    text := substring(upper(coalesce(q, '')) from '\m(15[0-9]{3})(-[0-9]{4})?\M');
  rest    text;
  hn      text;
  hn_int  int;
  street  text;
  padded  text;
  nearby  text[];
begin
  if raw = '' then return; end if;

  -- 1. Parcel ID, with or without dashes/spaces (e.g. 0015-E-00009-0000-00)
  if alnum ~ '^[0-9]{4}[A-Z][0-9]{11}$' then
    return query select a.parid::text, a.house_num, a.address, a.city, a.zip, a.muni_desc, a.use_desc, 'parcel id'::text, 1::real
      from assessments a where a.parid = alnum;
    if found then return; end if;
  end if;

  -- 2. Map / block / lot (e.g. 15-E-9)
  if raw ~ '^[0-9]{1,4}\s*-?\s*[A-Z]\s*-?\s*[0-9]{1,5}(\s*-\s*[0-9]+)*$' then
    return query select a.parid::text, a.house_num, a.address, a.city, a.zip, a.muni_desc, a.use_desc, 'map-block-lot'::text, 1::real
      from parcels p join assessments a using (parid)
      where upper(replace(p.map_block_lot, '-', '')) = alnum limit max_results;
    if found then return; end if;
  end if;

  -- 3. Address: drop ZIP, state, and commas; split the house number; normalize the street.
  rest := regexp_replace(raw, '\m15[0-9]{3}(-[0-9]{4})?\M', ' ', 'g');
  rest := regexp_replace(rest, '\m(PA|PENNSYLVANIA)\M', ' ', 'g');
  rest := regexp_replace(rest, '[,#.]', ' ', 'g');
  hn := substring(rest from '^\s*([0-9]+)[A-Z]?\s');
  street := norm_street(case when hn is not null then regexp_replace(rest, '^\s*[0-9]+[A-Z]?\s+', '') else rest end);
  if street = '' then return; end if;
  padded := ' ' || street || ' ';

  return query
  with cand as (
    select a.parid::text as parid, a.house_num, a.address, a.city, a.zip, a.muni_desc, a.use_desc,
           norm_street(a.address) as na,
           upper(case when a.muni_desc like '% - %' then split_part(a.muni_desc, ' - ', 2) else a.muni_desc end) as muni
    from assessments a
    where (hn is null or a.house_num = hn)
      and a.address is not null
      and word_similarity(a.address, street) >= case when hn is null then 0.6 else 0.45 end
  ), cored as (
    select c.*,
           trim(regexp_replace(c.na, ' (ST|AVE|RD|DR|BLVD|LN|PL|CT|TER|CIR|HWY|WAY|WY|ALY|PKWY|SQ|EXT|PIKE|RUN|STEPS|HTS)$', '')) as core
    from cand c
  ), scored as (
    select c.parid, c.house_num, c.address, c.city, c.zip, c.muni_desc, c.use_desc, 'address'::text as match,
           (0.7 * word_similarity(c.na, street) + 0.3 * similarity(c.na, street)
            + case when zip5 is not null and left(c.zip, 5) = zip5 then 0.2 else 0 end
            + case when c.muni <> '' and position(' ' || c.muni || ' ' in padded) > 0 then 0.25
                   when coalesce(c.city, '') <> '' and position(' ' || upper(c.city) || ' ' in padded) > 0 then 0.1
                   else 0 end)::real as score
    from cored c
    where c.core <> ''
      and (position(' ' || c.core || ' ' in padded) > 0
           or position(' ' || regexp_replace(c.core, '^(N|S|E|W) ', '') || ' ' in padded) > 0
           or word_similarity(c.core, street) >= 0.8)
  )
  select sc.parid, sc.house_num, sc.address, sc.city, sc.zip, sc.muni_desc, sc.use_desc, sc.match, sc.score
  from scored sc
  where sc.score >= (select max(s2.score) from scored s2) - 0.2
  order by sc.score desc, sc.address, sc.house_num
  limit max_results;
  if found or hn is null then return; end if;

  -- 4. The house number isn't on that street: offer the nearest numbers on the same street.
  hn_int := hn::int;
  select array_agg(g::text) into nearby from generate_series(greatest(hn_int - 100, 1), hn_int + 100) g where g <> hn_int;

  return query
  with cand as (
    select a.parid::text as parid, a.house_num, a.address, a.city, a.zip, a.muni_desc, a.use_desc,
           norm_street(a.address) as na,
           upper(case when a.muni_desc like '% - %' then split_part(a.muni_desc, ' - ', 2) else a.muni_desc end) as muni
    from assessments a
    where a.house_num = any(nearby)
      and a.address is not null
      and word_similarity(a.address, street) >= 0.45
  ), cored as (
    select c.*,
           trim(regexp_replace(c.na, ' (ST|AVE|RD|DR|BLVD|LN|PL|CT|TER|CIR|HWY|WAY|WY|ALY|PKWY|SQ|EXT|PIKE|RUN|STEPS|HTS)$', '')) as core
    from cand c
  ), scored as (
    select c.parid, c.house_num, c.address, c.city, c.zip, c.muni_desc, c.use_desc, 'nearby number'::text as match,
           (0.7 * word_similarity(c.na, street) + 0.3 * similarity(c.na, street)
            + case when zip5 is not null and left(c.zip, 5) = zip5 then 0.2 else 0 end
            + case when c.muni <> '' and position(' ' || c.muni || ' ' in padded) > 0 then 0.25
                   when coalesce(c.city, '') <> '' and position(' ' || upper(c.city) || ' ' in padded) > 0 then 0.1
                   else 0 end)::real as score,
           abs(c.house_num::int - hn_int) as dist
    from cored c
    where c.core <> ''
      and (position(' ' || c.core || ' ' in padded) > 0
           or position(' ' || regexp_replace(c.core, '^(N|S|E|W) ', '') || ' ' in padded) > 0
           or word_similarity(c.core, street) >= 0.8)
  )
  select sc.parid, sc.house_num, sc.address, sc.city, sc.zip, sc.muni_desc, sc.use_desc, sc.match, sc.score
  from scored sc
  where sc.score >= (select max(s2.score) from scored s2) - 0.2
  order by sc.score desc, sc.dist, sc.house_num
  limit max_results;
end $function$;
