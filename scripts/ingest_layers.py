# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "shapely>=2"]
# ///
"""Load the map layers a permit/requirements checklist needs: building footprints,
street centerlines, recorded landslides, bedrock geology, streams, wetlands, and
environmental cleanup/brownfield sites.

Usage: uv run scripts/ingest_layers.py <dataset>
  buildings | streets | landslides | bedrock_geology | streams | wetlands | env_sites

Sources fetched directly over ArcGIS REST (paged; results cached as GeoJSON in
data/raw/, gitignored). No editor usernames, owner names, or contact fields are
kept -- see the per-loader comments below for what was dropped.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, RAW, load_env, connect, upload, rows, jsonable, _geom_sql, PGH  # noqa: E402

# Allegheny County bounding box (WGS84, padded slightly) -- used to clip
# national/statewide layers that have no county attribute to filter on.
ALCO_BBOX = "-80.4,40.1,-79.65,40.7"

ALCO_GIS = "https://gisdata.alleghenycounty.us/arcgis/rest/services"


def _line_geom_sql(col="geom"):
    return (f"'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_Multi(ST_CollectionExtract("
            f"ST_MakeValid({col}), 2)), 0.0000001))")


def _point_geom_sql(col="geom"):
    return f"'SRID=4326;' || ST_AsText(ST_ReducePrecision({col}, 0.0000001))"


def curl_get(url, params):
    """GET via curl. httpx gets blocked (an "ArcGIS Web Adaptor" HTML error
    page, HTTP 200) by at least one source's bot mitigation; curl is not, so
    every network call in this file goes through curl rather than a Python
    HTTP client."""
    # POST (not -G/GET): the DCNR source's WAF blocks this query as a GET but
    # allows the identical parameters as a form-encoded POST.
    args = ["curl", "-sS", "--fail", url]
    for k, v in params.items():
        args += ["--data-urlencode", f"{k}={v}"]
    for attempt in range(5):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout
        time.sleep(2 ** attempt)
    raise SystemExit(f"curl failed for {url}: {p.stderr[:300]}")


def fetch_layer(name, layer_url, where="1=1", out_fields="*", geometry=None, page=1000):
    """Page through any ArcGIS layer that supports resultOffset paging (confirmed
    on every layer used here) and save the combined result as GeoJSON."""
    dest = RAW / f"{name}.geojson"
    if dest.exists():
        return dest
    feats, offset = [], 0
    # orderByFields is deliberately omitted: at least one source (PA DCNR's
    # legacy ArcGIS Server) rejects f=geojson+orderByFields together. Default
    # server ordering is stable enough across paged requests for a full scan.
    params = {"where": where, "outFields": out_fields, "outSR": 4326, "f": "geojson",
              "resultRecordCount": page}
    if geometry:
        params.update({"geometry": geometry, "geometryType": "esriGeometryEnvelope",
                       "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"})
    while True:
        body = curl_get(f"{layer_url}/query", dict(params, resultOffset=offset))
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            raise SystemExit(f"fetch failed {name}: non-JSON response: {body[:300]}")
        if "error" in data:
            raise SystemExit(f"fetch failed {name}: {data['error']}")
        batch = data.get("features", [])
        feats += batch
        if len(batch) < page:
            break
        offset += page
    # De-duplicate by feature id: unstable default ordering can repeat a
    # feature across a resultOffset page boundary (orderByFields is omitted --
    # see above), which would otherwise later fail an ON CONFLICT upsert.
    seen, deduped = set(), []
    for f in feats:
        fid = f.get("id")
        if fid in seen:
            continue
        seen.add(fid)
        deduped.append(f)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": deduped}))
    print(f"  fetched {name}: {len(deduped):,} features"
          + (f" ({len(feats) - len(deduped)} duplicate(s) dropped)" if len(deduped) != len(feats) else ""))
    return dest


def run_sql(query):
    """Run one statement through the Supabase Management API -- the same
    endpoint scripts/sql.sh posts to -- for the buildings -> parid tagging
    step below."""
    import os
    import re
    ref = re.match(r"https://([^.]+)\.", os.environ["NEXT_PUBLIC_SUPABASE_URL"]).group(1)
    p = subprocess.run(
        ["curl", "-sS", "--fail", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{ref}/database/query",
         "-H", f"Authorization: Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
         "-H", "Content-Type: application/json", "--data-binary", "@-"],
        input=json.dumps({"query": query}), capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"sql failed: {p.stderr[:500]}")
    return p.stdout


def tag_buildings_parid(chunks=20):
    """Per-building parid, by largest-overlap spatial join to public.parcels.
    Chunked (2-minute statement limit per scripts/sql.sh) the same way the
    existing parcel_schools / parcel_transit tagging migrations do."""
    print("  tagging buildings.parid by largest-overlap parcel (chunked)...")
    for c in range(chunks):
        run_sql(f"""
          update public.buildings b set parid = (
            select p.parid from public.parcels p
            where extensions.ST_Intersects(p.geom, b.geom)
            order by extensions.ST_Area(extensions.ST_Intersection(p.geom, b.geom)) desc
            limit 1
          )
          where abs(hashtext(b.id::text)) % {chunks} = {c} and b.parid is null;
        """)
        print(f"    chunk {c + 1}/{chunks} done", flush=True)


# ---------- 1. Building footprints (county-wide) ----------

def buildings(con):
    # Source has no owner/editor fields at all -- nothing to drop.
    # No height/stories/year fields exist in this source; those columns are
    # intentionally omitted rather than loaded as always-null.
    src = fetch_layer("buildings_alco", f"{ALCO_GIS}/EGIS/Buildings/MapServer/0",
                      out_fields="OBJECTID,status,CLASS,LUC")
    con.execute(f"create table b as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from b").fetchone()[0]
    sql = f"""
      select OBJECTID as id, nullif(trim(status),'') as status,
             nullif(trim(CLASS),'') as class, LUC as land_use_code, {_geom_sql()} as geom
      from b where geom is not null
    """
    upload("buildings", jsonable(rows(con, sql)), total, batch=1000, on_conflict="id")
    load_env()
    tag_buildings_parid()


# ---------- 2. Street centerlines (city + county), with a paper/vacated flag ----------

def streets(con):
    # City: PGHWeb "class" field carries PAPER / VACATED / INACTIVE / BARRICADED --
    # the only source of the two of us found with an explicit unopened-street flag.
    # editor fields (created_user, last_edited_user) are never read.
    city_src = fetch_layer("streets_pgh", f"{PGH}/PavementPublic/FeatureServer/0",
                           out_fields="OBJECTID_1,streetname,domi_class,class")
    con.execute(f"create table sc as select * from ST_Read('{city_src}')")
    total_c = con.execute("select count(*) from sc").fetchone()[0]
    upload("streets", jsonable(rows(con, f"""
      select 'pgh:' || OBJECTID_1 as id, 'city' as source,
             nullif(trim(streetname),'') as name, nullif(trim(domi_class),'') as street_type,
             nullif(trim(class),'') in ('PAPER','VACATED') as paper_or_vacated,
             null::text as municode, {_line_geom_sql()} as geom
      from sc where geom is not null
    """)), total_c, batch=500, on_conflict="id")

    # County: no explicit paper/vacated field was found in this source (FCC codes
    # are TIGER functional-class, not an unopened-street flag) -- paper_or_vacated
    # is left null for county rows rather than guessed. EDIT_USER is never read.
    co_src = fetch_layer("streets_alco", f"{ALCO_GIS}/Addressing/Addressing_Centerlines/MapServer/0",
                         out_fields="OBJECTID,FULL_NAME,FCC,LMUNI,RMUNI")
    con.execute(f"create or replace table sc as select * from ST_Read('{co_src}')")
    total_a = con.execute("select count(*) from sc").fetchone()[0]
    upload("streets", jsonable(rows(con, f"""
      select 'co:' || OBJECTID as id, 'county' as source,
             nullif(trim(FULL_NAME),'') as name, nullif(trim(FCC),'') as street_type,
             null::boolean as paper_or_vacated,
             coalesce(nullif(trim(LMUNI),''), nullif(trim(RMUNI),'')) as municode,
             {_line_geom_sql()} as geom
      from sc where geom is not null
    """)), total_a, batch=500, on_conflict="id")


# ---------- 3. Recorded landslides (county "Pomeroy" inventory) ----------

def landslides(con):
    # This is the county's digitized Pomeroy & Assoc. landslide inventory
    # (1970s-80s aerial-photo mapping of recorded slide scars), not a susceptibility
    # model. RECLAN/PREHIS/CREEP/etc. are landslide-type flags kept as attrs.
    src = fetch_layer("landslide_pomeroy",
                      "https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Landslide_Pomeroy/FeatureServer/0",
                      out_fields="OBJECTID,RECLAN,PREHIS,CREEP,REDBED,MANFILL,VSLOPE,ROCKFALL,DEBRIS,RILLS")
    con.execute(f"create table ls as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from ls").fetchone()[0]
    upload("overlays", jsonable(rows(con, f"""
      select 'landslide_recorded' as layer, cast(OBJECTID as varchar) as source_id,
             nullif(trim(RECLAN),'') as label,
             json_object('prehistoric', PREHIS, 'creep', CREEP, 'red_beds', REDBED,
                          'man_made_fill', MANFILL, 'very_steep_slope', VSLOPE,
                          'rockfall', ROCKFALL, 'debris', DEBRIS, 'rills', RILLS) as attrs,
             {_geom_sql()} as geom
      from ls where geom is not null
    """)), total, batch=200, on_conflict="layer,source_id")


# ---------- 4. Bedrock geology (PA DCNR, clipped to the county) ----------

def bedrock_geology(con):
    # Mirrored via PASDA (the DCNR agsprod server intermittently blocks
    # automated requests with a generic "ArcGIS Web Adaptor" error page).
    src = fetch_layer("bedrock_geology_pa",
                      "https://mapservices.pasda.psu.edu/server/rest/services/pasda/DCNR2/MapServer/11",
                      out_fields="OBJECTID,MAP_SYMBOL,NAME,AGE,LITH1", geometry=ALCO_BBOX)
    con.execute(f"create table bg as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from bg").fetchone()[0]
    # Conemaugh Group members in this area: Casselman (Pcc) and Glenshaw (Pcg)
    # formations -- flagged so the checklist can call out red-bed / slope-stability risk.
    sql = f"""
      select 'bedrock_geology' as layer, cast(OBJECTID as varchar) as source_id,
             NAME as label,
             json_object('formation', NAME, 'age', AGE, 'lithology', LITH1,
               'group', case when MAP_SYMBOL in ('Pcc','Pcg') then 'Conemaugh'
                              when MAP_SYMBOL like 'Pa%' then 'Allegheny'
                              when MAP_SYMBOL like 'Cm%' then 'Monongahela' end,
               'conemaugh_red_beds', MAP_SYMBOL in ('Pcc','Pcg')) as attrs,
             {_geom_sql()} as geom
      from bg where geom is not null
    """
    upload("overlays", jsonable(rows(con, sql)), total, batch=200, on_conflict="layer,source_id")


# ---------- 5. Streams (NHD flowlines, clipped to the county) ----------

def streams(con):
    src = fetch_layer("streams_nhd", "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6",
                      out_fields="OBJECTID,gnis_name,ftype,fcode", geometry=ALCO_BBOX)
    con.execute(f"create table s as select * from ST_Read('{src}')")
    total = con.execute("select count(*) from s").fetchone()[0]
    # FType 460 = Stream/River (fcode 46006 perennial, 46003 intermittent, 46007 ephemeral).
    sql = f"""
      select OBJECTID as id, nullif(trim(gnis_name),'') as name,
             case fcode when 46006 then 'perennial' when 46003 then 'intermittent'
                        when 46007 then 'ephemeral' else null end as flow_type,
             {_line_geom_sql()} as geom
      from s where geom is not null
    """
    upload("streams", jsonable(rows(con, sql)), total, batch=500, on_conflict="id")


# ---------- 6. Wetlands (USFWS NWI, clipped to the county) ----------

def wetlands(con):
    # This service names every property "Wetlands.<FIELD>" (its layer/table
    # alias), which DuckDB's GDAL-based GeoJSON reader can't parse ("Failed to
    # read GeoJSON data") -- so this loader reads the cached GeoJSON directly
    # in Python (shapely for the geometry) instead of going through ST_Read.
    src = fetch_layer("wetlands_nwi", "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0",
                      out_fields="Wetlands.OBJECTID,Wetlands.ATTRIBUTE,Wetlands.WETLAND_TYPE,Wetlands.ACRES",
                      geometry=ALCO_BBOX)
    from shapely.geometry import MultiPolygon, Polygon, shape
    feats = json.loads(Path(src).read_text())["features"]

    def gen():
        for f in feats:
            p = f["properties"]
            geom = shape(f["geometry"])
            if geom.is_empty:
                continue
            # A handful of "Riverine" features (the Ohio/Monongahela/Allegheny
            # mainstem, with every island as an interior ring) run into the
            # millions of vertices -- one alone was a 141 MB request body that
            # made every upload batch containing it time out on POST.
            # Simplifying at ~1m tolerance keeps the shape but fixes that.
            if len(geom.wkt) > 200_000:
                geom = geom.simplify(0.00001, preserve_topology=True)
            if isinstance(geom, Polygon):
                geom = MultiPolygon([geom])
            yield {"layer": "wetland_nwi", "source_id": str(p["Wetlands.OBJECTID"]),
                   "label": p.get("Wetlands.WETLAND_TYPE"),
                   "attrs": json.dumps({"acres": p.get("Wetlands.ACRES"),
                                        "attribute_code": p.get("Wetlands.ATTRIBUTE")}),
                   "geom": "SRID=4326;" + geom.wkt}
    upload("overlays", gen(), len(feats), batch=50, on_conflict="layer,source_id")


# ---------- 7. Environmental cleanup / brownfield sites ----------

def env_sites(con):
    # PA DEP Land Recycling Cleanup Locations: Groundwater Media (29) and Waste
    # Media (33) sublayers -- the two most relevant to redevelopment. CLIENT_NAME /
    # ORGANIZATION_NAME are dropped (may be an individual site owner, not just a firm).
    total_dep = 0
    for layer_id, media in ((29, "groundwater"), (33, "waste")):
        src = fetch_layer(f"env_dep_{media}",
                          f"https://gis.dep.pa.gov/depgisprd/rest/services/emappa/eMapPA_External/MapServer/{layer_id}",
                          out_fields="SHAPE_FID,SITE_NAME,PRIMARY_FACILITY_TYPE,SITE_STATUS,COMPLIANCE",
                          geometry=ALCO_BBOX)
        con.execute(f"create or replace table d as select * from ST_Read('{src}')")
        n = con.execute("select count(*) from d").fetchone()[0]
        total_dep += n
        upload("env_sites", jsonable(rows(con, f"""
          select 'dep:{media}:' || SHAPE_FID as id, 'pa_dep' as source,
                 nullif(trim(SITE_NAME),'') as name,
                 nullif(trim(PRIMARY_FACILITY_TYPE),'') as facility_type,
                 '{media}' as media, nullif(trim(SITE_STATUS),'') as status,
                 {_point_geom_sql()} as geom
          from d where geom is not null
        """)), n, batch=200, on_conflict="id")

    # EPA ACRES brownfields (assessed/cleaned up with EPA grant funding), Allegheny Co.
    # PRIMARY_NAME is a facility/site name from the grantee's report, not a person.
    src = fetch_layer("env_epa_acres", "https://geodata.epa.gov/arcgis/rest/services/OEI/FRS_INTERESTS/MapServer/0",
                      where="UPPER(COUNTY_NAME)='ALLEGHENY' AND STATE_CODE='PA'",
                      out_fields="OBJECTID,PRIMARY_NAME,INTEREST_TYPE,ACTIVE_STATUS")
    con.execute("create or replace table d as select * from ST_Read('" + str(src) + "')")
    n = con.execute("select count(*) from d").fetchone()[0]
    upload("env_sites", jsonable(rows(con, f"""
      select 'epa:' || OBJECTID as id, 'epa_acres' as source,
             nullif(trim(PRIMARY_NAME),'') as name, nullif(trim(INTEREST_TYPE),'') as facility_type,
             null::text as media, nullif(trim(ACTIVE_STATUS),'') as status,
             {_point_geom_sql()} as geom
      from d where geom is not null
    """)), n, batch=200, on_conflict="id")
    print(f"  env_sites: {total_dep:,} PA DEP + {n:,} EPA ACRES")


DATASETS = {"buildings": buildings, "streets": streets, "landslides": landslides,
            "bedrock_geology": bedrock_geology, "streams": streams, "wetlands": wetlands,
            "env_sites": env_sites}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    DATASETS[name](connect(), *extra)
