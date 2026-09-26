# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27", "numpy>=2", "rasterio>=1.4", "shapely>=2",
#                 "pyproj>=3.6", "laspy[lazrs]>=2.5"]
# ///
"""Measured building heights from USGS 3DEP lidar → public.building_heights.

  uv run scripts/building_heights.py <lon> <lat> [radius_m=350]

For every building footprint (public.buildings) within radius_m of the point:
  roof   = 95th percentile Z of lidar returns inside the footprint, excluding ground (2),
           noise (7, 18), water (9) and ignored ground (20). The 2019 Western PA cloud has no
           building class (6), so unclassified (1) returns carry the roofs.
  ground = median 1 m bare-earth DEM (lidar/dem.vrt, NAVD88 m) in a 1-3 m ring outside the footprint.
  height = roof - ground, clipped to [MIN_H, MAX_H]; null when fewer than MIN_POINTS returns.

Points come from the public USGS Entwine Point Tiles bucket (Web Mercator horizontal, NAVD88 m
vertical), read with PDAL readers.ept for just this window. The LAZ is cached under lidar/ept/.
Needs PDAL on PATH (or /opt/homebrew/bin/pdal) and lidar/dem.vrt
(gdalbuildvrt lidar/dem.vrt lidar/USGS_1M_*.tif).
"""
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import laspy
import numpy as np
import rasterio
import rasterio.features
import rasterio.windows
import shapely
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from ingest import load_env, upload  # noqa: E402

EPT_BUCKET = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"
# Pittsburgh falls in the overlap of these two; _2_ holds the city core, _1_ the southern county.
EPT_RESOURCES = ["PA_WesternPA_2_2019", "PA_WesternPA_1_2019"]
SOURCE = "USGS 3DEP lidar (PA_WesternPA_2019)"
RESOLUTION = 2.0          # EPT resolution in Web Mercator units; ~4-5 pts/m2 here, plenty for roofs
DEM = ROOT / "lidar" / "dem.vrt"
CACHE = ROOT / "lidar" / "ept"
EXCLUDE_CLASSES = [2, 7, 9, 17, 18, 20]
MIN_POINTS = 20
MIN_H, MAX_H = 2.0, 300.0  # downtown towers exceed 120 m (the tallest is ~256 m)
RING_IN, RING_OUT = 1.0, 3.0

to_utm = Transformer.from_crs(4326, 26917, always_xy=True)
utm_to_merc = Transformer.from_crs(26917, 3857, always_xy=True)


def pdal_bin():
    return shutil.which("pdal") or "/opt/homebrew/bin/pdal"


def sql(query):
    out = subprocess.run([str(ROOT / "scripts" / "sql.sh"), query], capture_output=True, text=True, check=True)
    rows = json.loads(out.stdout)
    if isinstance(rows, dict):
        raise SystemExit(f"sql error: {str(rows)[:300]}")
    return rows


def fetch_buildings(lon, lat, radius):
    deg = radius / 84000.0 * 1.5
    rows = sql(f"""
      select b.id, ST_AsText(ST_Transform(b.geom, 26917)) wkt
      from public.buildings b
      where b.geom && ST_Expand(ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326), {deg})
        and ST_DWithin(b.geom::geography, ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)::geography, {radius})""")
    return [(int(r["id"]), shapely.from_wkt(r["wkt"])) for r in rows]


def fetch_points(bounds_utm, tag):
    """Read the EPT window once (cached as LAZ), reprojected to UTM 17N. Returns (las, resource)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    xmin, ymin, xmax, ymax = bounds_utm
    xs, ys = utm_to_merc.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    mb = f"([{min(xs):.1f},{max(xs):.1f}],[{min(ys):.1f},{max(ys):.1f}])"
    for res in EPT_RESOURCES:
        out = CACHE / f"{tag}_{res}.laz"
        meta = CACHE / f"{tag}_{res}.json"
        if not out.exists():
            pipe = {"pipeline": [
                {"type": "readers.ept", "filename": f"{EPT_BUCKET}/{res}/ept.json",
                 "bounds": mb, "resolution": RESOLUTION},
                {"type": "filters.reprojection", "out_srs": "EPSG:26917"},
                {"type": "filters.stats", "dimensions": "Classification", "enumerate": "Classification"},
                {"type": "writers.las", "filename": str(out), "compression": True,
                 "scale_x": 0.01, "scale_y": 0.01, "scale_z": 0.01, "offset_x": "auto", "offset_y": "auto",
                 "offset_z": "auto", "a_srs": "EPSG:26917"}]}
            subprocess.run([pdal_bin(), "pipeline", "--stdin", "--metadata", str(meta)],
                           input=json.dumps(pipe), text=True, check=True)
        las = laspy.read(out)
        if len(las.points) > 1000:
            return las, res
        print(f"  {res}: {len(las.points)} points, trying next resource", flush=True)
    raise SystemExit("no EPT resource covers this window")


def main():
    lon, lat = float(sys.argv[1]), float(sys.argv[2])
    radius = float(sys.argv[3]) if len(sys.argv) > 3 else 350.0
    tag = f"{lon:.4f}_{lat:.4f}_{int(radius)}_r{RESOLUTION:g}"
    load_env()
    t0 = time.time()

    blds = fetch_buildings(lon, lat, radius)
    if not blds:
        raise SystemExit("no buildings in window")
    b = shapely.bounds(shapely.GeometryCollection([g for _, g in blds]))
    bounds = (b[0] - 5, b[1] - 5, b[2] + 5, b[3] + 5)
    print(f"{len(blds)} buildings; window {bounds[2] - bounds[0]:.0f} x {bounds[3] - bounds[1]:.0f} m "
          f"({time.time() - t0:.1f}s)", flush=True)

    t1 = time.time()
    las, resource = fetch_points(bounds, tag)
    x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    cls = np.asarray(las.classification)
    area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    classes, counts = np.unique(cls, return_counts=True)
    print(f"{resource}: {len(x):,} points, {len(x) / area:.2f} pts/m2, classes "
          f"{dict(zip(classes.tolist(), counts.tolist()))} ({time.time() - t1:.1f}s)", flush=True)

    with rasterio.open(DEM) as dem:
        win = rasterio.windows.from_bounds(*bounds, transform=dem.transform).round_offsets().round_lengths()
        grid = dem.read(1, window=win, masked=True).astype("float64").filled(np.nan)
        gt = dem.window_transform(win)

    # Vertical sanity check: lidar ground returns vs the bare-earth DEM (both NAVD88 m).
    g = np.flatnonzero(cls == 2)
    if len(g):
        g = g[:: max(1, len(g) // 20000)]
        r, c = rasterio.transform.rowcol(gt, x[g], y[g])
        r, c = np.asarray(r), np.asarray(c)
        ok = (r >= 0) & (r < grid.shape[0]) & (c >= 0) & (c < grid.shape[1])
        d = z[g][ok] - grid[r[ok], c[ok]]
        print(f"ground check: lidar ground - DEM median {np.nanmedian(d):+.2f} m (n={ok.sum():,})", flush=True)

    keep = ~np.isin(cls, EXCLUDE_CLASSES)
    x, y, z = x[keep], y[keep], z[keep]
    order = np.argsort(x)
    x, y, z = x[order], y[order], z[order]

    now = datetime.now(timezone.utc).isoformat()
    rows, clipped = [], 0
    for bid, geom in blds:
        minx, miny, maxx, maxy = geom.bounds
        lo, hi = np.searchsorted(x, [minx, maxx])
        sel = np.arange(lo, hi)
        sel = sel[(y[sel] >= miny) & (y[sel] <= maxy)]
        inside = sel[shapely.contains_xy(geom, x[sel], y[sel])] if len(sel) else sel
        n = int(len(inside))

        ring = geom.buffer(RING_OUT).difference(geom.buffer(RING_IN))
        rw = rasterio.windows.from_bounds(*ring.bounds, transform=gt).round_offsets().round_lengths()
        r0, c0 = max(int(rw.row_off), 0), max(int(rw.col_off), 0)
        r1, c1 = min(int(rw.row_off + rw.height), grid.shape[0]), min(int(rw.col_off + rw.width), grid.shape[1])
        ground = None
        if r1 > r0 and c1 > c0:
            sub = grid[r0:r1, c0:c1]
            m = rasterio.features.geometry_mask([ring], out_shape=sub.shape, invert=True,
                                                transform=rasterio.windows.transform(
                                                    rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0), gt),
                                                all_touched=True)
            vals = sub[m]
            vals = vals[np.isfinite(vals)]
            if len(vals):
                ground = float(np.median(vals))

        roof = float(np.percentile(z[inside], 95)) if n else None
        h = None
        if n >= MIN_POINTS and roof is not None and ground is not None:
            h = roof - ground
            if h < MIN_H or h > MAX_H:
                clipped += 1
            h = round(min(max(h, MIN_H), MAX_H), 2)
        rows.append({"building_id": bid, "height_m": h,
                     "roof_p95_m": round(roof, 2) if roof is not None else None,
                     "ground_m": round(ground, 2) if ground is not None else None,
                     "points": n, "source": SOURCE, "computed_at": now})

    hs = np.array([r["height_m"] for r in rows if r["height_m"] is not None])
    print(f"computed {len(hs)}/{len(rows)} heights ({len(rows) - len(hs)} null, {clipped} clipped)", flush=True)
    if len(hs):
        print(f"height m: min {hs.min():.1f}  p25 {np.percentile(hs, 25):.1f}  median {np.median(hs):.1f}  "
              f"p75 {np.percentile(hs, 75):.1f}  max {hs.max():.1f}", flush=True)
    upload("building_heights", iter(rows), len(rows), batch=1000, on_conflict="building_id")
    print(f"done in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
