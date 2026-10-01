#!/usr/bin/env bash
# CHANGES SINCE REPORT and FOLLOW, end to end on a real database (contract §6 gate 4: "Follow / Changes Since Report continues to
# work while the private context is active ... that must be shown end to end when it is built").
#   1. a fresh DISPOSABLE Postgres gets the shipped ledger, the reportable-events view, the private-context layer and the snapshot
#      SQL, exactly as production has them (only dev_change_source_health is a stand-in: standins.sql says why);
#   2. roundtrip.mjs assembles a report with the real engine from events read through the real shared reads, stores it with the real
#      writer, then drives the REAL edge function handler and data layer. The data layer's fetch is a small PostgREST translator
#      that runs each request as role service_role against the database, so a missing grant or a wrong column fails here.
# Refuses to run against anything that is not named disposable. Holds no Supabase credential.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
P -f "$root/docs/dev-change-ledger.sql" >/dev/null 2>&1
P -f "$root/docs/dev-change-reportable.sql" >/dev/null 2>&1
P -f "$root/docs/report-private-context.sql" >/dev/null 2>&1
P -f "$root/docs/report-snapshot.sql" >/dev/null 2>&1
P -f "$here/standins.sql" >/dev/null
exec node "$here/roundtrip.mjs"
