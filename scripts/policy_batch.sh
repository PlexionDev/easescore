#!/usr/bin/env bash
# Bundle scripts/policy_batch.ts with the engine (esbuild from engine/node_modules) and run it with Node.
# Usage: scripts/policy_batch.sh [--keys a35,m0,...] [--queue] [--buckets 200] [--from 0] [--to 199]
#                                [--workers 2] [--pause-ms 4000] [--dry] [--prepare] [--limit-buckets N]
set -euo pipefail
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/easescore-policy-batch.mjs"
engine/node_modules/.bin/esbuild scripts/policy_batch.ts --bundle --platform=node --format=esm --target=node20 \
  --log-level=warning --outfile="$out"
exec node "$out" "$@"
