#!/usr/bin/env bash
# Executable suite for the durable report snapshot (docs/report-snapshot.sql) against a
# DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice with an identical result;
# 3. it UPGRADES the exact Order F table that is live in production (test/report_snapshot_pg/f1_applied.sql)
#    to a shape identical to a fresh install, and REFUSES, changing nothing, when a report is stored;
# 4. each prohibited mutation fails >= 1 check (mutations named upgrade_* are judged by step 3).
# The private-context layer (docs/report-private-context.sql) is a dependency and is applied unmutated.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() { P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$here/fixture.sql" >/dev/null; }
apply_base() { reset_db; P -f "$PRIV" >/dev/null 2>&1; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/report-snapshot.sql"
PRIV="$root/docs/report-private-context.sql"
F1="$here/f1_applied.sql"

# the definition a second apply (or an upgrade) must leave exactly as a fresh install has it
fp() { P -tA -c "select md5(
    coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') || ':' || coalesce(generation_expression, '-'), ',' order by column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot'), '')
  || coalesce((select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname collate \"C\") from pg_constraint where conrelid = 'public.report_snapshot'::regclass), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid), ',' order by p.proname collate \"C\") from pg_proc p where p.proname like 'report\\_snapshot\\_%'), '')
  || coalesce((select string_agg(a.proname || coalesce(a.proacl::text, ''), ',' order by a.proname collate \"C\") from pg_proc a where a.proname like 'report\\_snapshot\\_%'), '')
  || coalesce((select relacl::text from pg_class where oid = 'public.report_snapshot'::regclass), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where tgrelid = 'public.report_snapshot'::regclass and not tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate \"C\") from pg_indexes where tablename = 'report_snapshot'), ''))"; }
columns() { P -tA -c "select string_agg(column_name, ',' order by column_name collate \"C\") from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot'"; }

# Steps 2 and 3 for one candidate file. Prints what failed; returns non-zero if anything did.
upgrade_checks() {
  local f="$1" bad=0 fresh up up2 before after
  apply_base; P -f "$f" >/dev/null 2>&1 || { echo "  HARNESS — the file does not apply to an empty database"; return 3; }
  fresh="$(fp)"
  # (a) the empty Order F table, exactly as it is in production, upgrades to the fresh shape
  reset_db; P -f "$F1" >/dev/null 2>&1; P -f "$PRIV" >/dev/null 2>&1
  if ! P -f "$f" >/dev/null 2>&1; then echo "  U1 the upgrade of the empty Order F table did not apply"; return 1; fi
  up="$(fp)"
  if [ "$up" != "$fresh" ]; then echo "  U1 the upgraded table differs from a fresh install"; bad=1; fi
  # (b) and a second apply changes nothing
  if ! P -f "$f" >/dev/null 2>&1; then echo "  U2 the upgraded database does not re-apply"; return 1; fi
  up2="$(fp)"
  if [ "$up" != "$up2" ]; then echo "  U2 a second apply changed the upgraded definition"; bad=1; fi
  # (c) the Order F table holding a stored report is REFUSED and left exactly as it was
  reset_db; P -f "$F1" >/dev/null 2>&1; P -f "$PRIV" >/dev/null 2>&1
  P -c "select * from public.report_snapshot_issue('{\"a\":1}', '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862', 'nyc-v1', '{\"address\":\"1 Centre Street\"}'::jsonb, 'nyc:1')" >/dev/null 2>&1 \
    || { echo "  HARNESS — could not store a report in the Order F table"; return 3; }
  before="$(P -tA -c "select md5(string_agg(row_to_json(s)::text, ',')) from public.report_snapshot s")"
  if P -f "$f" >/dev/null 2>&1; then echo "  U3 the upgrade SUCCEEDED on a table holding a stored report"; bad=1; fi
  after="$(P -tA -c "select md5(string_agg(row_to_json(s)::text, ',')) from public.report_snapshot s" 2>/dev/null || echo gone)"
  if [ "$before" != "$after" ] || [ "$(P -tA -c 'select count(*) from public.report_snapshot' 2>/dev/null || echo 0)" != "1" ]; then echo "  U3 the stored report changed or vanished"; bad=1; fi
  case ",$(columns)," in *,inputs,*) ;; *) echo "  U3 the refused upgrade still dropped the inputs column"; bad=1;; esac
  case ",$(columns)," in *,property_key,*) ;; *) echo "  U3 the refused upgrade still dropped the property_key column"; bad=1;; esac
  return $bad
}

apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
fp1="$(fp)"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 55 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped snapshot table does not pass"; exit 1; fi

# applying the file a second time must be a no-op (idempotent): same columns, constraints, functions, grants, triggers
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(fp)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

if upgrade_checks "$SQL"; then
  echo "UPGRADED the Order F table to an identical shape, and REFUSED a table holding a stored report"
else
  echo "FAIL — the upgrade path"; exit 1
fi

status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
while IFS= read -r name; do
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$tmp"
  case "$name" in
    upgrade_*)
      rc=0; msg="$(upgrade_checks "$tmp" 2>&1)" || rc=$?
      if [ "$rc" -eq 3 ]; then echo "HARNESS  $name — $msg"; status=1
      elif [ "$rc" -ne 0 ]; then echo "KILLED   $name — the upgrade path failed:"; echo "$msg" | sed 's/^/    /' | head -3
      else echo "SURVIVED $name — the upgrade checks cannot see this regression"; status=1; fi
      continue;;
  esac
  apply_base
  if ! P -f "$tmp" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  # a mutation that makes the suite ERROR is caught too: an error is a failed check
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    # print the first four failures. NOT `| head -4`: under pipefail, head exits after four lines while
    # cut is still writing, cut dies with "Broken pipe", and the run ends (measured: 80 of 1,500 runs).
    # `sed -n 1,4p` reads to the end, so nothing upstream is ever cut off.
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
