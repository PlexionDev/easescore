#!/usr/bin/env bash
# Bundle scripts/score_all.ts with the engine (esbuild from engine/node_modules) and run it with Node.
# Usage: scripts/score_all.sh [--scope city|county] [--buckets 200] [--from 0] [--to 199] [--workers 8]
#                             [--sql-concurrency 4] [--dry] [--verify 20]
set -euo pipefail
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/easescore-score-all.mjs"
engine/node_modules/.bin/esbuild scripts/score_all.ts --bundle --platform=node --format=esm --target=node20 \
  --log-level=warning --outfile="$out"
exec node "$out" "$@"
