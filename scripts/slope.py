# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27", "numpy>=2", "rasterio>=1.4", "shapely>=2"]
# ///
"""Per-parcel terrain slope from the USGS 3DEP elevation model.

1. Download a 10 m DEM for Allegheny County (UTM 17N) in tiles -> data/raw/dem/ (gitignored).
2. Slope (percent) per cell from elevation gradients.
3. Burn parcel IDs onto the same grid and average per parcel; tiny parcels that
   cover no cell centre get the slope at their interior point.
4. Upsert into public.parcel_slope.

Usage: uv run scripts/slope.py
"""
import sys
import time
from pathlib import Path

import duckdb
import httpx
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import rowcol
from shapely import wkb

sys.path.insert(0, str(Path(__file__).parent))
from ingest import RAW, load_env, upload  # noqa: E402

DEM_DIR = RAW / "dem"
SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
CELL = 10  # meters
# Allegheny County in UTM 17N (EPSG:32617), padded ~1 km.
XMIN, YMIN, XMAX, YMAX = 553000, 4449000, 612000, 4504000
TILE = 1000  # pixels per tile side (10 km); larger tiles time out at USGS


def download_dem():
    DEM_DIR.mkdir(parents=True, exist_ok=True)
    step = TILE * CELL
    paths = []
    with httpx.Client(timeout=300) as client:
        for x0 in range(XMIN, XMAX, step):
            for y0 in range(YMIN, YMAX, step):
                x1, y1 = min(x0 + step, XMAX), min(y0 + step, YMAX)
                dest = DEM_DIR / f"dem_{x0}_{y0}.tif"
                if not dest.exists():
                    for attempt in range(5):
                        r = client.get(SERVICE, params={
                            "bbox": f"{x0},{y0},{x1},{y1}", "bboxSR": 32617, "imageSR": 32617,
                            "size": f"{(x1 - x0) // CELL},{(y1 - y0) // CELL}", "format": "tiff",
                            "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation",
                            "f": "image"})
                        if r.status_code == 200 and r.content[:2] in (b"II", b"MM"):
                            break
                        time.sleep(5 * (attempt + 1))
                    else:
                        raise SystemExit(f"DEM tile failed: {dest.name} ({r.status_code})")
                    dest.write_bytes(r.content)
                    print(f"  tile {dest.name}: {len(r.content) / 1e6:.0f} MB", flush=True)
                paths.append(dest)
    return paths


def slope_grid(paths):
    srcs = [rasterio.open(p) for p in paths]
    dem, transform = merge(srcs, nodata=np.nan)
    dem = dem[0].astype("float64")
    dem[dem < -1000] = np.nan
    dy, dx = np.gradient(dem, CELL, CELL)
    slope = np.hypot(dx, dy) * 100.0  # percent
    print(f"  slope grid {slope.shape[1]}x{slope.shape[0]}, median {np.nanmedian(slope):.1f}%")
    return slope.astype("float32"), transform


def parcel_geoms():
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    cols = ("{'_id':'VARCHAR','pin':'VARCHAR','map_block_lot':'VARCHAR','municode':'VARCHAR',"
            "'calc_acreage':'VARCHAR','comments':'VARCHAR','notes':'VARCHAR','pseudono':'VARCHAR',"
            "'shape_length':'VARCHAR','wkt':'VARCHAR'}")
    rows = con.execute(f"""
      select pin, ST_AsWKB(ST_MakeValid(ST_Union_Agg(ST_MakeValid(ST_Transform(
               ST_GeomFromText(wkt), 'EPSG:2272', 'EPSG:32617', always_xy := true)))))
      from read_csv('{RAW / 'parcels.tsv'}', auto_detect=false, header=true, delim='\t',
                    quote='', escape='', max_line_size=60000000, columns={cols})
      where length(pin) = 16 and wkt is not null and trim(wkt) <> ''
      group by pin
    """).fetchall()
    return [(pin, wkb.loads(bytes(g))) for pin, g in rows]


def main():
    load_env()
    slope, transform = slope_grid(download_dem())
    parcels = parcel_geoms()
    print(f"  {len(parcels):,} parcels")

    # Burn parcel index (1-based) onto the slope grid. Later shapes win on shared cells.
    ids = rasterize(((g, i + 1) for i, (_, g) in enumerate(parcels)), out_shape=slope.shape,
                    transform=transform, fill=0, dtype="int32")
    valid = (ids > 0) & np.isfinite(slope)
    idx, vals = ids[valid], slope[valid]
    n = len(parcels) + 1
    cells = np.bincount(idx, minlength=n)
    mean = np.bincount(idx, weights=vals, minlength=n) / np.maximum(cells, 1)
    steep = np.bincount(idx, weights=(vals > 25).astype(float), minlength=n) / np.maximum(cells, 1)
    print(f"  parcels with >=1 cell: {(cells[1:] > 0).sum():,}")

    def rows():
        for i, (pin, g) in enumerate(parcels, start=1):
            if cells[i] > 0:
                m, s, c = float(mean[i]), float(steep[i]), int(cells[i])
            else:
                p = g.representative_point()
                r, cidx = rowcol(transform, p.x, p.y)
                v = slope[r, cidx] if 0 <= r < slope.shape[0] and 0 <= cidx < slope.shape[1] else np.nan
                if not np.isfinite(v):
                    continue
                m, s, c = float(v), float(v > 25), 0
            yield {"parid": pin, "slope_mean_pct": round(m, 1),
                   "steep_share": round(s, 3), "cells": c}

    upload("parcel_slope", rows(), len(parcels), batch=5000)


if __name__ == "__main__":
    main()
