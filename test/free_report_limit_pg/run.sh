#!/usr/bin/env bash
# THE MIGRATION OF THE FREE ALLOWANCE, 20 -> 10 (docs/free-report-limit-10.sql), against DISPOSABLE Postgres databases (never production).
#
# It starts from the entitlement exactly as production holds it (evaluation-entitlement-before.sql: a frozen copy of docs/evaluation-entitlement.sql
# before the change, limit 20), builds real usage under it, applies the migration, and proves:
#   1. usage is PRESERVED: no ledger row is written, changed or deleted (a fingerprint of the ledger is identical before and after);
#   2. remaining = max(0, 10 - used): 3 used -> 7 left, 0 used -> 10 left, 10 used -> 0 left and the evaluation is complete (never negative);
#   3. a brokerage with 3 used can make exactly 7 more, and the 8th is refused EVALUATION_COMPLETE; the one that had used 10 is refused at once;
#   4. the audit (evaluation_check) reads zero on every invariant, beside controls that are not zero;
#   5. applying it a second time changes nothing;
#   6. the result EQUALS a fresh install of the new SQL of record (docs/evaluation-entitlement.sql): same limit, same bodies of the functions it
#      splices, same constraint text. So the file in the repo and the migration cannot say two different things;
#   7. it REFUSES, changing nothing, when a ledger row above ordinal 10 exists, when a paid credit exists, or when a function it splices has changed.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
DB_A="$PGDATABASE"; DB_B="${PGDATABASE}_fresh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
PA() { PGDATABASE="$DB_A" P "$@"; }
PB() { PGDATABASE="$DB_B" P "$@"; }
MIG="$root/docs/free-report-limit-10.sql"; NEW="$root/docs/evaluation-entitlement.sql"; OLD="$here/evaluation-entitlement-before.sql"
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

# ---- 1. the state production is in: the old limit, with real usage -----------------------------------------------------------------------------------
base PA "$OLD"
ok "$([ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "20" ] && echo 1 || echo 0)" "0a the starting point is the entitlement as production holds it: the free limit is 20"
mk_eval PA 1 3      # three used
mk_eval PA 2 0      # none used
mk_eval PA 3 10     # ten used: active under the old limit of 20
FP0="$(ledger_fp "$DB_A")"
ok "$([ "${FP0%%:*}" = "13" ] && [ "${FP0#*:}" != "-" ] && echo 1 || echo 0)" "0b the starting ledger holds 13 reports across three evaluations (a control: the fingerprints below are over real rows)" "$FP0"
ok "$([ "$(PA -tA -c "select status from public.evaluation_usage('$(uid 5 3)')")" = "active" ] && echo 1 || echo 0)" "0c the brokerage with ten used is still ACTIVE under the old limit (the trigger flips at the limit, which was 20)"
DEF_OLD="$(defs_fp "$DB_A")"

# ---- 2. refusals leave the old state untouched ---------------------------------------------------------------------------------------------------------
PA -c "alter table public.evaluation_credit disable trigger evaluation_credit_complete_trg" >/dev/null
PA -c "insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id)
       select e.evaluation_id, 11, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{\"over\":1}', encode(sha256(convert_to('{\"over\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null))
         from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Brokerage 3'" >/dev/null
PA -c "alter table public.evaluation_credit enable trigger evaluation_credit_complete_trg" >/dev/null
DEF_OLD="$(defs_fp "$DB_A")"
out="$(PA -f "$MIG" 2>&1 || true)"
ok "$(grep -q 'ordinal above 10' <<<"$out" && [ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "20" ] && [ "$(defs_fp "$DB_A")" = "$DEF_OLD" ] && echo 1 || echo 0)" "1a a ledger row above ordinal 10 REFUSES the migration, and nothing changed (the limit is still 20, no definition moved)" "$(head -c 200 <<<"$out")"

# put the state back (rebuild) and test the other refusals
base PA "$OLD"; mk_eval PA 1 3; mk_eval PA 2 0; mk_eval PA 3 10
DEF_OLD="$(defs_fp "$DB_A")"
PA -c "create table public.brokerage_paid_credit (id int); insert into public.brokerage_paid_credit values (1)" >/dev/null
out="$(PA -f "$MIG" 2>&1 || true)"
ok "$(grep -q 'paid credit' <<<"$out" && [ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "20" ] && [ "$(defs_fp "$DB_A")" = "$DEF_OLD" ] && echo 1 || echo 0)" "1b an existing paid credit REFUSES the migration (paid numbers were issued from 21), and nothing changed" "$(head -c 200 <<<"$out")"
PA -c "drop table public.brokerage_paid_credit" >/dev/null
PA -c "create or replace function public.evaluation_usage(p_user_id uuid) returns table (evaluation_id uuid, status text, credit_limit integer, credits_used integer, credits_remaining integer, expires_at timestamptz, expired boolean)
       language sql stable security definer set search_path = public, pg_temp as \$\$ select null::uuid, 'x'::text, 0, 0, 0, null::timestamptz, false where false \$\$" >/dev/null
DEF_TAMPER="$(defs_fp "$DB_A")"
out="$(PA -f "$MIG" 2>&1 || true)"
ok "$(grep -q 'appears 0 times' <<<"$out" && [ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "20" ] && [ "$(defs_fp "$DB_A")" = "$DEF_TAMPER" ] && echo 1 || echo 0)" "1c a reader whose text is no longer the one the migration splices REFUSES it (anchor count must be exactly 1), and the limit is NOT moved on its own" "$(head -c 200 <<<"$out")"

# ---- 3. the real apply ---------------------------------------------------------------------------------------------------------------------------------
base PA "$OLD"; mk_eval PA 1 3; mk_eval PA 2 0; mk_eval PA 3 10
FP0="$(ledger_fp "$DB_A")"
PA -f "$MIG" >/dev/null 2>"$here/.mig.err" || { echo "FAIL — the migration does not apply: $(head -c 300 "$here/.mig.err")"; exit 1; }
rm -f "$here/.mig.err"
ok "$([ "$(PA -tA -c 'select public.evaluation_report_limit()')" = "10" ] && echo 1 || echo 0)" "2a the free limit is 10 after the migration"
ok "$([ "$(ledger_fp "$DB_A")" = "$FP0" ] && echo 1 || echo 0)" "2b USAGE IS PRESERVED: the ledger (13 rows) is identical to the byte before and after: nothing written, changed or deleted" "$FP0 / $(ledger_fp "$DB_A")"
ok "$([ "$(usage 1)" = "3 7 active" ] && echo 1 || echo 0)" "2c 3 used -> 7 remaining, still active" "$(usage 1)"
ok "$([ "$(usage 2)" = "0 10 active" ] && echo 1 || echo 0)" "2d 0 used -> 10 remaining" "$(usage 2)"
ok "$([ "$(usage 3)" = "10 0 complete" ] && echo 1 || echo 0)" "2e 10 used -> 0 remaining and the evaluation is COMPLETE (it was active under the old limit; the migration completed it, with the same event a 10th report writes)" "$(usage 3)"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_event where kind = 'completed'")" = "1" ] && echo 1 || echo 0)" "2f exactly one completed event was written, for that one evaluation"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_check() where kind = 'invariant' and violations <> 0")" = "0" ] && [ "$(PA -tA -c "select count(*) from public.evaluation_check() where kind = 'control' and violations > 0")" = "2" ] && echo 1 || echo 0)" "2g the audit reads zero on every invariant, beside two controls that are not zero"

# ---- 4. behaviour after the migration ---------------------------------------------------------------------------------------------------------------
issue() { PGDATABASE="$DB_A" P -tA -c "select credit_ordinal || ',' || credits_used || ',' || credits_remaining || ',' || evaluation_status from public.evaluation_report_issue('$(uid 5 "$1")', md5('post$1' || '$2')::uuid, '{\"p\":$2}', encode(sha256(convert_to('{\"p\":$2}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)" 2>&1 | tr '\n' ' ' | sed 's/ *$//' || true; }
r=""; for i in 1 2 3 4 5 6 7; do r="$(issue 1 $i)"; done
ok "$([ "$r" = "10,10,0,complete" ] && echo 1 || echo 0)" "3a the brokerage with 3 used makes exactly 7 more; the 7th is report 10, 0 left, complete" "$r"
r="$(issue 1 8)"
ok "$(grep -q 'EVALUATION_COMPLETE' <<<"$r" && [ "$(PA -tA -c "select count(*) from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Brokerage 1'")" = "10" ] && echo 1 || echo 0)" "3b the 11th is refused EVALUATION_COMPLETE and no row is added" "$r"
r="$(issue 3 1)"
ok "$(grep -q 'EVALUATION_COMPLETE' <<<"$r" && echo 1 || echo 0)" "3c the brokerage that had already used 10 is refused at once" "$r"
r="$(issue 2 1)"
ok "$([ "$r" = "1,1,9,active" ] && echo 1 || echo 0)" "3d the untouched brokerage starts with 10: its first report leaves 9" "$r"
ok "$([ "$(PA -tA -c "select count(*) from public.evaluation_credit where ordinal > 10")" = "0" ] && echo 1 || echo 0)" "3e no ledger row above 10 exists, and none can be written (the ordinal CHECK reads the one definition)"

# ---- 5. a second apply changes nothing ------------------------------------------------------------------------------------------------------------------
DEF1="$(defs_fp "$DB_A")"; FP1="$(ledger_fp "$DB_A")"; EV1="$(PA -tA -c 'select count(*) from public.evaluation_event')"
PA -f "$MIG" >/dev/null 2>&1 || true
ok "$([ "$(defs_fp "$DB_A")" = "$DEF1" ] && [ "$(ledger_fp "$DB_A")" = "$FP1" ] && [ "$(PA -tA -c 'select count(*) from public.evaluation_event')" = "$EV1" ] && echo 1 || echo 0)" "4a applying it a second time changes no definition, no ledger row and writes no event"

# ---- 6. migration == SQL of record ------------------------------------------------------------------------------------------------------------------------
base PA "$OLD"; PA -f "$MIG" >/dev/null 2>&1
base PB "$NEW"
FPA="$(defs_fp "$DB_A")"; FPB="$(defs_fp "$DB_B")"
ok "$([ "$FPA" = "$FPB" ] && [ -n "$FPA" ] && echo 1 || echo 0)" "5a the old entitlement plus the migration equals a FRESH install of docs/evaluation-entitlement.sql: the limit, the bodies of the readers and the check, and the ledger's constraints fingerprint identically" "$FPA / $FPB"
ok "$([ "$(PB -tA -c 'select public.evaluation_report_limit()')" = "10" ] && echo 1 || echo 0)" "5b and the SQL of record itself says 10"

psql -X -q -d postgres -c "drop database if exists $DB_B" >/dev/null
echo
echo "$((n - fails)) passed, $fails failed of $n"
[ "$fails" -eq 0 ]
