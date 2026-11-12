#!/usr/bin/env bash
# docs/dc-source-freshness.sql against a DISPOSABLE Postgres. Never point this at Supabase.
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash test/dc_source_freshness_pg/run.sh
# The shipped SQL must pass; it must apply twice; every prohibited mutation must FAIL the suite.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
sqlf="$root/docs/dc-source-freshness.sql"
db="${DC_SOURCE_FRESHNESS_PG_DB:-dc_source_freshness_disposable}"

case "${PGHOST:-}" in *supabase*) echo "ABORT: PGHOST points at Supabase"; exit 1 ;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "ABORT: a Supabase credential is set; this suite only ever addresses a disposable server"; exit 1
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

run_suite() {  # $1 = SQL file to apply; prints the suite output, returns its status
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db" >/dev/null
  PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/fixture.sql" -f "$1" -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err"; return 1; }
  out="$(psql -X -q -At -d "$db" -f "$here/suite.sql" 2>&1)" || { echo "$out"; return 1; }
  echo "$out"
  grep -q '^SUITE PASS 13$' <<<"$out"
}

if run_suite "$sqlf" > "$tmp/shipped"; then
  grep -E '\|t\|' "$tmp/shipped" | sed 's/|t|.*//; s/^/PASS /'
  echo "SHIPPED: 13 checks pass; the file applies twice"
else
  cat "$tmp/shipped"; echo "FAIL: the shipped SQL does not pass"; exit 1
fi

mutate() {  # $1 label  $2 python expression transforming s
  python3 - "$sqlf" "$tmp/m.sql" "$2" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
m = eval(sys.argv[3])
if m == s:
    print("NO-OP"); sys.exit(3)
open(sys.argv[2], 'w', encoding='utf-8').write(m)
PY
  rc=$?
  if [ $rc -eq 3 ]; then echo "NO-OP $1 -- the mutation changed nothing"; exit 1; fi
  if run_suite "$tmp/m.sql" > "$tmp/mout" 2>&1; then echo "SURVIVED $1"; exit 1; else echo "KILLED $1"; fi
}
set +e
mutate "X1 the edition date is our own read time"            "s.replace('ok.completed_at as ok_at, ok.source_declared_freshness as edition_at', 'ok.completed_at as ok_at, ok.completed_at as edition_at')"; r1=$?
mutate "X2 the newest attempt is the newest SUCCESS"          "s.replace('''order by r.started_at desc limit 1) nw on true''', '''and r.completeness_state = 'SUCCESS_COMPLETE' order by r.started_at desc limit 1) nw on true''')"; r2=$?
mutate "X3 a NOT_ACTIVE source is reported"                   "s.replace('''where s.active_state = 'ACTIVE\\'''', 'where true')"; r3=$?
mutate "X4 a healthy distribution hides a failed one"         "s.replace('order by x.source_key, x.nw_bad desc, x.nw_at desc', 'order by x.source_key, x.nw_at desc')"; r4=$?
mutate "X5 last success is the NEWER distribution"            "s.replace('else min(x.ok_at) end', 'else max(x.ok_at) end')"; r5=$?
mutate "X6 a never-read distribution is ignored"              "s.replace('case when bool_or(x.ok_at is null) then null else min(x.ok_at) end', 'min(x.ok_at)')"; r6=$?
mutate "X7 anon cannot run the reader"                        "s.replace('to anon, authenticated, service_role', 'to service_role')"; r7=$?
mutate "X8 PUBLIC keeps execute"                              "s.replace('revoke all on function public.dc_source_freshness() from public;', '')"; r8=$?
mutate "X9 not security definer (anon cannot read the tables)" "s.replace('security definer\n', '')"; r9=$?
mutate "X10 an open run reads as nothing"                     "s.replace('''coalesce(nw.completeness_state, 'IN_FLIGHT')''', 'nw.completeness_state')"; r10=$?
set -e
[ $((r1+r2+r3+r4+r5+r6+r7+r8+r9+r10)) -eq 0 ] || exit 1
echo "ALL 10 MUTATIONS KILLED"
