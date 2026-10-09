#!/usr/bin/env bash
# Executable suite for the individual-agent signup (docs/individual-agent-signup.sql, Order L2) against a DISPOSABLE Postgres (never production).
# 1. every layer it stands on is applied UNMUTATED and in production's order, a LEGACY brokerage (members, credits, a stored report) is seeded,
#    fingerprinted, THEN the L2 file is applied and the legacy rows must be byte-identical;
# 2. the suite (suite.sql): signup -> account + owner + evaluation; replay; refusals; no team can form; 10 reports then refusal; billing reads it;
# 3. REAL concurrent sessions: twenty simultaneous signups of ONE person make exactly one account; two simultaneous member inserts into one
#    individual account leave exactly one member;
# 4. the file applies twice with an identical definition; it refuses to apply without its layers;
# 5. the ROLLBACK footer removes exactly this file's objects and the file re-applies;
# 6. each prohibited mutation of the SQL fails >= 1 check. A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${SIGNUP_SQL:-$root/docs/individual-agent-signup.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$here/fixture.sql" >/dev/null; }
apply_deps() { local f; for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>"$tmp/dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$tmp/dep.err"; exit 1; }; done; }
seed_legacy() {
  P -q >/dev/null <<'SQL'
insert into auth.users (id, email, email_confirmed_at) values
  ('b0000000-0000-4000-8000-000000000001', 'owner@legacy.test', now()), ('b0000000-0000-4000-8000-000000000002', 'agent@legacy.test', now());
create temp table t as select * from public.evaluation_create('Legacy Brokerage');
select public.evaluation_invite_redeem((select owner_token from t), 'b0000000-0000-4000-8000-000000000001') ;
create temp table ta as select token from public.evaluation_invite_mint((select evaluation_id from t), 'agent', 'b0000000-0000-4000-8000-000000000001');
select public.evaluation_invite_redeem((select token from ta), 'b0000000-0000-4000-8000-000000000002');
select public.evaluation_report_issue('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{"legacy":1}', encode(sha256(convert_to('{"legacy":1}','UTF8')),'hex'), 'engine-v1', '{}'::jsonb, null);
select public.evaluation_report_issue('b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '{"legacy":2}', encode(sha256(convert_to('{"legacy":2}','UTF8')),'hex'), 'engine-v1', '{}'::jsonb, null);
SQL
}
base() { reset_db; apply_deps; seed_legacy; }
fp_before() { P -tA -f "$here/fp.sql" | tail -1; }
defs() { P -tA -c "select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname), '')) || '/' || (select count(*) from pg_trigger where tgname like '%individual%' or tgname = 'brokerage_account_type_guard_trg') || '/' || (select count(*) from information_schema.columns where table_name='brokerage_account' and column_name='account_type') from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'individual\_%' or p.proname like 'brokerage\_account\_type%' or p.proname in ('brokerage_member_individual_guard','evaluation_invite_individual_guard'))"; }
suite() { P -tA -F'|' -v "before_fp=$1" -v "fpfile=$here/fp.sql" -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

fail=0; ok() { echo "PASS — $1"; }; bad() { echo "FAIL — $1"; fail=1; }

race() {  # twenty simultaneous signups of ONE person; echoes "accounts members creators errors"
  P -c "insert into auth.users (id, email, email_confirmed_at) values ('e0000000-0000-4000-8000-000000000001','race@x.test', now()), ('e0000000-0000-4000-8000-000000000002','race2@x.test', now()) on conflict do nothing" >/dev/null
  rm -f "$tmp"/r*.out
  for i in $(seq 1 20); do ( psql -X -q -tA -c "begin; select replayed from public.individual_signup('e0000000-0000-4000-8000-000000000001', 'Racer'); select pg_sleep(0.6); commit;" >"$tmp/r$i.out" 2>&1 || true ) & done; wait
  echo "$(P -tA -c "select count(*) from public.brokerage_account where name = 'Racer'") $(P -tA -c "select count(*) from public.brokerage_member where user_id = 'e0000000-0000-4000-8000-000000000001'") $(cat "$tmp"/r*.out | grep -c '^f$' || true) $(cat "$tmp"/r*.out | grep -c -i 'error' || true)"
}

# ---- 1+2. the suite on the real SQL, after a legacy brokerage was fingerprinted --------------------------------------------------
base; BEFORE="$(fp_before)"; [ -n "$BEFORE" ] || { echo "FAIL — no legacy fingerprint"; exit 1; }
P -f "$SQL" >/dev/null 2>"$tmp/apply.err" || { echo "FAIL — docs/individual-agent-signup.sql does not apply"; head -5 "$tmp/apply.err"; exit 1; }
out="$(suite "$BEFORE")"; echo "$out" | awk -F'|' '{printf "%s %s\n", ($2=="t"?"PASS":"FAIL"), $1}'
[ "$(fails_of "$out")" = 0 ] && [ "$(grep -c '|t|' <<<"$out")" -ge 20 ] && ok "the suite: every check passes ($(grep -c '|t|' <<<"$out") checks)" || { bad "the suite has failing checks"; echo "$out" | grep '|f|' | head -20; }

# ---- 3. REAL concurrent sessions ---------------------------------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null
P -c "insert into auth.users (id, email, email_confirmed_at) values ('e0000000-0000-4000-8000-000000000001','race@x.test', now()), ('e0000000-0000-4000-8000-000000000002','race2@x.test', now())" >/dev/null
read -r n_acct n_mem n_new n_err <<<"$(race)"
[ "$n_acct" = 1 ] && [ "$n_mem" = 1 ] && [ "$n_new" = 1 ] && [ "$n_err" = 0 ] && ok "twenty simultaneous signups of one person: 1 account, 1 membership, exactly 1 creator, 19 replays, 0 errors" || bad "race: accounts=$n_acct members=$n_mem creators=$n_new errors=$n_err"
acct="$(P -tA -c "select brokerage_id from public.brokerage_member where user_id = 'e0000000-0000-4000-8000-000000000001'")"
( psql -X -q -tA -c "begin; insert into public.brokerage_member (brokerage_id, user_id, role) values ('$acct','e0000000-0000-4000-8000-000000000002','owner'); select pg_sleep(2); commit;" >"$tmp/h1.out" 2>&1 || true ) &
sleep 0.7
psql -X -q -tA -c "insert into public.brokerage_member (brokerage_id, user_id, role) values ('$acct','e0000000-0000-4000-8000-000000000002','owner')" >"$tmp/h2.out" 2>&1 || true; wait
two="$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$acct' and status = 'active'")"
[ "$two" -le 2 ] && [ "$two" = 1 ] && ok "two simultaneous member inserts into one individual account: exactly one active member remains" || bad "simultaneous inserts left $two active members"
# REPEATABLE READ cannot slip a second member in
rr="$(psql -X -q -tA -c "begin isolation level repeatable read; insert into public.brokerage_member (brokerage_id, user_id, role) values ('$acct','e0000000-0000-4000-8000-000000000002','owner'); commit;" 2>&1 || true)"
echo "$rr" | grep -q "needs READ COMMITTED" && ok "at REPEATABLE READ an insert into an individual account is refused rather than risked" || bad "repeatable read insert was not refused: $rr"

# ---- 4. idempotent apply, and it refuses without its layers ---------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null; D1="$(defs)"; P -f "$SQL" >/dev/null; D2="$(defs)"
[ "$D1" = "$D2" ] && [ -n "$D1" ] && ok "the file applies twice with an identical definition ($D1)" || bad "second apply changed the definition: $D1 vs $D2"
reset_db; if P -f "$SQL" >/dev/null 2>"$tmp/pre.err"; then bad "applied without its layers"; else grep -q "account spine" "$tmp/pre.err" && ok "without the account spine the file refuses and says why" || bad "refused for the wrong reason: $(head -2 "$tmp/pre.err")"; fi

# ---- 5. the ROLLBACK footer ------------------------------------------------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null; P -c "select * from public.individual_signup((select id from auth.users limit 1), 'x')" >/dev/null 2>&1 || true
sed -n '/^-- ROLLBACK/,$p' "$SQL" | grep -E '^--   (drop|alter)' | sed -E 's/^--   //; s/ *--.*$//' > "$tmp/rollback.sql"
P -c "delete from public.brokerage_member where brokerage_id in (select id from public.brokerage_account where account_type='individual'); delete from public.evaluation_event where evaluation_id in (select evaluation_id from public.evaluation e join public.brokerage_account a on a.id=e.brokerage_id where a.account_type='individual'); delete from public.evaluation where brokerage_id in (select id from public.brokerage_account where account_type='individual'); delete from public.brokerage_account where account_type='individual'" >/dev/null 2>&1 || true
P -f "$tmp/rollback.sql" >/dev/null 2>"$tmp/rb.err" && P -c "alter table public.brokerage_account drop column account_type" >/dev/null 2>>"$tmp/rb.err" && [ "$(defs)" = "d41d8cd98f00b204e9800998ecf8427e/0/0" ] && ok "the rollback footer removes exactly this file's objects" || bad "rollback left objects: $(defs) $(head -2 "$tmp/rb.err")"
P -f "$SQL" >/dev/null && ok "and the file re-applies after a rollback" || bad "re-apply after rollback failed"

# ---- 6. prohibited mutations ----------------------------------------------------------------------------------------------------------------------
mutate() {  # name, python expression text replace: old -> new (anchor must exist)
  local name="$1" old="$2" new="$3"
  python3 - "$SQL" "$tmp/mut.sql" "$old" "$new" <<'PY' || { bad "mutation '$name': anchor missing (harness failure)"; return; }
import sys
s=open(sys.argv[1]).read(); old,new=sys.argv[3],sys.argv[4]
assert s.count(old)>=1, 'anchor'
open(sys.argv[2],'w').write(s.replace(old,new,1))
PY
  base; BEFORE="$(fp_before)"
  if ! P -f "$tmp/mut.sql" >/dev/null 2>&1; then ok "mutation '$name' is refused at apply"; return; fi
  local o; o="$(suite "$BEFORE" 2>&1 || true)"
  local rc; rc="$(race 2>&1 | tail -1)"
  if [ "$rc" != "1 1 1 0" ]; then ok "mutation '$name' fails the concurrency check ($rc)"; elif [ "$(fails_of "$o")" -ge 1 ]; then ok "mutation '$name' fails $(fails_of "$o") check(s)"; elif ! grep -q '|t|' <<<"$o"; then ok "mutation '$name' aborts the suite (detected)"; else bad "mutation '$name' SURVIVED"; fi
}
mutate "no individual member guard"      "if v_type is distinct from 'individual' then" "if true then"
mutate "agents allowed in individual"    "if new.role <> 'owner' then" "if false then"
mutate "more than one member allowed"    "if new.status = 'active' and exists (select 1 from public.brokerage_member m where m.brokerage_id = new.brokerage_id and m.status = 'active') then" "if false then"
mutate "invites allowed"                 "where e.evaluation_id = new.evaluation_id and a.account_type = 'individual') then" "where e.evaluation_id = new.evaluation_id and a.account_type = 'never') then"
mutate "type can change"                 "if new.account_type is distinct from old.account_type then" "if false then"
mutate "unconfirmed email accepted"      "or not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null)" "or false"
mutate "seats open on individual"        "insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)" "insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, null)"
mutate "signup not idempotent"           "if v_exist.account_type = 'individual' and v_exist.role = 'owner' then" "if false then"
mutate "member of another brokerage can sign up" "raise exception using errcode = 'EV004', message = 'ALREADY_A_MEMBER';" "return;"
mutate "no advisory lock"                "perform pg_advisory_xact_lock(hashtextextended('individual_signup:' || p_user_id::text, 0));" "null;"
mutate "signup callable by anon"         "grant execute on function %s to service_role" "grant execute on function %s to service_role, anon"
mutate "new accounts typed brokerage"    "values (v_name, 'individual')" "values (v_name, 'brokerage')"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
