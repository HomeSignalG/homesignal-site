#!/usr/bin/env bash
# THE MIGRATION OF THE FREE ALLOWANCE, 10 -> 100 (docs/free-report-limit-100.sql), against DISPOSABLE Postgres databases (never production).
#
# It starts from the entitlement exactly as production holds it today (evaluation-entitlement-before.sql: a frozen copy of docs/evaluation-entitlement.sql
# at limit 10; production read 2026-10-15: limit 10, 3 evaluations, one complete at 10 used, 0 paid credits), builds real usage, applies the migration, proves:
#   1. usage is PRESERVED: no ledger row is written, changed or deleted (a fingerprint of the ledger is identical before and after);
#   2. remaining = 100 - used: 3 used -> 97 left, 0 used -> 100 left, and the evaluation that COMPLETED at 10 is reopened (active, 90 left);
#   3. the reopened brokerage makes exactly 90 more reports, report 100 completes it, and the 101st is refused EVALUATION_COMPLETE;
#   4. the audit (evaluation_check) reads zero on every invariant, beside controls that are not zero;
#   5. applying it a second time changes nothing;
#   6. the result EQUALS a fresh install of the new SQL of record (docs/evaluation-entitlement.sql, limit 100);
#   7. it REFUSES, changing nothing, when a paid credit exists or when the live limit is neither 10 nor 100;
#   8. the guard that makes 'complete' terminal is back ON after the migration (a complete evaluation still cannot be reopened by anyone else).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
DB_A="$PGDATABASE"; DB_B="${PGDATABASE}_fresh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
PA() { PGDATABASE="$DB_A" P "$@"; }
PB() { PGDATABASE="$DB_B" P "$@"; }
MIG="$root/docs/free-report-limit-100.sql"; NEW="$root/docs/evaluation-entitlement.sql"; OLD="$here/evaluation-entitlement-before.sql"
fails=0; n=0
ok() { n=$((n+1)); if [ "$1" = "1" ]; then echo "PASS — $2"; else fails=$((fails+1)); echo "FAIL — $2 ${3:+[$3]}"; fi; }
mkdb() { psql -X -q -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null; }
mkdb "$DB_B"

base() {   # $1 = psql function for the database, $2 = entitlement file
  local run="$1" f
  $run -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
  $run -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null
  for f in brokerage-account-spine report-private-context report-snapshot; do $run -f "$root/docs/$f.sql" >/dev/null 2>&1 || { echo "FAIL — docs/$f.sql does not apply"; exit 1; }; done
  $run -f "$2" >/dev/null 2>&1 || { echo "FAIL — $2 does not apply"; exit 1; }
}
uid() { printf 'f%07d-0000-4000-8000-%012d' "$1" "$2"; }
# one evaluation with one owner who makes $3 reports (keys are random uuids derived from the evaluation number)
mk_eval() {   # $1 = psql function, $2 = n, $3 = reports to make
  local run="$1" u; u="$(uid 5 "$2")"
  $run -c "insert into auth.users (id, email) values ('$u', 'p$2@example.test') on conflict do nothing" >/dev/null
  $run -c "do \$\$ declare t text; begin
      select owner_token into t from public.evaluation_create('Brokerage $2');
      perform public.evaluation_invite_redeem(t, '$u');
      for n in 1..$3 loop
        perform public.evaluation_report_issue('$u', md5('k$2' || n)::uuid, '{\"n\":' || n || '}', encode(sha256(convert_to('{\"n\":' || n || '}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null);
      end loop;
    end \$\$" >/dev/null
}
ledger_fp() { PGDATABASE="$1" P -tA -c "select count(*) || ':' || coalesce(md5(string_agg(evaluation_id::text || ',' || ordinal || ',' || idempotency_key::text || ',' || report_id::text, ';' order by evaluation_id::text collate \"C\", ordinal)), '-') from public.evaluation_credit"; }
usage() { PGDATABASE="$DB_A" P -tA -F' ' -c "select credits_used, credits_remaining, status from public.evaluation_usage('$(uid 5 "$1")')"; }
defs_fp() {   # the limit, the functions the migration touches or reads, the check, and the ledger's constraints, by prosrc / constraint text
  PGDATABASE="$1" P -tA -c "select md5(
      coalesce((select string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace
                  and p.proname in ('evaluation_report_limit', 'evaluation_usage', 'evaluation_report_issue', 'evaluation_check', 'evaluation_guard', 'evaluation_credit_after_insert')), '')
   || coalesce((select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname collate \"C\") from pg_constraint where conrelid = 'public.evaluation_credit'::regclass), ''))"; }


# ---- 1. the state production is in: limit 10, real usage ----------------------------------------------------------------------------------------------
base PA "$OLD"
ok "$([ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "10" ] && echo 1 || echo 0)" "0a the starting point is the entitlement as production holds it: the free limit is 10"
mk_eval PA 1 3      # three used
mk_eval PA 2 0      # none used
mk_eval PA 3 10     # ten used: COMPLETE under the old limit
FP0="$(ledger_fp "$DB_A")"
ok "$([ "${FP0%%:*}" = "13" ] && [ "${FP0#*:}" != "-" ] && echo 1 || echo 0)" "0b the starting ledger holds 13 reports across three evaluations (a control: the fingerprints below are over real rows)" "$FP0"
ok "$([ "$(PA -tA -c "select status from public.evaluation_usage('$(uid 5 3)')")" = "complete" ] && echo 1 || echo 0)" "0c the brokerage with ten used is COMPLETE under the old limit"
DEF_OLD="$(defs_fp "$DB_A")"

# ---- 2. refusals leave the old state untouched ---------------------------------------------------------------------------------------------------------
PA -c "create table public.brokerage_paid_credit (id int); insert into public.brokerage_paid_credit values (1)" >/dev/null
out="$(PA -f "$MIG" 2>&1 || true)"
ok "$(grep -q 'paid credit' <<<"$out" && [ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "10" ] && [ "$(defs_fp "$DB_A")" = "$DEF_OLD" ] && [ "$(PA -tA -c "select status from public.evaluation_usage('$(uid 5 3)')")" = "complete" ] && echo 1 || echo 0)" "1a an existing paid credit REFUSES the migration (free numbers 11..100 would collide with paid numbers), and nothing changed: limit, definitions and the complete status are as before"
PA -c "drop table public.brokerage_paid_credit" >/dev/null
PA -c "create or replace function public.evaluation_report_limit() returns integer language sql immutable as \$\$ select 20 \$\$" >/dev/null
out="$(PA -f "$MIG" 2>&1 || true)"
ok "$(grep -q 'expected 10' <<<"$out" && [ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "20" ] && echo 1 || echo 0)" "1b a live limit that is neither 10 nor 100 REFUSES the migration (an unknown starting point)"

# ---- 3. the real apply ---------------------------------------------------------------------------------------------------------------------------------
base PA "$OLD"; mk_eval PA 1 3; mk_eval PA 2 0; mk_eval PA 3 10
FP0="$(ledger_fp "$DB_A")"; EV0="$(PA -tA -c 'select count(*) from public.evaluation_event')"
PA -f "$MIG" >/dev/null 2>"$here/.mig.err" || { echo "FAIL — the migration does not apply: $(head -c 300 "$here/.mig.err")"; exit 1; }
rm -f "$here/.mig.err"
ok "$([ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "100" ] && echo 1 || echo 0)" "2a the free limit is 100 after the migration"
ok "$([ "$(ledger_fp "$DB_A")" = "$FP0" ] && echo 1 || echo 0)" "2b USAGE IS PRESERVED: the ledger (13 rows) is identical to the byte before and after: nothing written, changed or deleted" "$FP0 / $(ledger_fp "$DB_A")"
ok "$([ "$(usage 1)" = "3 97 active" ] && echo 1 || echo 0)" "2c 3 used -> 97 remaining, still active" "$(usage 1)"
ok "$([ "$(usage 2)" = "0 100 active" ] && echo 1 || echo 0)" "2d 0 used -> 100 remaining" "$(usage 2)"
ok "$([ "$(usage 3)" = "10 90 active" ] && echo 1 || echo 0)" "2e the evaluation that COMPLETED at 10 is reopened: 10 used, 90 remaining, active" "$(usage 3)"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_event")" = "$EV0" ] && echo 1 || echo 0)" "2f the reopening wrote no event and no ledger row (status only)"
ok "$([ "$(PA -tA -c "select count(*) from pg_trigger where tgrelid = 'public.evaluation'::regclass and tgname = 'evaluation_guard_trg' and tgenabled = 'O'")" = "1" ] && echo 1 || echo 0)" "2g the guard that makes 'complete' terminal is ENABLED again after the migration"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_check() where kind = 'invariant' and violations <> 0")" = "0" ] && [ "$(PA -tA -c "select count(*) from public.evaluation_check() where kind = 'control' and violations > 0")" = "2" ] && echo 1 || echo 0)" "2h the audit reads zero on every invariant, beside two controls that are not zero"

# ---- 4. behaviour after the migration ---------------------------------------------------------------------------------------------------------------
issue() { PGDATABASE="$DB_A" P -tA -c "select credit_ordinal || ',' || credits_used || ',' || credits_remaining || ',' || evaluation_status from public.evaluation_report_issue('$(uid 5 "$1")', md5('post$1' || '$2')::uuid, '{\"p\":$2}', encode(sha256(convert_to('{\"p\":$2}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)" 2>&1; }
r="$(issue 3 1)"
ok "$([ "$r" = "11,11,89,active" ] && echo 1 || echo 0)" "3a the reopened brokerage's next report is number 11, 89 left" "$r"
for i in $(seq 2 89); do r="$(issue 3 $i)"; done
ok "$([ "$r" = "99,99,1,active" ] && echo 1 || echo 0)" "3b after 89 more it is on report 99 with 1 left, still active" "$r"
r="$(issue 3 90)"
ok "$([ "$r" = "100,100,0,complete" ] && echo 1 || echo 0)" "3c report 100 is the last: 0 left, and the evaluation completes" "$r"
r="$(issue 3 91 || true)"
ok "$(grep -q 'EVALUATION_COMPLETE' <<<"$r" && [ "$(PA -tA -c "select count(*) from public.evaluation_credit where evaluation_id = (select evaluation_id from public.evaluation_usage('$(uid 5 3)'))")" = "100" ] && echo 1 || echo 0)" "3d the 101st is refused EVALUATION_COMPLETE and costs nothing: still 100 ledger rows" "$r"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_event where kind = 'completed'")" = "2" ] && echo 1 || echo 0)" "3e two completed events in all: one written by the 10th report under the old limit, one by the 100th (the reopening wrote none)" "$(PA -tA -c "select count(*) from public.evaluation_event where kind = 'completed'")"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_credit where ordinal > 100")" = "0" ] && echo 1 || echo 0)" "3f no ledger row above 100 exists, and none can be written (the ordinal CHECK reads the one definition)"
r="$(PA -tA -c "update public.evaluation set status = 'active' where evaluation_id = (select evaluation_id from public.evaluation_usage('$(uid 5 3)'))" 2>&1 || true)"
ok "$(grep -q 'complete evaluation can only be revoked' <<<"$r" && echo 1 || echo 0)" "3g a complete evaluation still cannot be reopened by an ordinary update (the guard is back on)" "$r"

# ---- 5. a second apply changes nothing ------------------------------------------------------------------------------------------------------------------
base PA "$OLD"; mk_eval PA 1 3; mk_eval PA 3 10; PA -f "$MIG" >/dev/null 2>&1
DEF1="$(defs_fp "$DB_A")"; FP1="$(ledger_fp "$DB_A")"; EV1="$(PA -tA -c 'select count(*) from public.evaluation_event')"; U1="$(usage 3)"
PA -f "$MIG" >/dev/null 2>&1 || true
ok "$([ "$(defs_fp "$DB_A")" = "$DEF1" ] && [ "$(ledger_fp "$DB_A")" = "$FP1" ] && [ "$(PA -tA -c 'select count(*) from public.evaluation_event')" = "$EV1" ] && [ "$(usage 3)" = "$U1" ] && echo 1 || echo 0)" "4a applying it a second time changes no definition, no ledger row, no event and no status"

# ---- 6. migration == SQL of record ------------------------------------------------------------------------------------------------------------------------
base PA "$OLD"; PA -f "$MIG" >/dev/null 2>&1
base PB "$NEW"
FPA="$(defs_fp "$DB_A")"; FPB="$(defs_fp "$DB_B")"
ok "$([ "$FPA" = "$FPB" ] && [ -n "$FPA" ] && echo 1 || echo 0)" "5a the old entitlement plus the migration equals a FRESH install of docs/evaluation-entitlement.sql: the limit, the bodies of the readers and the check, and the ledger's constraints fingerprint identically" "$FPA / $FPB"
ok "$([ "$(PB -tA -c 'select public.evaluation_report_limit()')" = "100" ] && echo 1 || echo 0)" "5b and the SQL of record itself says 100 (this suite runs the REAL file, not the limit-under-test copy)"

psql -X -q -d postgres -c "drop database if exists $DB_B" >/dev/null
echo
echo "$((n - fails)) passed, $fails failed of $n"
[ "$fails" -eq 0 ]
