# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load Allegheny County datasets from data/raw/ into Supabase.

Usage: uv run scripts/ingest.py <dataset>   (assessments | parcels | sales | ...)

Transforms run locally in DuckDB; rows are upserted through the Supabase REST API
with the server-only secret key. Personal data is dropped here, before upload.
"""
import os
import sys
import time
from pathlib import Path

import duckdb
import httpx

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def load_env():
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v)


def connect():
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    return con


def upload(table, rows_iter, total, batch=2000, on_conflict="parid"):
    url = f"{os.environ['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/{table}?on_conflict={on_conflict}"
    key = os.environ["SUPABASE_SECRET_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    sent, t0, last = 0, time.time(), 0
    with httpx.Client(timeout=180, limits=httpx.Limits(max_connections=8)) as client, \
            ThreadPoolExecutor(max_workers=6) as pool:
        pending, buf = set(), []

        def drain(block_until):
            nonlocal sent, pending, last
            while len(pending) > block_until:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for f in done:
                    sent += f.result()
            if sent - last >= batch * 20:
                last = sent
                print(f"  {table}: {sent:,}/{total:,} ({time.time() - t0:.0f}s)", flush=True)

        for row in rows_iter:
            buf.append(row)
            if len(buf) >= batch:
                pending.add(pool.submit(_post, client, url, headers, buf))
                buf = []
                drain(12)
        if buf:
            pending.add(pool.submit(_post, client, url, headers, buf))
        drain(0)
    print(f"  {table}: done, {sent:,} rows in {time.time() - t0:.0f}s", flush=True)


def _post(client, url, headers, rows):
    for attempt in range(5):
        r = client.post(url, headers=headers, json=rows)
        if r.status_code < 300:
            return len(rows)
        if attempt == 4 or r.status_code < 500 and r.status_code != 429:
            raise SystemExit(f"upload failed {r.status_code}: {r.text[:500]}")
        time.sleep(2 ** attempt)


def rows(con, sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    while chunk := cur.fetchmany(10000):
        for rec in chunk:
            yield dict(zip(cols, rec))


def jsonable(gen, json_cols=("attrs",)):
    import json
    for r in gen:
        out = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}
        for c in json_cols:  # DuckDB returns JSON as text; send it as a real object
            if isinstance(out.get(c), str):
                out[c] = json.loads(out[c])
        yield out


# ---------- datasets ----------

def assessments(con):
    # Dropped on purpose: owner mailing-address fields, LEGAL1-3,
    # DEEDBOOK/DEEDPAGE, PREVSALE* — personal or deed-linked. No owner names are published.
    con.execute(f"""
      create table a as
      select * from read_csv('{RAW / 'assessments.csv'}', all_varchar=true, header=true)
    """)
    total = con.execute("select count(distinct PARID) from a").fetchone()[0]
    sql = """
      select distinct on (PARID)
        PARID as parid,
        nullif(trim(PROPERTYHOUSENUM),'') as house_num,
        nullif(trim(PROPERTYADDRESS),'') as address,
        nullif(trim(PROPERTYUNIT),'') as unit,
        nullif(trim(PROPERTYCITY),'') as city,
        nullif(trim(PROPERTYZIP),'') as zip,
        nullif(trim(MUNICODE),'') as municode,
        nullif(trim(MUNIDESC),'') as muni_desc,
        nullif(trim(SCHOOLCODE),'') as school_code,
        nullif(trim(SCHOOLDESC),'') as school_desc,
        nullif(trim(NEIGHCODE),'') as neigh_code,
        nullif(trim(NEIGHDESC),'') as neigh_desc,
        nullif(trim(TAXCODE),'') as tax_code,
        nullif(trim(TAXDESC),'') as tax_desc,
        nullif(trim(OWNERDESC),'') as owner_type,
        nullif(trim(CLASS),'') as class_code,
        nullif(trim(CLASSDESC),'') as class_desc,
        nullif(trim(USECODE),'') as use_code,
        nullif(trim(USEDESC),'') as use_desc,
        try_cast(LOTAREA as double) as lot_area_sqft,
        HOMESTEADFLAG = 'HOM' as homestead,
        CLEANGREEN = 'Y' as clean_green,
        nullif(trim(ABATEMENTFLAG),'') is not null as abatement,
        try_strptime(SALEDATE, '%m-%d-%Y')::date as last_sale_date,
        try_cast(SALEPRICE as double) as last_sale_price,
        nullif(trim(SALECODE),'') as last_sale_code,
        nullif(trim(SALEDESC),'') as last_sale_desc,
        try_cast(COUNTYLAND as double) as county_land,
        try_cast(COUNTYBUILDING as double) as county_building,
        try_cast(COUNTYTOTAL as double) as county_total,
        try_cast(FAIRMARKETLAND as double) as fmv_land,
        try_cast(FAIRMARKETBUILDING as double) as fmv_building,
        try_cast(FAIRMARKETTOTAL as double) as fmv_total,
        nullif(trim(STYLEDESC),'') as style_desc,
        try_cast(STORIES as double) as stories,
        try_cast(YEARBLT as int) as year_built,
        nullif(trim(GRADEDESC),'') as grade_desc,
        nullif(trim(CONDITIONDESC),'') as condition_desc,
        nullif(trim(CDUDESC),'') as cdu_desc,
        try_cast(FINISHEDLIVINGAREA as double) as living_area_sqft,
        try_cast(TAXYEAR as int) as tax_year,
        try_strptime(ASOFDATE, '%d-%b-%y')::date as as_of_date
      from a
      where length(PARID) = 16
      order by PARID, try_cast(CARDNUMBER as int) nulls last
    """
    upload("assessments", jsonable(rows(con, sql)), total)


PARCEL_COLS = "{'_id':'VARCHAR','pin':'VARCHAR','map_block_lot':'VARCHAR','municode':'VARCHAR','calc_acreage':'VARCHAR','comments':'VARCHAR','notes':'VARCHAR','pseudono':'VARCHAR','shape_length':'VARCHAR','wkt':'VARCHAR'}"


def parcels(con):
    # Source WKT is PA State Plane South NAD83 feet (EPSG:2272); convert to WGS84.
    con.execute(f"""
      create table p as
      select pin, map_block_lot, municode, try_cast(calc_acreage as double) calc_acreage, wkt
      from read_csv('{RAW / 'parcels.tsv'}', auto_detect=false, header=true, delim='\t', quote='', escape='', max_line_size=60000000, columns={PARCEL_COLS})
      where length(pin) = 16 and wkt is not null and trim(wkt) <> ''
    """)
    total = con.execute("select count(distinct pin) from p").fetchone()[0]
    sql = """
      -- Some parcels arrive as several rows (one per piece): merge the pieces.
      with g as (
        select pin, any_value(map_block_lot) map_block_lot, any_value(municode) municode,
               sum(calc_acreage) calc_acreage,
               ST_MakeValid(ST_Union_Agg(ST_MakeValid(
                 ST_Transform(ST_GeomFromText(wkt), 'EPSG:2272', 'EPSG:4326', always_xy := true)))) as geom
        from p group by pin
      )
      select pin as parid, map_block_lot, nullif(trim(municode),'') municode, calc_acreage,
             'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_Multi(ST_CollectionExtract(geom, 3)), 0.0000001)) as geom,
             'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_PointOnSurface(geom), 0.0000001)) as centroid
      from g
      where not ST_IsEmpty(ST_CollectionExtract(geom, 3))
    """
    upload("parcels", jsonable(rows(con, sql)), total, batch=1000)


PGH = "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services"
FEMA_NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"


def fetch_arcgis(name, layer_url, where="1=1", out_fields="*", page=1000):
    """Page through an ArcGIS layer and save all features as one GeoJSON in data/raw/."""
    import json
    dest = RAW / f"{name}.geojson"
    if dest.exists():
        return dest
    feats, offset = [], 0
    with httpx.Client(timeout=180) as client:
        # Services without paging support (e.g. FEMA NFHL MapServer): fetch by object-ID chunks.
        ids = client.get(f"{layer_url}/query", params={
            "where": where, "returnIdsOnly": "true", "f": "json"}).json().get("objectIds") or []
        if "MapServer" in layer_url:
            def get_chunk(chunk):
                for attempt in range(3):
                    r = client.post(f"{layer_url}/query", data={
                        "objectIds": ",".join(map(str, chunk)), "outFields": out_fields,
                        "outSR": 4326, "f": "geojson"})
                    if r.status_code == 200 and "features" in r.text[:2000]:
                        return r.json()["features"]
                    time.sleep(2 * (attempt + 1))
                if len(chunk) == 1:
                    print(f"  WARNING {name}: object {chunk[0]} could not be fetched")
                    return []
                half = len(chunk) // 2
                return get_chunk(chunk[:half]) + get_chunk(chunk[half:])

            ids.sort()
            for i in range(0, len(ids), 100):
                feats += get_chunk(ids[i:i + 100])
            dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
            print(f"  fetched {name}: {len(feats):,} of {len(ids):,} features")
            return dest
        while True:
            r = client.get(f"{layer_url}/query", params={
                "where": where, "outFields": out_fields, "outSR": 4326, "f": "geojson",
                "resultOffset": offset, "resultRecordCount": page, "orderByFields": "OBJECTID",
            })
            r.raise_for_status()
            batch = r.json().get("features", [])
            feats += batch
            if len(batch) < page:
                break
            offset += page
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"  fetched {name}: {len(feats):,} features")
    return dest


def _geom_sql(col="geom"):
    return (f"'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_Multi(ST_CollectionExtract("
            f"ST_MakeValid({col}), 3)), 0.0000001))")


def zoning(con):
    # Only planning attributes are kept; GIS editor user names are dropped.
    src = fetch_arcgis("zoning_pgh", f"{PGH}/PGHWebZoning/FeatureServer/0",
                       out_fields="OBJECTID,zon_new,full_zoning_type,legendtype,municode")
    con.execute(f"create table z as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from z").fetchone()[0]
    sql = f"""
      select OBJECTID as id, nullif(trim(zon_new),'') zone_code, full_zoning_type zone_type,
             legendtype legend_type, cast(municode as varchar) municode, {_geom_sql()} as geom
      from z where geom is not null
    """
    upload("zoning", jsonable(rows(con, sql)), total, batch=200, on_conflict="id")


OVERLAYS = {
    # layer name: (fetch url, where, out_fields, label expression, attrs expression)
    "flood_fema_nfhl": (FEMA_NFHL, "DFIRM_ID LIKE '42003%'",
                        "OBJECTID,FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE",
                        "FLD_ZONE",
                        "json_object('zone', FLD_ZONE, 'subtype', ZONE_SUBTY, 'sfha', SFHA_TF, 'bfe', STATIC_BFE)"),
    "landslide_prone_pgh": (f"{PGH}/PGHWebLandslideProne/FeatureServer/0", "1=1",
                            "objectid,landslideprone,acres", "'landslide-prone'",
                            "json_object('acres', acres)"),
    "undermined_pgh": (f"{PGH}/PGHWebUndermined/FeatureServer/0", "1=1",
                       "objectid,undermined", "'undermined'", "json_object('undermined', undermined)"),
    "greenway_pgh": (f"{PGH}/PGHWebGreenways/FeatureServer/0", "1=1", "*", "'greenway'", "NULL"),
    # City of Pittsburgh historic districts (Historic Review Commission jurisdiction).
    "historic_district_pgh": (f"{PGH}/PGHWebCHDHistoricDistricts/FeatureServer/0", "1=1",
                              "OBJECTID,type,historic_name,guideline_link", "historic_name",
                              "json_object('type', type, 'guidelines', guideline_link)"),
    # Zoning overlays (e.g. steep slope, environmental, residential compatibility).
    "zoning_overlay_pgh": (f"{PGH}/PGHWebZoningOverlays/FeatureServer/0", "1=1",
                           "OBJECTID,overlay,criteria,computronixvalue", "overlay",
                           "json_object('criteria', criteria, 'code', computronixvalue)"),
    "inclusionary_pgh": (f"{PGH}/InclusionaryHousingOverlayDistrict/FeatureServer/0", "1=1",
                         "OBJECTID", "'Inclusionary Housing Overlay'", "NULL"),
    "riverfront_pgh": (f"{PGH}/PGHWebRiverfrontOverlay/FeatureServer/0", "1=1",
                       "objectid,type,zone,riverfront_ipod", "coalesce(zone, type)",
                       "json_object('type', type, 'ipod', riverfront_ipod)"),
    "uptown_ipod_pgh": (f"{PGH}/PGHWebUptownIPOD/FeatureServer/0", "1=1", "objectid",
                        "'Uptown IPOD'", "NULL"),
    "parking_reduction_pgh": (f"{PGH}/PGHWebParkingReductionOverlay/FeatureServer/0", "1=1",
                              "OBJECTID,name,reduction", "name",
                              "json_object('reduction', reduction)"),
    "height_reduction_pgh": (f"{PGH}/HeightReductionZone_ZoningOverlay/FeatureServer/0", "1=1",
                             "OBJECTID,Zone,Height", "Zone", "json_object('height', Height)"),
}


def overlays(con, only=None):
    for layer, (url, where, fields, label, attrs) in OVERLAYS.items():
        if only and layer != only:
            continue
        src = fetch_arcgis(layer, url, where=where, out_fields=fields,
                           page=2000 if "fema" in url else 1000)
        con.execute(f"create or replace table o as select * from ST_Read('{src}')")
        cols = [c[0] for c in con.execute("describe o").fetchall()]
        oid = next((c for c in cols if c.lower() in ("objectid", "fid", "objectid_1")),
                   "row_number() over ()")
        total = con.execute("select count(*) from o").fetchone()[0]
        sql = f"""
          select '{layer}' as layer, cast({oid} as varchar) as source_id, {label} as label,
                 {attrs} as attrs, {_geom_sql()} as geom
          from o where geom is not null
        """
        upload("overlays", jsonable(rows(con, sql)), total, batch=100, on_conflict="layer,source_id")


def clean_tsv(name):
    """WPRDC datastore dumps trip DuckDB's CSV sniffer; re-write them as plain TSV."""
    import csv
    src, dest = RAW / f"{name}.csv", RAW / f"{name}.tsv"
    if dest.exists():
        return dest
    csv.field_size_limit(10**9)
    with open(src, newline="") as f, open(dest, "w") as o:
        r = csv.reader(f)
        for row in r:
            o.write("\t".join(c.replace("\t", " ").replace("\n", " ").replace("\r", " ") for c in row) + "\n")
    return dest


def sales(con):
    con.execute(f"""
      create table s as select * from read_csv('{clean_tsv("sales")}', all_varchar=true, header=true,
                                               delim='\t', quote='', escape='')
    """)
    total = con.execute("select count(*) from s where trim(SALECODE) = '0'").fetchone()[0]
    sql = """
      select cast(_id as bigint) sale_id, PARID parid, try_cast(SALEDATE as date) sale_date,
             try_cast(RECORDDATE as date) record_date, try_cast(PRICE as double) price,
             nullif(trim(MUNICODE),'') municode, nullif(trim(SCHOOLCODE),'') school_code,
             nullif(trim(INSTRTYPDESC),'') instr_type
      from s
      where trim(SALECODE) = '0' and length(PARID) = 16
    """
    upload("sales_valid", jsonable(rows(con, sql)), total, batch=2000, on_conflict="sale_id")


def assessment_dates(con):
    """Re-send only the date columns (upsert updates just the columns provided)."""
    con.execute(f"create table a as select * from read_csv('{RAW / 'assessments.csv'}', all_varchar=true, header=true)")
    total = con.execute("select count(distinct PARID) from a").fetchone()[0]
    sql = """
      select distinct on (PARID) PARID parid,
             try_strptime(SALEDATE, '%m-%d-%Y')::date last_sale_date,
             try_strptime(ASOFDATE, '%d-%b-%y')::date as_of_date
      from a where length(PARID) = 16 order by PARID, try_cast(CARDNUMBER as int) nulls last
    """
    upload("assessments", jsonable(rows(con, sql)), total, batch=5000)


def permits(con):
    # Selected columns only: owner/contractor names and free-text descriptions are never read.
    con.execute(f"""
      create table pm as select permit_id, parcel_num, permit_type, work_type,
             commercial_or_residential, total_project_value, issue_date, status
      from read_csv('{clean_tsv("permits")}', all_varchar=true, header=true,
                    delim='\\t', quote='', escape='')
    """)
    total = con.execute("select count(distinct permit_id) from pm").fetchone()[0]
    sql = """
      select distinct on (permit_id) permit_id,
             case when length(trim(parcel_num)) = 16 then trim(parcel_num) end parid,
             nullif(trim(permit_type),'') permit_type, nullif(trim(work_type),'') work_type,
             nullif(trim(commercial_or_residential),'') res_or_comm,
             try_cast(total_project_value as double) project_value,
             try_cast(left(issue_date, 10) as date) issue_date, nullif(trim(status),'') status
      from pm where nullif(trim(permit_id),'') is not null order by permit_id
    """
    upload("permits", jsonable(rows(con, sql)), total, batch=5000, on_conflict="permit_id")


def condemned(con):
    # The source "owner" column is never read.
    con.execute(f"""
      create table cd as select record_number, parcel_id, property_type, create_date,
             latest_inspection_result, latest_inspection_score, inspection_status
      from read_csv('{clean_tsv("condemned")}', all_varchar=true, header=true,
                    delim='\\t', quote='', escape='')
    """)
    total = con.execute("select count(*) from cd").fetchone()[0]
    sql = """
      select distinct on (record_number) record_number,
             case when length(trim(parcel_id)) = 16 then trim(parcel_id) end parid,
             property_type, try_cast(left(create_date, 10) as date) created,
             nullif(trim(latest_inspection_result),'') inspection_result,
             try_cast(latest_inspection_score as double) inspection_score,
             inspection_status status
      from cd where nullif(trim(record_number),'') is not null order by record_number
    """
    upload("condemned", jsonable(rows(con, sql)), total, batch=5000, on_conflict="record_number")


def schools(con):
    src = RAW / "school_districts.geojson"   # WPRDC, already WGS84
    con.execute(f"create table sd as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from sd").fetchone()[0]
    upload("school_districts", jsonable(rows(con, f"""
      select OBJECTID as id, trim(SCHOOLD) as "name", {_geom_sql()} geom from sd where geom is not null
    """)), total, batch=10, on_conflict="id")
    # PPS feeder shapefiles are PA State Plane South feet (EPSG:2272).
    for level in ("elementary", "middle", "high"):
        shp = RAW / f"pps_{level}" / f"{level.capitalize()}.shp"
        con.execute(f"create or replace table z as select * from ST_Read('{shp}')")
        total = con.execute("select count(*) from z").fetchone()[0]
        g = "ST_Transform(geom, 'EPSG:2272', 'EPSG:4326', always_xy := true)"
        upload("pps_attendance_zones", jsonable(rows(con, f"""
          select '{level}' as "level", cast(School_ID as varchar) as school_id, SchoolName as school, {_geom_sql(g)} geom
          from z where geom is not null
        """)), total, batch=10, on_conflict="level,school_id")


def _muni_crosswalk():
    """Map a municipality name as written in research ("Aleppo Township", "Pittsburgh City",
    "City of Clairton") to the county municipal code, matching on base name + type."""
    import re
    key = os.environ["SUPABASE_SECRET_KEY"]
    r = httpx.get(f"{os.environ['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/municipalities?select=muni_code,name,type",
                  headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=60)
    r.raise_for_status()
    kinds = {"TOWNSHIP": "TOWNSHIP", "TWP": "TOWNSHIP", "BOROUGH": "BOROUGH", "BORO": "BOROUGH",
             "CITY": "CITY", "TOWN": "MUNICIPALI", "MUNICIPALITY": "MUNICIPALI"}
    norm = lambda s: " ".join(re.sub(r"[^A-Z ]", " ", s.upper().replace("MT.", "MOUNT").replace("MT ", "MOUNT ")
                                     .replace("SAINT ", "ST ").replace("ST.", "ST ")).split())
    table = {(norm(m["name"]), m["type"]): m["muni_code"] for m in r.json()}
    by_name = {}
    for (n, _t), code in table.items():
        by_name.setdefault(n, []).append(code)

    def lookup(name):
        n = norm(re.sub(r"\(.*?\)", "", name))
        kind = None
        m = re.match(r"^(CITY|TOWN|BOROUGH|TOWNSHIP) OF (.*)$", n)
        if m:
            kind, n = kinds[m.group(1)], m.group(2)
        else:
            parts = n.rsplit(" ", 1)
            if len(parts) == 2 and parts[1] in kinds:
                n, kind = parts[0], kinds[parts[1]]
        if kind and (n, kind) in table:
            return table[(n, kind)]
        codes = by_name.get(n, [])
        return codes[0] if len(codes) == 1 else None
    return lookup


def hidden_costs(con):
    import csv
    import re
    lookup = _muni_crosswalk()
    seed = ROOT / "data" / "seed"
    num = lambda v: float(v) if v not in (None, "", "n/a") and re.fullmatch(r"-?[\d.]+", v.strip()) else None
    date = lambda v: v if v and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()) else None

    rows_m, missing = [], []
    for r in csv.DictReader(open(seed / "muni_transfer_requirements.csv")):
        code = lookup(r["municipality"])
        if not code:
            missing.append(r["municipality"])
            continue
        rows_m.append({"muni_code": code, **{k: (r[k] or None) for k in r}})
    upload("muni_transfer_requirements", iter(rows_m), len(rows_m), batch=200, on_conflict="muni_code")
    print(f"  municipalities unmatched: {missing}")

    rows_t, missing_t = [], []
    for r in csv.DictReader(open(seed / "realty_transfer_tax.csv")):
        inside = re.search(r"\(in (.*?)\)", r["jurisdiction"])
        code = None
        if r["jurisdiction_type"] == "municipality":
            code = lookup(r["jurisdiction"])
        elif inside:
            code = lookup(inside.group(1))
        if r["jurisdiction_type"] != "state" and not code:
            missing_t.append(r["jurisdiction"])
        rows_t.append({"jurisdiction": r["jurisdiction"], "jurisdiction_type": r["jurisdiction_type"],
                       "muni_code": code, "rate_pct": num(r["rate_pct"]), "effective_date": date(r["effective_date"]),
                       "source_url": r["source_url"] or None, "confidence": r["confidence"] or None})
    upload("realty_transfer_tax", iter(rows_t), len(rows_t), batch=300, on_conflict="jurisdiction,jurisdiction_type")
    print(f"  transfer-tax rows unmatched: {missing_t}")

    rows_f = [{"id": i, "authority": r["authority"], "service": r["service"], "fee_type": r["fee_type"],
               "amount": num(r["amount"]), "unit": r["unit"] or None, "effective_date": date(r["effective_date"]),
               "source_url": r["source_url"] or None, "confidence": r["confidence"] or None}
              for i, r in enumerate(csv.DictReader(open(seed / "utility_tap_fees.csv")), start=1)]
    upload("utility_tap_fees", iter(rows_f), len(rows_f), batch=200, on_conflict="id")


def zoning_rules(con):
    src = ROOT / "data" / "seed" / "pgh_zoning_rules.csv"
    con.execute(f"create table zr as select * from read_csv('{src}', all_varchar=true, header=true)")
    total = con.execute("select count(*) from zr").fetchone()[0]
    num = lambda c: f"try_cast(nullif(trim({c}),'') as double) as {c}"
    txt = lambda c: f"nullif(trim({c}),'') as {c}"
    sql = f"""
      select {txt('zone_code')}, {txt('district_name')}, {txt('single_unit_detached')}, {txt('two_unit')},
             {txt('three_unit')}, {txt('multi_unit')}, {num('min_lot_area_sqft')}, {num('min_lot_area_per_unit_sqft')},
             {num('min_front_setback_ft')}, {num('min_rear_setback_ft')}, {num('min_side_setback_ft')},
             {num('max_height_ft')}, {num('max_height_stories')}, {num('max_far')}, {num('max_lot_coverage_pct')},
             {num('parking_per_unit')}, upper(trim(contextual_front_setback)) = 'Y' as contextual_front_setback,
             {txt('citation')}, {txt('confidence')}, {txt('notes')}
      from zr where nullif(trim(zone_code),'') is not null
    """
    upload("zoning_rules", jsonable(rows(con, sql)), total, batch=100, on_conflict="zone_code")


DATASETS = {"hidden_costs": hidden_costs, "zoning_rules": zoning_rules, "permits": permits, "condemned": condemned, "schools": schools, "assessments": assessments, "assessment_dates": assessment_dates, "parcels": parcels, "zoning": zoning,
            "overlays": overlays, "sales": sales}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    DATASETS[name](connect(), *extra)
