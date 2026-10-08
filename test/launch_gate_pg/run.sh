#!/usr/bin/env bash
# THE LAUNCH GATE (Development Activity build step 13) — the plan's own end-to-end sequence, through the real layers:
#   invite -> redeem -> report 1 -> ... -> report 20 -> report 21 blocked -> checkout -> payment -> paid entitlement -> reports continue -> 100 -> 101 blocked.
#   1. a fresh DISPOSABLE Postgres gets every shipped layer the product stands on, in the order production applied them (the fixture adds only the
#      Supabase roles and auth.users);
#   2. roundtrip.mjs drives the REAL request handlers and data layers of development-activity-trial, get-development-activity-report, manage-billing and
#      development-activity-billing-webhook; their network is translated to psql calls of the same database functions PostgREST would call, and the
#      payment processor is a stand-in that records the request it was sent. It then asserts on what the database holds.
# Refuses to run against anything that is not named disposable. Holds no Supabase credential and no processor key.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null
for f in brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing report-rate-limit da-owner-safeguards; do
  P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.apply.err" || { echo "FAIL — docs/$f.sql does not apply"; head -3 "$here/.apply.err"; exit 1; }
done
rm -f "$here/.apply.err"
exec node "$here/roundtrip.mjs"
