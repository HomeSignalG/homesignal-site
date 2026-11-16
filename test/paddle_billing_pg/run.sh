#!/usr/bin/env bash
# Executable suite for docs/paddle-billing.sql against a DISPOSABLE Postgres (never production). Stands on the REAL layers brokerage-billing.sql stands on,
# applied unmutated (the free limit under test is 10, exactly as test/brokerage_billing_pg does), then brokerage-billing.sql, then paddle-billing.sql.
# 1. suite.sql passes every check (checkout of both plans, partner eligibility, six monthly allotments, expiry, refunds, replays, out-of-order, test-mode);
# 2. applying paddle-billing.sql twice gives an identical result;
# 3. its ROLLBACK block runs and the file re-applies.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}${PADDLE_API_KEY:-}" ]; then echo "ABORT: a credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
. "$root/test/lib/docsql.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing)
P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null
for f in "${DEPS[@]}"; do P -f "$(docsql "$f")" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done
rm -f "$here/.dep.err"
SQL="$root/docs/paddle-billing.sql"
P -f "$SQL" >/dev/null || { echo "FAIL - paddle-billing.sql does not apply"; exit 1; }
fp() { P -tA -c "select md5(coalesce((select string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text collate \"C\") from pg_proc p where p.pronamespace='public'::regnamespace),'')||coalesce((select string_agg(table_name||column_name||data_type,',' order by table_name collate \"C\",column_name collate \"C\") from information_schema.columns where table_schema='public'),''))"; }
A=$(fp); P -f "$SQL" >/dev/null; B=$(fp)
[ "$A" = "$B" ] && echo "PASS 2 applies twice with an identical result" || { echo "FAIL 2 second apply changed the schema"; exit 1; }
out=$(P -tA -F'|' -f "$here/suite.sql"); echo "$out"
echo "$out" | grep -q '^FAIL' && { echo "SUITE FAILED"; exit 1; }
n=$(echo "$out" | grep -c '^PASS' || true); [ "$n" -ge 30 ] || { echo "FAIL fewer than 30 checks ran ($n)"; exit 1; }
# rollback runs, and re-apply works
sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$SQL" | sed '1d;$d' | sed 's/^-- //' | P -f - >/dev/null || { echo "FAIL 3 rollback does not run"; exit 1; }
P -f "$SQL" >/dev/null && echo "PASS 3 rollback runs and the file re-applies"
echo "ALL PASSED ($n suite checks)"
