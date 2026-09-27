#!/usr/bin/env bash
# Build parcel_block_face + block_faces (migration 130) in throttled chunks on the shared DB:
# one statement at a time, a pause between chunks. Usage: scripts/block_faces.sh [first_chunk] [pause_s]
set -euo pipefail
cd "$(dirname "$0")/.."
f=supabase/migrations/130_block_faces.sql
first=${1:-0}; pause=${2:-3}
sed -n '/^-- PREP/,/^-- CHUNK/p' $f | scripts/sql.sh >/dev/null
chunk_sql=$(sed -n '/^-- CHUNK/,/^-- AGG/p' $f)
for c in $(seq "$first" 49); do
  t0=$(date +%s)
  out=$(echo "${chunk_sql//:chunk/$c}" | scripts/sql.sh)
  [[ "$out" == "[]" ]] || { echo "chunk $c failed: $out"; exit 1; }
  echo "chunk $c done in $(( $(date +%s) - t0 ))s"
  sleep "$pause"
done
sed -n '/^-- AGG/,/^-- RPC/p' $f | scripts/sql.sh >/dev/null && echo "block_faces aggregated"
sed -n '/^-- RPC/,$p' $f | scripts/sql.sh >/dev/null && echo "rpc created"
