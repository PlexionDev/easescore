#!/usr/bin/env bash
# Bundle scripts/pane_all.ts with the engine and web/src/lib/pane-core.ts (esbuild from engine/node_modules)
# and run it with Node. Usage: see scripts/pane_all.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/easescore-pane-all.mjs"
engine/node_modules/.bin/esbuild scripts/pane_all.ts --bundle --platform=node --format=esm --target=node20 \
  --alias:@easescore/engine=./engine/src/index.ts --log-level=warning --outfile="$out"
exec node "$out" "$@"
