#!/usr/bin/env bash
# The dc_acquisitions splice (docs/dc-acquisitions-monitor.sql) against a DISPOSABLE Postgres.
# Never point this at Supabase. PG* variables pick the server; the database is created fresh.
#
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash test/dc_acquisitions_monitor_pg/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
mig="$root/docs/dc-acquisitions-monitor.sql"
live_md5=7f307c9cb6357e1c1bcafd21fbd9e58c          # the live body the migration was written against
db="${HEALTH_DC_ACQ_PG_DB:-health_dc_acq_disposable}"

case "${PGHOST:-}" in *supabase*) echo "ABORT: PGHOST points at Supabase"; exit 1 ;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "ABORT: a Supabase credential is set; this suite only ever addresses a disposable server"; exit 1
fi
grep -q "$live_md5" "$mig" || { echo "FAIL: the migration no longer names the live body md5 $live_md5"; exit 1; }

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db"
q() { psql -X -q -d "$db" -v ON_ERROR_STOP=1 "$@"; }
load() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$db" -v ON_ERROR_STOP=1 "$@"; }
body_md5() { q -Atc "select md5(prosrc) from pg_proc where oid = 'public.pipeline_health_tick()'::regprocedure"; }
attrs() {
  q -Atc "select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                           array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                           pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
            from pg_proc p where p.oid = 'public.pipeline_health_tick()'::regprocedure"
}
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
migration_for_current_body() { sed "s/$live_md5/$(body_md5)/g" "${1:-$mig}" > "$tmp/mig.sql"; }
expect_refusal() {  # $1 label  $2 expected error text
  local before; before="$(body_md5)"
  if out="$(q -f "$tmp/mig.sql" 2>&1)"; then echo "FAIL $1 -- it applied; expected a refusal"; exit 1; fi
  grep -qF "$2" <<<"$out" || { echo "FAIL $1 -- wrong error: $out"; exit 1; }
  [ "$(body_md5)" = "$before" ] || { echo "FAIL $1 -- it refused but the function changed"; exit 1; }
  echo "PASS $1 -- refused, function untouched: $2"
}

# ------------------------------------------------------------------------------ the splice
load -f "$here/fixture.sql"
stand_in="$(body_md5)"; before_attrs="$(attrs)"
migration_for_current_body
q -f "$tmp/mig.sql" 2>"$tmp/notice.txt"
after="$(body_md5)"
[ "$after" != "$stand_in" ] || { echo "FAIL M01 -- the splice changed nothing"; exit 1; }
[ "$(attrs)" = "$before_attrs" ] || { echo "FAIL M01 -- owner, grants or settings changed"; exit 1; }
grep -q "dc_acquisitions added" "$tmp/notice.txt" || { echo "FAIL M01 -- no success notice: $(cat "$tmp/notice.txt")"; exit 1; }
echo "PASS M01 -- applied once: body md5 $stand_in -> $after; owner, grants and settings unchanged"

q -f "$tmp/mig.sql" 2>"$tmp/notice.txt"
[ "$(body_md5)" = "$after" ] || { echo "FAIL M02 -- a second apply changed the function"; exit 1; }
grep -q "already present" "$tmp/notice.txt" || { echo "FAIL M02 -- no no-op notice"; exit 1; }
echo "PASS M02 -- a second apply does nothing"

sed 's/stands for the checks/stands for the drifted checks/' "$here/fixture.sql" | load
expect_refusal "M03 a body that drifted since it was read" "pipeline_health_tick drifted"

sed 's/^  return query select/  -- insert into public.pipeline_health_check as c (\n  return query select/' "$here/fixture.sql" | load
migration_for_current_body
expect_refusal "M04 the anchor appears twice" "appears 2 time(s)"

# ------------------------------------------------------------------------------ the check
run_suite() {  # $1 migration file; prints the suite output and returns its status
  load -f "$here/fixture.sql"
  migration_for_current_body "$1"
  q -f "$tmp/mig.sql" 2>/dev/null
  q -f "$here/suite.sql" 2>&1 | sed -n -e 's/^.*NOTICE:  //p' -e 's/^.*ERROR:  //p'
}
out="$(run_suite "$mig")"
echo "$out"
n="$(grep -c '^PASS S' <<<"$out" || true)"
! grep -q '^FAIL' <<<"$out" || { echo "FAIL -- a scenario failed"; exit 1; }
[ "$n" -ge 14 ] || { echo "FAIL -- only $n scenarios reported PASS; the suite did not run"; exit 1; }

# ------------------------------------------------------------------------------ mutations
# Each breaks one thing in a copy of the migration and requires the suite to notice. A suite
# that cannot fail proves nothing.
mutate() {  # $1 label  $2 old  $3 new
  python3 -I - "$mig" "$tmp/mut.sql" "$2" "$3" <<'PY' || { echo "FAIL mutation '$1' did not apply"; exit 1; }
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src, encoding="utf-8").read()
assert s.count(old) == 1, ("mutation target not found exactly once", old)
open(dst, "w", encoding="utf-8").write(s.replace(old, new))
PY
  if res="$(run_suite "$tmp/mut.sql" 2>&1)" && ! grep -q '^FAIL' <<<"$res"; then
    echo "FAIL mutation '$1' SURVIVED -- the suite did not notice"; exit 1
  fi
  echo "PASS mutation '$1' killed"
}
mutate "48 hours instead of 30"                      "or ok.completed_at < _now - interval '30 hours'" "or ok.completed_at < _now - interval '48 hours'"
mutate "a failed newest run is ignored"              "(nw.completeness_state is distinct from 'SUCCESS_COMPLETE'" "(false"
mutate "an open run fails at once"                   "or nw.started_at < _now - interval '2 hours'" "or true"
mutate "inactive sources are watched too"            "where s.active_state = 'ACTIVE') d" "where true) d"
mutate "only the first distribution is watched"      "unnest(s.distributions) as distribution_key" "s.distributions[1] as distribution_key"
mutate "a success of any distribution counts"        "where r.source_key = d.source_key and r.distribution_key = d.distribution_key
                                            and r.completeness_state" "where r.source_key = d.source_key
                                            and r.completeness_state"
mutate "no source at all passes"                     "(s.n_bad = 0 and s.n_dist > 0)" "(s.n_bad = 0)"
mutate "not alertable"                               "           true,
           case when s.n_dist = 0" "           false,
           case when s.n_dist = 0"
mutate "no wrapper: a broken check kills the monitor" "  exception when others then" "  exception when no_data_found then"

echo "ALL PASS"
