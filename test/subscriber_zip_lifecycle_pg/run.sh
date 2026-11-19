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
echo "$out" | grep -q FAIL && exit 1; [ "$(echo "$out" | grep -c PASS)" -ge 13 ]
