#!/usr/bin/env bash
# Executable suite for the evaluation entitlement (docs/evaluation-entitlement.sql) against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check of the suite, standing on the REAL account spine, private-context layer and snapshot writer;
# 2. REAL concurrent sessions: two issues serialise and both succeed; the last credit goes to exactly one of two callers; the same key
#    from two callers is one credit; a member removed while their call waits is refused; thirty callers race for ten credits and exactly ten win; one token and one seat go to one person;
#    and at REPEATABLE READ and SERIALIZABLE a writer that BYPASSES the functions still cannot put an 11th row in the ledger (the cap is a
#    constraint, not a lock);
# 3. the token hash stored is the SHA-256 that an independent tool (sha256sum) computes from the token;
# 4. it applies twice with an identical result;
# 5. a poisoned state (a policy, a stray grant to a table, a sequence or a function, to a named or an unnamed role) is refused or repaired;
# 6. the ROLLBACK footer removes exactly this file's objects and leaves the account spine, the private layer and the snapshot as they were;
# 7. each prohibited mutation fails >= 1 check (the kind of check that must catch it is named by test/evaluation_entitlement_mutants.py).
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SPINE="$root/docs/brokerage-account-spine.sql"
PRIV="$root/docs/report-private-context.sql"
SNAP="$root/docs/report-snapshot.sql"
SQL="$root/docs/evaluation-entitlement.sql"
MUTS="$root/test/evaluation_entitlement_mutants.py"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$here/fixture.sql" >/dev/null; }
# the three layers this file stands on, applied UNMUTATED and in their own order
apply_deps() {
  P -f "$SPINE" >/dev/null 2>&1 || { echo "FAIL — the account spine does not apply"; exit 1; }
  P -f "$PRIV" >/dev/null 2>&1  || { echo "FAIL — the private context does not apply"; exit 1; }
  P -f "$SNAP" >/dev/null 2>&1  || { echo "FAIL — the snapshot does not apply"; exit 1; }
}
apply_base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
fingerprint() { P -tA -f "$here/fingerprint.sql"; }

# ---- helpers for the real-session scenarios ----------------------------------------------------------------------------------
uid() { printf 'f%07d-0000-4000-8000-%012d' "$1" "$2"; }       # scenario, n  -> a uuid
add_user() { P -c "insert into auth.users (id, email) values ('$1', 'race@example.test') on conflict do nothing" >/dev/null; }
mk_eval() { P -tA -F ' ' -c "select evaluation_id, owner_token from public.evaluation_create('$1'${2:-})"; }
join_owner() { P -tA -c "select role from public.evaluation_invite_redeem('$2', '$1')" >/dev/null; }
issue_sql() { printf "select r.credit_ordinal || ',' || r.credits_used || ',' || r.evaluation_status || ',' || r.replayed || ',' || r.report_id from (select '{\"n\":%s}'::text as b) x cross join lateral public.evaluation_report_issue('%s', '%s', x.b, encode(sha256(convert_to(x.b, 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null) r" "$3" "$1" "$2"; }
snaps() { P -tA -c "select count(*) from public.report_snapshot"; }
ords() { P -tA -c "select coalesce(string_agg(ordinal::text, ',' order by ordinal), '') from public.evaluation_credit where evaluation_id = '$1'"; }
status_of() { P -tA -c "select status from public.evaluation where evaluation_id = '$1'"; }
# a background session that holds its transaction open (sleeping) so a second session can be started INSIDE it
HOLD=2.5
holder() {   # name, sql [, isolation level]
  local lvl="${3:-}"; [ -n "$lvl" ] && lvl=" isolation level $lvl"
  ( PGAPPNAME="l1race-$1" psql -X -q -v ON_ERROR_STOP=1 -tA -c "begin$lvl; $2; select pg_sleep($HOLD); commit;" >"$tmp/$1.out" 2>&1 || true ) &
}
wait_hold() {   # until the named session is asleep inside its transaction
  local i
  for i in $(seq 1 150); do
    if [ "$(P -tA -c "select count(*) from pg_stat_activity where application_name = 'l1race-$1' and wait_event = 'PgSleep'")" != "0" ]; then return 0; fi
    sleep 0.1
  done
  return 1
}

# 1. two issues, one held: the second WAITS and then takes the next ordinal; both succeed
race_next() {
  local u e t k1 k2 s0
  u="$(uid 1 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Race Next')"; join_owner "$u" "$t"
  k1="$(uid 1 101)"; k2="$(uid 1 102)"; s0="$(snaps)"
  holder s1 "$(issue_sql "$u" "$k1" 1)"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "$(issue_sql "$u" "$k2" 2)" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q '^1,1,active,false,' "$tmp/s1.out" && grep -q '^2,2,active,false,' "$tmp/s2.out" && [ "$(ords "$e")" = "1,2" ] && [ "$(( $(snaps) - s0 ))" = "2" ]; then return 0; fi
  echo "    two concurrent issues should be ordinals 1 and 2, both succeeding; got ledger '$(ords "$e")'; s1: $(grep -v -e BEGIN -e COMMIT "$tmp/s1.out" | head -c 120); s2: $(head -c 160 "$tmp/s2.out")"; return 1
}
# 2. the LAST credit: one session holds it, a second asks for it meanwhile and must be told the evaluation is complete
race_last() {
  local u e t k1 k2 s0
  u="$(uid 2 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Race Last')"; join_owner "$u" "$t"
  P -c "do \$\$ begin for n in 1..9 loop perform public.evaluation_report_issue('$u', md5('rl' || n)::uuid, '{\"n\":1}', encode(sha256(convert_to('{\"n\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null); end loop; end \$\$" >/dev/null
  k1="$(uid 2 101)"; k2="$(uid 2 102)"; s0="$(snaps)"
  holder s1 "$(issue_sql "$u" "$k1" 1)"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "$(issue_sql "$u" "$k2" 2)" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q '^10,10,complete,false,' "$tmp/s1.out" && grep -q 'EVALUATION_COMPLETE' "$tmp/s2.out" && [ "$(P -tA -c "select count(*) from public.evaluation_credit where evaluation_id = '$e'")" = "10" ] \
     && [ "$(status_of "$e")" = "complete" ] && [ "$(( $(snaps) - s0 ))" = "1" ]; then return 0; fi
  echo "    the last credit should go to exactly one caller; ledger $(P -tA -c "select count(*) from public.evaluation_credit where evaluation_id = '$e'") rows, status $(status_of "$e"); s1: $(grep -v -e BEGIN -e COMMIT "$tmp/s1.out" | head -c 120); s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 3. the SAME key from two callers is ONE credit
race_same_key() {
  local u e t k s0 r1 r2
  u="$(uid 3 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Race Same Key')"; join_owner "$u" "$t"
  k="$(uid 3 101)"; s0="$(snaps)"
  holder s1 "$(issue_sql "$u" "$k" 1)"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "$(issue_sql "$u" "$k" 2)" >"$tmp/s2.out" 2>&1 || true
  wait
  r1="$(grep -E '^1,1,active,false,' "$tmp/s1.out" | cut -d, -f5 || true)"; r2="$(grep -E '^1,1,active,true,' "$tmp/s2.out" | cut -d, -f5 || true)"
  if [ -n "$r1" ] && [ "$r1" = "$r2" ] && [ "$(ords "$e")" = "1" ] && [ "$(( $(snaps) - s0 ))" = "1" ]; then return 0; fi
  echo "    the same key twice should be one credit and one report; ledger '$(ords "$e")'; s1: $(grep -v -e BEGIN -e COMMIT "$tmp/s1.out" | head -c 120); s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 4. a storm: thirty callers, ten credits. Exactly ten win, twenty are told EVALUATION_COMPLETE, the ledger is 1..10, and no refused call stored a snapshot
race_storm() {
  local u e t s0 n won full
  u="$(uid 4 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Race Storm')"; join_owner "$u" "$t"; s0="$(snaps)"
  for n in $(seq 1 30); do
    ( psql -X -q -v ON_ERROR_STOP=1 -tA -c "$(issue_sql "$u" "$(uid 4 $((200 + n)))" "$n")" >"$tmp/st$n.out" 2>&1 || true ) &
  done
  wait
  won="$(grep -lE '^[0-9]+,[0-9]+,(active|complete),(true|false),' "$tmp"/st*.out | wc -l)"; full="$(grep -l 'EVALUATION_COMPLETE' "$tmp"/st*.out | wc -l)"
  if [ "$won" = "10" ] && [ "$full" = "20" ] && [ "$(ords "$e")" = "$(seq -s, 1 10)" ] && [ "$(status_of "$e")" = "complete" ] && [ "$(( $(snaps) - s0 ))" = "10" ]; then return 0; fi
  echo "    30 callers for 10 credits: $won won, $full refused as complete, ledger '$(ords "$e")', status $(status_of "$e"), snapshots +$(( $(snaps) - s0 )); a sample refusal: $(grep -h -v -E '^[0-9]+,[0-9]+,' "$tmp"/st*.out | sort | uniq -c | head -3 | tr '\n' ' ')"; return 1
}
# 5. ONE token, two people: the second waits, then is told it cannot be used
race_redeem_token() {
  local ua ub e t b
  ua="$(uid 5 1)"; ub="$(uid 5 2)"; add_user "$ua"; add_user "$ub"; read -r e t <<<"$(mk_eval 'Race Token')"
  b="$(P -tA -c "select brokerage_id from public.evaluation where evaluation_id = '$e'")"
  holder s1 "select role from public.evaluation_invite_redeem('$t', '$ua')"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "select role from public.evaluation_invite_redeem('$t', '$ub')" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q '^owner$' "$tmp/s1.out" && grep -q 'INVITE_UNUSABLE' "$tmp/s2.out" \
     && [ "$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$b'")" = "1" ] && [ "$(P -tA -c "select user_id from public.brokerage_member where brokerage_id = '$b'")" = "$ua" ]; then return 0; fi
  echo "    one token redeemed by two people at once should seat exactly the first; s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 6. ONE seat, two agents: the second is told the seats are full
race_redeem_seat() {
  local u1 u2 e t b t1 t2
  u1="$(uid 6 1)"; u2="$(uid 6 2)"; add_user "$u1"; add_user "$u2"; read -r e t <<<"$(mk_eval 'Race Seat' ', 1')"
  b="$(P -tA -c "select brokerage_id from public.evaluation where evaluation_id = '$e'")"
  t1="$(P -tA -c "select token from public.evaluation_invite_mint('$e', 'agent')")"; t2="$(P -tA -c "select token from public.evaluation_invite_mint('$e', 'agent')")"
  holder s1 "select role from public.evaluation_invite_redeem('$t1', '$u1')"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "select role from public.evaluation_invite_redeem('$t2', '$u2')" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q '^agent$' "$tmp/s1.out" && grep -q 'SEAT_LIMIT_REACHED' "$tmp/s2.out" \
     && [ "$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$b' and role = 'agent' and status = 'active'")" = "1" ]; then return 0; fi
  echo "    a seat limit of 1 with two concurrent agents should seat one; agents: $(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$b' and role = 'agent'"); s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 7. ONE person, two invites to two brokerages at once: the account spine's index leaves them one membership
race_redeem_person() {
  local u ea eb ta tb
  u="$(uid 7 1)"; add_user "$u"; read -r ea ta <<<"$(mk_eval 'Race Person A')"; read -r eb tb <<<"$(mk_eval 'Race Person B')"
  holder s1 "select role from public.evaluation_invite_redeem('$ta', '$u')"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "select role from public.evaluation_invite_redeem('$tb', '$u')" >"$tmp/s2.out" 2>&1 || true
  wait
  if [ "$(P -tA -c "select count(*) from public.brokerage_member where user_id = '$u' and status = 'active'")" = "1" ] && grep -qE 'one_active_per_user|ALREADY_A_MEMBER' "$tmp/s2.out" \
     && [ "$(P -tA -c "select status from public.evaluation_invite where evaluation_id = '$eb' and role = 'owner'")" = "open" ]; then return 0; fi
  echo "    one person redeeming two invites at once should hold one membership; s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 7b. a member REMOVED while their call waits for the lock: the entitlement is asked again once the lock is held
race_removed_while_waiting() {
  local uo ua e t ta
  uo="$(uid 12 1)"; ua="$(uid 12 2)"; add_user "$uo"; add_user "$ua"; read -r e t <<<"$(mk_eval 'Race Removed')"; join_owner "$uo" "$t"
  ta="$(P -tA -c "select token from public.evaluation_invite_mint('$e', 'agent')")"; join_owner "$ua" "$ta"
  holder s1 "select 1 from public.evaluation where evaluation_id = '$e' for update; update public.brokerage_member set status = 'deactivated' where user_id = '$ua'"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "$(issue_sql "$ua" "$(uid 12 101)" 1)" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q 'NOT_ENTITLED' "$tmp/s2.out" && [ "$(ords "$e")" = "" ]; then return 0; fi
  echo "    a member removed while waiting for the lock must be refused once it is held; ledger '$(ords "$e")'; s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 7c. a mint while the evaluation is being REVOKED: the mint waits for the lock, then finds the evaluation ended; no invite is created for it
race_mint_while_revoking() {
  local e t
  read -r e t <<<"$(mk_eval 'Race Mint')"
  holder s1 "select public.evaluation_revoke('$e')"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  P -tA -c "select token from public.evaluation_invite_mint('$e', 'agent')" >"$tmp/s2.out" 2>&1 || true
  wait
  if grep -q 'NOT_ENTITLED' "$tmp/s2.out" && [ "$(P -tA -c "select count(*) from public.evaluation_invite where evaluation_id = '$e'")" = "1" ] && [ "$(status_of "$e")" = "revoked" ]; then return 0; fi
  echo "    a mint during a revocation must wait and then be refused; invites now $(P -tA -c "select count(*) from public.evaluation_invite where evaluation_id = '$e'"); s2: $(head -c 200 "$tmp/s2.out")"; return 1
}
# 8. the cap is a CONSTRAINT: at REPEATABLE READ and SERIALIZABLE, writers that BYPASS the function (their count of the ledger is stale by construction)
#    still cannot make an 11th row, nor two rows of one ordinal
race_constraint() {
  local lvl="$1" u e t s1 s2 s3 out2 out3 n
  n=$([ "$lvl" = "repeatable read" ] && echo 8 || echo 9)
  u="$(uid $n 1)"; add_user "$u"; read -r e t <<<"$(mk_eval "Race Constraint $lvl")"; join_owner "$u" "$t"
  P -c "do \$\$ begin for n in 1..9 loop perform public.evaluation_report_issue('$u', md5('rc$lvl' || n)::uuid, '{\"n\":1}', encode(sha256(convert_to('{\"n\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null); end loop; end \$\$" >/dev/null
  s1="$(P -tA -c "select report_id from public.report_snapshot_issue('{\"d\":1}', encode(sha256(convert_to('{\"d\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)")"
  s2="$(P -tA -c "select report_id from public.report_snapshot_issue('{\"d\":2}', encode(sha256(convert_to('{\"d\":2}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)")"
  s3="$(P -tA -c "select report_id from public.report_snapshot_issue('{\"d\":3}', encode(sha256(convert_to('{\"d\":3}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)")"
  holder s1 "select count(*) from public.evaluation_credit where evaluation_id = '$e'; insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values ('$e', 10, md5('first')::uuid, '$s1')" "$lvl"
  wait_hold s1 || { wait; echo "    the holding session never reached its sleep"; return 1; }
  out2="$(psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -tA -c "begin isolation level $lvl; select count(*) from public.evaluation_credit where evaluation_id = '$e'; select pg_sleep(1.2); insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values ('$e', 10, md5('second')::uuid, '$s2'); commit" 2>&1 || true)"
  wait
  out3="$(psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -tA -c "begin isolation level $lvl; insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values ('$e', 11, md5('third')::uuid, '$s3'); commit" 2>&1 || true)"
  if [ "$(P -tA -c "select count(*) from public.evaluation_credit where evaluation_id = '$e'")" = "10" ] && [ "$(ords "$e")" = "$(seq -s, 1 10)" ] && [ "$(status_of "$e")" = "complete" ] \
     && grep -qE '23505|40001' <<<"$out2" && grep -q '23514' <<<"$out3" && grep -q 'evaluation_credit_ordinal' <<<"$out3"; then return 0; fi
  echo "    at $lvl: ledger $(P -tA -c "select count(*) from public.evaluation_credit where evaluation_id = '$e'") rows, status $(status_of "$e"); the second writer: $(head -c 200 <<<"$out2"); the 11th: $(head -c 200 <<<"$out3")"; return 1
}
# 9. what holding the evaluation lock costs: one call through the REAL writer, 10 times
lock_hold() {
  local u e t out mx
  u="$(uid 10 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Lock Hold')"; join_owner "$u" "$t"
  out="$(P -c "do \$\$ declare t0 timestamptz; mx numeric := 0; tot numeric := 0; d numeric; begin
      for n in 1..10 loop
        t0 := clock_timestamp();
        perform public.evaluation_report_issue('$u', md5('lh' || n)::uuid, '{\"n\":1}', encode(sha256(convert_to('{\"n\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null);
        d := extract(epoch from clock_timestamp() - t0) * 1000; tot := tot + d; if d > mx then mx := d; end if;
      end loop;
      raise notice 'LOCK-HOLD max_ms=% avg_ms=%', round(mx, 2), round(tot / 10, 2);
    end \$\$" 2>&1 || true)"
  mx="$(sed -n 's/.*max_ms=\([0-9.]*\) .*/\1/p' <<<"$out" | head -1)"
  [ -n "$mx" ] || { echo "    could not measure the lock hold: $out"; return 1; }
  echo "  $(grep -o 'LOCK-HOLD.*' <<<"$out" | head -1) (the evaluation row is locked for the duration of one call, through the real snapshot writer, on this machine)"
  python3 -c "import sys; sys.exit(0 if float('$mx') < 2000 else 1)" || { echo "    one issue took ${mx} ms while holding the lock"; return 1; }
}
races() {
  local name
  for name in race_next race_last race_same_key race_storm race_redeem_token race_redeem_seat race_redeem_person race_removed_while_waiting race_mint_while_revoking; do
    "$name" || return 1
  done
  race_constraint "repeatable read" || return 1
  race_constraint "serializable" || return 1
  return 0
}

# 3. the stored hash is what an INDEPENDENT tool computes from the token
hash_check() {
  local e t h exp
  read -r e t <<<"$(mk_eval 'Hash Check Co')"
  h="$(P -tA -c "select token_hash from public.evaluation_invite where evaluation_id = '$e' and role = 'owner'")"
  exp="$(printf '%s' "$t" | sha256sum | cut -d' ' -f1)"
  if [ "$h" = "$exp" ] && [ "${#t}" = "69" ] && [[ "$t" =~ ^hse1_[0-9a-f]{64}$ ]]; then return 0; fi
  echo "    stored hash '$h' vs sha256sum '$exp' of a ${#t}-character token"; return 1
}

# 5. POISONED state: a policy would make a table readable; a stray grant to a table, the sequence or a function must be repaired or stopped
poisoned() {
  local file="$1" err
  P -c "create policy poison_read on public.evaluation_credit for select to authenticated using (true)" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"
  P -c "drop policy if exists poison_read on public.evaluation_credit" >/dev/null
  if ! grep -q 'has a policy' <<<"$err"; then echo "    a pre-existing policy did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  # a stray grant to a named API role is repaired by the apply (the revoke), for a table, the sequence and a function
  P -c "grant select on public.evaluation_invite to authenticated; grant usage on sequence public.evaluation_event_event_id_seq to anon;
        grant execute on function public.evaluation_guard() to anon; grant execute on function public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb) to authenticated" >/dev/null
  P -f "$file" >/dev/null 2>&1 || { echo "    the re-apply after stray grants failed"; return 1; }
  if [ "$(P -tA -c "select has_table_privilege('authenticated', 'public.evaluation_invite', 'select') or has_sequence_privilege('anon', 'public.evaluation_event_event_id_seq', 'usage')
                      or has_function_privilege('anon', 'public.evaluation_guard()', 'execute') or has_function_privilege('authenticated', 'public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)', 'execute')")" != "f" ]; then
    echo "    a stray grant to anon or authenticated (table, sequence or function) survived a re-apply"; return 1
  fi
  # a function that carries this file's prefix but is NOT one the file defines is locked too (the loop is computed, not typed)
  P -c "create function public.evaluation_probe() returns integer language sql as 'select 1'" >/dev/null
  P -c "grant execute on function public.evaluation_probe() to anon" >/dev/null
  P -f "$file" >/dev/null 2>&1 || { P -c "drop function public.evaluation_probe()" >/dev/null; echo "    the re-apply with a stray evaluation_ function failed"; return 1; }
  local anon_exec; anon_exec="$(P -tA -c "select has_function_privilege('anon', 'public.evaluation_probe()', 'execute')")"
  P -c "drop function public.evaluation_probe()" >/dev/null
  if [ "$anon_exec" != "f" ]; then echo "    a function with the file's prefix stayed executable by anon (the lock loop is not computed over the prefix)"; return 1; fi
  # a grant to a role the file does not name cannot be revoked by the file, so it must STOP the apply: on a table, on the sequence, on a function
  P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'evaluation_probe_role') then create role evaluation_probe_role; end if; end \$\$; grant select on public.evaluation_credit to evaluation_probe_role" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"; P -c "revoke all on public.evaluation_credit from evaluation_probe_role" >/dev/null
  if ! grep -q 'accessible to a role other than its owner' <<<"$err"; then echo "    a grant on a table to an unnamed role did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  P -c "grant usage on sequence public.evaluation_event_event_id_seq to evaluation_probe_role" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"; P -c "revoke all on sequence public.evaluation_event_event_id_seq from evaluation_probe_role" >/dev/null
  if ! grep -q 'the sequence .* is accessible to a role other than its owner' <<<"$err"; then echo "    a grant on the sequence to an unnamed role did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  P -c "grant execute on function public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb) to evaluation_probe_role" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"; P -c "revoke all on function public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb) from evaluation_probe_role" >/dev/null
  if ! grep -q 'executable by a role it should not be' <<<"$err"; then echo "    a grant on a function to an unnamed role did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  # a SECOND sequence behind the four tables (the lock-down is written for exactly one) stops the apply too
  P -c "alter table public.evaluation_event add column poison_seq bigint generated always as identity" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"; P -c "alter table public.evaluation_event drop column poison_seq" >/dev/null
  if ! grep -q 'expected exactly one sequence' <<<"$err"; then echo "    a second sequence behind the tables did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  return 0
}

# 6. the ROLLBACK footer removes exactly this file's objects
rollback_exact() {
  local before after e t u
  apply_base; P -f "$SQL" >/dev/null 2>&1 || { echo "    the SQL does not apply"; return 1; }
  u="$(uid 11 1)"; add_user "$u"; read -r e t <<<"$(mk_eval 'Rollback Co')"; join_owner "$u" "$t"
  P -tA -c "select credit_ordinal from public.evaluation_report_issue('$u', '$(uid 11 2)', '{\"n\":1}', encode(sha256(convert_to('{\"n\":1}', 'UTF8')), 'hex'), 'engine-v1', '{}'::jsonb, null)" >/dev/null
  before="$(P -tA -f "$here/fingerprint.sql")"
  sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$SQL" | sed '1d;$d' | sed 's/^--   //' >"$tmp/rollback.sql"
  [ -s "$tmp/rollback.sql" ] || { echo "    the ROLLBACK block is empty or not found"; return 1; }
  P -f "$tmp/rollback.sql" >/dev/null 2>&1 || { echo "    the ROLLBACK block does not run"; return 1; }
  if [ "$(P -tA -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%'")" != "0" ] \
     || [ "$(P -tA -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation%'")" != "0" ]; then
    echo "    objects named evaluation* survive the rollback: $(P -tA -c "select string_agg(relname, ',') from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%'")"; return 1
  fi
  # what it stood on is untouched: the spine's tables and resolver, the snapshot and its stored report, the private context
  [ "$(P -tA -c "select count(*) from public.report_snapshot")" = "1" ] || { echo "    the stored snapshot did not survive the rollback"; return 1; }
  [ "$(P -tA -c "select count(*) from public.brokerage_member where user_id = '$u' and role = 'owner'")" = "1" ] || { echo "    the membership written by the redeem function did not survive the rollback (it is documented to)"; return 1; }
  [ "$(P -tA -c "select count(*) from pg_proc where proname in ('brokerage_membership_of', 'report_snapshot_issue', 'report_private_context_create')")" = "3" ] || { echo "    a function the file stood on is gone"; return 1; }
  # and the file applies again to the same shape, empty
  P -f "$SQL" >/dev/null 2>&1 || { echo "    the file does not re-apply after its rollback"; return 1; }
  after="$(P -tA -f "$here/fingerprint.sql")"
  [ "$before" = "$after" ] || { echo "    the definition after rollback and re-apply differs from the first apply"; return 1; }
  [ "$(P -tA -c "select count(*) from public.evaluation")" = "0" ] || { echo "    the re-applied tables are not empty"; return 1; }
  return 0
}

# ------------------------------------------------------------------------------------------------------------------------------------------
apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
fp1="$(fingerprint)"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 75 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped evaluation entitlement does not pass"; exit 1; fi
if ! races; then echo "FAIL — a concurrent scenario did not give the promised answer"; exit 1; fi
echo "CONCURRENT: two issues serialise (ordinals 1 and 2); the last credit goes to one caller; one key is one credit; 30 callers win exactly 10 credits; one token and one seat go to one person; a member removed while waiting is refused; a mint during a revocation waits and is refused"
echo "ISOLATION: at REPEATABLE READ and SERIALIZABLE a writer that bypasses the functions still cannot add an 11th ledger row or repeat an ordinal (the cap is a constraint)"
if ! lock_hold; then echo "FAIL — the evaluation lock is held too long (or could not be measured)"; exit 1; fi
if ! hash_check; then echo "FAIL — the stored hash is not the SHA-256 of the token"; exit 1; fi
echo "TOKEN HASH: the hash stored for a minted token equals what sha256sum computes from it, and the token is 69 characters of hse1_ and hex"

# applying the file a second time must be a no-op (idempotent): same constraints, functions, grants, triggers, indexes
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(fingerprint)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"
if ! poisoned "$SQL"; then echo "FAIL — a poisoned state was not stopped or repaired by the apply"; exit 1; fi
echo "POISONED: a pre-existing policy stops the apply; stray grants on a table, the sequence and a function are revoked by it (including a function the file does not define); a grant to an unnamed role on any of them stops it; so does a second sequence behind the tables"
if ! rollback_exact; then echo "FAIL — the ROLLBACK footer is not exact"; exit 1; fi
echo "ROLLED BACK: the footer removes every evaluation* object and nothing else (the spine, the private layer and the stored snapshot stand), and the file applies again to the same definition"

status=0
while IFS= read -r name; do
  apply_base
  mutated_file="$tmp/mutated.sql"
  python3 "$MUTS" --sql "$name" "$SQL" >"$mutated_file" || { echo "HARNESS $name — anchor missing or nothing changed"; status=1; continue; }
  if ! P -f "$mutated_file" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  kind="$(python3 "$MUTS" --kind "$name")"
  case "$kind" in
    poison)
      if poisoned "$mutated_file" >"$tmp/why.txt" 2>&1; then echo "SURVIVED $name — a poisoned state still goes through"; status=1
      else echo "KILLED   $name — the poisoned-apply check failed:"; sed -n '1,2p' "$tmp/why.txt"; fi;;
    race)
      if races >"$tmp/why.txt" 2>&1; then echo "SURVIVED $name — the concurrent scenarios still give the promised answers"; status=1
      else echo "KILLED   $name — a concurrent scenario failed:"; sed -n '1,2p' "$tmp/why.txt"; fi;;
    *)
      # a mutation that makes the suite ERROR is caught too: an error is a failed check
      out="$(suite 2>&1)" || out="$out
suite errored|f|"
      n_fail=$(fails_of "$out")
      if [ "$n_fail" -gt 0 ]; then
        # print the first four failures. NOT `| head -4`: under pipefail, head exits after four lines while cut is still writing,
        # cut dies with "Broken pipe", and the run ends. `sed -n 1,4p` reads to the end, so nothing upstream is ever cut off.
        echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
      else
        echo "SURVIVED $name — the suite cannot see this regression"; status=1
      fi;;
  esac
done < <(python3 "$MUTS" --list)
apply_base
exit $status
