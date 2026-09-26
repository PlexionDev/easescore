# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load county-wide mine-subsidence layers and compute per-parcel mine facts.

Usage: uv run scripts/ingest_mines.py <step>
  mined_out        PA DEP digitized underground coal mined-out areas  -> overlays 'mined_out_dep'
  coal_bearing     PA DEP Mine Subsidence Insurance risk areas         -> overlays 'coal_bearing'
  mine_map_sheets  PA Mine Map Atlas sheet index (PASDA)               -> overlays 'mine_map_sheets'
  parcel_mines     fill public.parcel_mines (needs migration 040 applied)
  all              every step above, in order

Every source is clipped to Allegheny County (DEP's own county boundary layer).
Raw responses are cached as GeoJSON in data/raw/ (gitignored). No operator,
permittee, or GIS-editor fields are read; see mined_out() for mine names.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import RAW, load_env, connect, upload, rows, jsonable, _geom_sql  # noqa: E402

DEP = "https://gis.dep.pa.gov/depgisprd/rest/services"
MINED_OUT = f"{DEP}/DistrictMiningOperations/DMO_MinedOutAreaCoalUnderground/FeatureServer/0"
MSI_CONFIRMED = f"{DEP}/MineSubsidenceInsurance/MSI_SubsidenceRiskMiningConfirmed/FeatureServer/0"
MSI_POSSIBLE = f"{DEP}/MineSubsidenceInsurance/MSI_SubsidenceRiskMiningPossible/FeatureServer/0"
DEP_COUNTY = f"{DEP}/MSI/MSI1/MapServer/2"
MINE_MAPS = "https://apps.pasda.psu.edu/arcgis/rest/services/MineMaps/MapServer"
ATLAS = "https://www.minemaps.psu.edu/?LocalSheetID="

ALCO_BBOX = "-80.37,40.19,-79.68,40.68"


def curl_post(url, params):
    """Form-encoded POST via curl (long where/geometry params; polite retries)."""
    args = ["curl", "-sS", "--fail", "-m", "300", url]
    for k, v in params.items():
        args += ["--data-urlencode", f"{k}={v}"]
    for attempt in range(5):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout
        time.sleep(2 ** attempt)
    raise SystemExit(f"curl failed for {url}: {p.stderr[:300]}")


def fetch(name, layer_url, where="1=1", out_fields="*", page=500, **extra):
    """Page through an ArcGIS layer, filtered to the county bounding box, as GeoJSON."""
    dest = RAW / f"{name}.geojson"
    if dest.exists():
        return dest
    params = {"where": where, "outFields": out_fields, "outSR": 4326, "f": "geojson",
              "geometry": ALCO_BBOX, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "resultRecordCount": page,
              "orderByFields": "OBJECTID", **extra}
    feats, offset = [], 0
    while True:
        body = curl_post(f"{layer_url}/query", dict(params, resultOffset=offset))
        data = json.loads(body)
        if "error" in data:
            raise SystemExit(f"fetch failed {name}: {data['error']}")
        batch = data.get("features", [])
        feats += batch
        if len(batch) < page:
            break
        offset += page
        time.sleep(0.5)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"  fetched {name}: {len(feats):,} features")
    return dest


def county(con):
    src = fetch("allegheny_county_dep", DEP_COUNTY, where="MCDCOUNTY = 'Allegheny'",
                out_fields="OBJECTID,MCDCOUNTY")
    con.execute(f"create or replace table county as select ST_Union_Agg(ST_MakeValid(geom)) geom "
                f"from ST_Read('{src}')")


def clipped(col="geom"):
    return f"ST_Intersection(ST_MakeValid({col}), (select geom from county))"


def run_sql(query):
    """One statement through the Supabase Management API (same endpoint as scripts/sql.sh)."""
    ref = re.match(r"https://([^.]+)\.", os.environ["NEXT_PUBLIC_SUPABASE_URL"]).group(1)
    p = subprocess.run(
        ["curl", "-sS", "--fail-with-body", "-m", "300", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{ref}/database/query",
         "-H", f"Authorization: Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
         "-H", "Content-Type: application/json", "--data-binary", "@-"],
        input=json.dumps({"query": query}), capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"sql failed: {p.stdout[:500]} {p.stderr[:300]}")
    return p.stdout


def delete_layer(layer):
    run_sql(f"delete from public.overlays where layer = '{layer}'")


# ---------- a. Mined-out areas ----------

# Mine names that are (or contain) a person's name are withheld. Patterns, from reading
# every name in the county extract: country "pits" (almost always "<owner> Pit"), initials
# ("J.P.Warner", "RLThompson", "JH Sanford"), a leading/embedded first name ("John Keck",
# "AlexMoreschi", "... and David Beck"), and surname pairs joined by "&"/"and".
# Deliberately over-inclusive; a single surname-style mine name ("Hillman") is kept.
FIRST_NAMES = ("John|Hugh|Felix|Henry|Dan|Mike|Dominick|Alphonse|Angilio|Paul|Mary|Alex|Frank|"
               "Harvey|Jesse|James|David|Rebecca|Oswald|Geo|Jos|Ira|William|Jean")
PERSON_NAME_RE = ("Pit([^a-z]|$)|(^|[^A-Za-z])[A-Z]\\.|^([A-Z] ){1,2}[A-Z][a-z]|^[A-Z]{2} ?[A-Z][a-z]"
                  f"|(^|[ &])({FIRST_NAMES}) ?[A-Z]|&|[a-z]and [A-LO-Z]|[a-z] and ")

def mined_out(con):
    # Read: seam, mine name, last-mined date, source collection/map, status, permit number.
    # Never read: OPERATOR (company or individual) and CREATOR (DEP digitizer).
    # Mine names: historic K-sheet "pit" names are often a person's name ("<First> <Last> Pit").
    # Those are withheld (mine_name null) -- only names that read as a mine/company name are kept.
    src = fetch("mined_out_dep", MINED_OUT,
                out_fields="OBJECTID,COAL_SEAM,OPERATION,OPERATION_STATUS,CDO_FILE,"
                           "COLLECTION_NAME,MAP_SOURCE,PERMIT,LASTMINED")
    county(con)
    con.execute(f"create or replace table m as select * from ST_Read('{src}')")
    con.execute(f"create or replace table m2 as select *, {clipped()} as cgeom from m where geom is not null")
    total = con.execute("select count(*) from m2 where not ST_IsEmpty(cgeom)").fetchone()[0]
    name = "nullif(nullif(nullif(trim(OPERATION), ''), 'Unknown'), 'N/A')"
    person_pit = f"coalesce(regexp_matches({name}, '{PERSON_NAME_RE}'), false)"
    nm = "nullif(trim({c}), '')"
    sql = f"""
      select 'mined_out_dep' as layer, cast(OBJECTID as varchar) as source_id,
             coalesce({nm.format(c='COAL_SEAM')}, 'unknown seam') || ' seam mined-out area' as label,
             json_object(
               'mine_name', case when {person_pit} then null else {name} end,
               'mine_name_withheld', coalesce({person_pit}, false),
               'coal_seam', {nm.format(c='COAL_SEAM')},
               'last_mined', {nm.format(c='LASTMINED')},
               'status', {nm.format(c='OPERATION_STATUS')},
               'collection', {nm.format(c='COLLECTION_NAME')},
               'map_source', {nm.format(c='MAP_SOURCE')},
               'file_id', {nm.format(c='CDO_FILE')},
               'permit', {nm.format(c='PERMIT')},
               'source', 'PA DEP DMO Mined Out Area Coal Underground (MOA)') as attrs,
             {_geom_sql('cgeom')} as geom
      from m2 where not ST_IsEmpty(ST_CollectionExtract(cgeom, 3))
    """
    load_env()
    delete_layer("mined_out_dep")
    upload("overlays", jsonable(rows(con, sql)), total, batch=50, on_conflict="layer,source_id")


# ---------- b. Coal-bearing extent (MSI risk map) ----------

def coal_bearing(con):
    # DEP MSI risk map (https://gis.dep.pa.gov/msiRisk/): "Confirmed" = known undermined
    # or near undermined; "Possible" = over/near mineable coal, no record of mining.
    # Both are over coal-bearing rock, so both go in 'coal_bearing' with the MSI class kept.
    county(con)
    # GDAL's GeoJSON reader rejects these very large single features, so parse them here.
    con.execute("create or replace table raw_cb (cls varchar, oid int, gj varchar)")
    for cls, url in (("confirmed", MSI_CONFIRMED), ("possible", MSI_POSSIBLE)):
        src = fetch(f"msi_risk_{cls}", url, out_fields="OBJECTID,DESCRIPTION", page=1,
                    geometryPrecision=6)  # a few statewide polygons, ~8 MB each
        for f in json.loads(src.read_text())["features"]:
            if f.get("geometry"):
                con.execute("insert into raw_cb values (?, ?, ?)",
                            [cls, f["properties"]["OBJECTID"], json.dumps(f["geometry"])])
    con.execute(f"""create or replace table cb as
      select cls, oid, {clipped('ST_GeomFromGeoJSON(gj)')} as cgeom from raw_cb""")
    total = con.execute("select count(*) from cb").fetchone()[0]
    sql = f"""
      select 'coal_bearing' as layer, cls || ':' || oid as source_id,
             case cls when 'confirmed' then 'MSI risk: mining confirmed'
                      else 'MSI risk: coal present, mining possible' end as label,
             json_object('msi_class', cls,
                         'source', case cls when 'confirmed'
                           then 'PA DEP MSI Mine Subsidence Risk (Confirmed)'
                           else 'PA DEP MSI Mine Subsidence Risk (Possible/No Known Mining)' end) as attrs,
             {_geom_sql('cgeom')} as geom
      from cb where not ST_IsEmpty(ST_CollectionExtract(cgeom, 3))
    """
    load_env()
    delete_layer("coal_bearing")
    upload("overlays", jsonable(rows(con, sql)), total, batch=1, on_conflict="layer,source_id")


# ---------- c. Mine map sheet index (PA Mine Map Atlas) ----------

def mine_map_sheets(con):
    # Layer 2 = Mine Maps Index (DEP, K-Sheet, archives...); layer 3 = WPA mine maps index.
    # Each footprint is one georeferenced scanned mine map; the Atlas viewer opens a sheet
    # by id with ?LocalSheetID=<Local_Shee> (index.html phummisReturn()).
    county(con)
    a = fetch("mine_map_index", f"{MINE_MAPS}/2",
              out_fields="OBJECTID,Local_Shee,Collection,FullPath,PDF_Path", page=1000)
    b = fetch("mine_map_index_wpa", f"{MINE_MAPS}/3",
              out_fields="OBJECTID,Local_Shee,FullPath,PDF_Path", page=1000)
    con.execute(f"""
      create or replace table ms as
      select 'idx:' || OBJECTID sid, Local_Shee sheet, Collection coll, FullPath zip, PDF_Path pdf,
             {clipped()} cgeom from ST_Read('{a}') where geom is not null
      union all
      select 'wpa:' || OBJECTID, Local_Shee, 'WPA', FullPath, PDF_Path,
             {clipped()} from ST_Read('{b}') where geom is not null
    """)
    total = con.execute("select count(*) from ms").fetchone()[0]
    sql = f"""
      select 'mine_map_sheets' as layer, sid as source_id, sheet as label,
             json_object('sheet_id', sheet, 'collection', coll,
                         'atlas_url', '{ATLAS}' || sheet, 'pdf_url', pdf, 'georef_zip_url', zip,
                         'source', 'PA Mine Map Atlas (PASDA / PA DEP)') as attrs,
             {_geom_sql('cgeom')} as geom
      from ms where sheet is not null and not ST_IsEmpty(ST_CollectionExtract(cgeom, 3))
    """
    load_env()
    delete_layer("mine_map_sheets")
    upload("overlays", jsonable(rows(con, sql)), total, batch=200, on_conflict="layer,source_id")


# ---------- 2. Per-parcel mine facts ----------

def parcel_mines(con=None, chunks=20):
    """Fill public.parcel_mines. SQL lives in supabase/migrations/040_parcel_mines.sql
    (PREP / CHUNK / CLEANUP sections); this runs it chunk by chunk."""
    load_env()
    text = (Path(__file__).resolve().parent.parent / "supabase/migrations/040_parcel_mines.sql").read_text()
    sections = dict(re.findall(r"-- (\w+) -+\n(.*?)(?=\n-- \w+ -+\n|\Z)", text, re.S))
    run_sql(text.split("\n-- PREP -")[0])  # create table + grants (idempotent)
    print("  prep (subdividing polygons)...", flush=True)
    run_sql(sections["PREP"])
    for c in range(chunks):
        t0 = time.time()
        run_sql(sections["CHUNK"].replace(":chunk", str(c)))
        print(f"    chunk {c + 1}/{chunks} done ({time.time() - t0:.0f}s)", flush=True)
    run_sql(sections["CLEANUP"])


STEPS = {"mined_out": mined_out, "coal_bearing": coal_bearing,
         "mine_map_sheets": mine_map_sheets, "parcel_mines": parcel_mines}

if __name__ == "__main__":
    step = sys.argv[1]
    if step == "all":
        for f in STEPS.values():
            f(connect())
    else:
        STEPS[step](connect())
