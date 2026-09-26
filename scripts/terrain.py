# /// script
# requires-python = ">=3.11"
# dependencies = ["rasterio>=1.4", "numpy>=2", "pillow>=10", "mercantile>=1.2"]
# ///
"""USGS 1 m lidar DEM → Terrain-RGB tiles (Mapbox encoding, 512 px, lossless WebP) → MBTiles.

Inputs:  lidar/USGS_1M_*.tif (UTM 17N source tiles; each output tile is reprojected on the fly with WarpedVRT)
Output:  web/public/tiles/terrain/{z}/{x}/{y}.webp (gitignored; served by the app) and lidar/terrain.mbtiles
         (for hosting: `pmtiles convert lidar/terrain.mbtiles terrain.pmtiles`)

Encoding (MapLibre raster-dem "mapbox"): height_m = -10000 + (R*65536 + G*256 + B) * 0.1
Usage: uv run scripts/terrain.py [minzoom] [maxzoom]   (re-running resumes: existing .webp tiles are reused)
"""
import io
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import mercantile
import numpy as np
import rasterio
import rasterio.windows
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds as from_bounds_transform
from rasterio.warp import reproject, transform_bounds

ROOT = Path(__file__).resolve().parent.parent
SOURCES = sorted((ROOT / "lidar").glob("USGS_1M_*.tif"))
# Overview zooms (≤ 13) read a 10 m Web Mercator mosaic built with:
#   gdalbuildvrt lidar/dem.vrt lidar/USGS_1M_*.tif
#   gdalwarp -t_srs EPSG:3857 -tr 10 10 -r average -dstnodata -9999 lidar/dem.vrt lidar/dem_3857_10m.tif
LOWRES = ROOT / "lidar" / "dem_3857_10m.tif"
LOWRES_MAXZOOM = 13
_BOUNDS_3857: list = []
OUT = ROOT / "lidar" / "terrain.mbtiles"
DIR = ROOT / "web" / "public" / "tiles" / "terrain"
TILE = 512
BOUNDS = (-80.37, 40.19, -79.68, 40.68)  # Allegheny County, padded


def encode(h: np.ndarray) -> bytes:
    h = np.nan_to_num(h, nan=0.0)
    v = np.clip(np.round((h + 10000.0) * 10.0), 0, 16777215).astype(np.uint32)
    rgb = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="WEBP", lossless=True, quality=100, method=4)
    return buf.getvalue()


def source_bounds():
    out = []
    for f in SOURCES:
        with rasterio.open(f) as s:
            out.append((f, transform_bounds(s.crs, "EPSG:3857", *s.bounds)))
    return out


def _init(bounds):
    global _BOUNDS_3857
    _BOUNDS_3857 = bounds


def render(t: tuple[int, int, int]):
    z, x, y = t
    done = DIR / str(z) / str(x) / f"{y}.webp"
    if done.exists():  # resume: reuse tiles written by an earlier run
        return z, x, y, done.read_bytes()
    b = mercantile.xy_bounds(x, y, z)
    out = np.full((TILE, TILE), np.nan, dtype="float32")
    if z <= LOWRES_MAXZOOM:
        with rasterio.open(LOWRES) as src:
            win = rasterio.windows.from_bounds(b.left, b.bottom, b.right, b.top, src.transform)
            arr = src.read(1, window=win, out_shape=(TILE, TILE), boundless=True, fill_value=-9999,
                           resampling=Resampling.bilinear).astype("float32")
        arr = np.where(arr < -1000, np.nan, arr)
        return None if np.isnan(arr).all() else (z, x, y, encode(arr))
    for f, (l, bo, r, tp) in _BOUNDS_3857:
        if r < b.left or l > b.right or tp < b.bottom or bo > b.top:
            continue
        arr = np.full((TILE, TILE), np.nan, dtype="float32")
        with rasterio.open(f) as src:
            reproject(source=rasterio.band(src, 1), destination=arr,
                      dst_transform=from_bounds_transform(b.left, b.bottom, b.right, b.top, TILE, TILE),
                      dst_crs="EPSG:3857", src_nodata=src.nodata, dst_nodata=np.nan,
                      resampling=Resampling.bilinear, init_dest_nodata=True)
        arr = np.where(arr < -1000, np.nan, arr)
        out = np.where(np.isnan(out), arr, out)
    if np.isnan(out).all():
        return None
    return z, x, y, encode(out)


def main():
    zmin = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    zmax = int(sys.argv[2]) if len(sys.argv) > 2 else 16
    tiles = [(t.z, t.x, t.y) for z in range(zmin, zmax + 1) for t in mercantile.tiles(*BOUNDS, zooms=z)]
    print(f"{len(tiles):,} tiles z{zmin}-{zmax}", flush=True)
    OUT.unlink(missing_ok=True)
    db = sqlite3.connect(OUT)
    db.executescript("""
      create table metadata (name text, value text);
      create table tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
      create unique index tile_index on tiles (zoom_level, tile_column, tile_row);
    """)
    meta = {"name": "EaseScore lidar terrain", "format": "webp", "type": "baselayer", "minzoom": str(zmin), "maxzoom": str(zmax),
            "bounds": ",".join(map(str, BOUNDS)), "attribution": "USGS 3DEP 1 m lidar (PA_WesternPA_2019)",
            "description": "Terrain-RGB (mapbox encoding), 512 px, lossless WebP"}
    db.executemany("insert into metadata values (?, ?)", meta.items())
    done = 0
    bounds = source_bounds()
    print(f"{len(bounds)} source tiles", flush=True)
    with ProcessPoolExecutor(initializer=_init, initargs=(bounds,)) as pool:
        for r in pool.map(render, tiles, chunksize=16):
            done += 1
            if r:
                z, x, y, data = r
                db.execute("insert into tiles values (?, ?, ?, ?)", (z, x, (2 ** z - 1) - y, data))  # MBTiles = TMS rows
                f = DIR / str(z) / str(x) / f"{y}.webp"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(data)
            if done % 2000 == 0:
                db.commit()
                print(f"  {done:,}/{len(tiles):,}", flush=True)
    db.commit()
    db.close()
    print("done", flush=True)


if __name__ == "__main__":
    main()
