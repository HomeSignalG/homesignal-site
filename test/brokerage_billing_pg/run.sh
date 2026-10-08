#!/usr/bin/env bash
# Executable suite for brokerage billing (docs/brokerage-billing.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved reports, share links, property watch and payment-event
# ledger, applied unmutated.
# 1. the shipped SQL passes every check of suite.sql; applying it changes NOTHING it stands on except the BODY of the six ownership readers (and
#    their security, volatility, search path, owner and privileges are exactly what they were);
# 2. REAL concurrent sessions: two callers racing for a brokerage's 100th report of the month - exactly one wins and the other is refused
#    ALLOTMENT_COMPLETE; two callers sending the SAME key at once charge ONE report; two events binding one new subscription to two DIFFERENT
#    brokerages at once - one binding, the loser refused BINDING_CONFLICT and recording nothing; two events binding it to the SAME brokerage - one
#    binding; and a report issued above READ COMMITTED is refused (55000) and charges nothing;
# 3. it applies twice with an identical result;
# 4. its ROLLBACK (the footer of the file, extracted and run) removes everything it created WITH paid reports stored, puts the six readers back to
#    EXACTLY the definitions they had before, keeps every stored snapshot and every ledger event, is repeatable, and re-applying gives the first apply;
# 5. it REFUSES, creating nothing, when a layer it stands on is absent, and when a reader to be spliced does not hold the one anchor it expects;
# 6. each prohibited mutation fails >= 1 NAMED check (of suite.sql or of the scenarios above) or stops the apply. A mutation that makes the suite CRASH
#    does not count as killed: a crash names nothing, so it is reported and fails the run. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${BILLING_SQL:-$root/docs/brokerage-billing.sql}"
# every layer the billing file stands on, in the order production applied them
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header)
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() {
  local f
  for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done
  rm -f "$here/.dep.err"
}
apply_base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }

# the objects this file owns: eleven functions, two tables, one view
FN="(p.proname like 'billing\\_%' or p.proname = 'brokerage_report_issue' or p.proname like 'brokerage\\_paid\\_credit%')"
RD="(p.proname in ('evaluation_reports_of', 'evaluation_report_open', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open', 'evaluation_property_watches_of'))"
MYREL="('brokerage_subscription', 'brokerage_paid_credit', 'evaluation_credit_all')"
fp_mine() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name in $MYREL), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where conrelid in ('public.brokerage_subscription'::regclass, 'public.brokerage_paid_credit'::regclass)), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal and tgrelid in ('public.brokerage_subscription'::regclass, 'public.brokerage_paid_credit'::regclass)), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in $MYREL), '')
  || coalesce((select pg_get_viewdef('public.evaluation_credit_all'::regclass)), ''))"; }
# everything this file stands on and must not touch, EXCEPT the bodies of the six readers it splices (their attributes are compared separately)
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\")
                from pg_proc p where p.pronamespace = 'public'::regnamespace and not $FN and not $RD), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name not in $MYREL), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not in $MYREL), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal and tgrelid not in (select oid from pg_class where relname in $MYREL)), ''))"; }
fp_readers_attrs() { P -tA -c "select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(p.proconfig::text, '-') || ':' || coalesce(p.proacl::text, '-') || ':' || p.proowner::text, ',' order by p.oid::regprocedure::text collate \"C\"), ''))
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and $RD"; }
fp_readers_full() { P -tA -c "select md5(coalesce(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\"), ''))
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and $RD"; }
n_mine() { P -tA -c "select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN) + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in $MYREL)"; }

# ---- the real-session scenarios (they build their own population) --------------------------------------------------------------
UR1='f0000000-0000-4000-8000-000000000001'; UR2='f0000000-0000-4000-8000-000000000002'; UR3='f0000000-0000-4000-8000-000000000003'; UR4='f0000000-0000-4000-8000-000000000004'
key() { printf 'f1000000-0000-4000-8000-%012d' "$1"; }
ev() { # $1 subscription_ref  $2 idempotency key  $3 status ; a live event at the current time
  printf '{"processor":"lemonsqueezy","idempotency_key":"%s","subscription_ref":"%s","event_name":"subscription_updated","processor_status":"%s","occurred_at":"%s","product_ref":"11","variant_ref":"22","livemode":true}' \
    "$2" "$1" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }
issue_sql() { # $1 user  $2 key number ; the body is a JSON object, as the snapshot writer requires
  printf '%s' "select i.* from (select format('{\"product\":\"HomeSignal Development Activity\",\"n\":%s}', $2) as body) b cross join lateral public.brokerage_report_issue('$1', '$(key "$2")', b.body, encode(sha256(convert_to(b.body, 'UTF8')), 'hex'), 'engine-v1', '{\"engine\":\"test\"}'::jsonb, null) i"; }
brokerage_of() { P -tA -c "select e.brokerage_id from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = '$1'"; }
scenarios() {
  P -c "insert into auth.users (id, email) values ('$UR1', 'race1@example.test'), ('$UR2', 'race2@example.test'), ('$UR3', 'race3@example.test'), ('$UR4', 'race4@example.test');
        do \$\$ declare c record; t text; begin
          select * into c from public.evaluation_create('Race Realty');   perform 1 from public.evaluation_invite_redeem(c.owner_token, '$UR1');
          select m.token into t from public.evaluation_invite_mint(c.evaluation_id, 'agent') m;                  perform 1 from public.evaluation_invite_redeem(t, '$UR2');
          select * into c from public.evaluation_create('Key Realty');    perform 1 from public.evaluation_invite_redeem(c.owner_token, '$UR3');
          select * into c from public.evaluation_create('Bind Realty');   perform 1 from public.evaluation_invite_redeem(c.owner_token, '$UR4');
        end \$\$" >/dev/null
  local RACE KEYB BIND; RACE="$(brokerage_of 'Race Realty')"; KEYB="$(brokerage_of 'Key Realty')"; BIND="$(brokerage_of 'Bind Realty')"
  P -c "select public.billing_event_apply('$RACE', '$(ev 7001 race-pay active)'::jsonb); select public.billing_event_apply('$KEYB', '$(ev 7002 key-pay active)'::jsonb)" >/dev/null
  # Race Realty uses 99 of its 100 reports this month through the real entry
  P -c "do \$\$ declare n int; b text; begin for n in 1..99 loop b := format('{\"product\":\"HomeSignal Development Activity\",\"n\":%s}', n);
          perform * from public.brokerage_report_issue('$UR1', ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, b, encode(sha256(convert_to(b, 'UTF8')), 'hex'), 'engine-v1', '{\"engine\":\"test\"}'::jsonb, null); end loop; end \$\$" >/dev/null
  local o1 o2 bg
  # the 100th report: session 1 takes it and holds its transaction open; session 2 (the agent of the same brokerage) asks meanwhile
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'won ordinal=' || credit_ordinal || ' left=' || credits_remaining from ($(issue_sql "$UR1" 1001)) t;
select pg_sleep(2.5);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  P -tA -c "select 'won ordinal=' || credit_ordinal from ($(issue_sql "$UR2" 1002)) t" >"$o2" 2>&1 || true
  wait "$bg" || true
  local rows; rows="$(P -tA -c "select count(*) from public.brokerage_paid_credit where brokerage_id = '$RACE'")"
  if grep -q '^won ordinal=100 left=0$' "$o1" && ! grep -q '^won' "$o2" && grep -q 'ALLOTMENT_COMPLETE' "$o2" && [ "$rows" = "100" ]; then
    echo "RACE_100TH|t|two callers raced for the 100th report: one won (ordinal 100, none left), the other was refused ALLOTMENT_COMPLETE, and the ledger holds exactly 100 ($rows)"
  else
    echo "RACE_100TH|f|rows=$rows; first said: $(tr '\n' ' ' <"$o1" | cut -c1-120); second said: $(tr '\n' ' ' <"$o2" | cut -c1-160)"
  fi
  rm -f "$o1" "$o2"
  # the SAME key from two sessions at once: one report is charged, the other is answered with it
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'r=' || report_id || ' replayed=' || replayed from ($(issue_sql "$UR3" 2001)) t;
select pg_sleep(2.5);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  P -tA -c "select 'r=' || report_id || ' replayed=' || replayed from ($(issue_sql "$UR3" 2001)) t" >"$o2" 2>&1 || true
  wait "$bg" || true
  rows="$(P -tA -c "select count(*) from public.brokerage_paid_credit where brokerage_id = '$KEYB'")"
  local r1 r2; r1="$(sed -n 's/^r=\([0-9a-f-]*\) replayed=false$/\1/p' "$o1")"; r2="$(sed -n 's/^r=\([0-9a-f-]*\) replayed=true$/\1/p' "$o2")"
  if [ -n "$r1" ] && [ "$r1" = "$r2" ] && [ "$rows" = "1" ]; then
    echo "SAME_KEY|t|two sessions sent the same key at once: one made the report, the other was answered with that same report (replayed), and ONE credit was charged ($rows)"
  else
    echo "SAME_KEY|f|rows=$rows first=$(tr '\n' ' ' <"$o1" | cut -c1-100) second=$(tr '\n' ' ' <"$o2" | cut -c1-120)"
  fi
  rm -f "$o1" "$o2"
  # above READ COMMITTED the entry refuses (55000) and charges nothing; the same call at READ COMMITTED is the control
  local before after rc; before="$(P -tA -c "select count(*) from public.brokerage_paid_credit where brokerage_id = '$KEYB'")"
  rc="$(psql -X -q -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -tA 2>&1 <<SQL
begin isolation level repeatable read;
$(issue_sql "$UR3" 2002);
rollback;
SQL
)"
  after="$(P -tA -c "select count(*) from public.brokerage_paid_credit where brokerage_id = '$KEYB'")"
  local ctl; ctl="$(P -tA -c "select credit_ordinal from ($(issue_sql "$UR3" 2003)) t" 2>&1 || true)"
  if grep -q '55000' <<<"$rc" && grep -q 'READ COMMITTED' <<<"$rc" && [ "$after" = "$before" ] && [ "$ctl" = "2" ]; then
    echo "REPEATABLE_READ|t|an issue under REPEATABLE READ is refused (55000) and charges nothing; the same call at READ COMMITTED is the next report (ordinal $ctl)"
  else
    echo "REPEATABLE_READ|f|before=$before after=$after control=$ctl; said: $(tr '\n' ' ' <<<"$rc" | cut -c1-160)"
  fi
  # one NEW subscription named by two events for two DIFFERENT brokerages at once: one binding, the loser refused and nothing recorded for it
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'bound=' || bound || ' outcome=' || outcome from public.billing_event_apply('$BIND', '$(ev 7003 bind-a active)'::jsonb);
select pg_sleep(2.5);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  P -tA -c "select 'bound=' || bound from public.billing_event_apply('$KEYB', '$(ev 7003 bind-b active)'::jsonb)" >"$o2" 2>&1 || true
  wait "$bg" || true
  local nb owner lost; nb="$(P -tA -c "select count(*) from public.brokerage_subscription where subscription_ref = '7003'")"
  owner="$(P -tA -c "select brokerage_id from public.brokerage_subscription where subscription_ref = '7003'")"
  lost="$(P -tA -c "select count(*) from public.payment_event where idempotency_key = 'bind-b'")"
  if grep -q '^bound=true outcome=RECORDED$' "$o1" && grep -q 'BINDING_CONFLICT' "$o2" && [ "$nb" = "1" ] && [ "$owner" = "$BIND" ] && [ "$lost" = "0" ]; then
    echo "BIND_RACE|t|one subscription named for two brokerages at once: one binding (the first), the other refused BINDING_CONFLICT, and the loser's event was not recorded"
  else
    echo "BIND_RACE|f|bindings=$nb loser-events=$lost; first said: $(tr '\n' ' ' <"$o1" | cut -c1-100); second said: $(tr '\n' ' ' <"$o2" | cut -c1-160)"
  fi
  rm -f "$o1" "$o2"
  # one NEW subscription named by two events for the SAME brokerage at once: one binding, both events recorded, exactly one call says it bound
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'bound=' || bound from public.billing_event_apply('$BIND', '$(ev 7004 same-a active)'::jsonb);
select pg_sleep(2.5);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  P -tA -c "select 'bound=' || bound from public.billing_event_apply('$BIND', '$(ev 7004 same-b active)'::jsonb)" >"$o2" 2>&1 || true
  wait "$bg" || true
  nb="$(P -tA -c "select count(*) from public.brokerage_subscription where subscription_ref = '7004'")"
  local ne; ne="$(P -tA -c "select count(*) from public.payment_event where subscription_ref = '7004'")"
  if grep -q '^bound=true$' "$o1" && grep -q '^bound=false$' "$o2" && [ "$nb" = "1" ] && [ "$ne" = "2" ]; then
    echo "SAME_BINDING|t|two events for one new subscription and one brokerage at once: ONE binding, both events recorded, and only the first call says it bound"
  else
    echo "SAME_BINDING|f|bindings=$nb events=$ne; first said: $(tr '\n' ' ' <"$o1" | cut -c1-100); second said: $(tr '\n' ' ' <"$o2" | cut -c1-160)"
  fi
  rm -f "$o1" "$o2"
}

# ---- the apply must REFUSE (and, in one transaction like the runner's, leave nothing) when a reader to be spliced does not hold its one anchor ----
# `twice`: a reader that names the trial table twice; `never`: a reader that no longer names it. Each is applied under psql -1, as db-sql.yml applies a file.
splice_refuses() {
  local file="$1" variant err
  for variant in twice never; do
    apply_base
    if [ "$variant" = twice ]; then
      P -c "do \$\$ declare d text; begin d := pg_get_functiondef('public.evaluation_reports_of(uuid)'::regprocedure); d := replace(d, 'AS \$function\$', 'AS \$function\$ /* public.evaluation_credit c */ '); execute d; end \$\$" >/dev/null
    else
      P -c "do \$\$ declare d text; begin perform set_config('check_function_bodies', 'off', true); d := pg_get_functiondef('public.evaluation_reports_of(uuid)'::regprocedure); d := replace(d, 'public.evaluation_credit c', 'public.evaluation_credit_none c'); execute d; end \$\$" >/dev/null
    fi
    local n; n="$(P -tA -c "select (length(pg_get_functiondef('public.evaluation_reports_of(uuid)'::regprocedure)) - length(replace(pg_get_functiondef('public.evaluation_reports_of(uuid)'::regprocedure), 'public.evaluation_credit c', ''))) / length('public.evaluation_credit c')")"
    if { [ "$variant" = twice ] && [ "$n" != "2" ]; } || { [ "$variant" = never ] && [ "$n" != "0" ]; }; then echo "    HARNESS: the $variant defect was not put in place (anchor count $n)"; return 2; fi
    if err="$(psql -X -q -v ON_ERROR_STOP=1 -1 -f "$file" 2>&1 >/dev/null)"; then echo "    the file APPLIED over a reader that reads the trial table $variant"; return 1; fi
    if ! grep -q 'refusing to splice' <<<"$err" || [ "$(n_mine)" != "0" ]; then echo "    the refusal over a reader reading the trial table $variant did not say why, or left objects behind (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  done
  return 0
}

# ---- 1. the shipped SQL passes, and touches nothing it depends on ---------------------------------------------------------------
apply_base
dep0="$(fp_deps)"; rattr0="$(fp_readers_attrs)"; rfull0="$(fp_readers_full)"
[ "$(n_mine)" = "0" ] || { echo "FAIL - billing objects exist before the file is applied"; exit 1; }
P -f "$SQL" >/dev/null 2>"$here/.apply.err" || { echo "FAIL - the SQL of record does not apply"; head -3 "$here/.apply.err"; exit 1; }
rm -f "$here/.apply.err"
dep1="$(fp_deps)"; rattr1="$(fp_readers_attrs)"; rfull1="$(fp_readers_full)"; mine1="$(fp_mine)"
if [ -z "$dep0" ] || [ "$dep0" != "$dep1" ]; then echo "FAIL - applying the billing file changed something it stands on ($dep0 vs $dep1)"; exit 1; fi
if [ -z "$rattr0" ] || [ "$rattr0" != "$rattr1" ]; then echo "FAIL - the splice changed the security, volatility, search path, owner or privileges of a reader"; exit 1; fi
if [ "$rfull0" = "$rfull1" ]; then echo "FAIL - the six readers have the same definitions before and after the splice (the comparison cannot see the change it exists to see)"; exit 1; fi
[ "$(n_mine)" = "14" ] || { echo "FAIL - expected 14 objects (11 functions, 2 tables, 1 view), found $(n_mine)"; exit 1; }
echo "UNTOUCHED - every other function, table, privilege and trigger is identical before and after; the six readers differ in BODY only (same security, volatility, search path, owner, privileges)"
out="$(suite)"; echo "$out" | sed 's/^/  /' | cut -c1-230
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 70 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL - the shipped billing layer does not pass"; exit 1; fi

# ---- 2. real sessions -----------------------------------------------------------------------------------------------------------
sc="$(scenarios)"; echo "$sc" | sed 's/^/  /'
if [ "$(grep -c '|t|' <<<"$sc" || true)" -ne 5 ] || grep -q '|f|' <<<"$sc"; then echo "FAIL - the real-session scenarios do not pass"; exit 1; fi

# the suite leaves one table of its own in public (a trap standing in for the map product's subscriptions table): what the layers beneath look like NOW
dep_pop="$(fp_deps)"

# ---- 3. applying it a second time is a no-op ----------------------------------------------------------------------------------------
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record is not idempotent"; exit 1; }
mine2="$(fp_mine)"; dep2="$(fp_deps)"; rfull2="$(fp_readers_full)"
if [ -z "$mine1" ] || [ "$mine1" != "$mine2" ] || [ "$dep_pop" != "$dep2" ] || [ "$rfull1" != "$rfull2" ]; then echo "FAIL - a second apply changed a definition (mine $([ "$mine1" = "$mine2" ] && echo same || echo DIFFERENT), beneath $([ "$dep_pop" = "$dep2" ] && echo same || echo DIFFERENT), readers $([ "$rfull1" = "$rfull2" ] && echo same || echo DIFFERENT))"; exit 1; fi
echo "APPLIED TWICE with an identical definition (the second splice found nothing to change)"

# ---- 4. the rollback, with paid reports stored ---------------------------------------------------------------------------------------------
paid="$(P -tA -c 'select count(*) from public.brokerage_paid_credit')"; binds="$(P -tA -c 'select count(*) from public.brokerage_subscription')"
snaps="$(P -tA -c 'select count(*) from public.report_snapshot')"; events="$(P -tA -c 'select count(*) from public.payment_event')"
if [ "$paid" -lt 200 ] || [ "$binds" -lt 5 ] || [ "$events" -lt 5 ]; then echo "FAIL - the rollback must be proven on a POPULATED database (paid=$paid bindings=$binds events=$events)"; exit 1; fi
rb="$(rollback_sql "$SQL")"
if [ -z "$rb" ] || ! grep -q 'drop table if exists public.brokerage_paid_credit;' <<<"$rb"; then echo "FAIL - no rollback footer was found in the SQL of record"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback does not run"; exit 1; }
if [ "$(n_mine)" != "0" ]; then echo "FAIL - the rollback left some of the billing objects behind"; exit 1; fi
if [ "$(fp_readers_full)" != "$rfull0" ]; then echo "FAIL - the reverse splice did not put the six readers back to EXACTLY their earlier definitions"; exit 1; fi
if [ "$(fp_deps)" != "$dep_pop" ] || [ "$(fp_readers_attrs)" != "$rattr0" ]; then echo "FAIL - the rollback changed a layer beneath it"; exit 1; fi
if [ "$(P -tA -c 'select count(*) from public.report_snapshot')" != "$snaps" ] || [ "$(P -tA -c 'select count(*) from public.payment_event')" != "$events" ]; then
  echo "FAIL - the rollback removed a stored snapshot or a payment event (both are append-only records and must survive it)"; exit 1
fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback is not repeatable (it must be safe to run twice)"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record does not re-apply after a rollback"; exit 1; }
if [ "$(fp_mine)" != "$mine1" ] || [ "$(fp_readers_full)" != "$rfull1" ]; then echo "FAIL - re-applying after a rollback differs from the first apply"; exit 1; fi
echo "ROLLED BACK with $paid paid credits and $binds bindings stored: the 14 objects gone, the six readers back to EXACTLY their earlier definitions, all $snaps snapshots and $events payment events kept, every layer beneath untouched, repeatable, and re-applying gives exactly the first apply"

# ---- 5. it refuses, creating nothing, when a layer it stands on is absent -----------------------------------------------------------------
reset_db
for f in brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch; do P -f "$root/docs/$f.sql" >/dev/null 2>&1; done
if P -f "$SQL" >/dev/null 2>"$here/.refusal.err"; then rm -f "$here/.refusal.err"; echo "FAIL - the billing file APPLIED without the payment-event ledger"; exit 1; fi
if ! grep -q 'brokerage_billing: apply docs/brokerage-account-spine.sql' "$here/.refusal.err" || [ "$(n_mine)" != "0" ]; then
  rm -f "$here/.refusal.err"; echo "FAIL - the refusal without the payment-event ledger did not say why, or left objects behind"; exit 1
fi
reset_db
for f in brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery payment-event-ledger; do P -f "$root/docs/$f.sql" >/dev/null 2>&1; done
if P -f "$SQL" >/dev/null 2>"$here/.refusal.err"; then rm -f "$here/.refusal.err"; echo "FAIL - the billing file APPLIED without the property-watch functions"; exit 1; fi
if ! grep -q 'brokerage_billing: public.evaluation_property_watches_of' "$here/.refusal.err" || [ "$(n_mine)" != "0" ]; then
  rm -f "$here/.refusal.err"; echo "FAIL - the refusal without the property-watch functions did not say why, or left objects behind"; exit 1
fi
rm -f "$here/.refusal.err"
echo "REFUSED without the payment-event ledger and without the property-watch functions, saying why, and creating nothing"
if ! splice_refuses "$SQL"; then echo "FAIL - the splice did not refuse a reader that does not hold its one anchor"; exit 1; fi
echo "SPLICE REFUSED a reader that names the trial table twice and one that no longer names it, saying why, and (in one transaction, as the runner applies it) leaving nothing behind"

# ---- 6. every prohibited mutation must fail a named check -------------------------------------------------------------------------------------
status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp" "$here/.refusal.err" "$here/.apply.err" "$here/.dep.err"' EXIT
while IFS= read -r name; do
  if [ -n "${MUTATION_FILTER:-}" ] && ! [[ "$name" =~ $MUTATION_FILTER ]]; then continue; fi
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name - anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$tmp"
  kind="$(python3 "$here/mutate.py" --kind "$name")"
  case "$kind" in
    postcondition)
      apply_base
      if err="$(psql -X -q -v ON_ERROR_STOP=1 -f "$tmp" 2>&1 >/dev/null)"; then echo "SURVIVED $name - the apply accepted a file that weakens the lock-down"; status=1
      elif grep -q 'brokerage_billing:' <<<"$err"; then echo "KILLED   $name - the post-condition stopped the apply: $(grep -o 'brokerage_billing:[^"]*' <<<"$err" | head -1 | cut -c1-120)"
      else echo "HARNESS  $name - the apply failed for a reason that is not the post-condition: $(head -c 160 <<<"$err")"; status=1; fi;;
    splice)
      if splice_refuses "$tmp" >"$here/.why.txt" 2>&1; then echo "SURVIVED $name - a reader without its one anchor is still spliced"; status=1
      else echo "KILLED   $name - the splice refusal check failed:"; sed -n '1,2p' "$here/.why.txt"; fi
      rm -f "$here/.why.txt";;
    untouched)
      apply_base; a0="$(fp_readers_attrs)"; d0="$(fp_deps)"
      P -f "$tmp" >/dev/null 2>&1 || { echo "HARNESS  $name - the mutated SQL did not apply"; status=1; continue; }
      if [ "$(fp_readers_attrs)" != "$a0" ] || [ "$(fp_deps)" != "$d0" ]; then echo "KILLED   $name - the UNTOUCHED comparison saw a reader's privileges (or a layer beneath) change"
      else echo "SURVIVED $name - the splice changed a privilege and nothing noticed"; status=1; fi;;
    *)
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
      fi;;
  esac
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
