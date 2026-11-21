#!/usr/bin/env bash
# Disposable-Postgres proof for the dc_current_observation security_invoker repair. Exit 1 on any FAIL.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
if [ "$(id -u)" = 0 ]; then chmod -R a+rX "$here/../.." ; exec runuser -u postgres -- env PGBIN="$PGBIN" bash "$here/run.sh"; fi
d="$(mktemp -d)"; trap 'PGDATA="$d" "$PGBIN/pg_ctl" stop -m fast >/dev/null 2>&1 || true; rm -rf "$d"' EXIT
"$PGBIN/initdb" -D "$d" -U postgres >/dev/null; "$PGBIN/pg_ctl" -D "$d" -o "-p 55441 -k $d" -l "$d/log" start -w >/dev/null
P="psql -X -q -v ON_ERROR_STOP=1 -h $d -p 55441 -U postgres -d postgres"
$P -c "select 'server '||current_setting('server_version')" -At
# the AUTHORITATIVE definition is extracted from the real file, never retyped
python3 - "$here" <<'PY'
import re,sys
here=sys.argv[1]
t=open(here+"/../../docs/official-documents-map-gate.sql").read()
m=re.search(r"create or replace view public\.dc_current_observation.*?\nrevoke all on public\.dc_current_observation from anon, authenticated;\n",t,re.S)
assert m, "authoritative definition not found"
open(here+"/.new-definition.sql","w").write(m.group(0))
PY
trap 'rm -f "$here/.new-definition.sql"; PGDATA="$d" "$PGBIN/pg_ctl" stop -m fast >/dev/null 2>&1 || true; rm -rf "$d"' EXIT
$P -f "$here/fixture.sql"
set +e
out="$($P -v here="$here" -f "$here/suite.sql" 2>&1)"; rc=$?
set -e
echo "$out"
# the process status, any SQL error, any FAIL, a missing end marker, or too few checks all fail the run
[ "$rc" -eq 0 ] || { echo "FAIL suite.sql exited $rc"; exit 1; }
if echo "$out" | grep -Eq "FAIL|ERROR"; then exit 1; fi
echo "$out" | grep -q "^DONE suite complete$" || { echo "FAIL the suite did not reach its end marker"; exit 1; }
n="$(echo "$out" | grep -c "^PASS")"; [ "$n" -ge 37 ] || { echo "FAIL only $n checks ran (expected at least 37)"; exit 1; }
