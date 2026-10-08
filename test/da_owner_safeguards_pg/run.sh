#!/usr/bin/env bash
# Executable suite for the three owner safeguards (docs/da-owner-safeguards.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved reports, share links, property watch, payment-event
# ledger, report header, brokerage billing and report rate limit, applied unmutated, in the order production applied them.
#  1. applying the file changes NOTHING it stands on (a fingerprint of every other function, column, constraint, trigger and privilege is identical);
#  2. the shipped SQL passes every check of suite.sql;
#  3. REAL concurrent sessions: eight sessions racing one brokerage's checkout slot produce EXACTLY ONE "make a checkout" answer; eight sessions racing one
#     client's minute admit EXACTLY thirty; two owners removing the same agent at once - one true, one false; a call above READ COMMITTED is refused (55000)
#     and changes nothing; the API roles are refused by the database;
#  4. it applies twice with an identical result and keeps what it already held;
#  5. its ROLLBACK (the footer of the file, extracted and run) removes everything it created and nothing else, a removed agent STAYS removed, and
#     re-applying gives the first apply;
#  6. it REFUSES, creating nothing, when a layer it stands on is absent;
#  7. each prohibited mutation fails >= 1 NAMED check or stops the apply (mutate_all.sh). A crash does not count as a kill.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${SAFEGUARDS_SQL:-$root/docs/da-owner-safeguards.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing report-rate-limit)
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() {
  local f
  for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done
  rm -f "$here/.dep.err"
}
apply_base() { reset_db; apply_deps; }
rollback_sql() { sed -n '/^-- ROLLBACK (this file only/,$p' "$1" | sed '1d' | grep '^-- drop' | sed 's/^-- //'; }

FN="(p.proname like 'share\\_view\\_%' or p.proname like 'billing\\_checkout\\_%' or p.proname in ('brokerage_team_of', 'brokerage_member_remove', 'da_owner_safeguards_check'))"
MYREL="('share_view_window', 'billing_checkout_claim')"
fp_mine() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\") from information_schema.columns where table_schema = 'public' and table_name in $MYREL), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where conrelid in (select oid from pg_class where relname in $MYREL)), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in $MYREL), ''))"; }
# everything this file stands on and must not touch
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and not $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name not in $MYREL), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where connamespace = 'public'::regnamespace and conrelid not in (select oid from pg_class where relname in $MYREL)), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname not in $MYREL), ''))"; }
n_mine() { P -tA -c "select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN) + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in $MYREL)"; }

n=0; bad=0
ok() { n=$((n+1)); if [ "$1" = "1" ]; then echo "PASS — $2"; else bad=$((bad+1)); echo "FAIL — $2${3:+  [$3]}"; fi; }

# ---- the real-session scenarios (they build their own population) ------------------------------------------------------------------------------
SB='f2000000-0000-4000-8000-000000000001'
T='2032-06-01 09:30:00+00'
CL="$(printf '%040d' 7)"
scenario_population() {
  P -c "insert into auth.users (id, email) values ('f2100000-0000-4000-8000-000000000001', 'race.owner1@example.test'), ('f2100000-0000-4000-8000-000000000002', 'race.owner2@example.test'), ('f2100000-0000-4000-8000-000000000003', 'race.agent@example.test');
        insert into public.brokerage_account (id, name) values ('$SB', 'Race Safeguards');
        insert into public.brokerage_member (brokerage_id, user_id, role) values ('$SB', 'f2100000-0000-4000-8000-000000000001', 'owner'), ('$SB', 'f2100000-0000-4000-8000-000000000002', 'owner'), ('$SB', 'f2100000-0000-4000-8000-000000000003', 'agent');" >/dev/null
}
scenarios() {
  scenario_population
  local d i out got
  d="$(mktemp -d)"
  # (1) eight sessions press Subscribe at the same instant: exactly ONE is told to make a checkout, the other 159 are told BUSY
  for i in 1 2 3 4 5 6 7 8; do : > "$d/c$i.sql"; for j in $(seq 1 20); do echo "select outcome from public.billing_checkout_claim_at('$SB', '$T');" >> "$d/c$i.sql"; done; done
  for i in 1 2 3 4 5 6 7 8; do P -tA -f "$d/c$i.sql" > "$d/co$i.txt" 2>"$d/ce$i.txt" & done
  wait
  got="$(cat "$d"/co?.txt | grep -c '^CLAIMED$' || true)"
  ok "$([ "$got" = "1" ] && echo 1 || echo 0)" "S1 eight real sessions racing one brokerage's checkout slot produce EXACTLY ONE 'make a checkout' answer (of 160)" "claimed=$got"
  got="$(cat "$d"/co?.txt | grep -c '^BUSY$' || true)"
  ok "$([ "$got" = "159" ] && echo 1 || echo 0)" "S2 and the other 159 are told BUSY" "busy=$got"
  ok "$([ ! -s "$d/ce1.txt" ] && [ ! -s "$d/ce5.txt" ] && echo 1 || echo 0)" "S3 no session raised an error while racing" "$(head -c 160 "$d/ce1.txt" "$d/ce5.txt" 2>/dev/null | tr '\n' ' ')"
  # (2) eight sessions race one client's minute: exactly thirty of 160 are admitted
  rm -f "$d"/*
  for i in 1 2 3 4 5 6 7 8; do : > "$d/w$i.sql"; for j in $(seq 1 20); do echo "select allowed from public.share_view_claim_at('$CL', null, '$T');" >> "$d/w$i.sql"; done; done
  for i in 1 2 3 4 5 6 7 8; do P -tA -f "$d/w$i.sql" > "$d/o$i.txt" 2>"$d/e$i.txt" & done
  wait
  got="$(cat "$d"/o?.txt | grep -c '^t$' || true)"
  ok "$([ "$got" = "30" ] && echo 1 || echo 0)" "S4 eight real sessions racing one client's minute admit EXACTLY thirty of 160" "admitted=$got"
  got="$(P -tA -c "select used from public.share_view_window where bucket='client' and subject='$CL' and window_secs=60")"
  ok "$([ "$got" = "30" ] && echo 1 || echo 0)" "S5 and the client's minute reads exactly 30" "used=$got"
  # (3) two owners remove the same agent AT THE SAME TIME, on purpose and not left to timing: owner A removes the agent and HOLDS the transaction open
  # for three seconds; owner B asks one second later. With the row lock B WAITS for A, then re-reads, finds it already done and answers false. Without it B
  # reads the agent as active, tries to end the membership too, and the membership guard raises: an error, not a clean false.
  rm -f "$d"/*
  local AGENT; AGENT="$(P -tA -c "select id from public.brokerage_member where user_id='f2100000-0000-4000-8000-000000000003'")"
  printf 'begin;\nselect public.brokerage_member_remove(%s, %s);\nselect pg_sleep(3);\ncommit;\n' "'f2100000-0000-4000-8000-000000000001'" "'$AGENT'" > "$d/a.sql"
  P -tA -f "$d/a.sql" > "$d/a.txt" 2>"$d/a.err" &
  sleep 1
  P -tA -c "select public.brokerage_member_remove('f2100000-0000-4000-8000-000000000002', '$AGENT')" > "$d/b.txt" 2>"$d/b.err" || true
  wait
  ok "$([ "$(grep -m1 -E '^[tf]$' "$d/a.txt")" = "t" ] && [ "$(head -1 "$d/b.txt")" = "f" ] && [ ! -s "$d/b.err" ] && echo 1 || echo 0)" "S6 two owners removing the same agent at once: the first is true, the second WAITS and answers false, with no error" "a=$(grep -m1 -E '^[tf]$' "$d/a.txt") b=$(head -1 "$d/b.txt") err=$(head -c 120 "$d/b.err")"
  # (3b) the same overlap for the checkout slot: A claims and holds its transaction for three seconds; B claims one second later. With the advisory lock B
  # WAITS, sees A's slot and is told BUSY. Without it B sees nothing, and is told to make a second checkout (CLAIMED).
  rm -f "$d"/*
  local T3='2033-01-01 00:00:00+00'
  printf 'begin;\nselect outcome from public.billing_checkout_claim_at(%s, %s);\nselect pg_sleep(3);\ncommit;\n' "'$SB'" "'$T3'" > "$d/a.sql"
  P -tA -f "$d/a.sql" > "$d/a.txt" 2>"$d/a.err" &
  sleep 1
  P -tA -c "select outcome from public.billing_checkout_claim_at('$SB', '$T3')" > "$d/b.txt" 2>"$d/b.err" || true
  wait
  ok "$([ "$(grep -m1 -E '^[A-Z]+$' "$d/a.txt")" = "CLAIMED" ] && [ "$(head -1 "$d/b.txt")" = "BUSY" ] && echo 1 || echo 0)" "S6b a second checkout claim that overlaps the first WAITS for it and is told BUSY: it can never be told to make a second checkout" "a=$(grep -m1 -E '^[A-Z]+$' "$d/a.txt") b=$(head -1 "$d/b.txt")"
  rm -rf "$d"
  # (4) above READ COMMITTED every writer is refused by name and changes nothing
  local before after
  before="$(P -tA -c "select (select count(*) from public.share_view_window) || '/' || (select count(*) from public.billing_checkout_claim) || '/' || (select count(*) from public.brokerage_member where status='active')")"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "begin isolation level repeatable read; select * from public.share_view_claim_at('$(printf '%040d' 9)', null, '$T'); rollback;" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'SHARE_VIEW_CLAIM_NEEDS_READ_COMMITTED' && echo 1 || echo 0)" "S7 a share-link claim above READ COMMITTED is refused by name" "$(echo "$out" | head -c 120)"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "begin isolation level repeatable read; select * from public.billing_checkout_claim_at('$SB', '2040-01-01 00:00:00+00'); rollback;" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'CHECKOUT_CLAIM_NEEDS_READ_COMMITTED' && echo 1 || echo 0)" "S8 a checkout claim above READ COMMITTED is refused by name" "$(echo "$out" | head -c 120)"
  P -c "insert into auth.users (id, email) values ('f2100000-0000-4000-8000-000000000004', 'race.agent2@example.test'); insert into public.brokerage_member (brokerage_id, user_id, role) values ('$SB', 'f2100000-0000-4000-8000-000000000004', 'agent');" >/dev/null
  local A2; A2="$(P -tA -c "select id from public.brokerage_member where user_id='f2100000-0000-4000-8000-000000000004'")"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "begin isolation level repeatable read; select public.brokerage_member_remove('f2100000-0000-4000-8000-000000000001', '$A2'); rollback;" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'needs READ COMMITTED' && [ "$(P -tA -c "select status from public.brokerage_member where id='$A2'")" = "active" ] && echo 1 || echo 0)" "S9 a removal above READ COMMITTED is refused and removes nothing" "$(echo "$out" | head -c 120)"
  after="$(P -tA -c "select (select count(*) from public.share_view_window) || '/' || (select count(*) from public.billing_checkout_claim) || '/' || (select count(*) from public.brokerage_member where status='active')")"
  ok "$([ "$before" != "" ] && [ "${after##*/}" = "$(( ${before##*/} + 1 ))" ] && [ "${after%%/*}" = "${before%%/*}" ] && echo 1 || echo 0)" "S10 none of the refused calls wrote a counter or a slot (only the agent the test itself added)" "$before -> $after"
  # (5) the API roles are refused by the database itself; the system role is let in to the functions only. The schema is opened to all three first (as on
  # Supabase), so a refusal is the OBJECT's privilege speaking; S13 is the control that the schema really is open.
  P -c "grant usage on schema public to anon, authenticated, service_role" >/dev/null
  local r denied=1 named=1 sig
  for r in anon authenticated; do
    for sig in "brokerage_team_of('$SB')" "brokerage_member_remove('$SB','$SB')" "share_view_claim('$CL', null)" "billing_checkout_claim('$SB')" "billing_checkout_release('$SB')" "share_view_limits()" "da_owner_safeguards_check()"; do
      out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role $r; select * from public.$sig;" 2>&1 || true)"
      echo "$out" | grep -q "permission denied for function" || { denied=0; echo "  not denied: $r $sig: $(echo "$out" | head -c 100)"; }
    done
    for t in share_view_window billing_checkout_claim; do
      out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role $r; select * from public.$t;" 2>&1 || true)"
      echo "$out" | grep -q "permission denied for table $t" || named=0
    done
  done
  ok "$denied" "S11 anon and authenticated are refused ('permission denied for function') for all seven callable functions, with the schema open to them"
  ok "$named" "S12 and for both tables ('permission denied for table')"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role service_role; select count(*) from public.billing_checkout_claim_at('$SB', '2040-01-01 00:00:00+00');" 2>&1 || true)"
  ok "$([ "$(echo "$out" | head -1)" = "1" ] && echo 1 || echo 0)" "S13 the system role (service_role) can call the functions (and so the schema above really was open)" "$out"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role service_role; select * from public.billing_checkout_claim;" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'permission denied for table billing_checkout_claim' && echo 1 || echo 0)" "S14 but not the tables: even the system role reaches them only through the functions" "$(echo "$out" | head -c 120)"
}

# ---- 0. the shipped SQL --------------------------------------------------------------------------------------------------------------------------
if [ "${MUTANT:-0}" = "0" ]; then
  # it refuses, creating nothing, when a layer it stands on is absent
  for gone in report-rate-limit brokerage-billing evaluation-entitlement brokerage-account-spine; do
    reset_db
    for f in "${DEPS[@]}"; do [ "$f" = "$gone" ] || P -f "$root/docs/$f.sql" >/dev/null 2>&1 || true; done
    out="$(psql -X -q -v ON_ERROR_STOP=1 -f "$SQL" 2>&1 || true)"
    ok "$(echo "$out" | grep -q 'da_owner_safeguards:' && [ "$(n_mine)" = "0" ] && echo 1 || echo 0)" "P-$gone with that layer absent the file REFUSES by name and creates nothing" "$(echo "$out" | head -c 160)"
  done
fi

apply_base
dep_before="$(fp_deps)"
P -f "$SQL" >/dev/null 2>"$here/.apply.err" || { echo "FAIL — the shipped SQL does not apply"; head -3 "$here/.apply.err"; rm -f "$here/.apply.err"; exit 1; }
rm -f "$here/.apply.err"
dep_after="$(fp_deps)"
ok "$([ "$dep_before" = "$dep_after" ] && echo 1 || echo 0)" "F1 applying it changes NOTHING it stands on (every other function, column, constraint, trigger and privilege is identical)" "$dep_before vs $dep_after"
ok "$([ "$(n_mine)" = "11" ] && echo 1 || echo 0)" "F2 it creates exactly eleven objects: nine functions and two tables" "$(n_mine)"

echo "---- suite.sql ----"
suite_out="$(P -tA -F'|' -f "$here/suite.sql" 2>&1)" || { echo "CRASH — suite.sql stopped before it finished"; echo "$suite_out" | tail -5; exit 3; }
echo "$suite_out" | while IFS='|' read -r name pass detail; do
  [ -z "$name" ] && continue
  if [ "$pass" = "t" ]; then echo "PASS — $name"; else echo "FAIL — $name${detail:+  [$detail]}"; fi
done > "$here/.suite.out"
cat "$here/.suite.out"
suite_fail="$(grep -c '^FAIL' "$here/.suite.out" || true)"; suite_n="$(grep -c '^\(PASS\|FAIL\)' "$here/.suite.out" || true)"
rm -f "$here/.suite.out"
n=$((n+suite_n)); bad=$((bad+suite_fail))

echo "---- real sessions ----"
scenarios

if [ "${MUTANT:-0}" = "0" ]; then
  echo "---- idempotence, rollback ----"
  mine1="$(fp_mine)"
  held_before="$(P -tA -c "select count(*) from public.share_view_window")"
  P -f "$SQL" >/dev/null 2>&1 || true
  ok "$([ "$(fp_mine)" = "$mine1" ] && echo 1 || echo 0)" "I1 applying it twice leaves the same objects, the same privileges and the same constraints"
  ok "$([ "$(P -tA -c "select count(*) from public.share_view_window")" = "$held_before" ] && echo 1 || echo 0)" "I2 and a second apply keeps the counters it already held"
  removed="$(P -tA -c "select count(*) from public.brokerage_member where status='deactivated'")"
  rollback_sql "$SQL" > "$here/.rb.sql"
  ok "$([ "$(wc -l < "$here/.rb.sql")" = "11" ] && echo 1 || echo 0)" "B0 the footer carries eleven rollback statements" "$(wc -l < "$here/.rb.sql")"
  P -f "$here/.rb.sql" >/dev/null 2>&1 || true
  ok "$([ "$(n_mine)" = "0" ] && echo 1 || echo 0)" "B1 the rollback removes every function and both tables it created" "$(n_mine)"
  ok "$([ "$(fp_deps)" = "$dep_before" ] && echo 1 || echo 0)" "B2 and nothing else: the entitlement, the billing layer and everything under them are exactly as before the file was applied"
  ok "$([ "$(P -tA -c 'select public.evaluation_report_limit() || chr(47) || public.billing_report_limit()')" = "10/100" ] && echo 1 || echo 0)" "B3 the founder's 10 free and 100 paid are still 10 and 100 after the rollback"
  ok "$([ "$(P -tA -c "select count(*) from public.brokerage_member where status='deactivated'")" = "$removed" ] && [ "$removed" -ge 1 ] && echo 1 || echo 0)" "B3b a removed agent STAYS removed after the rollback (membership rows are history; the rollback does not touch them)" "$removed"
  P -f "$here/.rb.sql" >/dev/null 2>&1 && ok 1 "B4 the rollback is repeatable (if exists)" || ok 0 "B4 the rollback is repeatable (if exists)"
  rm -f "$here/.rb.sql"
  P -f "$SQL" >/dev/null 2>&1 || true
  ok "$([ "$(fp_mine)" = "$mine1" ] && echo 1 || echo 0)" "B5 re-applying after the rollback gives exactly the first apply"
fi

echo
echo "$((n-bad)) passed, $bad failed of $n"
[ "$bad" = "0" ]
