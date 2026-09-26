# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "numpy>=2", "scipy>=1.13", "rasterio>=1.4", "shapely>=2.1", "pyproj>=3.6"]
# ///
"""Helpers for scripts/vector_tiles.sh (the vector map build).

Usage: uv run scripts/vector_tiles.py <step> [args]

  parcels <out.fgb>                 county parcels (parid + site address; no owner data) in WGS84
  buildings <out.fgb>               county building footprints tagged with the parid of the
                                    parcel they overlap most
  slope-smooth <slope.tif> <class.tif>
                                    median-filter percent slope, then classify into
                                    1:<8  2:8-15  3:15-25  4:>=25 (0 = nodata)
  slope-vectorize <polys.gpkg> <city.gpkg> <out.geojsonl>
                                    coverage-simplify the polygonized classes (shared edges
                                    stay shared), clip to the City boundary, reproject to WGS84
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

SLOPE_LABELS = {1: "<8%", 2: "8-15%", 3: "15-25%", 4: ">=25%"}


def duck():
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET preserve_insertion_order = false;")
    return con


def load_parcels(con):
    # parcels.tsv: county parcel polygons, WKT in PA South state plane ft (EPSG:2272).
    con.execute(f"""
      create table parcels as
      select trim(pin) as parid,
             ST_Transform(ST_GeomFromText(wkt), 'EPSG:2272', 'EPSG:4326', always_xy := true) as geom
      from read_csv('{RAW / "parcels.tsv"}', delim='\t', header=true, quote='',
                    columns={{'_id':'VARCHAR','pin':'VARCHAR','map_block_lot':'VARCHAR','municode':'VARCHAR',
                              'calc_acreage':'VARCHAR','comments':'VARCHAR','notes':'VARCHAR',
                              'pseudono':'VARCHAR','shape_length':'VARCHAR','wkt':'VARCHAR'}})
      where wkt is not null and trim(wkt) <> '' and trim(pin) <> ''
    """)


def parcels(out):
    t0 = time.time()
    con = duck()
    load_parcels(con)
    # Site address only (PROPERTY* columns) -- no owner / change-notice fields.
    con.execute(f"""
      create table addr as
      select PARID as parid,
             nullif(trim(regexp_replace(concat_ws(' ', trim(PROPERTYHOUSENUM), trim(PROPERTYFRACTION),
                                                  trim(PROPERTYADDRESS)), '\\s+', ' ', 'g')), '') as address
      from read_csv('{RAW / "assessments.csv"}', header=true, all_varchar=true)
    """)
    con.execute(f"""
      copy (select p.parid, a.address, p.geom
            from parcels p left join addr a using (parid)
            where p.geom is not null and not ST_IsEmpty(p.geom))
      to '{out}' with (format gdal, driver 'FlatGeobuf', srs 'EPSG:4326')
    """)
    n, na = con.execute(f"select count(*), count(address) from ST_Read('{out}')").fetchone()
    print(f"parcels: {n:,} features ({na:,} with address) -> {out} in {time.time() - t0:.0f}s")


def buildings(out):
    t0 = time.time()
    con = duck()
    load_parcels(con)
    con.execute(f"""
      create table b as
      select cast(OBJECTID as bigint) as id, geom from ST_Read('{RAW / "buildings_alco.geojson"}') where geom is not null
    """)
    # Largest-overlap parcel, same rule as ingest_layers.tag_buildings_parid.
    # Areas in degrees^2 are fine for ranking overlaps of the same building.
    con.execute("""
      create table bp as
      select id, arg_max(parid, ov) as parid from (
        select b.id, p.parid, ST_Area(ST_Intersection(b.geom, p.geom)) as ov
        from b join parcels p on ST_Intersects(b.geom, p.geom)
      ) group by id
    """)
    con.execute(f"""
      copy (select b.id, bp.parid, b.geom from b left join bp using (id))
      to '{out}' with (format gdal, driver 'FlatGeobuf', srs 'EPSG:4326')
    """)
    n, np_ = con.execute("select count(*), count(parid) from b left join bp using (id)").fetchone()
    print(f"buildings: {n:,} features ({np_:,} tagged with parid) -> {out} in {time.time() - t0:.0f}s")


def slope_smooth(src, dst, size=5):
    import numpy as np
    import rasterio
    from scipy import ndimage
    t0 = time.time()
    with rasterio.open(src) as ds:
        s = ds.read(1, masked=True)
        prof = ds.profile
    valid = ~np.ma.getmaskarray(s)
    v = s.filled(0).astype("float32")
    # Median over a size x size window (10 m at 2 m cells): removes curb/wall/stair
    # spikes while keeping real breaks in slope.
    m = ndimage.median_filter(v, size=size)
    cls = np.digitize(m, [8, 15, 25]).astype("uint8") + 1
    cls[~valid] = 0
    prof.update(dtype="uint8", nodata=0, compress="deflate", predictor=2, tiled=True,
                blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER")
    with rasterio.open(dst, "w", **prof) as out:
        out.write(cls, 1)
    counts = {k: int((cls == k).sum()) for k in (1, 2, 3, 4)}
    print(f"slope-smooth: {cls.shape[1]}x{cls.shape[0]} px, class counts {counts} in {time.time() - t0:.0f}s")


def slope_vectorize(polys, city, out, tol=1.0):
    import duckdb  # noqa: F401  (reads the GPKGs)
    import numpy as np
    import shapely
    from pyproj import Transformer
    t0 = time.time()
    con = duck()
    rows = con.execute(f"select class, ST_AsWKB(geom) from ST_Read('{polys}') where class between 1 and 4").fetchall()
    cls = np.array([r[0] for r in rows], dtype="int8")
    geoms = shapely.from_wkb([bytes(r[1]) for r in rows])
    print(f"  read {len(geoms):,} polygons in {time.time() - t0:.0f}s", flush=True)
    t1 = time.time()
    # Coverage simplification keeps shared edges identical between neighbours,
    # so simplifying does not open gaps or overlaps between slope classes.
    geoms = shapely.coverage_simplify(geoms, tol, simplify_boundary=True)
    print(f"  coverage_simplify({tol} m) in {time.time() - t1:.0f}s", flush=True)
    t1 = time.time()
    (cwkb,) = con.execute(f"select ST_AsWKB(ST_Union_Agg(geom)) from ST_Read('{city}')").fetchone()
    cityg = shapely.from_wkb(bytes(cwkb))
    shapely.prepare(cityg)
    inside = shapely.contains(cityg, geoms)
    touch = ~inside & shapely.intersects(cityg, geoms)
    geoms[touch] = shapely.intersection(geoms[touch], cityg)
    keep = (inside | touch) & ~shapely.is_empty(geoms)
    geoms, cls = geoms[keep], cls[keep]
    geoms = shapely.make_valid(geoms)
    print(f"  clipped to City: {len(geoms):,} polygons in {time.time() - t1:.0f}s", flush=True)
    t1 = time.time()
    tr = Transformer.from_crs("EPSG:26917", "EPSG:4326", always_xy=True)
    geoms = shapely.transform(geoms, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))
    area_ok = 0
    with open(out, "w") as f:
        for g, c in zip(geoms, cls):
            # make_valid can emit collections with stray lines/points on the clip edge.
            parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
            if not parts:
                continue
            g = parts[0] if len(parts) == 1 else shapely.MultiPolygon(
                [q for p in parts for q in shapely.get_parts(p)])
            area_ok += 1
            f.write(json.dumps({"type": "Feature",
                                "properties": {"class": int(c), "label": SLOPE_LABELS[int(c)]},
                                "geometry": json.loads(shapely.to_geojson(g, indent=None))}) + "\n")
    print(f"slope-vectorize: {area_ok:,} features -> {out} "
          f"(write {time.time() - t1:.0f}s, total {time.time() - t0:.0f}s)")


if __name__ == "__main__":
    step, args = sys.argv[1], sys.argv[2:]
    {"parcels": parcels, "buildings": buildings, "slope-smooth": slope_smooth,
     "slope-vectorize": slope_vectorize}[step](*args)
