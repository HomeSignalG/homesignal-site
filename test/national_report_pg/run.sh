#!/usr/bin/env bash
# The national report engine's REAL output through the REAL database writer (Development Activity plan, Order G;
# docs/report-private-context-contract-2026-09-30.md gates 1 and 2: "not yet proven for a real engine").
#   1. a fresh DISPOSABLE Postgres gets the shipped private-context and snapshot SQL, exactly as production has them;
#   2. roundtrip.mjs assembles reports with the real engine and stores them with the real snapshot module, whose rpc is a
#      psql session against that database, then asserts on what the database actually holds.
# Refuses to run against anything that is not named disposable. Holds no Supabase credential.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/report_snapshot_pg/fixture.sql" >/dev/null
P -f "$root/docs/report-private-context.sql" >/dev/null 2>&1
P -f "$root/docs/report-snapshot.sql" >/dev/null 2>&1
exec node "$here/roundtrip.mjs"
