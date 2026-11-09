#!/usr/bin/env bash
# The maps_subscriber_zips splice (docs/maps-subscriber-zips-monitor.sql) against a DISPOSABLE Postgres.
# Never point this at Supabase. PG* variables pick the server; the database is created fresh.
#
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash test/maps_subscriber_zips_monitor_pg/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
mig="$root/docs/maps-subscriber-zips-monitor.sql"
live_md5=3ac532673a460298b7cae95e7f21be97          # the live body the migration was written against
db="${HEALTH_MAPS_SUBS_PG_DB:-health_maps_subs_disposable}"

case "${PGHOST:-}" in *supabase*) echo "ABORT: PGHOST points at Supabase"; exit 1 ;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "ABORT: a Supabase credential is set; this suite only ever addresses a disposable server"; exit 1
fi
grep -q "$live_md5" "$mig" || { echo "FAIL: the migration no longer names the live body md5 $live_md5"; exit 1; }

fresh() { psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db"; }
fresh
q() { psql -X -q -d "$db" -v ON_ERROR_STOP=1 "$@"; }
load() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$db" -v ON_ERROR_STOP=1 "$@"; }
body_md5() { q -Atc "select md5(prosrc) from pg_proc where oid = 'public.pipeline_health_tick()'::regprocedure"; }
attrs() {
  q -Atc "select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                           array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                           pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
            from pg_proc p where p.oid = 'public.pipeline_health_tick()'::regprocedure"
}
load_base() {
  load -f "$root/test/maps_zip_order_subscribers_pg/fixture.sql"
  load -f "$root/docs/maps-zip-order-subscriber-zips.sql"
  load -f "$here/fixture.sql"
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
load_base
stand_in="$(body_md5)"; before_attrs="$(attrs)"
migration_for_current_body
q -f "$tmp/mig.sql" 2>"$tmp/notice.txt"
after="$(body_md5)"
[ "$after" != "$stand_in" ] || { echo "FAIL M01 -- the splice changed nothing"; exit 1; }
[ "$(attrs)" = "$before_attrs" ] || { echo "FAIL M01 -- owner, grants or settings changed"; exit 1; }
grep -q "maps_subscriber_zips added" "$tmp/notice.txt" || { echo "FAIL M01 -- no success notice: $(cat "$tmp/notice.txt")"; exit 1; }
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
  fresh; load_base
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
mutate "14 days instead of 7"                      "z.real_since < _now - interval '7 days' and not z.posted) as n_stale" "z.real_since < _now - interval '14 days' and not z.posted) as n_stale"
mutate "a missing ZIP passes"                       "(m.n_trig = 2 and m.n_missing = 0 and m.n_stale = 0)" "(m.n_trig = 2 and m.n_stale = 0)"
mutate "a missing trigger passes"                   "(m.n_trig = 2 and m.n_missing = 0 and m.n_stale = 0)" "(m.n_missing = 0 and m.n_stale = 0)"
mutate "any status counts as published"             "p.content_family = 'MAPS' and p.status = 'published' and p.zip = g.zip" "p.content_family = 'MAPS' and p.zip = g.zip"
mutate "withdrawn posts count"                      "and not exists (select 1 from public.social_post_withdrawals w" "and true or exists (select 1 from public.social_post_withdrawals w"
mutate "any family counts"                          "p.content_family = 'MAPS' and p.status = 'published' and p.zip = g.zip" "p.status = 'published' and p.zip = g.zip"
mutate "test subscribers page too"                  "filter (where u.referral_source is distinct from 'admin_test') as real_since" "as real_since"
mutate "unsubscribed people are watched"            "where s.stream = 'maps' and s.subscribed" "where s.stream = 'maps'"
mutate "not alertable"                              "(m.n_trig = 2 and m.n_missing = 0 and m.n_stale = 0),
           true," "(m.n_trig = 2 and m.n_missing = 0 and m.n_stale = 0),
           false,"
mutate "no wrapper: a broken check kills the monitor" "  exception when others then" "  exception when no_data_found then"

echo "ALL PASS"
