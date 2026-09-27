#!/usr/bin/env bash
# Bundle scripts/backtest.ts with the engine and run it. ENGINE=path/to/engine/src/index.ts to backtest another engine copy.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/easescore-backtest.mjs"
engine/node_modules/.bin/esbuild scripts/backtest.ts --bundle --platform=node --format=esm --target=node20 \
  --alias:@easescore/engine="${ENGINE:-./engine/src/index.ts}" --log-level=warning --outfile="$out"
exec node "$out" "$@"
