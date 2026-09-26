# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load Census ACS 5-year neighborhood context (tract level) for Allegheny
County into Supabase, then tag every parcel with its tract.

Usage: uv run scripts/ingest_census.py tracts
       uv run scripts/ingest_census.py parcel_tract

ACS pull runs locally against api.census.gov; tract geometry comes from the
Census cartographic boundary file. Both are joined and transformed with
DuckDB, then upserted through the Supabase REST API (same pattern as
ingest.py). parcel_tract is filled with plain SQL, run in 20 hashed chunks
through scripts/sql.sh to stay under its per-statement time limit.
"""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import duckdb
import httpx

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import connect, jsonable, load_env, rows, upload, _geom_sql  # noqa: E402

ACS_YEAR = 2024
STATE, COUNTY = "42", "003"
ACS_VARS = [
    "NAME", "B01003_001E", "B19013_001E", "B25064_001E",
    "B25070_001E", "B25070_007E", "B25070_008E", "B25070_009E",
    "B25070_010E", "B25070_011E", "B25002_001E", "B25002_003E",
]


def _num(v):
    """Census returns numbers as JSON strings/numbers; large negative sentinels
    (e.g. -666666666) mean "not available" and become null."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return None if n < 0 else n


def fetch_acs():
    key = os.environ["CENSUS_API_KEY"]
    r = httpx.get(f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5", params={
        "get": ",".join(ACS_VARS), "for": "tract:*",
        "in": f"state:{STATE}+county:{COUNTY}", "key": key,
    }, timeout=60)
    r.raise_for_status()
    data = r.json()
    cols = data[0]
    out = {}
    for row in data[1:]:
        d = dict(zip(cols, row))
        out[d["state"] + d["county"] + d["tract"]] = d
    return out


def fetch_tract_shapes():
    name = f"cb_{ACS_YEAR}_42_tract_500k"
    zip_path = RAW / f"{name}.zip"
    extract_dir = RAW / name
    if not zip_path.exists():
        r = httpx.get(f"https://www2.census.gov/geo/tiger/GENZ{ACS_YEAR}/shp/{zip_path.name}", timeout=120)
        r.raise_for_status()
        zip_path.write_bytes(r.content)
    if not extract_dir.exists():
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extract_dir)
    return next(extract_dir.glob("*.shp"))


def tracts(con):
    acs = fetch_acs()
    shp = fetch_tract_shapes()
    con.execute(f"create table t as select * from ST_Read('{shp}') where COUNTYFP = '003'")
    total = con.execute("select count(*) from t").fetchone()[0]

    con.execute("""
      create table acs (
        geoid text, population double, median_income double, median_rent double,
        rent_burden_30_pct double, rent_burden_50_pct double, vacancy_rate double
      )
    """)
    acs_rows = []
    for geoid, a in acs.items():
        pop = _num(a.get("B01003_001E"))
        renter_total = _num(a.get("B25070_001E"))
        not_computed = _num(a.get("B25070_011E"))
        burden_vals = [_num(a.get(f"B25070_{i}E")) for i in ("007", "008", "009", "010")]
        burden30_n = sum(v for v in burden_vals if v is not None) if any(v is not None for v in burden_vals) else None
        burden50_n = _num(a.get("B25070_010E"))
        units_total = _num(a.get("B25002_001E"))
        vacant = _num(a.get("B25002_003E"))
        denom = renter_total - not_computed if renter_total is not None and not_computed is not None else None
        acs_rows.append((
            geoid,
            pop,
            _num(a.get("B19013_001E")),
            _num(a.get("B25064_001E")),
            round(burden30_n / denom * 100, 2) if denom and denom > 0 and burden30_n is not None else None,
            round(burden50_n / denom * 100, 2) if denom and denom > 0 and burden50_n is not None else None,
            round(vacant / units_total * 100, 2) if units_total and units_total > 0 and vacant is not None else None,
        ))
    con.executemany("insert into acs values (?,?,?,?,?,?,?)", acs_rows)

    sql = f"""
      select t.GEOID as geoid, t.NAME as name, {ACS_YEAR} as acs_year,
             cast(acs.population as int) as population,
             acs.median_income, acs.median_rent, acs.rent_burden_30_pct,
             acs.rent_burden_50_pct, acs.vacancy_rate, {_geom_sql()} as geom
      from t join acs on acs.geoid = t.GEOID
    """
    upload("tracts", jsonable(rows(con, sql)), total, batch=200, on_conflict="geoid")


def _run_sql(sql):
    r = subprocess.run(["bash", str(ROOT / "scripts" / "sql.sh")], input=sql,
                        text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"sql.sh failed: {r.stdout}\n{r.stderr}")
    return r.stdout


def parcel_tract(con=None):
    # Subdivide tract polygons once so the per-chunk point lookups stay fast.
    _run_sql("""
      drop table if exists public._tract_polys;
      create table public._tract_polys as
        select geoid, extensions.ST_Subdivide(geom, 128) geom from public.tracts;
      create index on public._tract_polys using gist (geom);
      alter table public._tract_polys enable row level security;
      truncate public.parcel_tract;
    """)
    for n in range(20):
        _run_sql(f"""
          insert into public.parcel_tract (parid, geoid)
          select p.parid, tp.geoid
          from public.parcels p
          left join lateral (
            select t.geoid from public._tract_polys t
            where extensions.ST_Intersects(t.geom, p.centroid) limit 1
          ) tp on true
          where abs(hashtext(p.parid)) % 20 = {n};
        """)
        print(f"  parcel_tract: chunk {n}/19 done", flush=True)
    _run_sql("drop table if exists public._tract_polys;")


DATASETS = {"tracts": tracts, "parcel_tract": parcel_tract}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    DATASETS[name](connect(), *extra)
