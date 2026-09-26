# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load PA DEP public water supplier service areas and fill public.parcel_utilities.

Usage: uv run scripts/ingest_utilities.py <step>
  water_areas      fetch the DEP layer (Allegheny bounding box), upload, clip to the county
  parcel_utilities per-parcel water / sewer flags (chunked SQL, idempotent)
  all              both, in order

Apply supabase/migrations/081_utilities.sql first. Re-running is safe: areas upsert on
pwsid and parcel rows upsert on parid.

Water: PA DEP "Public Water Supplier Service Areas" (eMapPA layer 302; also mirrored on WPRDC as
"pa-public-water-systems"). License: "Not for commercial use or resale" (see SOURCES.md).
Sewer: no public sewer service-area layer exists for the county (see 081_utilities.sql), so every
parcel is 'unknown' -- sewersheds are drainage basins and are not used as service areas.

Network etiquette: honest User-Agent with the RESEARCH_CONTACT from .env.local (never printed),
robots.txt checked, one request at a time with a 3 s pause, raw download cached in data/raw/.
"""
import json
import sys
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import RAW, load_env, connect, upload, rows, jsonable  # noqa: E402
from ingest_context import run_sql  # noqa: E402

DEP_PWS = "https://gis.dep.pa.gov/depgisprd/rest/services/emappa/eMapPA_External/MapServer/302"
ALCO_BBOX = "-80.4,40.1,-79.65,40.7"
OUT = RAW / "utilities"
WATER_SOURCE = "PA DEP Public Water Supplier Service Areas (eMapPA layer 302)"
SEWER_SOURCE = ("No public sewer service-area layer for Allegheny County (searched WPRDC, PASDA, "
                "PA DEP, county GIS); sewersheds are drainage basins, not service areas")
CHUNKS = 20


def polite_client():
    contact = None
    for line in (Path(__file__).resolve().parent.parent / ".env.local").read_text().splitlines():
        if line.startswith("RESEARCH_CONTACT="):
            contact = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not contact:
        raise SystemExit("RESEARCH_CONTACT is not set in .env.local")
    ua = f"EaseScore-research (contact: {contact})"
    return httpx.Client(headers={"User-Agent": ua}, timeout=120, follow_redirects=True), ua


def polite_get(client, ua, url, params=None, robots={}):
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in robots:
        rp = urllib.robotparser.RobotFileParser()
        r = client.get(f"{base}/robots.txt")
        # urllib.robotparser ignores '*' wildcards: cut each rule at its first '*' (stricter prefix
        # rule), and drop blank lines so a group is not split (same handling as collect/polite.py).
        rp.parse([ln.split("*", 1)[0] if ln.lower().startswith(("disallow:", "allow:")) else ln
                  for ln in r.text.splitlines() if ln.strip()] if r.status_code == 200 else [])
        robots[base] = rp
        time.sleep(3)
    if not robots[base].can_fetch(ua, url):
        raise SystemExit(f"robots.txt disallows {url}; not fetching")
    for attempt in range(4):
        r = client.get(url, params=params)
        time.sleep(3)
        if r.status_code == 403:
            raise SystemExit(f"blocked (HTTP 403) at {url}; stopping, not evading")
        if r.status_code < 500 and r.status_code != 429:
            r.raise_for_status()
            return r
        time.sleep(60 * (attempt + 1))
    raise SystemExit(f"repeated failures at {url}")


def fetch_water_areas():
    dest = OUT / "pws_service_areas_dep.geojson"
    if dest.exists():
        return dest
    OUT.mkdir(parents=True, exist_ok=True)
    client, ua = polite_client()
    feats, offset = [], 0
    while True:
        r = polite_get(client, ua, f"{DEP_PWS}/query", {
            "where": "1=1", "geometry": ALCO_BBOX, "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outSR": 4326, "f": "geojson",
            "outFields": "PWS_ID,NAME,OWNERSHIP,GW_SOURCE,SW_SOURCE,INTCONNECT,LAST_DATE,CNTY_NAME",
            "resultOffset": offset, "resultRecordCount": 500})
        data = r.json()
        if "error" in data:
            raise SystemExit(f"DEP query error: {data['error']}")
        page = data.get("features", [])
        feats += page
        if len(page) < 500:
            break
        offset += len(page)
    client.close()
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"  fetched {len(feats)} DEP service-area features (bbox)")
    return dest


def water_areas():
    src = fetch_water_areas()
    con = connect()
    # One row per system: a PWSID can arrive as several polygons.
    sql = f"""
      with f as (select * from ST_Read('{src}'))
      select PWS_ID pwsid, any_value(NAME) "name", any_value(OWNERSHIP) owner_type,
             bool_or(GW_SOURCE = 'Y') gw_source, bool_or(SW_SOURCE = 'Y') sw_source,
             bool_or(INTCONNECT = 'Y') interconnect,
             max(to_timestamp(LAST_DATE / 1000))::date last_date,
             'SRID=4326;' || ST_AsText(ST_ReducePrecision(ST_Multi(ST_CollectionExtract(
               ST_MakeValid(ST_Union_Agg(ST_MakeValid(geom))), 3)), 0.0000001)) geom
      from f where PWS_ID is not null group by PWS_ID
    """
    total = con.execute(f"select count(*) from ({sql})").fetchone()[0]
    upload("water_service_areas", jsonable(rows(con, sql)), total, batch=5, on_conflict="pwsid")
    # Clip to Allegheny County (union of the 130 municipal boundaries); drop systems outside it.
    print("  clipping to Allegheny County...")
    run_sql("""
      drop table if exists public._alco;
      create table public._alco as
        select extensions.ST_Union(extensions.ST_MakeValid(geom)) geom from public.municipalities;
      delete from public.water_service_areas w using public._alco c
        where not extensions.ST_Intersects(w.geom, c.geom)
           or extensions.ST_Area(extensions.ST_Intersection(w.geom, c.geom)::extensions.geography) < 1000;
      update public.water_service_areas w set geom = extensions.ST_Multi(extensions.ST_CollectionExtract(
          extensions.ST_MakeValid(extensions.ST_Intersection(w.geom, c.geom)), 3))
        from public._alco c where not extensions.ST_CoveredBy(w.geom, c.geom);
      drop table public._alco;
    """)
    print(run_sql("select count(*) n from public.water_service_areas"))


def parcel_utilities():
    print("  parcel_utilities: prep (subdivided service areas)...")
    run_sql("""
      drop table if exists public._pws_sub;
      create table public._pws_sub as
        select pwsid, name, extensions.ST_Area(geom::extensions.geography) area_m2,
               extensions.ST_Subdivide(geom, 64) geom
        from public.water_service_areas;
      create index on public._pws_sub using gist (geom);
      alter table public._pws_sub enable row level security;
      analyze public._pws_sub;
    """)
    for c in range(CHUNKS):
        # ~100 m search box in degrees (0.0013 deg lat ~ 145 m) before the exact geography test.
        run_sql(f"""
          insert into public.parcel_utilities (parid, water_served, water_system, water_pwsid, water_dist_m,
                                               water_source, sewer_served, sewer_status, sewer_source, computed_at)
          select p.parid,
                 case when inside.pwsid is not null then true
                      when near.pwsid is null then false
                      else null end,
                 coalesce(inside.name, near.name), coalesce(inside.pwsid, near.pwsid),
                 case when inside.pwsid is not null then 0 else round(near.dist_m::numeric, 0) end,
                 {sql_str(WATER_SOURCE)}, null, 'unknown', {sql_str(SEWER_SOURCE)}, now()
          from public.parcels p
          left join lateral (
            select s.pwsid, s.name from public._pws_sub s
            where extensions.ST_Intersects(s.geom, p.centroid)
            order by s.area_m2 limit 1) inside on true
          left join lateral (
            select s.pwsid, s.name,
                   extensions.ST_Distance(s.geom::extensions.geography, p.centroid::extensions.geography) dist_m
            from public._pws_sub s
            where inside.pwsid is null and extensions.ST_DWithin(s.geom, p.centroid, 0.0016)
              and extensions.ST_DWithin(s.geom::extensions.geography, p.centroid::extensions.geography, 100)
            order by 3 limit 1) near on true
          where abs(hashtext(p.parid)) % {CHUNKS} = {c}
          on conflict (parid) do update set
            water_served = excluded.water_served, water_system = excluded.water_system,
            water_pwsid = excluded.water_pwsid, water_dist_m = excluded.water_dist_m,
            water_source = excluded.water_source, sewer_served = excluded.sewer_served,
            sewer_status = excluded.sewer_status, sewer_source = excluded.sewer_source,
            computed_at = excluded.computed_at;
        """)
        print(f"    chunk {c + 1}/{CHUNKS} done", flush=True)
    run_sql("drop table if exists public._pws_sub;")
    print(run_sql("""select water_served, count(*) n from public.parcel_utilities group by 1 order by 1"""))


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


if __name__ == "__main__":
    load_env()
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("water_areas", "all"):
        water_areas()
    if step in ("parcel_utilities", "all"):
        parcel_utilities()
