#!/usr/bin/env bash
# Executable suite for the brokerage account spine (docs/brokerage-account-spine.sql) against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check of the suite, and two sessions removing the two owners of one brokerage at once leave one;
# 2. it applies twice with an identical result;
# 3. a poisoned state (a policy that would make a table readable, or a grant to a role the file does not name) stops the apply, and a
#    stray grant to anon/authenticated is revoked by it; owner removal above READ COMMITTED is refused;
# 4. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() {
  P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/brokerage-account-spine.sql"
MUTS="$root/test/brokerage_account_mutants.py"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# CONCURRENT removal of the two owners of one brokerage. Session 1 deactivates owner A and holds its transaction open; session 2
# deactivates owner B meanwhile. With the guard serialised on the brokerage row, session 2 waits, then sees A gone and is refused;
# without it both pass and the brokerage is left with no owner.
concurrent() {
  local A='d2000000-0000-4000-8000-00000000000a' B='d2000000-0000-4000-8000-00000000000b' BR='d1000000-0000-4000-8000-000000000001'
  P -c "insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000a', 'race-a@example.test'), ('d0000000-0000-4000-8000-00000000000b', 'race-b@example.test');
        insert into public.brokerage_account (id, name) values ('$BR', 'Race Realty');
        insert into public.brokerage_member (id, brokerage_id, user_id, role) values
          ('$A', '$BR', 'd0000000-0000-4000-8000-00000000000a', 'owner'), ('$B', '$BR', 'd0000000-0000-4000-8000-00000000000b', 'owner');" >/dev/null
  ( P -c "begin; update public.brokerage_member set status = 'deactivated' where id = '$A'; select pg_sleep(5); commit;" >"$tmp/s1.out" 2>&1 || true ) &
  local pid=$!
  sleep 1.5
  local out2; out2="$(P -c "update public.brokerage_member set status = 'deactivated' where id = '$B'" 2>&1 || true)"
  wait "$pid" || true
  local active; active="$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$BR' and role = 'owner' and status = 'active'")"
  if [ "$active" = "1" ] && grep -q 'last active owner' <<<"$out2"; then return 0; fi
  echo "    owners still active after two concurrent removals: $active (expected 1); second session said: $(head -c 160 <<<"$out2")"
  return 1
}

# OWNER REMOVAL ABOVE READ COMMITTED is refused. The row lock in the guard serialises two removals only if the waiter then re-reads
# committed data; at REPEATABLE READ it keeps its old snapshot, sees the other owner still active, and both commit (measured on
# PostgreSQL 16: zero owners left). So the guard must refuse there, and must NOT refuse at READ COMMITTED (a blanket refusal would
# pass the first half). The positive control is the same removal at READ COMMITTED.
isolation_refused() {
  local A='d4000000-0000-4000-8000-00000000000a' B='d4000000-0000-4000-8000-00000000000b' BR='d3000000-0000-4000-8000-000000000001'
  P -c "insert into auth.users (id, email) values ('d5000000-0000-4000-8000-00000000000a', 'iso-a@example.test'), ('d5000000-0000-4000-8000-00000000000b', 'iso-b@example.test');
        insert into public.brokerage_account (id, name) values ('$BR', 'Isolation Realty');
        insert into public.brokerage_member (id, brokerage_id, user_id, role) values
          ('$A', '$BR', 'd5000000-0000-4000-8000-00000000000a', 'owner'), ('$B', '$BR', 'd5000000-0000-4000-8000-00000000000b', 'owner');" >/dev/null
  local lvl out
  for lvl in 'repeatable read' 'serializable'; do
    out="$(P -c "begin isolation level $lvl; update public.brokerage_member set status = 'deactivated' where id = '$A'; commit;" 2>&1 || true)"
    if ! grep -q 'needs READ COMMITTED' <<<"$out"; then echo "    an owner removal at $lvl was not refused (it said: $(head -c 160 <<<"$out"))"; return 1; fi
  done
  if [ "$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$BR' and role = 'owner' and status = 'active'")" != "2" ]; then
    echo "    a refused removal still changed the owners"; return 1
  fi
  out="$(P -c "update public.brokerage_member set status = 'deactivated' where id = '$A'" 2>&1 || true)"
  if grep -q 'ERROR' <<<"$out" || [ "$(P -tA -c "select count(*) from public.brokerage_member where brokerage_id = '$BR' and role = 'owner' and status = 'active'")" != "1" ]; then
    echo "    the same removal at READ COMMITTED did not go through (it said: $(head -c 160 <<<"$out"))"; return 1
  fi
  return 0
}

# POISONED state: a policy left on a table (it would make the memberships readable) must stop the apply, naming the policy; and a
# stray grant to authenticated must be gone after a re-apply (the apply repairs drift rather than reporting success over it).
poisoned() {
  local file="$1" err
  P -c "create policy poison_read on public.brokerage_member for select to authenticated using (true)" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"
  P -c "drop policy if exists poison_read on public.brokerage_member" >/dev/null
  if ! grep -q 'has a policy' <<<"$err"; then echo "    a pre-existing policy did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  P -c "grant select on public.brokerage_account to authenticated" >/dev/null
  P -f "$file" >/dev/null 2>&1 || { echo "    the re-apply after a stray grant failed"; return 1; }
  if [ "$(P -tA -c "select has_table_privilege('authenticated', 'public.brokerage_account', 'select')")" != "f" ]; then
    echo "    a stray grant to authenticated survived a re-apply"; return 1
  fi
  # a grant to a role the file does not name (so the apply's own revokes cannot clear it) must stop the apply: the post-condition
  # reads the table's whole ACL rather than a typed list of roles
  P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'brokerage_probe_role') then create role brokerage_probe_role; end if; end \$\$; grant select on public.brokerage_member to brokerage_probe_role" >/dev/null
  err="$(P -f "$file" 2>&1 >/dev/null || true)"
  P -c "revoke all on public.brokerage_member from brokerage_probe_role" >/dev/null
  if ! grep -q 'accessible to a role other than its owner' <<<"$err"; then echo "    a grant to an unnamed role did not stop the apply (it said: $(head -c 160 <<<"$err"))"; return 1; fi
  return 0
}

apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
fp1="$(P -tA -f "$here/fingerprint.sql")"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 45 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped spine does not pass"; exit 1; fi
if ! concurrent; then echo "FAIL — two concurrent removals of the two owners left the brokerage with none"; exit 1; fi
echo "CONCURRENT: two sessions removing the two owners of one brokerage at once leave exactly one"
if ! isolation_refused; then echo "FAIL — an owner removal above READ COMMITTED was not refused (or the READ COMMITTED control failed)"; exit 1; fi
echo "ISOLATION: removing an owner at REPEATABLE READ or SERIALIZABLE is refused; at READ COMMITTED it goes through"

# applying the file a second time must be a no-op (idempotent): same constraints, functions, grants, triggers, indexes
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(P -tA -f "$here/fingerprint.sql")"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"
if ! poisoned "$SQL"; then echo "FAIL — a poisoned state was not stopped or repaired by the apply"; exit 1; fi
echo "POISONED: a pre-existing policy stops the apply, and a stray grant is revoked by it"

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
      if concurrent >"$tmp/why.txt" 2>&1 && isolation_refused >>"$tmp/why.txt" 2>&1; then echo "SURVIVED $name — two owners can be removed at once"; status=1
      else echo "KILLED   $name — the owner race or the isolation check failed:"; sed -n '1,2p' "$tmp/why.txt"; fi;;
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
