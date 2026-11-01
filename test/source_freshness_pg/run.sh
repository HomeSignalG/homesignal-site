#!/usr/bin/env bash
# Source freshness suite against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. concurrency, replay and rollback behave;
# 3. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
SQL="$root/docs/source-freshness.sql"; RB="$root/docs/source-freshness.rollback.sql"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_fixture() { P -f "$here/fixture_schema.sql" >/dev/null 2>&1; P -c "delete from cron.job" >/dev/null; }
apply_sql() { reset_fixture; P -f "$1" >/dev/null; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f$' <<<"$1" || true; }
status=0

apply_sql "$SQL"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 27 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped SQL does not pass"; exit 1; fi

# Replay: applying the file a second time keeps one cron job and the same rows.
before=$(P -tAc "select md5(string_agg(registry_id||'|'||coalesce(newest_record_date::text,'')||'|'||coalesce(last_success_at::text,''), ',' order by registry_id collate \"C\")) from public.dev_source_freshness")
P -f "$SQL" >/dev/null
after=$(P -tAc "select md5(string_agg(registry_id||'|'||coalesce(newest_record_date::text,'')||'|'||coalesce(last_success_at::text,''), ',' order by registry_id collate \"C\")) from public.dev_source_freshness")
jobs=$(P -tAc "select count(*) from cron.job where jobname='dev-source-freshness'")
if [ "$before" = "$after" ] && [ "$jobs" = "1" ]; then echo "PASS replay: same rows ($after), one cron job"; else echo "FAIL replay: $before -> $after, jobs $jobs"; status=1; fi

# Change: a new completed read and a newer issued record move only that source.
P -c "update public.dev_source_continuity set last_tick_at='2026-11-02 01:00+00' where zip='33333' and registry_id='src-a';
      insert into public.dev_change_project values ('a9','src-a','{\"date_kind\":\"issued\",\"submitted_at\":\"2026-10-31\"}')" >/dev/null
n=$(P -tAc "select public.dev_source_freshness_refresh()")
row=$(P -tAc "select newest_record_date||' '||last_success_at from public.dev_source_freshness where registry_id='src-a'")
if [ "$n" = "1" ] && [ "$row" = "2026-10-31 2026-11-02 01:00:00+00" ]; then echo "PASS change: only src-a rewritten ($row)"; else echo "FAIL change: n=$n row=$row"; status=1; fi

# Removal: a source neither table mentions any more is dropped.
P -c "delete from public.dev_change_project where registry_id='src-c'" >/dev/null
n=$(P -tAc "select public.dev_source_freshness_refresh()")
gone=$(P -tAc "select count(*) from public.dev_source_freshness where registry_id='src-c'")
if [ "$gone" = "0" ] && [ "$n" = "1" ]; then echo "PASS removal: src-c dropped"; else echo "FAIL removal: n=$n left=$gone"; status=1; fi

# Concurrency: while another session holds the refresh lock, a second refresh does nothing (-1).
P -c "begin; select pg_advisory_xact_lock(hashtext('public.dev_source_freshness_refresh')); select pg_sleep(4); commit;" >/dev/null &
holder=$!; sleep 1
n=$(P -tAc "select public.dev_source_freshness_refresh()")
wait "$holder"
n2=$(P -tAc "select public.dev_source_freshness_refresh()")
if [ "$n" = "-1" ] && [ "$n2" = "0" ]; then echo "PASS concurrency: overlapping run returned -1, next run 0"; else echo "FAIL concurrency: $n then $n2"; status=1; fi

# Rollback: removes all four objects; the file then applies cleanly again.
P -f "$RB" >/dev/null
left=$(P -tAc "select (select count(*) from pg_proc where proname in ('dev_source_freshness_refresh','source_freshness_for_zip'))
  + (select count(*) from pg_class where relname='dev_source_freshness') + (select count(*) from cron.job where jobname='dev-source-freshness')")
P -f "$SQL" >/dev/null
back=$(P -tAc "select count(*) from public.dev_source_freshness")
if [ "$left" = "0" ] && [ "$back" -gt 0 ]; then echo "PASS rollback: 0 objects left; re-apply restored $back rows"; else echo "FAIL rollback: left=$left back=$back"; status=1; fi

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
for m in "$here"/mutations/*.sed; do
  sed -f "$m" "$SQL" > "$tmp"
  if cmp -s "$tmp" "$SQL"; then echo "NO-OP    $(basename "$m") — the mutation did not change the file"; status=1; continue; fi
  reset_fixture; P -c "drop table if exists public.dev_source_freshness cascade" >/dev/null
  if ! P -f "$tmp" >/dev/null 2>&1; then echo "KILLED   $(basename "$m") — the file no longer applies"; continue; fi
  out="$(suite 2>&1 || true)"; n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ] || ! grep -q '|' <<<"$out"; then echo "KILLED   $(basename "$m") — $n_fail check(s) failed"
  else echo "SURVIVED $(basename "$m") — the suite cannot see this regression"; status=1; fi
done
apply_sql "$SQL"
exit $status
