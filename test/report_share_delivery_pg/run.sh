#!/usr/bin/env bash
# Executable suite for the report share delivery layer (docs/report-share-delivery.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved-reports functions and share primitive,
# applied unmutated.
# 1. the shipped SQL passes every check of suite.sql, and applying it changes NOTHING about the layers it stands on;
# 2. REAL concurrent sessions: two callers racing for the last of a report's 25 places - exactly one wins and the other is refused
#    SHARE_LIMIT_REACHED - and a create under REPEATABLE READ is refused (55000) rather than counted on a stale snapshot;
# 3. it applies twice with an identical result;
# 4. its ROLLBACK (the footer of the file, extracted and run) removes the six functions it created, with shares stored, leaves the
#    primitive (its tables, rows and functions) exactly as it was, and re-applying gives exactly the first apply;
# 5. it REFUSES, creating nothing, when the share primitive is absent;
# 6. each prohibited mutation fails >= 1 NAMED check (of suite.sql or of the scenarios above). A mutation that makes the suite CRASH does
#    not count as killed: a crash names nothing, so it is reported and fails the run. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="$root/docs/report-share-delivery.sql"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports)
SHARE="$root/docs/report-share.sql"
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() {
  for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>&1 || { echo "FAIL - docs/$f.sql does not apply"; exit 1; }; done
  P -f "$SHARE" >/dev/null 2>&1 || { echo "FAIL - docs/report-share.sql does not apply"; exit 1; }
}
apply_base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }

MINE="('report_share_lifetime','report_share_limit','evaluation_report_share_create','evaluation_report_shares_of','evaluation_report_share_revoke','report_share_open')"
# the definition and privileges of this file's six functions
fp_mine() { P -tA -c "select md5(coalesce(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\"), ''))
                         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in $MINE"; }
# everything this file stands on and must not touch: every OTHER function in public (with its privileges) and every table's columns and privileges
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\")
                from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in $MINE), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal), ''))"; }
n_mine() { P -tA -c "select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in $MINE"; }

# ---- the real-session scenarios (they run on the data the suite left behind) --------------------------------------------------
U1='a0000000-0000-4000-8000-000000000001'
scenarios() {
  local a3; a3="$(P -tA -c "select c.report_id from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Acme Realty' and c.ordinal = 3")"
  [ -n "$a3" ] || { echo "SCENARIOS|f|the report to race for was not found"; return; }
  # bring the report to 24 links (the suite left it with one)
  P -c "do \$\$ declare n int; begin select count(*) into n from public.report_share where report_id = '$a3'; while n < 24 loop
          perform public.report_share_create('$a3', encode(sha256(convert_to('race-fill-' || n, 'UTF8')), 'hex'), null); n := n + 1; end loop; end \$\$" >/dev/null
  local hA hB hC
  hA="$(printf 'race-A' | sha256sum | cut -d' ' -f1)"; hB="$(printf 'race-B' | sha256sum | cut -d' ' -f1)"; hC="$(printf 'race-C' | sha256sum | cut -d' ' -f1)"
  # session 1 takes the last place and holds its transaction open; session 2 asks for it while that is uncommitted
  local o1 o2
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'won' from public.evaluation_report_share_create('$U1', '$a3', '$hA');
select pg_sleep(2.5);
commit;
SQL
  ) &
  local bg=$!
  sleep 0.8
  P -tA -c "select 'won' from public.evaluation_report_share_create('$U1', '$a3', '$hB')" >"$o2" 2>&1 || true
  wait "$bg" || true
  local total; total="$(P -tA -c "select count(*) from public.report_share where report_id = '$a3'")"
  local w1 w2; w1="$(grep -c '^won$' "$o1" || true)"; w2="$(grep -c '^won$' "$o2" || true)"
  if [ "$w1" = "1" ] && [ "$w2" = "0" ] && grep -q 'SHARE_LIMIT_REACHED' "$o2" && [ "$total" = "25" ]; then
    echo "RACE|t|two callers raced for the 25th place: one won, the other was refused SHARE_LIMIT_REACHED, and the report holds exactly 25 ($total)"
  else
    echo "RACE|f|won=$w1/$w2 total=$total; second session said: $(tr '\n' ' ' <"$o2" | cut -c1-160)"
  fi
  rm -f "$o1" "$o2"
  # at REPEATABLE READ the count could be taken on a stale snapshot: the function refuses instead
  local rc; rc="$(psql -X -q -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -tA 2>&1 <<SQL
begin isolation level repeatable read;
select * from public.evaluation_report_share_create('$U1', '$a3', '$hC');
rollback;
SQL
)"
  local after; after="$(P -tA -c "select count(*) from public.report_share where report_id = '$a3'")"
  if grep -q '55000' <<<"$rc" && grep -q 'READ COMMITTED' <<<"$rc" && [ "$after" = "$total" ]; then
    echo "REPEATABLE_READ|t|a create under REPEATABLE READ is refused (55000) and stores nothing"
  else
    echo "REPEATABLE_READ|f|after=$after total=$total; said: $(tr '\n' ' ' <<<"$rc" | cut -c1-160)"
  fi
}

# ---- 1. the shipped SQL passes, and touches nothing it depends on ----------------------------------------------------------------
apply_base
dep0="$(fp_deps)"
[ "$(n_mine)" = "0" ] || { echo "FAIL - the six functions exist before the file is applied"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record does not apply"; exit 1; }
dep1="$(fp_deps)"; mine1="$(fp_mine)"
if [ -z "$dep0" ] || [ "$dep0" != "$dep1" ]; then echo "FAIL - applying the delivery file changed something it stands on ($dep0 vs $dep1)"; exit 1; fi
echo "UNTOUCHED - every other function, table, privilege and trigger has an identical definition before and after this file is applied"
out="$(suite)"; echo "$out" | sed 's/^/  /' | cut -c1-230
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 40 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL - the shipped delivery layer does not pass"; exit 1; fi

# ---- 2. real sessions ---------------------------------------------------------------------------------------------------------
sc="$(scenarios)"; echo "$sc" | sed 's/^/  /'
if [ "$(grep -c '|t|' <<<"$sc" || true)" -ne 2 ] || grep -q '|f|' <<<"$sc"; then echo "FAIL - the real-session scenarios do not pass"; exit 1; fi

# ---- 3. applying it a second time is a no-op ----------------------------------------------------------------------------------
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record is not idempotent"; exit 1; }
mine2="$(fp_mine)"; dep2="$(fp_deps)"
if [ -z "$mine1" ] || [ "$mine1" != "$mine2" ] || [ "$dep0" != "$dep2" ]; then echo "FAIL - a second apply changed a definition"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

# ---- 4. the rollback, with shares stored -----------------------------------------------------------------------------------------
shares="$(P -tA -c 'select count(*) from public.report_share')"
events="$(P -tA -c 'select count(*) from public.report_share_event')"
if [ "$shares" -lt 50 ]; then echo "FAIL - the rollback must be proven on a POPULATED database (found $shares shares)"; exit 1; fi
rb="$(rollback_sql "$SQL")"
if [ -z "$rb" ] || ! grep -q 'drop function if exists public.report_share_open(text)' <<<"$rb"; then echo "FAIL - no rollback footer was found in the SQL of record"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback does not run"; exit 1; }
if [ "$(n_mine)" != "0" ]; then echo "FAIL - the rollback left some of the six functions behind"; exit 1; fi
if [ "$(P -tA -c 'select count(*) from public.report_share')" != "$shares" ] || [ "$(P -tA -c 'select count(*) from public.report_share_event')" != "$events" ]; then echo "FAIL - the rollback changed the stored shares"; exit 1; fi
if [ "$(fp_deps)" != "$dep0" ]; then echo "FAIL - the rollback changed the primitive or a layer beneath it"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback is not repeatable (it must be safe to run twice)"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record does not re-apply after a rollback"; exit 1; }
if [ "$(fp_mine)" != "$mine1" ]; then echo "FAIL - re-applying after a rollback differs from the first apply"; exit 1; fi
echo "ROLLED BACK with $shares shares stored: the six functions gone, every share and event row and every other object untouched, repeatable, and re-applying gives exactly the first apply"

# ---- 5. it refuses, creating nothing, without the share primitive ----------------------------------------------------------------------
reset_db
for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>&1; done
if P -f "$SQL" >/dev/null 2>"$here/.refusal.err"; then rm -f "$here/.refusal.err"; echo "FAIL - the delivery file APPLIED without the share primitive"; exit 1; fi
if ! grep -q 'report_share_delivery: apply docs/report-share.sql' "$here/.refusal.err" || [ "$(n_mine)" != "0" ]; then
  rm -f "$here/.refusal.err"; echo "FAIL - the refusal without the share primitive did not say why, or left functions behind"; exit 1
fi
rm -f "$here/.refusal.err"
echo "REFUSED without the share primitive, saying why, and creating nothing"

# ---- 6. every prohibited mutation must fail a named check -----------------------------------------------------------------------------------
status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp" "$here/.refusal.err"' EXIT
while IFS= read -r name; do
  if [ -n "${MUTATION_FILTER:-}" ] && ! [[ "$name" =~ $MUTATION_FILTER ]]; then continue; fi
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name - anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$tmp"
  apply_base
  if ! P -f "$tmp" >/dev/null 2>&1; then echo "HARNESS  $name - the mutated SQL did not apply"; status=1; continue; fi
  crashed=0
  mout="$(suite 2>&1)" || crashed=1
  if [ "$crashed" -eq 1 ]; then
    # a suite that errors names no check: the regression would be caught by accident, so it is not accepted as a kill
    echo "CRASHED  $name - the suite errored instead of failing a named check:"; printf '%s\n' "$mout" | cut -c1-200 | sed -n '1,3s/^/    /p'; status=1; continue
  fi
  mout="$mout"$'\n'"$(scenarios 2>&1)"
  n_fail=$(grep -c '|f|' <<<"$mout" || true)
  if [ "$n_fail" -gt 0 ]; then
    # NOT `| head -4`: under pipefail head exits while cut is still writing and the run ends. `sed -n 1,4p` reads to the end.
    echo "KILLED   $name - $n_fail check(s) failed:"; { grep '|f|' <<<"$mout" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name - the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
