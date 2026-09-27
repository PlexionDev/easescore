# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Shared data foundation for the Planner / Nonprofit / Policy seats.

Usage: uv run scripts/ingest_seats.py <step>
  council | block_groups | parcel_geo | acs | chas | chas_area |
  lihtc | millage_fix | sources

Ownership class (public.parcel_owner_class) is loaded by a separate script,
scripts/ingest_owner_class.py, which is not in the repo (see its docstring).

Apply supabase/migrations/100-105 first. Every step is re-runnable (upserts).
Writes are throttled on purpose -- other batch jobs share the database and
live pages time out under load: REST uploads go one request at a time with a
pause, and the parcel-level SQL fills run in hashed chunks with sleeps.
"""
import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, RAW, connect, jsonable, load_env, rows, fetch_arcgis, _geom_sql  # noqa: E402

STATE, COUNTY = "42", "003"
ACS_YEAR = 2024
ACS_VINTAGE = "2020-2024 ACS 5-year"
PGH_GIS = "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services"
HUD_EGIS = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services"


# ---------- helpers ----------

def _run_sql(sql):
    r = subprocess.run(["bash", str(ROOT / "scripts" / "sql.sh")], input=sql,
                       text=True, capture_output=True)
    out = r.stdout.strip()
    if r.returncode != 0 or out.startswith('{"message"') or '"error"' in out[:200]:
        raise SystemExit(f"sql.sh failed: {out[:800]}\n{r.stderr[:400]}")
    return json.loads(out) if out.startswith("[") else out


def slow_upload(table, recs, on_conflict, batch=500, pause=0.4):
    """Sequential, paused upserts through PostgREST (no parallel requests)."""
    url = f"{os.environ['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/{table}?on_conflict={on_conflict}"
    key = os.environ["SUPABASE_SECRET_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    sent, buf, t0 = 0, [], time.time()
    with httpx.Client(timeout=120) as client:
        def post(chunk):
            for attempt in range(6):
                r = client.post(url, headers=headers, json=chunk)
                if r.status_code < 300:
                    return
                if r.status_code < 500 and r.status_code != 429:
                    raise SystemExit(f"upload {table} failed {r.status_code}: {r.text[:400]}")
                time.sleep(3 * (attempt + 1))
            raise SystemExit(f"upload {table} kept failing")
        for rec in recs:
            buf.append(rec)
            if len(buf) >= batch:
                post(buf); sent += len(buf); buf = []
                time.sleep(pause)
                if sent % (batch * 40) == 0:
                    print(f"  {table}: {sent:,} ({time.time() - t0:.0f}s)", flush=True)
        if buf:
            post(buf); sent += len(buf)
    print(f"  {table}: done, {sent:,} rows in {time.time() - t0:.0f}s", flush=True)
    return sent


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return None if n < 0 else n  # Census sentinels (-666666666 etc.) -> null


def _int(v):
    n = _num(v)
    return None if n is None else int(round(n))


def _pct(n, d):
    return round(n / d * 100, 2) if n is not None and d else None


SOURCES = {}


def source(id, **kw):
    SOURCES[id] = {"id": id, **kw}


def write_sources():
    recs = [{"notes": None, **s, "loaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} for s in SOURCES.values()]
    if recs:
        slow_upload("sources", recs, "id", batch=50)


# ---------- 1.2 geography ----------

def council(con):
    src = fetch_arcgis("council_districts_2022", f"{PGH_GIS}/CouncilDistricts2022/FeatureServer/0",
                       out_fields="OBJECTID,DIST_ID")
    con.execute(f"create table cd as select * from ST_Read('{src}')")
    recs = list(jsonable(rows(con, f"select cast(DIST_ID as int) district, {_geom_sql()} geom from cd")))
    slow_upload("council_districts", recs, "district", batch=5)
    source("pgh_council_2022", name="Pittsburgh City Council Districts (2022 map, current)",
           publisher="City of Pittsburgh (via WPRDC)",
           url="https://data.wprdc.org/dataset/city-council-districts-2012 ; service "
               f"{PGH_GIS}/CouncilDistricts2022/FeatureServer/0",
           vintage="2022 redistricting; layer last edited 2025-08-20",
           license="WPRDC lists 'License not specified' (City GIS; WPRDC publisher policy is open data)",
           tables=["council_districts", "parcel_geo"])


def block_groups(con):
    name = f"cb_{ACS_YEAR}_42_bg_500k"
    zip_path, extract = RAW / f"{name}.zip", RAW / name
    if not zip_path.exists():
        r = httpx.get(f"https://www2.census.gov/geo/tiger/GENZ{ACS_YEAR}/shp/{zip_path.name}", timeout=180)
        r.raise_for_status()
        zip_path.write_bytes(r.content)
    if not extract.exists():
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extract)
    shp = next(extract.glob("*.shp"))
    con.execute(f"create table bg as select * from ST_Read('{shp}') where COUNTYFP = '{COUNTY}'")
    recs = list(jsonable(rows(con, f"""
      select GEOID geoid, left(GEOID, 11) tract_geoid, ALAND aland_m2, {_geom_sql()} geom from bg""")))
    slow_upload("block_groups", recs, "geoid", batch=100)
    source("census_cb_2024_bg", name="Census cartographic boundary file, block groups (1:500k)",
           publisher="U.S. Census Bureau", url=f"https://www2.census.gov/geo/tiger/GENZ{ACS_YEAR}/shp/{zip_path.name}",
           vintage="2024 (2020-census block groups)", license="Public domain (U.S. Government work)",
           tables=["block_groups", "parcel_geo"],
           notes="Same generalized edition as public.tracts (cb_2024 tracts), derived from TIGER/Line 2024.")


PARCEL_GEO_CHUNKS = 40


def parcel_geo(con=None, start="0"):
    for n in range(int(start), PARCEL_GEO_CHUNKS):
        t0 = time.time()
        _run_sql(f"""
          set local statement_timeout = '110s';
          insert into public.parcel_geo (parid, municipality, muni_code, is_pittsburgh, neighborhood,
                 council_district, tract_geoid, block_group_geoid, school_district, school_code, zip)
          select p.parid, m.name, k.muni_code, k.is_pgh,
                 case when k.is_pgh then c.neighborhood end,
                 case when k.is_pgh then cd.district end,
                 t.geoid, bg.geoid, a.school_desc, a.school_code, nullif(trim(a.zip), '')
          from public.parcels p
          left join public.assessments a on a.parid = p.parid
          left join public.parcel_context c on c.parid = p.parid
          left join public.parcel_tract t on t.parid = p.parid
          cross join lateral (
            select coalesce(a.municode, p.municode) code,
                   case when coalesce(a.municode, p.municode) ~ '^[1-4][0-9][0-9]$'
                        then left(coalesce(a.municode, p.municode), 1) || '00'
                        else coalesce(a.municode, p.municode) end muni_code,
                   coalesce(coalesce(a.municode, p.municode) ~ '^1(0[1-9]|[12][0-9]|3[0-2])$', false) is_pgh
          ) k
          left join public.municipalities m on m.muni_code = k.muni_code
          left join lateral (
            select d.district from public.council_districts d
            where k.is_pgh and extensions.ST_Intersects(d.geom, p.centroid) limit 1
          ) cd on true
          left join lateral (
            select b.geoid from public.block_groups b
            where b.tract_geoid = t.geoid and extensions.ST_Intersects(b.geom, p.centroid) limit 1
          ) bg on true
          where abs(hashtext(p.parid)) % {PARCEL_GEO_CHUNKS} = {n}
          on conflict (parid) do update set
            municipality = excluded.municipality, muni_code = excluded.muni_code,
            is_pittsburgh = excluded.is_pittsburgh, neighborhood = excluded.neighborhood,
            council_district = excluded.council_district, tract_geoid = excluded.tract_geoid,
            block_group_geoid = excluded.block_group_geoid, school_district = excluded.school_district,
            school_code = excluded.school_code, zip = excluded.zip;
        """)
        print(f"  parcel_geo chunk {n + 1}/{PARCEL_GEO_CHUNKS} ({time.time() - t0:.0f}s)", flush=True)
        time.sleep(4)


# ---------- 1.4 ACS ----------

ACS_COMMON = [
    "NAME", "B01003_001E", "B25003_001E", "B25003_002E", "B25003_003E",
    "B19013_001E", "B19013_001M", "B25064_001E", "B25064_001M",
    "B25070_001E", "B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E", "B25070_011E",
    "B11005_001E", "B11005_002E",
    "B03002_001E", "B03002_003E", "B03002_004E", "B03002_005E", "B03002_006E",
    "B03002_007E", "B03002_008E", "B03002_009E", "B03002_012E",
]


def _acs_get(level, extra):
    key = os.environ["CENSUS_API_KEY"]
    params = {"get": ",".join(ACS_COMMON + extra), "key": key}
    if level == "tract":
        params.update({"for": "tract:*", "in": f"state:{STATE} county:{COUNTY}"})
    else:
        params.update({"for": "block group:*", "in": f"state:{STATE} county:{COUNTY} tract:*"})
    r = httpx.get(f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5", params=params, timeout=120)
    if r.status_code != 200:
        raise SystemExit(f"Census API {level} failed: HTTP {r.status_code}")  # never echo the URL (has key)
    data = r.json()
    return [dict(zip(data[0], row)) for row in data[1:]]


def _acs_row(d, level):
    geoid = d["state"] + d["county"] + d["tract"] + (d.get("block group") or "")
    hh = _int(d["B25003_001E"])
    renters = _int(d["B25003_003E"])
    denom = None
    if _int(d["B25070_001E"]) is not None and _int(d["B25070_011E"]) is not None:
        denom = _int(d["B25070_001E"]) - _int(d["B25070_011E"])
    b30 = [_int(d[f"B25070_0{i}E"]) for i in ("07", "08", "09", "10")]
    b30n = sum(v for v in b30 if v is not None) if any(v is not None for v in b30) else None
    b50n = _int(d["B25070_010E"])
    if level == "tract":
        pov_u, pov_n, pov_t = _int(d["B17001_001E"]), _int(d["B17001_002E"]), "B17001"
    else:
        pov_u = _int(d["C17002_001E"])
        p2, p3 = _int(d["C17002_002E"]), _int(d["C17002_003E"])
        pov_n = None if p2 is None or p3 is None else p2 + p3
        pov_t = "C17002"
    kids = _int(d["B11005_002E"])
    kids_u = _int(d["B11005_001E"])
    others = [_int(d[f"B03002_00{i}E"]) for i in ("5", "7", "8")]
    out = {
        "geoid": geoid, "name": d["NAME"], "vintage": ACS_VINTAGE, "acs_year": ACS_YEAR,
        "population": _int(d["B01003_001E"]), "households": hh,
        "owner_hh": _int(d["B25003_002E"]), "renter_hh": renters, "renter_share_pct": _pct(renters, hh),
        "median_hh_income": _num(d["B19013_001E"]), "median_hh_income_moe": _num(d["B19013_001M"]),
        "median_gross_rent": _num(d["B25064_001E"]), "median_gross_rent_moe": _num(d["B25064_001M"]),
        "rent_burden_universe": denom, "rent_burden_30_n": b30n, "rent_burden_50_n": b50n,
        "rent_burden_30_pct": _pct(b30n, denom), "rent_burden_50_pct": _pct(b50n, denom),
        "poverty_universe": pov_u, "poverty_n": pov_n, "poverty_pct": _pct(pov_n, pov_u), "poverty_table": pov_t,
        "hh_with_children": kids, "hh_with_children_pct": _pct(kids, kids_u),
        "pop_race_universe": _int(d["B03002_001E"]), "nh_white": _int(d["B03002_003E"]),
        "nh_black": _int(d["B03002_004E"]), "nh_asian": _int(d["B03002_006E"]),
        "nh_other": sum(v for v in others if v is not None) if any(v is not None for v in others) else None,
        "nh_two_or_more": _int(d["B03002_009E"]), "hispanic": _int(d["B03002_012E"]),
    }
    if level == "bg":
        out["tract_geoid"] = geoid[:11]
    return out


def acs(con=None):
    tr = [_acs_row(d, "tract") for d in _acs_get("tract", ["B17001_001E", "B17001_002E"])]
    slow_upload("acs_tract", tr, "geoid", batch=200)
    time.sleep(2)
    bg = [_acs_row(d, "bg") for d in _acs_get("bg", ["C17002_001E", "C17002_002E", "C17002_003E"])]
    slow_upload("acs_bg", bg, "geoid", batch=250)
    source("acs5_2024", name="American Community Survey 5-year estimates (tables B01003, B03002, B11005, "
                            "B17001, C17002, B19013, B25003, B25064, B25070)",
           publisher="U.S. Census Bureau (Census Data API)", url=f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5",
           vintage=ACS_VINTAGE + " (released Dec 2025; 2021-2025 not yet published on 2026-09-26)",
           license="Public domain (U.S. Government work)", tables=["acs_tract", "acs_bg"],
           notes="B03002 race/ethnicity is equity context only and never feeds a parcel score. "
                 "Block groups use C17002 for poverty (B17001 is tract-only).")


# ---------- 1.4 CHAS ----------

CHAS_COLS = {
    "hh_total": "T2_EST1", "hh_le30": "T8_LE30", "hh_30_50": "T8_GT30_LE50", "hh_50_80": "T8_GT50_LE80",
    "hh_80_100": "T8_GT80_LE100", "hh_gt100": "T8_GT100",
    "cb_le30": "T8_LE30_CB", "cb_30_50": "T8_GT30_LE50_CB", "cb_50_80": "T8_GT50_LE80_CB",
    "cb_80_100": "T8_GT80_LE100_CB", "scb_le30": "T8_LE30_CB50", "scb_30_50": "T8_GT30_LE50_CB50",
    "scb_50_80": "T8_GT50_LE80_CB50", "scb_80_100": "T8_GT80_LE100_CB50", "renter_cb_le30": "T8_LE30_CB_R",
    "rental_units_total": "RENT_DENOM", "rental_units_afford_le30": "AFF_AVAIL_30_R",
    "rental_units_afford_le50": "AFF_AVAIL_50_R", "rental_units_afford_le80": "AFF_AVAIL_80_R",
}
CHAS_TRACT_VINTAGE = "2016-2020 (per HUD eGIS item metadata)"


def chas(con=None):
    url = f"{HUD_EGIS}/ACS_5YR_ESTIMATES_CHAS_TRACT/FeatureServer/1/query"
    r = httpx.get(url, params={"where": f"STATE='{STATE}' AND COUNTY='{COUNTY}'", "outFields": "*",
                               "returnGeometry": "false", "f": "json"}, timeout=120)
    r.raise_for_status()
    feats = [f["attributes"] for f in r.json()["features"]]
    recs = []
    for a in feats:
        rec = {"geoid": a["GEOID"], "vintage": CHAS_TRACT_VINTAGE}
        for col, fld in CHAS_COLS.items():
            rec[col] = _int(a.get(fld))
        rec["attrs"] = {k: v for k, v in a.items() if k not in ("OBJECTID", "Shape__Area", "Shape__Length")}
        recs.append(rec)
    slow_upload("chas_tract", recs, "geoid", batch=100)
    source("hud_chas_tract_egis", name="HUD CHAS, ACS 5-year CHAS Estimate Data by Tract",
           publisher="U.S. Department of Housing and Urban Development (eGIS open data)",
           url=f"{HUD_EGIS}/ACS_5YR_ESTIMATES_CHAS_TRACT/FeatureServer (item db5099395be44cbd8c6896136dbd5e7e)",
           vintage=CHAS_TRACT_VINTAGE + "; service updated 2025-09-05. The service's own description still "
                   "says 2013-2017 -- conflicting metadata, noted.",
           license="Public domain (U.S. Government work); HUD eGIS disclaimer", tables=["chas_tract"],
           notes="Newest tract-level CHAS (2018-2022) is only a bulk download on huduser.gov, which answers "
                 "automated requests with a bot challenge (AWS WAF); not fetched.")


def _cousubs():
    key = os.environ["CENSUS_API_KEY"]
    r = httpx.get(f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5", params={
        "get": "NAME", "for": "county subdivision:*", "in": f"state:{STATE} county:{COUNTY}", "key": key},
        timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"Census API cousub failed: HTTP {r.status_code}")
    data = r.json()
    return [dict(zip(data[0], row)) for row in data[1:]]


def _norm_muni(s):
    import re
    s = s.upper().split(",")[0]
    s = re.sub(r"\b(CITY|BOROUGH|TOWNSHIP|MUNICIPALITY|TOWN)\b", "", s)
    s = s.replace("MT.", "MOUNT").replace("MT ", "MOUNT ").replace("MCKEES ROCKS", "MC KEES ROCKS")
    return re.sub(r"[^A-Z]", "", s)


def chas_area(con=None):
    token = os.environ["HUD_API_TOKEN"]
    munis = {_norm_muni(r["name"]): r["muni_code"] for r in _run_sql("select muni_code, name from public.municipalities")}

    def get(type_, entity):
        for attempt in range(5):
            r = httpx.get("https://www.huduser.gov/hudapi/public/chas",
                          headers={"Authorization": f"Bearer {token}"},
                          params={"type": type_, "stateId": STATE, "entityId": entity}, timeout=60)
            if r.status_code == 200:
                d = r.json()
                return d[0] if isinstance(d, list) and d and "geoname" in d[0] else None
            time.sleep(10 * (attempt + 1))
        return None

    def rec(level, geoid, muni_code, d):
        keys = ["owner_le30", "renter_le30", "total_le30", "owner_30_50", "renter_30_50", "total_30_50",
                "owner_50_80", "renter_50_80", "total_50_80", "owner_80_100", "renter_80_100", "total_80_100",
                "owner_gt100", "renter_gt100", "total_gt100", "owner_total", "renter_total", "hh_total"]
        out = {"level": level, "geoid": geoid, "muni_code": muni_code, "name": d["geoname"], "vintage": d["year"]}
        for i, k in enumerate(keys, 1):
            out[k] = _int(d.get(f"A{i}"))
        out["attrs"] = d
        return out

    out = []
    d = get(3, int(COUNTY))
    if d:
        out.append(rec("county", STATE + COUNTY, None, d))
    unmatched, missing = [], []
    for c in _cousubs():
        code = c["county subdivision"]
        muni = munis.get(_norm_muni(c["NAME"]))
        if muni is None:
            unmatched.append(c["NAME"])
        d = get(4, int(code))  # API rejects leading zeros
        time.sleep(1.0)
        if d is None:
            missing.append(c["NAME"])
            continue
        out.append(rec("municipality", code, muni, d))
    slow_upload("chas_area", out, "level,geoid", batch=50)
    print(f"  chas_area: {len(out)} rows; cousub names not matched to municipalities: {unmatched}; "
          f"no CHAS returned: {missing}")
    source("hud_chas_api_2022", name="HUD CHAS 2018-2022, county and county-subdivision level (CHAS API)",
           publisher="U.S. Department of Housing and Urban Development, HUD User",
           url="https://www.huduser.gov/hudapi/public/chas (docs: https://www.huduser.gov/portal/dataset/chas-api.html)",
           vintage="2018-2022", license="Public domain (U.S. Government work); HUD User API terms",
           tables=["chas_area"],
           notes="Households by HAMFI band x tenure (fields A1-A18); remaining fields kept raw in attrs.")


# ---------- 1.4 LIHTC ----------

def lihtc(con=None):
    url = f"{HUD_EGIS}/LIHTC/FeatureServer/0/query"
    fields = ("HUD_ID,PROJECT,PROJ_ADD,PROJ_CTY,PROJ_ZIP,N_UNITS,LI_UNITS,N_0BR,N_1BR,N_2BR,N_3BR,N_4BR,"
              "YR_PIS,YR_ALLOC,CREDIT,TYPE,NON_PROF,TRGT_POP,QCT,DDA,LAT,LON")
    r = httpx.get(url, params={"where": "STATE2KX='42' AND CNTY2KX='3'", "outFields": fields,
                               "returnGeometry": "false", "resultRecordCount": 2000, "f": "json"}, timeout=120)
    r.raise_for_status()
    feats = [f["attributes"] for f in r.json()["features"]]

    def yr(v):
        n = _int(v)
        return n if n and 1986 <= n <= 2100 else None

    def cnt(v):
        n = _int(v)
        return n if n is not None and n < 99990 else None  # HUD uses 99999-style codes for missing

    recs = []
    for a in feats:
        lat, lon = _num(a.get("LAT")), a.get("LON")
        try:
            lon = float(lon)
        except (TypeError, ValueError):
            lon = None
        recs.append({
            "hud_id": a["HUD_ID"], "project": a.get("PROJECT"), "address": a.get("PROJ_ADD"),
            "city": a.get("PROJ_CTY"), "zip": a.get("PROJ_ZIP"),
            "n_units": cnt(a.get("N_UNITS")), "li_units": cnt(a.get("LI_UNITS")),
            "n_0br": cnt(a.get("N_0BR")), "n_1br": cnt(a.get("N_1BR")), "n_2br": cnt(a.get("N_2BR")),
            "n_3br": cnt(a.get("N_3BR")), "n_4br": cnt(a.get("N_4BR")),
            "yr_pis": yr(a.get("YR_PIS")), "yr_alloc": yr(a.get("YR_ALLOC")),
            "credit": a.get("CREDIT"), "construction_type": a.get("TYPE"),
            "non_profit": {"1": True, "2": False}.get(str(a.get("NON_PROF"))),
            "target_pop": a.get("TRGT_POP"),
            "qct": {"1": True, "2": False}.get(str(a.get("QCT"))),
            "dda": None if a.get("DDA") in (None, "") else str(a.get("DDA")) != "0",
            "geom": f"SRID=4326;POINT({lon} {lat})" if lat and lon else None,
        })
    slow_upload("lihtc_projects", recs, "hud_id", batch=100)
    _run_sql("""
      update public.lihtc_projects l set tract_geoid = t.geoid
      from public.tracts t where l.geom is not null and extensions.ST_Intersects(t.geom, l.geom);
    """)
    source("hud_lihtc", name="HUD Low-Income Housing Tax Credit (LIHTC) project database",
           publisher="U.S. Department of Housing and Urban Development (eGIS open data)",
           url=f"{HUD_EGIS}/LIHTC/FeatureServer/0 (dataset: https://www.huduser.gov/portal/datasets/lihtc.html)",
           vintage="HUD eGIS layer (last edited 2025-05-14); Allegheny projects placed in service 1987-2019 "
                   "(25 with year unknown, HUD code 8888)",
           license="Public domain (U.S. Government work)", tables=["lihtc_projects"],
           notes="Contact, company and company-address fields not loaded. HUD's newer national release "
                 "(LIHTCPUB.zip on huduser.gov) answers automated requests with a bot challenge; not fetched, "
                 "so projects placed in service after 2019 are missing.")


# ---------- 1.5 millage ----------

def millage_fix(con=None):
    """065's parser skipped Monroeville ('... Municipality' matched its header
    filter). Add it from the same Treasurer listing (2026 column)."""
    text = subprocess.run(["pdftotext", "-layout", str(RAW / "millage_muni_2026.pdf"), "-"],
                          capture_output=True, text=True, check=True).stdout
    import re
    m = re.search(r"^Monroeville Municipality\s.*?\s([\d.]+)\s+([\d.]+)\s+\$", text, re.M)
    if not m:
        raise SystemExit("Monroeville line not found in the millage PDF")
    rec = {"jurisdiction_type": "municipality", "code": "879", "name": "Monroeville Municipality",
           "rate_type": "general", "mills": float(m.group(2)), "year": 2026,
           "source_url": "https://alleghenycountytreasurer.us/wp-content/uploads/2026/03/Tax-Collectors-Millages-2026.pdf"}
    slow_upload("millage", [rec], "jurisdiction_type,code,rate_type,year", batch=1)
    source("alco_treasurer_millage_2026", name="Allegheny County Treasurer tax millage listings "
           "(municipal 2026; school district 2025-2026)", publisher="Allegheny County Treasurer",
           url="https://alleghenycountytreasurer.us/wp-content/uploads/2026/03/Tax-Collectors-Millages-2026.pdf ; "
               "https://alleghenycountytreasurer.us/wp-content/uploads/2025/07/School-District-Millages_2025-2026.pdf",
           vintage="2026 (municipal/county); 2025-26 school year", license="Public government record",
           tables=["millage", "millage_rates"])


def sources(con=None):
    """Register the pre-existing geography tables the crosswalk reuses."""
    source("alco_municipalities", name="Allegheny County Municipal Boundaries", publisher="Allegheny County, via WPRDC",
           url="https://data.wprdc.org/dataset/allegheny-county-municipal-boundaries", vintage="2026-09 download",
           license="WPRDC lists 'License not specified'", tables=["municipalities", "parcel_geo"])
    source("pgh_neighborhoods", name="Pittsburgh Neighborhoods", publisher="City of Pittsburgh, via WPRDC",
           url="https://data.wprdc.org/dataset/neighborhoods2", vintage="2026-09 download",
           license="WPRDC open data (City of Pittsburgh)", tables=["neighborhoods", "parcel_context", "parcel_geo"])
    source("census_cb_2024_tract", name="Census cartographic boundary file, tracts (1:500k)",
           publisher="U.S. Census Bureau", url="https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_42_tract_500k.zip",
           vintage="2024 (2020-census tracts)", license="Public domain (U.S. Government work)",
           tables=["tracts", "parcel_tract", "parcel_geo"])
    source("hud_fmr_il_2026", name="HUD FY2026 Fair Market Rents, Small Area FMRs and Income Limits "
           "(Pittsburgh, PA HUD Metro FMR Area)", publisher="U.S. Department of Housing and Urban Development, HUD User API",
           url="https://www.huduser.gov/portal/dataset/fmr-api.html", vintage="FY2026",
           license="Public domain (U.S. Government work)", tables=["hud_fmr", "hud_income_limits"],
           notes="Loaded earlier by scripts/ingest_finance.py; MSA FMR + 124 Allegheny ZIP SAFMRs; IL 30/50/80%.")
    source("hud_qct_dda_2026", name="HUD 2026 Qualified Census Tracts and Difficult Development Areas",
           publisher="U.S. Department of Housing and Urban Development", url="https://www.huduser.gov/portal/datasets/qct.html",
           vintage="2026 designations", license="Public domain (U.S. Government work)", tables=["tract_designations"],
           notes="Loaded earlier by scripts/ingest_finance.py.")


STEPS = {"council": council, "block_groups": block_groups, "parcel_geo": parcel_geo, "acs": acs, "chas": chas, "chas_area": chas_area,
         "lihtc": lihtc, "millage_fix": millage_fix, "sources": sources}

if __name__ == "__main__":
    load_env()
    os.chdir(ROOT)
    step, *extra = sys.argv[1:]
    fn = STEPS[step]
    fn(connect(), *extra) if step in ("council", "block_groups") else fn(None, *extra)
    write_sources()
