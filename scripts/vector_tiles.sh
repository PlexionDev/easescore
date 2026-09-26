#!/usr/bin/env bash
# Build the vector map tiles served by the web app at /tiles/... (web/public/tiles/, gitignored).
#
#   basemap.pmtiles    Protomaps OSM vector basemap, clipped to Allegheny County (z0-15).
#                      Data (c) OpenStreetMap contributors (ODbL), Protomaps.
#   easescore.pmtiles  parcels, buildings, zoning, hazard layers, streams (z10-16).
#   slope.pmtiles      smoothed lidar slope-class polygons for the City of Pittsburgh (z10-16).
#
# Usage: scripts/vector_tiles.sh [all|basemap|layers|slope|verify]   (default: all)
#
# Needs: gdal, tippecanoe, pmtiles (Homebrew), uv. Inputs: data/raw/ (scripts/ingest*.py)
# and the USGS 1 m lidar DEM tiles in lidar/USGS_1M_*.tif (UTM 17N, EPSG:26917).
# Intermediates go to data/raw/tiles_build/ and lidar/slope_build/ (both gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=web/public/tiles
BUILD=data/raw/tiles_build
SLOPE=lidar/slope_build
PROTOMAPS_BUILD=${PROTOMAPS_BUILD:-}          # e.g. 20260926; default: latest listed build
COUNTY_BBOX=-80.37,40.19,-79.68,40.68
JOBS=${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}
export OGR_GEOJSON_MAX_OBJ_SIZE=0             # NWI riverine polygons exceed GDAL's 200 MB default
mkdir -p "$OUT" "$BUILD" "$SLOPE"

stamp() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
timed() { local t0=$SECONDS; "$@"; stamp "  ($(( SECONDS - t0 ))s)"; }

# ---------------------------------------------------------------- basemap
basemap() {
  local b=$PROTOMAPS_BUILD
  if [ -z "$b" ]; then
    b=$(curl -fsS https://build-metadata.protomaps.dev/builds.json |
        python3 -c 'import json,sys; print(sorted(x["key"] for x in json.load(sys.stdin))[-1].split(".")[0])')
  fi
  stamp "basemap: Protomaps build $b"
  rm -f "$OUT/basemap.pmtiles"
  pmtiles extract "https://build.protomaps.com/$b.pmtiles" "$OUT/basemap.pmtiles" \
    --bbox="$COUNTY_BBOX" --maxzoom=15
}

# ---------------------------------------------------------------- easescore layers
# ogr2ogr (SQLite dialect) -> FlatGeobuf with a "kind" property, one file per layer.
ogr_layer() { # name src sql
  local name=$1 src=$2 sql=$3
  rm -f "$BUILD/$name.fgb"
  ogr2ogr -f FlatGeobuf "$BUILD/$name.fgb" "$src" -dialect SQLite \
    -sql "select * from ($sql) where geometry is not null" \
    -nln "$name" -nlt PROMOTE_TO_MULTI -makevalid -t_srs EPSG:4326
  stamp "  $name: $(ogrinfo -ro -so "$BUILD/$name.fgb" "$name" | awk -F': ' '/Feature Count/{print $2}') features"
}

# tippecanoe one layer into its own tileset; everything is tile-joined at the end.
tip() { # out.pmtiles minzoom maxzoom [extra flags...] -- -L inputs
  local out=$1 zmin=$2 zmax=$3; shift 3
  rm -f "$out"
  tippecanoe -q -o "$out" -Z"$zmin" -z"$zmax" --force --read-parallel "$@"
}

layers() {
  local R=data/raw T=$BUILD
  stamp "layers: parcels + buildings (DuckDB)"
  timed uv run scripts/vector_tiles.py parcels "$T/parcels.fgb"
  timed uv run scripts/vector_tiles.py buildings "$T/buildings.fgb"

  stamp "layers: zoning, hazards, streams (ogr2ogr)"
  ogr_layer zoning "$R/zoning_pgh.geojson" \
    "select zon_new as zone_code, legendtype as legend, geometry from zoning_pgh where zon_new is not null"
  ogr_layer floodway "$R/flood_fema_nfhl.geojson" \
    "select 'floodway' as kind, FLD_ZONE as zone, geometry from flood_fema_nfhl
     where ZONE_SUBTY like '%FLOODWAY%'"
  ogr_layer flood_100 "$R/flood_fema_nfhl.geojson" \
    "select 'flood_100' as kind, FLD_ZONE as zone, geometry from flood_fema_nfhl
     where FLD_ZONE in ('A','AE','AH','AO') and coalesce(ZONE_SUBTY,'') not like '%FLOODWAY%'"
  ogr_layer flood_500 "$R/flood_fema_nfhl.geojson" \
    "select 'flood_500' as kind, geometry from flood_fema_nfhl
     where FLD_ZONE = 'X' and ZONE_SUBTY like '0.2 PCT%'"
  ogr_layer landslide_prone "$R/landslide_prone_pgh.geojson" \
    "select 'landslide_prone' as kind, geometry from landslide_prone_pgh"
  ogr_layer undermined "$R/undermined_pgh.geojson" \
    "select 'undermined' as kind, geometry from undermined_pgh"
  ogr_layer mined_out "$R/mined_out_dep.geojson" \
    "select 'mined_out' as kind, nullif(trim(COAL_SEAM),'') as coal_seam,
            nullif(trim(OPERATION),'') as operation, geometry from mined_out_dep"
  ogr_layer slope_movement "$R/landslide_pomeroy.geojson" \
    "select 'slope_movement' as kind, nullif(trim(RECLAN),'') as type,
            case when trim(REDBED) = 'Y' then 1 else 0 end as red_beds, geometry from landslide_pomeroy"
  ogr_layer wetlands "$R/wetlands_nwi.geojson" \
    "select 'wetlands' as kind, \"Wetlands.WETLAND_TYPE\" as type,
            \"Wetlands.ATTRIBUTE\" as code, geometry from wetlands_nwi"
  ogr_layer historic "$R/historic_district_pgh.geojson" \
    "select 'historic' as kind, historic_name as name, type as district_type, geometry
     from historic_district_pgh"
  rm -f "$T/streams.fgb"
  ogr2ogr -f FlatGeobuf "$T/streams.fgb" "$R/streams_nhd.geojson" -dialect SQLite -nln streams \
    -sql "select nullif(trim(gnis_name),'') as name,
                 case fcode when 46006 then 'perennial' when 46003 then 'intermittent'
                            when 46007 then 'ephemeral' end as flow_type, geometry
          from streams_nhd where geometry is not null" -t_srs EPSG:4326

  stamp "layers: tippecanoe"
  local P=$T/pm; mkdir -p "$P"
  local clip=(--clip-bounding-box="$COUNTY_BBOX")
  # Parcels and buildings start at z13 (at z12 tippecanoe would have to drop ~90% of
  # parcels to fit tiles, which reads as missing data) and are thinned only below z15.
  # z15-16 are built with no feature or size limit and no tiny-polygon reduction, so
  # every parcel and footprint is present.
  timed tip "$P/parcels_lo.pmtiles" 13 14 --drop-densest-as-needed --detect-shared-borders \
    -L parcels:"$T/parcels.fgb"
  timed tip "$P/parcels_hi.pmtiles" 15 16 --no-feature-limit --no-tile-size-limit \
    --no-tiny-polygon-reduction --detect-shared-borders -L parcels:"$T/parcels.fgb"
  timed tip "$P/buildings_lo.pmtiles" 13 14 --drop-densest-as-needed -T id:int -L buildings:"$T/buildings.fgb"
  timed tip "$P/buildings_hi.pmtiles" 15 16 --no-feature-limit --no-tile-size-limit \
    --no-tiny-polygon-reduction -T id:int -L buildings:"$T/buildings.fgb"
  timed tip "$P/zoning.pmtiles" 10 16 --detect-shared-borders --no-tile-size-limit \
    --no-tiny-polygon-reduction-at-maximum-zoom \
    -L zoning:"$T/zoning.fgb"
  local hz=()
  for k in floodway flood_100 flood_500 landslide_prone undermined mined_out slope_movement wetlands historic; do
    hz+=(-L "$k:$T/$k.fgb")
  done
  timed tip "$P/hazards.pmtiles" 10 16 "${clip[@]}" --coalesce-densest-as-needed --no-tile-size-limit \
    --no-tiny-polygon-reduction-at-maximum-zoom -T red_beds:bool "${hz[@]}"
  timed tip "$P/streams.pmtiles" 10 16 "${clip[@]}" --drop-densest-as-needed -L streams:"$T/streams.fgb"

  stamp "layers: tile-join -> $OUT/easescore.pmtiles"
  rm -f "$OUT/easescore.pmtiles"
  timed tile-join -q --force --no-tile-size-limit -o "$OUT/easescore.pmtiles" \
    -n "EaseScore layers" -N "Parcels, buildings, zoning, hazards and streams for Allegheny County" \
    -A "Allegheny County, City of Pittsburgh, FEMA NFHL, PA DEP, USFWS NWI, USGS NHD" \
    "$P"/parcels_lo.pmtiles "$P"/parcels_hi.pmtiles "$P"/buildings_lo.pmtiles "$P"/buildings_hi.pmtiles \
    "$P"/zoning.pmtiles "$P"/hazards.pmtiles "$P"/streams.pmtiles
}

# ---------------------------------------------------------------- slope polygons
slope() {
  local S=$SLOPE
  stamp "slope: City of Pittsburgh boundary"
  rm -f "$S/city.gpkg" "$S/city_buf.gpkg"
  ogr2ogr -f GPKG "$S/city.gpkg" data/raw/municipalities_alco.geojson -nln city \
    -where "NAME = 'PITTSBURGH'" -t_srs EPSG:26917 -makevalid
  # 60 m pad so slope along the boundary is computed from real neighbours, then clipped.
  ogr2ogr -f GPKG "$S/city_buf.gpkg" "$S/city.gpkg" -nln city -dialect SQLite \
    -sql "select ST_Buffer(geom, 60) as geom from city"

  stamp "slope: mosaic + 2 m DEM"
  gdalbuildvrt -q -overwrite -srcnodata -999999 -vrtnodata -999999 "$S/dem_1m.vrt" lidar/USGS_1M_*.tif
  timed gdalwarp -q -overwrite -multi -wo NUM_THREADS=ALL_CPUS -r average -tr 2 2 -tap \
    -cutline "$S/city_buf.gpkg" -crop_to_cutline -dstnodata -999999 \
    -co COMPRESS=DEFLATE -co PREDICTOR=3 -co TILED=YES -co BIGTIFF=IF_SAFER \
    "$S/dem_1m.vrt" "$S/dem_2m.tif"

  stamp "slope: percent slope"
  timed gdaldem slope -q -p -compute_edges -co COMPRESS=DEFLATE -co TILED=YES \
    "$S/dem_2m.tif" "$S/slope_pct.tif"

  stamp "slope: median filter (10 m) + classify"
  timed uv run scripts/vector_tiles.py slope-smooth "$S/slope_pct.tif" "$S/slope_class.tif"

  stamp "slope: sieve (< 13 px = 52 m2)"
  rm -f "$S/slope_sieved.tif"
  timed gdal_sieve -q -st 13 -8 -of GTiff "$S/slope_class.tif" "$S/slope_sieved.tif"

  stamp "slope: polygonize"
  rm -f "$S/slope_polys.gpkg"
  timed gdal_polygonize -q "$S/slope_sieved.tif" -b 1 -f GPKG "$S/slope_polys.gpkg" slope class

  stamp "slope: simplify (1 m, shared edges), clip, reproject"
  timed uv run scripts/vector_tiles.py slope-vectorize "$S/slope_polys.gpkg" "$S/city.gpkg" "$S/slope.geojsonl"

  stamp "slope: tippecanoe -> $OUT/slope.pmtiles"
  # z15-16 keep every polygon (no tiny-polygon reduction) so the classes stay crisp.
  timed tip "$S/slope_lo.pmtiles" 10 14 --detect-shared-borders --coalesce-densest-as-needed \
    --no-tile-size-limit -L slope:"$S/slope.geojsonl"
  timed tip "$S/slope_hi.pmtiles" 15 16 --detect-shared-borders --no-feature-limit \
    --no-tile-size-limit --no-tiny-polygon-reduction -L slope:"$S/slope.geojsonl"
  rm -f "$OUT/slope.pmtiles"
  timed tile-join -q --force --no-tile-size-limit -o "$OUT/slope.pmtiles" \
    -n "Pittsburgh slope classes" -N "Lidar slope classes (<8, 8-15, 15-25, >=25 %)" -A "USGS 3DEP 1 m lidar (2019), EaseScore" \
    "$S/slope_lo.pmtiles" "$S/slope_hi.pmtiles"
}

# ---------------------------------------------------------------- verify
verify() {
  for f in basemap easescore slope; do
    [ -f "$OUT/$f.pmtiles" ] || { echo "missing $OUT/$f.pmtiles"; continue; }
    echo "== $f.pmtiles  $(du -h "$OUT/$f.pmtiles" | cut -f1)"
    pmtiles show "$OUT/$f.pmtiles" | grep -Ev '^\s*$' | head -30
  done
}

case "${1:-all}" in
  basemap) timed basemap ;;
  layers)  timed layers ;;
  slope)   timed slope ;;
  verify)  verify ;;
  all)     timed basemap; timed layers; timed slope; verify ;;
  *) echo "usage: $0 [all|basemap|layers|slope|verify]" >&2; exit 2 ;;
esac
