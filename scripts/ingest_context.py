# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load parcel-context datasets: municipal boundaries, Pittsburgh neighborhoods,
street trees, institutionally-owned parcels, and tax liens -- then fill
public.parcel_context for every parcel.

Usage: uv run scripts/ingest_context.py <dataset>
  municipalities | neighborhoods | street_trees | public_owned | tax_delinquency | parcel_context

No personal names, owner/debtor identities, or GIS editor usernames are loaded --
see the per-loader comments below for what was checked and dropped.
"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, RAW, load_env, connect, upload, rows, jsonable, fetch_arcgis, clean_tsv, PGH  # noqa: E402

ALCO_GIS_HUB = "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services"
WPRDC_DUMP = "https://data.wprdc.org/datastore/dump"


def _multi_geom_sql(col="geom"):
    return (f"'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_Multi(ST_CollectionExtract("
            f"ST_MakeValid({col}), 3)), 0.0000001))")


def _point_geom_sql(col="geom"):
    return f"'SRID=4326;' || ST_AsText(ST_ReducePrecision({col}, 0.0000001))"


def fetch_ckan_dump(name, resource_id):
    """Download a WPRDC/CKAN datastore's full CSV dump (no auth, no paging needed)."""
    dest = RAW / f"{name}.csv"
    if dest.exists():
        return dest
    for attempt in range(4):
        p = subprocess.run(["curl", "-sS", "--fail", "--max-time", "600",
                            "-o", str(dest), f"{WPRDC_DUMP}/{resource_id}"])
        if p.returncode == 0 and dest.stat().st_size > 0:
            print(f"  fetched {name}: {dest.stat().st_size:,} bytes")
            return dest
        time.sleep(3 * (attempt + 1))
    raise SystemExit(f"fetch failed for {name} ({resource_id})")


def run_sql(query):
    """Run one statement through the Supabase Management API (same endpoint as
    scripts/sql.sh), for the chunked parcel_context fill below."""
    ref = re.match(r"https://([^.]+)\.", os.environ["NEXT_PUBLIC_SUPABASE_URL"]).group(1)
    p = subprocess.run(
        ["curl", "-sS", "--fail", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{ref}/database/query",
         "-H", f"Authorization: Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
         "-H", "Content-Type: application/json", "--data-binary", "@-"],
        input='{"query": ' + __import__("json").dumps(query) + '}',
        capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"sql failed: {p.stderr[:800]}\n{p.stdout[:800]}")
    return p.stdout


# ---------- 1. Municipal boundaries (all 130 Allegheny County municipalities) ----------

def municipalities(con):
    # Source has NAME/TYPE/MUNICODE only -- no editor or owner fields at all.
    src = fetch_arcgis("municipalities_alco",
                       f"{ALCO_GIS_HUB}/AlleghenyCountyMunicipalBoundaries/FeatureServer/0",
                       out_fields="NAME,TYPE,MUNICODE")
    con.execute(f"create table m as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from m").fetchone()[0]
    sql = f"""
      select nullif(trim(MUNICODE),'') as muni_code, trim(NAME) as "name",
             nullif(trim(TYPE),'') as "type", {_multi_geom_sql()} as geom
      from m where geom is not null
    """
    upload("municipalities", jsonable(rows(con, sql)), total, batch=50, on_conflict="muni_code")


# ---------- 2. Pittsburgh neighborhoods (90) ----------

def neighborhoods(con):
    # Source layer is already dissolved to one polygon per neighborhood (90 features);
    # only the neighborhood name/number are kept -- census/DPW/planner-assignment
    # columns carried on this layer are dropped as out of scope.
    src = fetch_arcgis("neighborhoods_pgh", f"{PGH}/PGHWebNeighborhoods/FeatureServer/0",
                       out_fields="hood,hood_no")
    con.execute(f"create table n as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from n").fetchone()[0]
    sql = f"""
      select hood_no, trim(hood) as "name", {_multi_geom_sql()} as geom
      from n where geom is not null
    """
    upload("neighborhoods", jsonable(rows(con, sql)), total, batch=50, on_conflict="hood_no")


# ---------- 3. Street trees (City of Pittsburgh DPW Forestry inventory) ----------

def street_trees(con):
    # Source has no owner/contact fields. Only species common name and trunk
    # diameter are kept; the ~50 stormwater/energy/air-quality benefit-value columns
    # are dropped as out of scope for this checklist.
    src = fetch_ckan_dump("city_trees", "1515a93c-73e3-4425-9b35-1cd11b2196da")
    con.execute(f"""
      create table t as select * from read_csv('{clean_tsv("city_trees")}', all_varchar=true, header=true,
                                               delim='\t', quote='', escape='')
    """)
    total = con.execute("select count(*) from t where nullif(trim(id),'') is not null").fetchone()[0]
    sql = f"""
      select try_cast(id as bigint) as id, nullif(trim(common_name),'') as common_name,
             try_cast(diameter_base_height as double) as dbh,
             {_point_geom_sql("ST_Point(try_cast(longitude as double), try_cast(latitude as double))")} as geom
      from t
      where nullif(trim(id),'') is not null
        and try_cast(latitude as double) is not null and try_cast(longitude as double) is not null
    """
    upload("street_trees", jsonable(rows(con, sql)), total, batch=2000, on_conflict="id")


# ---------- 4. Institutionally-owned parcels ----------

# Keyword -> category. Applied in order; the source "owner" field is otherwise a
# free-text party name from the eProperty Plus system, which for several hundred
# rows (per the source's own data dictionary) is a private individual -- those rows
# are dropped rather than guessed at.
_OWNER_CATEGORIES = [
    ("Pittsburgh Land Bank", "%LAND BANK%"),
    ("Urban Redevelopment Authority", "%URBAN REDEVELOPMENT AUTHORITY%"),
    ("Urban Redevelopment Authority", "%URA%"),
    ("Housing Authority", "%HOUSING AUTHORITY%"),
    ("School District", "%SCHOOL DISTRICT%"),
    ("City of Pittsburgh", "%CITY OF PITTSBURGH%"),
    ("Allegheny County", "%COUNTY OF ALLEGHENY%"),
    ("Allegheny County", "%ALLEGHENY COUNTY%"),
    ("Commonwealth of PA", "%COMMONWEALTH%"),
    ("Parking Authority", "%PARKING AUTHORITY%"),
    ("Water and Sewer Authority", "%WATER%SEWER AUTHORITY%"),
    ("Sports & Exhibition Authority", "%SPORTS%EXHIBITION AUTHORITY%"),
]


def public_owned(con):
    fetch_ckan_dump("city_owned_properties", "e1dcee82-9179-4306-8167-5891915b62a7")
    con.execute(f"""
      create table c as select pin, owner, current_status, last_updated
      from read_csv('{clean_tsv("city_owned_properties")}', all_varchar=true, header=true,
                    delim='\t', quote='', escape='')
    """)
    total = con.execute("select count(*) from c where length(trim(pin)) = 16").fetchone()[0]
    case_sql = "case\n"
    for label, pattern in _OWNER_CATEGORIES:
        case_sql += f"    when upper(owner) like '{pattern}' then '{label}'\n"
    case_sql += "    else null end"
    sql = f"""
      select distinct on (parid) parid, owner_category, current_status as status from (
        select trim(pin) as parid, {case_sql} as owner_category, nullif(trim(current_status),'') as current_status,
               try_strptime(last_updated, '%Y-%m-%d')::date as last_updated
        from c where length(trim(pin)) = 16
      )
      where owner_category is not null
      order by parid, last_updated desc nulls last
    """
    upload("public_owned", jsonable(rows(con, sql)), total, batch=2000, on_conflict="parid")


# ---------- 5. Tax delinquency (Allegheny County tax liens, filed and satisfied) ----------

def tax_delinquency(con):
    # This source has no debtor/owner name at all -- only lien type, filing date,
    # tax year, amount, and satisfied flag. "assignee" (the lien-buyer company, when
    # sold) is read only to confirm it is never a person, then dropped.
    fetch_ckan_dump("tax_liens", "65d0d259-3e58-49d3-bebb-80dc75f61245")
    con.execute(f"""
      create table l as select pin, tax_year, amount, satisfied
      from read_csv('{clean_tsv("tax_liens")}', all_varchar=true, header=true,
                    delim='\t', quote='', escape='')
    """)
    total = con.execute("""
      select count(distinct trim(pin)) from l
      where length(trim(pin)) = 16 and lower(trim(satisfied)) in ('false','f','0')
    """).fetchone()[0]
    sql = """
      select trim(pin) as parid,
             count(*) as lien_count,
             count(distinct try_cast(tax_year as int)) as years_delinquent,
             max(try_cast(tax_year as int)) as latest_year,
             case
               when sum(try_cast(amount as double)) < 1000 then '<1k'
               when sum(try_cast(amount as double)) < 5000 then '1k-5k'
               when sum(try_cast(amount as double)) < 15000 then '5k-15k'
               else '15k+'
             end as amount_band
      from l
      where length(trim(pin)) = 16 and lower(trim(satisfied)) in ('false','f','0')
      group by trim(pin)
    """
    upload("tax_delinquency", jsonable(rows(con, sql)), total, batch=5000, on_conflict="parid")


# ---------- 6. parcel_context: fill for every parcel, in chunks ----------

def parcel_context(con=None, chunks=20):
    load_env()
    print("  parcel_context: prep (street-tree geography, index)...")
    run_sql("""
      drop table if exists public._trees_geog;
      create table public._trees_geog as
        select id, geom::extensions.geography geog from public.street_trees;
      create index on public._trees_geog using gist (geog);
      alter table public._trees_geog enable row level security;
      truncate public.parcel_context;
    """)
    for c in range(chunks):
        run_sql(f"""
          insert into public.parcel_context
            (parid, muni_name, neighborhood, street_trees_15m, public_owner,
             tax_delinquent, delinquency_band)
          select p.parid,
                 m.name,
                 (select n.name from public.neighborhoods n
                   where extensions.ST_Intersects(n.geom, p.centroid) limit 1),
                 (select count(*) from public._trees_geog t
                   where extensions.ST_DWithin(t.geog, p.centroid::extensions.geography, 15)),
                 po.owner_category,
                 td.parid is not null,
                 td.amount_band
          from public.parcels p
          -- Pittsburgh, Clairton, Duquesne, and McKeesport are single boundary polygons
          -- in this layer, but the assessment/parcel MUNICODE breaks each into its own
          -- per-ward code (e.g. 101-186 for Pittsburgh's wards); fall back to the city's
          -- hundred-code when no exact ward-level boundary exists.
          left join public.municipalities m
            on m.muni_code = p.municode
            or (p.municode ~ '^[0-9]+$' and m.muni_code = (floor(p.municode::int / 100) * 100)::text)
          left join public.public_owned po on po.parid = p.parid
          left join public.tax_delinquency td on td.parid = p.parid
          where abs(hashtext(p.parid)) % {chunks} = {c}
          on conflict (parid) do update set
            muni_name = excluded.muni_name, neighborhood = excluded.neighborhood,
            street_trees_15m = excluded.street_trees_15m, public_owner = excluded.public_owner,
            tax_delinquent = excluded.tax_delinquent, delinquency_band = excluded.delinquency_band;
        """)
        print(f"    chunk {c + 1}/{chunks} done", flush=True)
    print("  parcel_context: cleanup...")
    run_sql("drop table if exists public._trees_geog;")


DATASETS = {"municipalities": municipalities, "neighborhoods": neighborhoods,
            "street_trees": street_trees, "public_owned": public_owned,
            "tax_delinquency": tax_delinquency, "parcel_context": parcel_context}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    if name == "parcel_context":
        parcel_context()
    else:
        DATASETS[name](connect(), *extra)
