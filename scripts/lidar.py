# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27", "numpy>=2", "rasterio>=1.4", "shapely>=2"]
# ///
"""USGS 3DEP 1-meter lidar DEM for Allegheny County → per-parcel slope.

  uv run scripts/lidar.py list       # tile list from the National Map API → lidar/tiles.json
  uv run scripts/lidar.py download   # one tile at a time, resumable, skips finished tiles
  uv run scripts/lidar.py compute    # mean / max / p95 slope and share over 15/25/40% per parcel

Tiles (~19 GB) live in lidar/ (gitignored). Tiles are UTM 17N (EPSG:26917), 10 km × 10 km.
"""
import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
LIDAR = ROOT / "lidar"
TILES = LIDAR / "tiles.json"
API = "https://tnmaccess.nationalmap.gov/api/v1/products"
BBOX = "-80.37,40.19,-79.68,40.68"  # Allegheny County, padded
PROJECT = "PA_WesternPA_2019"


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(LIDAR / "progress.log", "a") as f:
        f.write(line + "\n")


def list_tiles():
    LIDAR.mkdir(exist_ok=True)
    r = httpx.get(API, params={"datasets": "Digital Elevation Model (DEM) 1 meter", "bbox": BBOX,
                               "max": 500, "outputFormat": "JSON"}, timeout=120)
    r.raise_for_status()
    items = [i for i in r.json()["items"] if PROJECT in i["title"]]
    tiles = [{"title": i["title"], "url": i["downloadURL"], "bytes": i.get("sizeInBytes"),
              "published": i.get("publicationDate")} for i in items]
    TILES.write_text(json.dumps(tiles, indent=1))
    log(f"listed {len(tiles)} tiles, {sum(t['bytes'] or 0 for t in tiles) / 1e9:.1f} GB")
    return tiles


def download():
    tiles = json.loads(TILES.read_text()) if TILES.exists() else list_tiles()
    with httpx.Client(timeout=httpx.Timeout(60, read=300), follow_redirects=True) as client:
        for n, t in enumerate(tiles, 1):
            dest = LIDAR / t["url"].rsplit("/", 1)[1]
            part = dest.with_suffix(".tif.part")
            # The API's sizeInBytes can be wrong; the server's Content-Length is the truth.
            if "server_bytes" not in t:
                h = client.head(t["url"])
                t["server_bytes"] = int(h.headers.get("content-length", 0)) or t["bytes"]
                TILES.write_text(json.dumps(tiles, indent=1))
            t["bytes"] = t["server_bytes"]
            if dest.exists() and (not t["bytes"] or dest.stat().st_size == t["bytes"]):
                continue
            # Keep resuming with Range requests until the file reaches the published size;
            # the server sometimes closes long transfers early without an error.
            for attempt in range(20):
                have = part.stat().st_size if part.exists() else 0
                if t["bytes"] and have >= t["bytes"]:
                    break
                headers = {"Range": f"bytes={have}-"} if have else {}
                try:
                    with client.stream("GET", t["url"], headers=headers) as r:
                        if r.status_code == 416:  # already complete
                            break
                        r.raise_for_status()
                        mode = "ab" if have and r.status_code == 206 else "wb"
                        with open(part, mode) as f:
                            for chunk in r.iter_bytes(1 << 20):
                                f.write(chunk)
                except (httpx.HTTPError, OSError) as e:
                    log(f"retry {attempt + 1} {dest.name}: {type(e).__name__}")
                    time.sleep(min(60, 5 * (attempt + 1)))
                if not t["bytes"]:
                    break
            size = part.stat().st_size if part.exists() else 0
            if t["bytes"] and size != t["bytes"]:
                log(f"INCOMPLETE {dest.name}: {size} of {t['bytes']} bytes — rerun to resume")
                continue
            part.rename(dest)
            log(f"[{n}/{len(tiles)}] {dest.name} {size / 1e6:.0f} MB")
    done = [p for p in LIDAR.glob("*.tif")]
    log(f"download pass finished: {len(done)} tiles, {sum(p.stat().st_size for p in done) / 1e9:.2f} GB")


def compute():
    """Per parcel: mean, max, and 95th-percentile slope plus share of area over 15/25/40%.
    Each tile is processed on its own; parcels crossing tile edges are merged with running sums
    (max and share exact; p95 from a per-parcel slope histogram)."""
    import duckdb
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from shapely import wkb
    from shapely.strtree import STRtree

    sys.path.insert(0, str(ROOT / "scripts"))
    from ingest import RAW, load_env, upload

    load_env()
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    cols = ("{'_id':'VARCHAR','pin':'VARCHAR','map_block_lot':'VARCHAR','municode':'VARCHAR',"
            "'calc_acreage':'VARCHAR','comments':'VARCHAR','notes':'VARCHAR','pseudono':'VARCHAR',"
            "'shape_length':'VARCHAR','wkt':'VARCHAR'}")
    rows = con.execute(f"""
      select pin, ST_AsWKB(ST_MakeValid(ST_Union_Agg(ST_MakeValid(ST_Transform(
               ST_GeomFromText(wkt), 'EPSG:2272', 'EPSG:26917', always_xy := true)))))
      from read_csv('{RAW / 'parcels.tsv'}', auto_detect=false, header=true, delim='\t',
                    quote='', escape='', max_line_size=60000000, columns={cols})
      where length(pin) = 16 and wkt is not null and trim(wkt) <> '' group by pin
    """).fetchall()
    pins = [r[0] for r in rows]
    geoms = [wkb.loads(bytes(r[1])) for r in rows]
    tree = STRtree(geoms)
    n = len(pins) + 1
    BINS = np.arange(0, 201, 1.0)  # 1% slope bins, 200%+ clipped
    cells = np.zeros(n); total = np.zeros(n); mx = np.zeros(n)
    over15 = np.zeros(n); over25 = np.zeros(n); over40 = np.zeros(n)
    hist_arr = np.zeros((n, len(BINS) - 1), dtype=np.uint32)
    log(f"compute: {len(pins):,} parcels")

    for tif in sorted(LIDAR.glob("*.tif")):
        with rasterio.open(tif) as src:
            dem = src.read(1, masked=True).astype("float32").filled(np.nan)
            tr = src.transform
            res = abs(tr.a)
            b = src.bounds
        dy, dx = np.gradient(dem, res, res)
        slope = (np.hypot(dx, dy) * 100.0).astype("float32")
        del dem, dx, dy
        from shapely.geometry import box
        idx = tree.query(box(b.left, b.bottom, b.right, b.top))
        if len(idx) == 0:
            continue
        ids = rasterize(((geoms[i], int(i) + 1) for i in idx), out_shape=slope.shape, transform=tr,
                        fill=0, dtype="int32")
        ok = (ids > 0) & np.isfinite(slope)
        pid, val = ids[ok], slope[ok]
        cells += np.bincount(pid, minlength=n)
        total += np.bincount(pid, weights=val, minlength=n)
        over15 += np.bincount(pid, weights=val > 15, minlength=n)
        over25 += np.bincount(pid, weights=val > 25, minlength=n)
        over40 += np.bincount(pid, weights=val > 40, minlength=n)
        np.maximum.at(mx, pid, val)
        b_idx = np.clip(np.digitize(val, BINS) - 1, 0, len(BINS) - 2)
        np.add.at(hist_arr, (pid, b_idx), 1)
        log(f"  {tif.name}: {len(idx):,} parcels, {ok.sum():,} cells")
        del slope, ids, ok, pid, val

    def p95(i):
        h = hist_arr[i]
        c = np.cumsum(h)
        return float(BINS[np.searchsorted(c, 0.95 * c[-1])]) if c[-1] else None

    def out():
        for i, pin in enumerate(pins, start=1):
            if cells[i] == 0:
                continue
            yield {"parid": pin, "mean_pct": round(float(total[i] / cells[i]), 1),
                   "max_pct": round(float(mx[i]), 1), "p95_pct": p95(i),
                   "share_over_15": round(float(over15[i] / cells[i]), 3),
                   "share_over_25": round(float(over25[i] / cells[i]), 3),
                   "share_over_40": round(float(over40[i] / cells[i]), 3),
                   "cells_1m": int(cells[i]), "steep_25": bool(over25[i] > 0)}

    upload("parcel_slope_1m", out(), len(pins), batch=5000)
    log(f"compute done: {int((cells[1:] > 0).sum()):,} parcels with 1 m cells")


if __name__ == "__main__":
    {"list": list_tiles, "download": download, "compute": compute}[sys.argv[1]]()
