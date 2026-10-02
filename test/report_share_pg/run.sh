#!/usr/bin/env bash
# Executable suite for the report share primitive (docs/report-share.sql) against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check, and applying it changes NOTHING about the snapshot or the private layer;
# 2. it applies twice with an identical result;
# 3. its ROLLBACK (the footer of the file, extracted and run) removes every object it created, with shares stored,
#    leaves the snapshot and the private layer exactly as they were, and re-applying gives exactly the first apply;
# 4. it REFUSES, creating nothing, when the snapshot table is absent;
# 5. each prohibited mutation fails >= 1 NAMED check. A mutation that makes the suite CRASH does not count as killed: a crash
#    names nothing, so it is reported and fails the run. A mutation whose anchor is missing is a harness failure, never a pass.
# The snapshot (docs/report-snapshot.sql) and the private context (docs/report-private-context.sql) are dependencies and are
# applied unmutated: they are the real ones.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="$root/docs/report-share.sql"
PRIV="$root/docs/report-private-context.sql"
SNAP="$root/docs/report-snapshot.sql"
reset_db() { P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/report_snapshot_pg/fixture.sql" >/dev/null; }
apply_deps() { reset_db; P -f "$PRIV" >/dev/null 2>&1; P -f "$SNAP" >/dev/null 2>&1; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }

# the definition a second apply must leave exactly as it found it: columns, constraints, functions (with their grants),
# tables' grants, triggers and indexes of everything this file creates
fp() { P -tA -c "select md5(
    coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') || ':' || coalesce(generation_expression, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name like 'report\\_share%'), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where conrelid::regclass::text like 'public.report\\_share%'), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.proname like 'report\\_share\\_%'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relname like 'report\\_share%' and c.relkind = 'r'), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where tgrelid::regclass::text like 'public.report\\_share%' and not tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate \"C\") from pg_indexes where tablename like 'report\\_share%'), ''))"; }

# the same, for what this file must NOT touch: the snapshot table and the whole private layer (definitions only, not rows)
dep_fp() { P -tA -c "select md5(
    coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') || ':' || coalesce(generation_expression, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and (table_name = 'report_snapshot' or table_name like 'report\\_private\\_context%')), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\")
                from pg_constraint where conrelid::regclass::text = 'public.report_snapshot' or conrelid::regclass::text like 'public.report\\_private\\_context%'), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.proname like 'report\\_snapshot\\_%' or p.proname like 'report\\_private\\_context\\_%'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where (c.relname = 'report_snapshot' or c.relname like 'report\\_private\\_context%') and c.relkind = 'r'), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where (tgrelid::regclass::text = 'public.report_snapshot' or tgrelid::regclass::text like 'public.report\\_private\\_context%') and not tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate \"C\") from pg_indexes where tablename = 'report_snapshot' or tablename like 'report\\_private\\_context%'), ''))"; }

# how many objects of this file exist: its tables, functions and (via the tables) nothing else
objects() { P -tA -c "select (select count(*) from pg_class where relname like 'report\\_share%' and relkind in ('r', 'S', 'i')) || '/' || (select count(*) from pg_proc where proname like 'report\\_share\\_%')"; }

# ---- 1. the shipped SQL passes, and touches nothing it depends on ----------------------------------------------------
apply_deps
dep0="$(dep_fp)"
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
fp1="$(fp)"; dep1="$(dep_fp)"
if [ -z "$dep0" ] || [ "$dep0" != "$dep1" ]; then echo "FAIL — applying the share file changed the snapshot or the private layer ($dep0 vs $dep1)"; exit 1; fi
echo "UNTOUCHED — the snapshot and the whole private layer have an identical definition before and after this file is applied"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 50 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped share primitive does not pass"; exit 1; fi

# ---- 2. applying it a second time is a no-op (idempotent) -------------------------------------------------------------
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(fp)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

# ---- 3. the rollback, with shares stored ------------------------------------------------------------------------------
shares="$(P -tA -c 'select count(*) from public.report_share')"
if [ "$shares" -lt 8 ]; then echo "FAIL — the rollback must be proven on a POPULATED database (found $shares shares)"; exit 1; fi
rb="$(rollback_sql "$SQL")"
if [ -z "$rb" ] || ! grep -q 'drop table if exists public.report_share_event, public.report_share;' <<<"$rb"; then echo "FAIL — no rollback footer was found in the SQL of record"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL — the rollback does not run"; exit 1; }
left="$(objects)"
depr="$(dep_fp)"
if [ "$left" != "0/0" ]; then echo "FAIL — the rollback left objects behind (tables+sequences+indexes / functions = $left)"; exit 1; fi
if [ "$depr" != "$dep0" ]; then echo "FAIL — the rollback changed the snapshot or the private layer"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL — the rollback is not repeatable (it must be safe to run twice)"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not re-apply after a rollback"; exit 1; }
fp3="$(fp)"
if [ "$fp3" != "$fp1" ]; then echo "FAIL — re-applying after a rollback differs from the first apply ($fp1 vs $fp3)"; exit 1; fi
echo "ROLLED BACK $shares shares' worth of tables: no object left, the snapshot and the private layer untouched, repeatable, and re-applying gives exactly the first apply"

# ---- 4. it refuses, creating nothing, without the snapshot table --------------------------------------------------------
reset_db
if P -f "$SQL" >/dev/null 2>"$here/.refusal.err"; then rm -f "$here/.refusal.err"; echo "FAIL — the share file APPLIED without the snapshot table"; exit 1; fi
if ! grep -q 'apply docs/report-snapshot.sql first' "$here/.refusal.err" || [ "$(objects)" != "0/0" ]; then
  rm -f "$here/.refusal.err"; echo "FAIL — the refusal without the snapshot table did not say why, or left objects behind"; exit 1
fi
rm -f "$here/.refusal.err"
echo "REFUSED without the snapshot table, saying why, and creating nothing"

# ---- 5. every prohibited mutation must fail a named check ------------------------------------------------------------------
status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp" "$here/.refusal.err"' EXIT
while IFS= read -r name; do
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$tmp"
  apply_deps
  if ! P -f "$tmp" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  crashed=0
  mout="$(suite 2>&1)" || crashed=1
  if [ "$crashed" -eq 1 ]; then
    # a suite that errors names no check: the regression would be caught by accident, so it is not accepted as a kill
    echo "CRASHED  $name — the suite errored instead of failing a named check:"; printf '%s\n' "$mout" | cut -c1-200 | sed -n '1,3s/^/    /p'; status=1; continue
  fi
  n_fail=$(grep -c '|f|' <<<"$mout" || true)
  if [ "$n_fail" -gt 0 ]; then
    # print the first four failures. NOT `| head -4`: under pipefail, head exits after four lines while cut is still
    # writing, cut dies with "Broken pipe", and the run ends. `sed -n 1,4p` reads to the end, so nothing upstream is cut off.
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$mout" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_deps
exit $status
