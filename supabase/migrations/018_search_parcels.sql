-- Forgiving parcel search: addresses with extra words (city, state, ZIP), spelled-out suffixes
-- ("Street", "Avenue"), directionals, small typos, and parcel IDs with or without dashes.
create extension if not exists pg_trgm with schema extensions;

create index if not exists assessments_address_trgm on public.assessments using gin (address extensions.gin_trgm_ops);
create index if not exists assessments_house_num_idx on public.assessments (house_num);
create index if not exists parcels_mbl_idx on public.parcels (upper(replace(map_block_lot, '-', '')));

-- Normalize a street string the way the county writes it: upper case, USPS suffix/directional
-- abbreviations, no punctuation.
create or replace function public.norm_street(s text) returns text
language sql immutable set search_path = public, extensions as $$
  select trim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(
      ' ' || regexp_replace(upper(coalesce(s, '')), '[^A-Z0-9 ]', ' ', 'g') || ' ',
      ' STREET ', ' ST ', 'g'), ' AVENUE ', ' AVE ', 'g'), ' ROAD ', ' RD ', 'g'), ' DRIVE ', ' DR ', 'g'),
      ' BOULEVARD ', ' BLVD ', 'g'), ' LANE ', ' LN ', 'g'), ' PLACE ', ' PL ', 'g'), ' COURT ', ' CT ', 'g'),
      ' TERRACE ', ' TER ', 'g'), ' CIRCLE ', ' CIR ', 'g'), ' HIGHWAY ', ' HWY ', 'g'),
      ' NORTH ', ' N ', 'g'), ' SOUTH ', ' S ', 'g'), ' EAST ', ' E ', 'g'), ' WEST ', ' W ', 'g'),
    '\s+', ' ', 'g'))
$$;

create or replace function public.search_parcels(q text, max_results int default 25)
returns table (parid text, house_num text, address text, city text, zip text, muni_desc text, use_desc text, match text, score real)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  raw     text := upper(trim(coalesce(q, '')));
  alnum   text := regexp_replace(upper(coalesce(q, '')), '[^A-Z0-9]', '', 'g');
  zip5    text := substring(upper(coalesce(q, '')) from '\m(15[0-9]{3})(-[0-9]{4})?\M');
  rest    text;
  hn      text;
  street  text;
begin
  if raw = '' then return; end if;

  -- 1. Parcel ID, with or without dashes/spaces (e.g. 0011-J-00056-0000-00)
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

  -- word_similarity: how well the county's street name appears inside what the user typed,
  -- so trailing city names ("... PITTSBURGH") don't hurt the match.
  -- Keep only matches close to the best one, so weak look-alikes ("410 A ST") drop out.
  return query
  with scored as (
    select a.parid::text as parid, a.house_num, a.address, a.city, a.zip, a.muni_desc, a.use_desc, 'address'::text as match,
           (0.7 * word_similarity(a.address, street) + 0.3 * similarity(a.address, street)
            + case when zip5 is not null and left(a.zip, 5) = zip5 then 0.2 else 0 end
            + case when street like '% ' || upper(a.city) || '%' or street like '%' || upper(split_part(a.muni_desc, ' - ', 2)) || '%' then 0.1 else 0 end)::real as score
    from assessments a
    where (hn is null or a.house_num = hn)
      and a.address is not null
      and word_similarity(a.address, street) >= case when hn is null then 0.6 else 0.45 end
  )
  select sc.parid, sc.house_num, sc.address, sc.city, sc.zip, sc.muni_desc, sc.use_desc, sc.match, sc.score
  from scored sc
  where sc.score >= (select max(s2.score) from scored s2) - 0.2
  order by sc.score desc, sc.address, sc.house_num
  limit max_results;
end $$;

revoke all on function public.search_parcels(text, int) from public;
grant execute on function public.search_parcels(text, int) to anon, authenticated, service_role;
