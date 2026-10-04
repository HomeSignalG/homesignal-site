#!/usr/bin/env bash
# A TRIAL REPORT THROUGH THE REAL LAYERS (Development Activity build steps 5b, 5c, 5d, 5e, 6 and 7).
#   1. a fresh DISPOSABLE Postgres gets the shipped account spine, private context, snapshot, evaluation, share, watch, payment-ledger and billing SQL, exactly as
#      production has them (the fixture adds only the Supabase roles and auth.users);
#   2. roundtrip.mjs drives the REAL request handlers and data layers of development-activity-trial (creating, joining, and an
#      owner inviting agents) and get-development-activity-report (reports), whose network is translated to psql calls of the
#      same database functions PostgREST would call, then asserts on what the database holds.
# Refuses to run against anything that is not named disposable. Holds no Supabase credential.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null
P -f "$root/docs/brokerage-account-spine.sql" >/dev/null 2>&1 || { echo "FAIL — the account spine does not apply"; exit 1; }
P -f "$root/docs/report-private-context.sql" >/dev/null 2>&1 || { echo "FAIL — the private context does not apply"; exit 1; }
P -f "$root/docs/report-snapshot.sql" >/dev/null 2>&1 || { echo "FAIL — the snapshot does not apply"; exit 1; }
P -f "$root/docs/evaluation-entitlement.sql" >/dev/null 2>&1 || { echo "FAIL — the evaluation entitlement does not apply"; exit 1; }
P -f "$root/docs/saved-reports.sql" >/dev/null 2>&1 || { echo "FAIL — the saved-reports functions do not apply"; exit 1; }
P -f "$root/docs/saved-reports.sql" >/dev/null 2>&1 || { echo "FAIL — the saved-reports functions do not apply a second time"; exit 1; }
# the layers the billing file stands on (it splices the six ownership readers of saved reports, share links and the watch, and reads the payment
# ledger), in the order production applied them, then the header function, then billing: a member's report is stored by
# public.brokerage_report_issue, which the real handler now calls, so this suite must have it
for f in report-share report-share-delivery property-watch payment-event-ledger; do
  P -f "$root/docs/$f.sql" >/dev/null 2>&1 || { echo "FAIL — docs/$f.sql does not apply"; exit 1; }
done
P -f "$root/docs/report-header.sql" >/dev/null 2>&1 || { echo "FAIL — the report-header function does not apply"; exit 1; }
P -f "$root/docs/report-header.sql" >/dev/null 2>&1 || { echo "FAIL — the report-header function does not apply a second time"; exit 1; }
P -f "$root/docs/brokerage-billing.sql" >/dev/null 2>&1 || { echo "FAIL — the billing layer does not apply"; exit 1; }
P -f "$root/docs/brokerage-billing.sql" >/dev/null 2>&1 || { echo "FAIL — the billing layer does not apply a second time"; exit 1; }
exec node "$here/roundtrip.mjs"
