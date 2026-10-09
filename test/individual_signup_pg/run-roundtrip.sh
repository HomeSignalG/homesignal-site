#!/usr/bin/env bash
# SIGNUP -> REPORT THROUGH THE REAL LAYERS (Order L2). A fresh DISPOSABLE Postgres gets the shipped SQL exactly as production has it (account spine,
# private context, snapshot, evaluation, saved reports, share, watch, payment ledger, header, billing, report rate limit) PLUS docs/individual-agent-signup.sql,
# then roundtrip.mjs drives the REAL request handlers and data layers: the trial function's `signup`, then the report function ten times, then the
# billing function. Refuses anything not named disposable. Holds no Supabase credential.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null
for f in brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing report-rate-limit individual-agent-signup; do
  P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.dep.err" || { echo "FAIL — docs/$f.sql does not apply"; head -3 "$here/.dep.err"; rm -f "$here/.dep.err"; exit 1; }
done
rm -f "$here/.dep.err"
exec node --experimental-strip-types "$here/roundtrip.mjs"
