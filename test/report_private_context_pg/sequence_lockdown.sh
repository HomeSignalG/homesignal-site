#!/usr/bin/env bash
# Executable proof for docs/report-private-context-sequence-lockdown.sql against a DISPOSABLE Postgres (never production).
# 1. the gap is REPRODUCED first: after docs/report-private-context.sql alone, anon, authenticated and service_role can use the
#    event counter (so a green "closed" result below means the file closed it, not that it was never open);
# 2. after the follow-up: closed to all three, the owner and every definer writer still work, a later sequence on the layer is
#    closed too, an unrelated sequence is NOT touched, a second apply changes nothing, and the two refusals fire;
# 3. each prohibited mutation of the follow-up is caught by >= 1 check. A mutation whose anchor is missing is a harness failure.
set -uo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
FIXTURE="$root/test/report_snapshot_pg/fixture.sql"
BASE="$root/docs/report-private-context.sql"
FOLLOW="$root/docs/report-private-context-sequence-lockdown.sql"
SEQ="public.report_private_context_event_event_id_seq"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
V() { psql -X -tA "$@"; }
reset() { P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$FIXTURE" >/dev/null; }

FAILS=0; CHECKS=0; QUIET=0
ck() {  # name, expected, actual
  CHECKS=$((CHECKS+1))
  if [ "$2" = "$3" ]; then [ "$QUIET" = 1 ] || echo "  ok    $1"; else FAILS=$((FAILS+1)); [ "$QUIET" = 1 ] || echo "  FAIL  $1 (expected '$2', got '$3')"; fi
}
usable() {  # role, sequence -> t/f: any of USAGE, SELECT, UPDATE
  V -c "select has_sequence_privilege('$1','$2','USAGE') or has_sequence_privilege('$1','$2','SELECT') or has_sequence_privilege('$1','$2','UPDATE')"
}

# One full run of every check against the follow-up file given as $1. The shipped file must give 0 failures; a mutation >= 1.
run_all() {
  local file="$1"
  FAILS=0; CHECKS=0

  # ---- scenario 1: the layer, plus two probe tables ------------------------------------------------------------
  reset; P -f "$BASE" >/dev/null 2>&1 || { echo "HARNESS: the base layer does not apply"; return 99; }
  # The API roles hold USAGE on the schema in Supabase (the existing suite grants it too). Without it a refusal below would be a
  # SCHEMA refusal and would prove nothing about the sequence.
  P -c "grant usage on schema public to anon, authenticated, service_role;
        create table public.report_private_context_probe (id bigint generated always as identity primary key, x int);
        create table public.unrelated_probe (id bigint generated always as identity primary key);" >/dev/null
  # An over-broad grant to PUBLIC (the pseudo-role every role belongs to): the follow-up must clear it, and without this a mutation
  # that forgets PUBLIC would be indistinguishable from a correct file (PUBLIC holds nothing by default).
  P -c "grant usage on sequence $SEQ to public" >/dev/null
  ck "BEFORE: PUBLIC holds a grant on the event counter (control for the PUBLIC check)" 1 "$(V -c "select count(*) from pg_class c, aclexplode(c.relacl) a where c.oid = '$SEQ'::regclass and a.grantee = 0")"
  PROBE_SEQ="$(V -c "select pg_get_serial_sequence('public.report_private_context_probe','id')")"
  UNREL_SEQ="$(V -c "select pg_get_serial_sequence('public.unrelated_probe','id')")"
  ck "BEFORE: anon can use the event counter (the gap exists)"               t "$(usable anon "$SEQ")"
  ck "BEFORE: authenticated can use the event counter"                       t "$(usable authenticated "$SEQ")"
  ck "BEFORE: service_role can use the event counter"                        t "$(usable service_role "$SEQ")"
  # Positive control for the two refusals below: before the fix the same calls SUCCEED, so a later refusal is the sequence's.
  out="$(psql -X -q -c "set role anon; select nextval('$SEQ')" 2>&1)"; ck "BEFORE: anon nextval succeeds (control for the refusal below)" t "$(grep -q 'permission denied' <<<"$out" && echo f || echo t)"
  out="$(psql -X -q -c "set role authenticated; select setval('$SEQ', 5)" 2>&1)"; ck "BEFORE: authenticated setval succeeds (control for the refusal below)" t "$(grep -q 'permission denied' <<<"$out" && echo f || echo t)"

  if P -f "$file" >/dev/null 2>&1; then applied=t; else applied=f; fi
  ck "the follow-up applies" t "$applied"
  if [ "$applied" = t ]; then
    ck "AFTER: anon cannot use the event counter"                            f "$(usable anon "$SEQ")"
    ck "AFTER: authenticated cannot use the event counter"                   f "$(usable authenticated "$SEQ")"
    ck "AFTER: service_role cannot use the event counter"                    f "$(usable service_role "$SEQ")"
    ck "AFTER: no grantee but the owner (PUBLIC included)" 0 "$(V -c "select count(*) from pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a where c.oid = '$SEQ'::regclass and a.grantee <> c.relowner")"
    ck "AFTER: a later sequence on this layer is closed to anon"             f "$(usable anon "$PROBE_SEQ")"
    ck "AFTER: a later sequence on this layer is closed to authenticated"    f "$(usable authenticated "$PROBE_SEQ")"
    ck "AFTER: a later sequence on this layer is closed to service_role"     f "$(usable service_role "$PROBE_SEQ")"
    ck "AFTER: an UNRELATED sequence is left exactly as it was (scope)"      t "$(usable anon "$UNREL_SEQ")"
    out="$(psql -X -q -c "set role anon; select nextval('$SEQ')" 2>&1)"; ck "AFTER: anon nextval is refused (permission denied)" t "$(grep -q 'permission denied' <<<"$out" && echo t || echo f)"
    out="$(psql -X -q -c "set role authenticated; select setval('$SEQ', 9223372036854775000)" 2>&1)"; ck "AFTER: authenticated setval is refused (permission denied)" t "$(grep -q 'permission denied' <<<"$out" && echo t || echo f)"
    before_n="$(V -c "select count(*) from public.report_private_context_event")"
    w="$(V -c "set role service_role; select public.report_private_context_create(jsonb_build_object('address','1 Test St'), 'report', 'r1') is not null" 2>&1 | tail -1)"
    after_n="$(V -c "select count(*) from public.report_private_context_event")"
    ck "AFTER: a definer writer still works as service_role (creates a context)" t "$w"
    ck "AFTER: ...and its audit event was written (the counter still issues ids)" t "$([ "$after_n" -gt "$before_n" ] && echo t || echo f)"
    acl1="$(V -c "select relacl::text from pg_class where oid = '$SEQ'::regclass")"
    if P -f "$file" >/dev/null 2>&1; then again=t; else again=f; fi
    ck "a second apply succeeds"                                             t "$again"
    ck "a second apply changes nothing (same ACL)"                           "$acl1" "$(V -c "select relacl::text from pg_class where oid = '$SEQ'::regclass")"
  fi

  # ---- scenario 2: the event table is absent -> refused, with the stated reason ----------------------------------------------
  reset
  out="$(psql -X -q -v ON_ERROR_STOP=1 -f "$file" 2>&1)"; rc=$?
  ck "ABSENT TABLE: the follow-up is refused" t "$([ $rc -ne 0 ] && echo t || echo f)"
  ck "ABSENT TABLE: with the stated reason" t "$(grep -q 'does not exist' <<<"$out" && echo t || echo f)"

  # ---- scenario 3: the table exists but owns NO sequence -> a loop over nothing must not read as success ------------------------
  reset; P -c "create table public.report_private_context_event (x int)" >/dev/null
  out="$(psql -X -q -v ON_ERROR_STOP=1 -f "$file" 2>&1)"; rc=$?
  ck "ZERO SEQUENCES: the follow-up is refused" t "$([ $rc -ne 0 ] && echo t || echo f)"
  ck "ZERO SEQUENCES: with the stated reason" t "$(grep -q 'found no sequence' <<<"$out" && echo t || echo f)"
  return 0
}

echo "== shipped follow-up =="
run_all "$FOLLOW"; rc=$?
[ "$rc" = 99 ] && exit 1
echo "SHIPPED: $CHECKS checks, $FAILS failed"
if [ "$CHECKS" -lt 25 ] || [ "$FAILS" -ne 0 ]; then echo "FAIL — the shipped follow-up does not pass"; exit 1; fi

status=0; QUIET=1
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
while IFS= read -r name; do
  python3 "$here/sequence_lockdown_mutate.py" "$name" "$FOLLOW" > "$tmp" || { echo "HARNESS  $name — anchor missing"; status=1; continue; }
  run_all "$tmp"; rc=$?
  [ "$rc" = 99 ] && { echo "HARNESS  $name — base did not apply"; status=1; continue; }
  if [ "$FAILS" -gt 0 ]; then echo "KILLED   $name — $FAILS check(s) failed"; else echo "SURVIVED $name — the checks cannot see this regression"; status=1; fi
done < <(python3 "$here/sequence_lockdown_mutate.py" --list)
reset
exit $status
