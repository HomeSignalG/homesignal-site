#!/usr/bin/env bash
# Executable suite for the report rate limit (docs/report-rate-limit.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved reports, share links, property watch, payment-event
# ledger, report header and brokerage billing, applied unmutated, in the order production applied them.
#  1. applying the file changes NOTHING it stands on: a fingerprint of every other function, column, constraint, trigger and privilege in the public schema is
#     identical before and after (the credit ledgers, the 10 and the 100 and their triggers are not touched);
#  2. the shipped SQL passes every check of suite.sql;
#  3. REAL concurrent sessions: eight sessions racing one person's minute admit EXACTLY ten; sixteen sessions across four people of one brokerage race the
#     brokerage's minute and admit EXACTLY thirty; a claim above READ COMMITTED is refused (55000) and writes nothing; the API roles are refused by the database;
#  4. it applies twice with an identical result and keeps the counters it already held;
#  5. its ROLLBACK (the footer of the file, extracted and run) removes everything it created and nothing else, and re-applying gives the first apply;
#  6. it REFUSES, creating nothing, when a layer it stands on is absent;
#  7. each prohibited mutation fails >= 1 NAMED check (of suite.sql or of the scenarios above) or stops the apply. A mutation that makes the suite CRASH does
#     not count as killed: a crash names nothing, so it is reported and fails the run. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${RATE_SQL:-$root/docs/report-rate-limit.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing)
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() {
  local f
  for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done
  rm -f "$here/.dep.err"
}
apply_base() { reset_db; apply_deps; }
rollback_sql() { sed -n '/^-- ROLLBACK (this file only/,$p' "$1" | sed '1d' | grep '^-- drop' | sed 's/^-- //'; }

FN="(p.proname like 'report\\_rate\\_%')"
fp_mine() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN), '')
  || coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by column_name collate \"C\") from information_schema.columns where table_schema = 'public' and table_name = 'report_rate_window'), '')
  || coalesce((select string_agg(pg_get_constraintdef(oid), ',' order by conname collate \"C\") from pg_constraint where conrelid = to_regclass('public.report_rate_window')), '')
  || coalesce((select c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.report_rate_window')), ''))"; }
# everything this file stands on and must not touch
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and not $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name <> 'report_rate_window'), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> coalesce(to_regclass('public.report_rate_window'), 0::oid::regclass)), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname <> 'report_rate_window'), ''))"; }
n_mine() { P -tA -c "select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN) + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'report_rate_window')"; }

n=0; bad=0
ok() { n=$((n+1)); if [ "$1" = "1" ]; then echo "PASS — $2"; else bad=$((bad+1)); echo "FAIL — $2${3:+  [$3]}"; fi; }

# ---- the real-session scenarios (they build their own population) ------------------------------------------------------------------------------
RU1='f0000000-0000-4000-8000-000000000001'
RB='f1000000-0000-4000-8000-000000000001'
RUS=('f0000000-0000-4000-8000-000000000011' 'f0000000-0000-4000-8000-000000000012' 'f0000000-0000-4000-8000-000000000013' 'f0000000-0000-4000-8000-000000000014')
T='2032-06-01 09:30:00+00'
scenario_population() {
  P -c "insert into auth.users (id, email) values ('$RU1', 'race0@example.test'), ('${RUS[0]}', 'race1@example.test'), ('${RUS[1]}', 'race2@example.test'), ('${RUS[2]}', 'race3@example.test'), ('${RUS[3]}', 'race4@example.test');
        insert into public.brokerage_account (id, name) values ('$RB', 'Race Realty');
        insert into public.brokerage_member (brokerage_id, user_id, role) values ('$RB', '${RUS[0]}', 'owner'), ('$RB', '${RUS[1]}', 'agent'), ('$RB', '${RUS[2]}', 'agent'), ('$RB', '${RUS[3]}', 'agent');" >/dev/null
}
# a worker: 20 claims in separate transactions (each line of the script file is its own statement), printing t/f for each
worker_file() { local f="$1" u="$2" i; : > "$f"; for i in $(seq 1 20); do echo "select allowed from public.report_rate_claim_at('$u', '$T');" >> "$f"; done; }
count_allowed() { cat "$@" | grep -c '^t$' || true; }
scenarios() {
  scenario_population
  local w d i
  d="$(mktemp -d)"
  # (1) eight sessions race ONE person's minute: exactly ten are admitted, none lost, none added
  for i in 1 2 3 4 5 6 7 8; do worker_file "$d/w$i.sql" "$RU1"; done
  for i in 1 2 3 4 5 6 7 8; do P -tA -f "$d/w$i.sql" > "$d/o$i.txt" 2>"$d/e$i.txt" & done
  wait
  local got; got="$(count_allowed "$d"/o?.txt)"
  ok "$([ "$got" = "10" ] && echo 1 || echo 0)" "R1 eight real sessions racing one person's minute admit EXACTLY ten of their 160 requests" "admitted=$got"
  local used; used="$(P -tA -c "select used from public.report_rate_window where bucket='user' and subject='$RU1' and window_secs=60")"
  ok "$([ "$used" = "10" ] && echo 1 || echo 0)" "R2 and the person's minute reads exactly 10, not more" "used=$used"
  ok "$([ ! -s "$d/e1.txt" ] && [ ! -s "$d/e5.txt" ] && echo 1 || echo 0)" "R3 no session raised an error while racing (a lock that deadlocks would show here)" "$(head -c 160 "$d/e1.txt" "$d/e5.txt" 2>/dev/null | tr '\n' ' ')"
  # (1b) THE OVERLAP, ONCE, ON PURPOSE (not left to the race above, which is a matter of timing): person RU2 has used 9 of 10 in the minute. Session A claims the tenth
  # and HOLDS its transaction open for three seconds; session B claims one second later. With the locks B must WAIT for A, then read 10 and be refused. Without them B
  # reads 9 (A's write is not committed), is admitted, and the minute ends at 11.
  local RU2='f0000000-0000-4000-8000-000000000002' T2='2032-06-01 09:40:00+00'
  P -c "insert into auth.users (id, email) values ('$RU2', 'race-overlap@example.test');" >/dev/null
  for i in 1 2 3 4 5 6 7 8 9; do P -tA -c "select allowed from public.report_rate_claim_at('$RU2', '$T2')" >/dev/null; done
  printf 'begin;\nselect allowed from public.report_rate_claim_at(%s, %s);\nselect pg_sleep(3);\ncommit;\n' "'$RU2'" "'$T2'" > "$d/a.sql"
  P -tA -f "$d/a.sql" > "$d/a.txt" 2>"$d/a.err" &
  sleep 1
  P -tA -c "select allowed from public.report_rate_claim_at('$RU2', '$T2')" > "$d/b.txt" 2>"$d/b.err"
  wait
  ok "$([ "$(grep -m1 -E '^[tf]$' "$d/a.txt")" = "t" ] && [ "$(head -1 "$d/b.txt")" = "f" ] && echo 1 || echo 0)" "R3b a claim that overlaps another open claim of the same person WAITS for it: the tenth is admitted, the eleventh (one second later, while the tenth is still uncommitted) is refused" "a=$(grep -m1 -E '^[tf]$' "$d/a.txt") b=$(head -1 "$d/b.txt")"
  used="$(P -tA -c "select used from public.report_rate_window where bucket='user' and subject='$RU2' and window_secs=60")"
  ok "$([ "$used" = "10" ] && echo 1 || echo 0)" "R3c and the person's minute reads exactly 10 after the overlap, not 11" "used=$used"
  # (2) sixteen sessions, four people of one brokerage: the brokerage's minute admits exactly thirty (each person alone could take ten)
  rm -f "$d"/*
  w=0; for u in "${RUS[@]}"; do for i in 1 2 3 4; do w=$((w+1)); worker_file "$d/w$w.sql" "$u"; done; done
  for i in $(seq 1 $w); do P -tA -f "$d/w$i.sql" > "$d/o$i.txt" 2>"$d/e$i.txt" & done
  wait
  got="$(count_allowed "$d"/o*.txt)"
  ok "$([ "$got" = "30" ] && echo 1 || echo 0)" "R4 sixteen real sessions across four people of one brokerage admit EXACTLY thirty: the brokerage's ceiling, not the sum of the people's" "admitted=$got"
  used="$(P -tA -c "select used from public.report_rate_window where bucket='brokerage' and subject='$RB' and window_secs=60")"
  ok "$([ "$used" = "30" ] && echo 1 || echo 0)" "R5 and the brokerage's minute reads exactly 30" "used=$used"
  local over; over="$(P -tA -c "select count(*) from public.report_rate_window w join public.report_rate_limits() l on l.bucket=w.bucket and l.window_secs=w.window_secs where w.used > l.max_requests")"
  ok "$([ "$over" = "0" ] && echo 1 || echo 0)" "R6 no counter anywhere is above its limit after both races" "over=$over"
  rm -rf "$d"
  # (3) a claim above READ COMMITTED is refused and writes nothing
  local before after out
  before="$(P -tA -c "select count(*) from public.report_rate_window")"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "begin isolation level repeatable read; select * from public.report_rate_claim_at('$RU1', '$T'); rollback;" 2>&1 || true)"
  after="$(P -tA -c "select count(*) from public.report_rate_window")"
  ok "$(echo "$out" | grep -q 'RATE_CLAIM_NEEDS_READ_COMMITTED' && [ "$before" = "$after" ] && echo 1 || echo 0)" "R7 a claim above READ COMMITTED is refused by name (RATE_CLAIM_NEEDS_READ_COMMITTED) and writes nothing" "$(echo "$out" | head -c 160)"
  # (4) the API roles are refused by the database itself; the system role is let in to the functions only. The schema is opened to all three first (as on
  # Supabase), so a refusal below is the OBJECT's privilege speaking, not a closed schema; R9 is the control that the schema really is open.
  P -c "grant usage on schema public to anon, authenticated, service_role" >/dev/null
  local r denied=1 named=1
  for r in anon authenticated; do
    out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role $r; select * from public.report_rate_claim('$RU1');" 2>&1 || true)"
    echo "$out" | grep -q 'permission denied for function report_rate_claim' || denied=0
    out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role $r; select * from public.report_rate_window;" 2>&1 || true)"
    echo "$out" | grep -q 'permission denied for table report_rate_window' || named=0
  done
  ok "$denied" "R8 anon and authenticated are refused by the database for the claim itself ('permission denied for function report_rate_claim'), with the schema open to them"
  ok "$named" "R8b and for the counter table ('permission denied for table report_rate_window')"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role service_role; select allowed from public.report_rate_claim('${RUS[0]}');" 2>&1 || true)"
  local sr; sr="$(echo "$out" | head -1)"
  ok "$([ "$sr" = "t" ] || [ "$sr" = "f" ] && echo 1 || echo 0)" "R9 the system role (service_role) can make a claim through the function (and so the schema above really was open)" "$out"
  out="$(psql -X -q -tA -v ON_ERROR_STOP=0 -c "set role service_role; select * from public.report_rate_window;" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'permission denied for table report_rate_window' && echo 1 || echo 0)" "R10 but not the table: even the system role reaches the counters only through the functions" "$(echo "$out" | head -c 120)"
}

# ---- 0. the shipped SQL --------------------------------------------------------------------------------------------------------------------------
if [ "${MUTANT:-0}" = "0" ]; then
  # 6 first: it refuses, creating nothing, when a layer it stands on is absent
  reset_db
  for f in "${DEPS[@]}"; do [ "$f" = "brokerage-billing" ] || P -f "$root/docs/$f.sql" >/dev/null 2>&1; done
  out="$(psql -X -q -v ON_ERROR_STOP=1 -f "$SQL" 2>&1 || true)"
  ok "$(echo "$out" | grep -q 'billing_report_limit' && [ "$(n_mine)" = "0" ] && echo 1 || echo 0)" "P1 with the billing layer absent the file REFUSES by name and creates nothing" "$(echo "$out" | head -c 160)"
  reset_db
  for f in "${DEPS[@]}"; do [ "$f" = "brokerage-account-spine" ] && continue; P -f "$root/docs/$f.sql" >/dev/null 2>&1 || true; done
  out="$(psql -X -q -v ON_ERROR_STOP=1 -f "$SQL" 2>&1 || true)"
  ok "$([ "$(n_mine)" = "0" ] && echo 1 || echo 0)" "P2 with the account spine absent it also creates nothing" "$(echo "$out" | head -c 160)"
fi

apply_base
dep_before="$(fp_deps)"
P -f "$SQL" >/dev/null 2>"$here/.apply.err" || { echo "FAIL — the shipped SQL does not apply"; head -3 "$here/.apply.err"; rm -f "$here/.apply.err"; exit 1; }
rm -f "$here/.apply.err"
dep_after="$(fp_deps)"
ok "$([ "$dep_before" = "$dep_after" ] && echo 1 || echo 0)" "F1 applying it changes NOTHING it stands on (every other function, column, constraint, trigger and privilege is identical)" "$dep_before vs $dep_after"
ok "$([ "$(n_mine)" = "5" ] && echo 1 || echo 0)" "F2 it creates exactly five objects: four functions (report_rate_limits, _claim_at, _claim, _check) and one table (report_rate_window)" "$(n_mine)"

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
  P -c "insert into auth.users (id, email) values ('f0000000-0000-4000-8000-0000000000aa', 'idem@example.test') on conflict do nothing;" >/dev/null
  P -tA -c "select allowed from public.report_rate_claim_at('f0000000-0000-4000-8000-0000000000aa', '2033-01-01 00:00:00+00')" >/dev/null
  P -f "$SQL" >/dev/null 2>&1 || true
  ok "$([ "$(fp_mine)" = "$mine1" ] && echo 1 || echo 0)" "I1 applying it twice leaves the same objects, the same privileges and the same constraints"
  kept="$(P -tA -c "select used from public.report_rate_window where subject='f0000000-0000-4000-8000-0000000000aa' and window_secs=60")"
  ok "$([ "$kept" = "1" ] && echo 1 || echo 0)" "I2 and a second apply keeps the counters it already held" "used=$kept"
  rollback_sql "$SQL" > "$here/.rb.sql"
  ok "$([ "$(wc -l < "$here/.rb.sql")" = "5" ] && echo 1 || echo 0)" "B0 the footer carries five rollback statements" "$(wc -l < "$here/.rb.sql")"
  P -f "$here/.rb.sql" >/dev/null 2>&1 || true
  ok "$([ "$(n_mine)" = "0" ] && echo 1 || echo 0)" "B1 the rollback removes every function and the table it created" "$(n_mine)"
  ok "$([ "$(fp_deps)" = "$dep_before" ] && echo 1 || echo 0)" "B2 and nothing else: the entitlement, the billing layer and everything under them are exactly as before the file was applied"
  ok "$([ "$(P -tA -c 'select public.evaluation_report_limit() || chr(47) || public.billing_report_limit()')" = "10/100" ] && echo 1 || echo 0)" "B3 the founder's 10 free and 100 paid are still 10 and 100 after the rollback"
  P -f "$here/.rb.sql" >/dev/null 2>&1 && ok 1 "B4 the rollback is repeatable (if exists)" || ok 0 "B4 the rollback is repeatable (if exists)"
  rm -f "$here/.rb.sql"
  P -f "$SQL" >/dev/null 2>&1 || true
  ok "$([ "$(fp_mine)" = "$mine1" ] && echo 1 || echo 0)" "B5 re-applying after the rollback gives exactly the first apply"
fi

echo
echo "$((n-bad)) passed, $bad failed of $n"
[ "$bad" = "0" ]
