#!/usr/bin/env bash
# Run SQL against the Supabase project via the Management API.
# Usage: scripts/sql.sh "select 1"   or   scripts/sql.sh < file.sql
# Needs SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL in .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
ref=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https://([^.]+)\..*#\1#')
if [ $# -gt 0 ]; then q="$1"; else q=$(cat); fi
python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$q" |
  curl -sS -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
echo
