#!/usr/bin/env bash
# dc-atlas-admission-apply.sh — STAGE 10: applies docs/dc-atlas-admission-apply.sql (ADMIT Atlas) to
# production EXACTLY ONCE, byte for byte, with a BOUNDED LOCK WAIT, and proves it.
#
# Same discipline as scripts/dc-atlas-phase-a-apply.sh (proven on production 2026-09-25):
#   * the artifact runs with psql `\i` from the committed file, hash pinned here -- never pasted;
#   * lock_timeout / statement_timeout are SESSION settings asserted in the applying session, on the
#     same backend pid, immediately before `\i`; the artifact sets no session state of its own;
#   * refused inside the :25/:35 resolver window, with a DC session active, or with a lock held on a
#     DC relation; a transaction-mode pooler (which cannot hold session state) is refused;
#   * the artifact is one transaction with an in-transaction drift guard and post-condition.
# After it: Atlas and Epoch read admitted, nothing else does, and every dc_% view/function + the Map 1
# reader equals a replica built from this checkout's DDL of record. Map 1 itself does not move until
# the next hourly resolver run; stage 11 compares that run with the stage 8 dry run.
#
# DCA_MODE=rollback runs the SAME discipline in reverse with docs/dc-atlas-admission-rollback.sql:
# refused unless Atlas reads admitted, and afterwards Atlas reads NOT admitted, the switch body is
# byte-identical to Phase A's (md5 cd968b64...), and every OTHER dc_% object still equals the DDL of
# record (the switch itself deliberately differs from it until the DDL is reverted too). The next
# hourly geography run then restores the pre-admission decisions (V07 in the Atlas suite).
set -euo pipefail

: "${PROD_DB_URL:?PROD_DB_URL is required}"
MODE="${DCA_MODE:-admit}"
case "$MODE" in
  admit)    ART=docs/dc-atlas-admission-apply.sql
            EXPECTED_SHA256=2c2c8571c7ac8167210e66eb9d72a0ddff82843d972526e5951d97d8e2a3341c
            ATLAS_BEFORE=false; ATLAS_AFTER=true ;;
  rollback) ART=docs/dc-atlas-admission-rollback.sql
            EXPECTED_SHA256=a440713b3ede8fef49495c9a60cc2c509660c33babc1d2c72cdffa0969e9a2e8
            ATLAS_BEFORE=true; ATLAS_AFTER=false ;;
  *) echo "REFUSED: DCA_MODE must be admit or rollback"; exit 1 ;;
esac
PHASE_A_PROSRC_MD5=cd968b64ada7adaee18a4dc8be0c4a4b
echo "MODE: $MODE"
LOCK_TIMEOUT=5s
STMT_TIMEOUT=2min
APP=dc-atlas-admission-apply
w="$(mktemp -d)"
export PGOPTIONS="-c lock_timeout=$LOCK_TIMEOUT -c statement_timeout=$STMT_TIMEOUT -c idle_in_transaction_session_timeout=60s -c application_name=$APP"
P() { psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off "$@"; }
RO() { PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=30s' P "$@"; }

echo "== 0. artifact identity"
sha="$(sha256sum "$ART" | cut -d' ' -f1)"
echo "  $ART sha256 $sha (expected $EXPECTED_SHA256)"
[ "$sha" = "$EXPECTED_SHA256" ] || { echo "REFUSED: artifact hash"; exit 1; }
if grep -niE '^\s*(set|reset)\s[^;]*;\s*$|set_config\s*\(' "$ART"; then echo "REFUSED: the artifact sets session state of its own"; exit 1; fi
[ "$(grep -cE '^begin;$' "$ART")" = 1 ] && [ "$(grep -cE '^commit;$' "$ART")" = 1 ] \
  || { echo "REFUSED: the artifact is not exactly one begin/commit transaction"; exit 1; }
python3 test/dc_atlas_validation_pg/build_admission.py --check
[ "$(grep -c "dc_derived_address_admitted" "$ART")" -ge 1 ] || { echo "REFUSED: control: the artifact does not name the switch"; exit 1; }

echo "== 1. PREFLIGHT (read-only; nothing written)"
port="$(python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.argv[1]).port or 5432)' "$PROD_DB_URL")"
echo "  connection port: $port"
[ "$port" != 6543 ] || { echo "REFUSED: transaction-mode pooler port; session settings cannot be held"; exit 1; }
min="$(date -u +%M)"; min=$((10#$min))
echo "  UTC minute: $min (resolvers run at :25 and :35)"
if [ "${DCA_OFFLINE:-}" != 1 ] && [ "$min" -ge 18 ] && [ "$min" -le 45 ]; then echo "REFUSED: inside the :25/:35 resolver window"; exit 1; fi
P -tA <<'SQL' > "$w/pre.txt"
set lock_timeout = '5s';
select 'pid1=' || pg_backend_pid();
select 'pid2=' || pg_backend_pid();
select 'lock_timeout=' || current_setting('lock_timeout');
select 'atlas_admitted=' || public.dc_derived_address_admitted('compute_atlas', 'facilities');
select 'epoch_admitted=' || public.dc_derived_address_admitted('epoch_ai', 'data_centers');
select 'conflicting_sessions=' || count(*) from pg_stat_activity
 where pid <> pg_backend_pid() and state <> 'idle'
   and (query ilike '%dc\_resolve%' or query ilike '%dc\_address\_geocode%' or query ilike '%map1\_dc\_zip\_members%');
select 'locks_on_dc_relations=' || count(*) from pg_locks l join pg_class c on c.oid = l.relation
 join pg_namespace n on n.oid = c.relnamespace
 where l.pid <> pg_backend_pid() and n.nspname = 'public' and (c.relname like 'dc\_%' or c.relname like 'map1\_%');
select 'blocked_sessions=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
select 'atlas_evidence_rows=' || count(*) from public.dc_entity_geography_evidence
 where source_key = 'compute_atlas' and evidence_class = 'DERIVED_ADDRESS';
SQL
sed 's/^/  /' "$w/pre.txt"
v() { grep "^$1=" "$w/pre.txt" | cut -d= -f2; }
[ "$(v pid1)" = "$(v pid2)" ] || { echo "REFUSED: backend changed between statements"; exit 1; }
[ "$(v lock_timeout)" = 5s ] || { echo "REFUSED: lock_timeout did not hold in-session"; exit 1; }
[ "$(v atlas_admitted)" = "$ATLAS_BEFORE" ] || { echo "REFUSED: production already carries this change (atlas_admitted=$(v atlas_admitted), $MODE expects $ATLAS_BEFORE)"; exit 1; }
[ "$(v epoch_admitted)" = true ] || { echo "REFUSED: Epoch is not admitted; production is not in the state stage 8 measured"; exit 1; }
if [ "$MODE" = admit ]; then
  [ "$(v atlas_evidence_rows)" = 0 ] || { echo "REFUSED: Atlas derived evidence already reaches decisions"; exit 1; }
fi
[ "$(v conflicting_sessions)" = 0 ] || { echo "REFUSED: an active DC session is running"; exit 1; }
if [ "${DCA_OFFLINE_ALLOW_LOCKS:-}" = 1 ] && [ "${DCA_OFFLINE:-}" = 1 ]; then
  echo "  (offline negative control: pre-existing locks deliberately allowed, to prove the bounded wait)"
else
  [ "$(v locks_on_dc_relations)" = 0 ] || { echo "REFUSED: another session holds a lock on a DC relation"; exit 1; }
  [ "$(v blocked_sessions)" = 0 ] || { echo "REFUSED: blocked sessions present before apply"; exit 1; }
fi

echo "== 2. APPLY (one session, one transaction, bounded lock wait)"
t0=$(date +%s.%N)
set +e
P -tA > "$w/apply.txt" 2>&1 <<SQL
set application_name = '$APP';
set lock_timeout = '$LOCK_TIMEOUT';
set statement_timeout = '$STMT_TIMEOUT';
select 'pid_before=' || pg_backend_pid();
do \$assert\$ begin
  if current_setting('lock_timeout') <> '$LOCK_TIMEOUT' or current_setting('statement_timeout') <> '$STMT_TIMEOUT' then
    raise exception 'session timeouts not in effect (lock_timeout=%, statement_timeout=%)',
      current_setting('lock_timeout'), current_setting('statement_timeout');
  end if;
end \$assert\$;
\\i $ART
select 'pid_after=' || pg_backend_pid();
SQL
rc=$?
set -e
t1=$(date +%s.%N)
echo "  psql exit: $rc"
sed 's/^/  /' "$w/apply.txt"
echo "  APPLY_RUNTIME_S=$(python3 -c "print(round($t1-$t0,3))")"
[ "$rc" = 0 ] || { echo "APPLY FAILED (rc=$rc): the artifact is one transaction, so nothing was committed"; exit 1; }
a() { grep "^$1=" "$w/apply.txt" | cut -d= -f2; }
[ -n "$(a pid_before)" ] && [ "$(a pid_before)" = "$(a pid_after)" ] || { echo "FAILED: the apply did not run on the asserted backend"; exit 1; }

echo "== 3. POST-APPLY (read-only)"
RO -tA <<'SQL' | tee "$w/post.txt" | sed 's/^/  /'
select 'ATLAS_ADMITTED=' || public.dc_derived_address_admitted('compute_atlas', 'facilities');
select 'EPOCH_ADMITTED=' || public.dc_derived_address_admitted('epoch_ai', 'data_centers');
select 'OTHER_ADMITTED=' || (public.dc_derived_address_admitted('compute_atlas', 'other')
                          or public.dc_derived_address_admitted('some_new_source', 'facilities'));
select 'ADMITTED_ATLAS_DERIVED_POINTS=' || count(*) from public.dc_observation_derived_point
 where source_key = 'compute_atlas' and admitted;
select 'SWITCH_PROSRC_MD5=' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_derived_address_admitted';
select 'BLOCKED_SESSIONS_AFTER=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
SQL
p() { grep "^$1=" "$w/post.txt" | cut -d= -f2; }
[ "$(p ATLAS_ADMITTED)" = "$ATLAS_AFTER" ] && [ "$(p EPOCH_ADMITTED)" = true ] && [ "$(p OTHER_ADMITTED)" = false ] \
  || { echo "FAILED: the switch does not read as $MODE expects (atlas $ATLAS_AFTER, epoch true, nothing else)"; exit 1; }
if [ "$MODE" = admit ]; then
  [ "$(p ADMITTED_ATLAS_DERIVED_POINTS)" -gt 0 ] || { echo "FAILED: control: no Atlas derived point reads admitted"; exit 1; }
else
  [ "$(p ADMITTED_ATLAS_DERIVED_POINTS)" = 0 ] || { echo "FAILED: Atlas derived points still read admitted after rollback"; exit 1; }
  [ "$(p SWITCH_PROSRC_MD5)" = "$PHASE_A_PROSRC_MD5" ] || { echo "FAILED: the rolled-back switch is not Phase A's body"; exit 1; }
fi

echo "== 4. DEFINITION PARITY: production after the apply == a replica built from this checkout's DDL of record"
export PGPASSWORD=postgres
REP=dc_parity
psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $REP" -c "create database $REP" >/dev/null
RR() { psql -h localhost -U supabase_admin -d "$REP" -X -q -v ON_ERROR_STOP=1 "$@"; }
RR -f test/zip_membership_pg/fixture_schema.sql >/dev/null
RR -f docs/zip-membership-canonical.sql >/dev/null
RR -f test/dc_epoch_geography_pg/fixture.sql >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  RR -f "$f" >/dev/null
done
SIG="select 'view', c.relname, md5(pg_get_viewdef(c.oid)) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'v' and c.relname like 'dc\\_%'
     union all select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(p.prosrc)
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and (p.proname like 'dc\\_%' or p.proname = 'map1_dc_zip_members')"
RR -tA -F, -c "$SIG" | LC_ALL=C sort > "$w/rep_sig.csv"
RO -tA -F, -c "$SIG" | LC_ALL=C sort > "$w/prod_sig.csv"
echo "  replica objects: $(wc -l < "$w/rep_sig.csv")   production objects: $(wc -l < "$w/prod_sig.csv")"
[ "$(wc -l < "$w/rep_sig.csv")" -gt 20 ] || { echo "FAILED: replica signature suspiciously small"; exit 1; }
if [ "$MODE" = rollback ]; then
  # the switch is proven equal to Phase A's body above; every other object must still equal the DDL of record
  grep -v '^function,dc_derived_address_admitted(' "$w/rep_sig.csv" > "$w/rep_sig.x"; mv "$w/rep_sig.x" "$w/rep_sig.csv"
fi
missing="$(LC_ALL=C comm -23 "$w/rep_sig.csv" "$w/prod_sig.csv")"
if [ -n "$missing" ]; then echo "FAILED: DDL-of-record objects that differ in production:"; echo "$missing" | sed 's/^/    /'; exit 1; fi
if [ "$MODE" = admit ]; then
  grep -q '^function,dc_derived_address_admitted(' "$w/rep_sig.csv" || { echo "FAILED: parity did not cover the switch"; exit 1; }
fi
grep -q '^function,dc_resolve_geography(' "$w/rep_sig.csv" || { echo "FAILED: control: parity did not cover the resolver"; exit 1; }
echo "  DEFINITION_PARITY PASS: $(wc -l < "$w/rep_sig.csv") dc_% views/functions + map1 reader identical to the DDL of record"

if [ "$MODE" = admit ]; then
  echo "ATLAS ADMITTED: artifact $sha, lock_timeout $LOCK_TIMEOUT asserted in-session. Map 1 moves at the next resolver run (stage 11)."
else
  echo "ATLAS ROLLED BACK: artifact $sha, switch is Phase A's body again. Map 1 returns to the pre-admission state at the next resolver run."
fi
