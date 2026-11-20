#!/usr/bin/env bash
# Disposable Postgres proof of docs/subscriber-zip-lifecycle.sql. Exit 1 on any FAIL.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
if [ "$(id -u)" = 0 ]; then chmod -R a+rX "$here/../.." ; exec runuser -u postgres -- env PGBIN="$PGBIN" bash "$here/run.sh"; fi
d="$(mktemp -d)"; trap 'PGDATA="$d" "$PGBIN/pg_ctl" stop -m fast >/dev/null 2>&1 || true; rm -rf "$d"' EXIT
"$PGBIN/initdb" -D "$d" -U postgres >/dev/null; "$PGBIN/pg_ctl" -D "$d" -o "-p 55439 -k $d" -l "$d/log" start -w >/dev/null
P="psql -X -q -h $d -p 55439 -U postgres -d postgres"
$P -f "$here/fixture.sql"; $P -f "$here/../../docs/subscriber-zip-lifecycle.sql"
out="$($P -f "$here/suite.sql" 2>&1 || true)"; echo "$out"
# CONCURRENCY (two real sessions): a second run while the lock is held must skip, then run normally after release
$P -c "select pg_advisory_lock(public._hs_lifecycle_lock_key()); select pg_sleep(6);" >/dev/null 2>&1 &
holder=$!; sleep 2
sk="$($P -At -c "select public.subscriber_zip_lifecycle_sync()->>'status'")"
cnt="$($P -At -c "select count(*) from public.subscriber_zip_lifecycle_run where status='skipped'")"
wait $holder
ok2="$($P -At -c "select public.subscriber_zip_lifecycle_sync()->>'status'")"
[ "$sk" = skipped ] && [ "$cnt" = 1 ] && echo "PASS C1 a concurrent run skips and is logged (not silent)" || { echo "FAIL C1 got status=$sk skipped_rows=$cnt"; exit 1; }
[ "$ok2" = success ] && echo "PASS C2 after the lock is released the next run executes normally" || { echo "FAIL C2 got $ok2"; exit 1; }
if echo "$out" | grep -q "FAIL"; then exit 1; fi
exit 0
