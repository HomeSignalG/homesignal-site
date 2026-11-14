#!/usr/bin/env bash
# Paddle fulfilment against the REAL billing SQL on a DISPOSABLE Postgres (never production). The deliveries are signed, verified and translated by the real adapter (gen-events.mjs),
# then replayed through billing_event_apply: duplicates, out-of-order delivery, cancellation, refund, chargeback, a real monthly reset, the 100/month cap, test mode, binding conflict,
# privileges. Exit 1 on any failed check. Needs node (type stripping), psql and PGHOST/PGDATABASE for a database whose name contains "disposable".
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
. "$root/test/lib/docsql.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing individual-agent-signup)
P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/individual_signup_pg/fixture.sql" >/dev/null   # auth.users with email_confirmed_at (an individual signup needs a confirmed email)
for f in "${DEPS[@]}"; do P -f "$(docsql "$f")" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done
apply_paddle() { P -f "$root/docs/paddle-billing.sql" >/dev/null; }
apply_paddle; apply_paddle      # idempotent: twice is the same
P -tA -F$'\t' -f "$here/phase1.sql" | grep -v '^$' > "$here/.accounts.tsv"
node "$root/test/paddle_billing_pg/gen-events.mjs" "$here/.accounts.tsv" > "$here/.events.sql"
out="$(P -tA -F'|' -v events="$here/.events.sql" -f "$here/suite.sql")"
echo "$out"
fails="$(echo "$out" | grep -c '|f|' || true)"; total="$(echo "$out" | grep -c '|[tf]|' || true)"
rm -f "$here/.accounts.tsv" "$here/.events.sql" "$here/.dep.err"
echo "---- $((total - fails)) passed, $fails failed of $total"
[ "$fails" = "0" ] && [ "$total" -ge 30 ]
