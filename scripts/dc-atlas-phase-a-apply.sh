#!/usr/bin/env bash
# dc-atlas-phase-a-apply.sh — applies docs/dc-atlas-validation-apply.sql (PR #1335, PHASE A) to
# production EXACTLY ONCE, byte for byte, with a BOUNDED LOCK WAIT, and proves it.
#
# WHY THIS EXISTS. The #1324 apply went through a path with no session settings, so it ran with no
# lock_timeout at all. A DDL transaction that queues behind a long reader holds its place in the lock
# queue and blocks every later reader of that relation -- the hourly resolvers and Map 1 included.
# The fix must bound the wait WITHOUT editing the generated artifact (its bytes are what the drift
# guard, the replica dry run and the review all saw). So:
#
#   * the artifact is executed with psql `\i` from the committed file -- never pasted, never rebuilt;
#   * lock_timeout / statement_timeout / idle_in_transaction_session_timeout are SESSION settings,
#     set by PGOPTIONS at connect AND by an explicit SET, then ASSERTED inside the same session
#     immediately before `\i` (a DO block that raises if the value is not the one we asked for);
#   * the artifact contains no SET of its own (checked), so its `begin; ... commit;` inherits them;
#   * the backend pid is recorded before and after: same pid == the artifact ran on the backend
#     whose settings were asserted. A connection that cannot hold session state (a transaction-mode
#     pooler) is refused in PREFLIGHT, before anything is written.
#
# PHASE A ONLY. Nothing here admits Atlas. The post-apply check REFUSES (exit 1, loud) if
# dc_derived_address_admitted('compute_atlas','facilities') is anything but false.
set -euo pipefail

: "${PROD_DB_URL:?PROD_DB_URL is required}"
ART=docs/dc-atlas-validation-apply.sql
# The artifact merged in #1335 (ccd637e), byte for byte. Pinned here, not passed in.
EXPECTED_SHA256=891bb2101d1f99d5861529953e7f216cdb1d61c64d898d381efee2c0d39ea5a3
LOCK_TIMEOUT=5s
STMT_TIMEOUT=120s
w="$(mktemp -d)"
export PGOPTIONS="-c lock_timeout=$LOCK_TIMEOUT -c statement_timeout=$STMT_TIMEOUT -c idle_in_transaction_session_timeout=60s -c application_name=dc-atlas-phase-a-apply"
P() { psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off "$@"; }

echo "== 0. artifact identity"
sha="$(sha256sum "$ART" | cut -d' ' -f1)"
echo "  $ART sha256 $sha (expected $EXPECTED_SHA256)"
[ "$sha" = "$EXPECTED_SHA256" ] || { echo "REFUSED: artifact hash"; exit 1; }
if grep -niE '^\s*(set|reset)\s' "$ART"; then echo "REFUSED: the artifact sets session state of its own"; exit 1; fi
[ "$(grep -cE '^begin;$' "$ART")" = 1 ] && [ "$(grep -cE '^commit;$' "$ART")" = 1 ] \
  || { echo "REFUSED: the artifact is not exactly one begin/commit transaction"; exit 1; }
python3 test/dc_atlas_validation_pg/build_apply.py --check

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
select 'statement_timeout=' || current_setting('statement_timeout');
select 'read_only=' || current_setting('transaction_read_only');
select 'server=' || current_setting('server_version');
select 'conflicting_sessions=' || count(*) from pg_stat_activity
 where pid <> pg_backend_pid() and state <> 'idle'
   and (query ilike '%dc\_resolve%' or query ilike '%dc\_address\_geocode%' or query ilike '%map1\_dc\_zip\_members%');
select 'locks_on_dc_relations=' || count(*) from pg_locks l join pg_class c on c.oid = l.relation
 join pg_namespace n on n.oid = c.relnamespace
 where l.pid <> pg_backend_pid() and n.nspname = 'public' and (c.relname like 'dc\_%' or c.relname like 'map1\_%');
select 'blocked_sessions=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
select 'long_transactions_gt_60s=' || count(*) from pg_stat_activity
 where pid <> pg_backend_pid() and xact_start < now() - interval '60 seconds' and backend_type = 'client backend';
select 'new_functions_present=' || count(*) from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('dc_publisher_stated_address','dc_geocodable_site_address','dc_derived_address_admitted');
SQL
sed 's/^/  /' "$w/pre.txt"
v() { grep "^$1=" "$w/pre.txt" | cut -d= -f2; }
[ "$(v pid1)" = "$(v pid2)" ] || { echo "REFUSED: backend changed between statements (not a session-holding connection)"; exit 1; }
[ "$(v lock_timeout)" = 5s ] || { echo "REFUSED: lock_timeout did not hold in-session"; exit 1; }
[ "$(v new_functions_present)" = 0 ] || { echo "REFUSED: production already carries this change"; exit 1; }
[ "$(v conflicting_sessions)" = 0 ] || { echo "REFUSED: an active DC session is running"; exit 1; }
if [ "${DCA_OFFLINE_ALLOW_LOCKS:-}" = 1 ] && [ "${DCA_OFFLINE:-}" = 1 ]; then
  echo "  (offline negative control: pre-existing locks deliberately allowed, to prove the bounded wait)"
else
  [ "$(v locks_on_dc_relations)" = 0 ] || { echo "REFUSED: another session holds a lock on a DC relation"; exit 1; }
  [ "$(v blocked_sessions)" = 0 ] || { echo "REFUSED: blocked sessions present before apply"; exit 1; }
fi

echo "== 2. APPLY (one session, one transaction, bounded lock wait) — with a concurrent lock monitor"
( end=$((SECONDS + 150))
  while [ $SECONDS -lt $end ] && [ ! -f "$w/done" ]; do
    PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5s' psql "$PROD_DB_URL" -X -q -tA -c \
      "select to_char(clock_timestamp(),'HH24:MI:SS.MS') || ' blocked=' || count(*) filter (where cardinality(pg_blocking_pids(pid)) > 0)
              || ' apply_state=' || coalesce(max(state) filter (where application_name = 'dc-atlas-phase-a-apply'), '-')
              || ' apply_wait=' || coalesce(max(wait_event_type || ':' || wait_event) filter (where application_name = 'dc-atlas-phase-a-apply'), '-')
         from pg_stat_activity" 2>&1 || true
    sleep 0.5
  done ) > "$w/monitor.txt" &
mon=$!
t0=$(date +%s.%N)
set +e
P -tA > "$w/apply.txt" 2>&1 <<SQL
set lock_timeout = '$LOCK_TIMEOUT';
set statement_timeout = '$STMT_TIMEOUT';
select 'pid_before=' || pg_backend_pid();
do \$assert\$ begin
  if current_setting('lock_timeout') <> '$LOCK_TIMEOUT' or current_setting('statement_timeout') <> '$STMT_TIMEOUT' then
    raise exception 'session timeouts not in effect (lock_timeout=%, statement_timeout=%)',
      current_setting('lock_timeout'), current_setting('statement_timeout');
  end if;
end \$assert\$;
select 'lock_timeout_in_effect=' || current_setting('lock_timeout');
\\i $ART
select 'pid_after=' || pg_backend_pid();
select 'lock_timeout_after=' || current_setting('lock_timeout');
select 'txid_after=' || txid_current_if_assigned();
SQL
rc=$?
set -e
t1=$(date +%s.%N)
touch "$w/done"; wait "$mon" || true
echo "  psql exit: $rc"
sed 's/^/  /' "$w/apply.txt"
echo "  APPLY_RUNTIME_S=$(python3 -c "print(round($t1-$t0,3))")"
echo "  -- lock monitor (every 0.5 s during the apply) --"
sed 's/^/  /' "$w/monitor.txt"
echo "  MONITOR_MAX_BLOCKED=$(grep -oE 'blocked=[0-9]+' "$w/monitor.txt" | cut -d= -f2 | sort -n | tail -1)"
[ "$rc" = 0 ] || { echo "APPLY FAILED (rc=$rc): the artifact is one transaction, so nothing was committed"; exit 1; }
a() { grep "^$1=" "$w/apply.txt" | cut -d= -f2; }
[ -n "$(a pid_before)" ] && [ "$(a pid_before)" = "$(a pid_after)" ] || { echo "FAILED: the apply did not run on the asserted backend"; exit 1; }
[ "$(a lock_timeout_after)" = "$LOCK_TIMEOUT" ] || { echo "FAILED: lock_timeout did not survive the apply session"; exit 1; }

echo "== 3. POST-APPLY (read-only): admission, completeness"
PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s' P -tA <<'SQL' | tee "$w/post.txt" | sed 's/^/  /'
select 'EPOCH_ADMITTED=' || public.dc_derived_address_admitted('epoch_ai', 'data_centers');
select 'ATLAS_ADMITTED=' || public.dc_derived_address_admitted('compute_atlas', 'facilities');
select 'NEW_FUNCTIONS=' || count(*) from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('dc_publisher_stated_address','dc_geocodable_site_address','dc_derived_address_admitted');
select 'DERIVED_POINT_HAS_ADMITTED=' || count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'dc_observation_derived_point' and column_name = 'admitted';
select 'QUEUE_HAS_ADMITTED=' || count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'dc_geocode_queue' and column_name = 'admitted';
select 'RESOLVER_RULE_VERSION_5=' || (position('v_rule_version constant integer := 5' in prosrc) > 0)
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_resolve_geography';
select 'ADMITTED_ATLAS_DERIVED_POINTS=' || count(*) from public.dc_observation_derived_point
 where source_key = 'compute_atlas' and admitted;
select 'ATLAS_EVIDENCE_ROWS=' || count(*) from public.dc_entity_geography_evidence e
 where e.source_key = 'compute_atlas' and e.evidence_class = 'DERIVED_ADDRESS';
select 'EVIDENCE_CONTROL_EPOCH_DERIVED=' || count(*) from public.dc_entity_geography_evidence e
 where e.source_key = 'epoch_ai' and e.evidence_class = 'DERIVED_ADDRESS';
select 'BLOCKED_SESSIONS_AFTER=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
SQL
p() { grep "^$1=" "$w/post.txt" | cut -d= -f2; }
[ "$(p ATLAS_ADMITTED)" = false ] || { echo "🛑 INCIDENT: Atlas is admitted in production"; exit 1; }
[ "$(p EPOCH_ADMITTED)" = true ] || { echo "FAILED: Epoch is not admitted"; exit 1; }
[ "$(p NEW_FUNCTIONS)" = 3 ] && [ "$(p DERIVED_POINT_HAS_ADMITTED)" = 1 ] && [ "$(p QUEUE_HAS_ADMITTED)" = 1 ] \
  && [ "$(p RESOLVER_RULE_VERSION_5)" = true ] || { echo "FAILED: partial apply"; exit 1; }
[ "$(p ADMITTED_ATLAS_DERIVED_POINTS)" = 0 ] && [ "$(p ATLAS_EVIDENCE_ROWS)" = 0 ] \
  || { echo "🛑 INCIDENT: Atlas derived evidence reaches the decision plane"; exit 1; }

echo "== 4. DEFINITION PARITY: production after the apply == a replica built from main's DDL of record"
R() { psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
export PGPASSWORD=postgres
REP=dc_parity; R -c "drop database if exists $REP" -c "create database $REP" >/dev/null
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
PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s' P -tA -F, -c "$SIG" | LC_ALL=C sort > "$w/prod_sig.csv"
echo "  replica objects: $(wc -l < "$w/rep_sig.csv")   production objects: $(wc -l < "$w/prod_sig.csv")"
[ "$(wc -l < "$w/rep_sig.csv")" -gt 20 ] || { echo "FAILED: replica signature suspiciously small"; exit 1; }
# Every object the DDL of record declares must be byte-identical in production.
missing="$(LC_ALL=C comm -23 "$w/rep_sig.csv" "$w/prod_sig.csv")"
if [ -n "$missing" ]; then echo "FAILED: DDL-of-record objects that differ in production:"; echo "$missing" | sed 's/^/    /'; exit 1; fi
echo "  DEFINITION_PARITY PASS: $(wc -l < "$w/rep_sig.csv") dc_% views/functions + map1 reader identical to main's DDL of record"
echo "  sig md5: $(md5sum < "$w/rep_sig.csv" | cut -c1-32)"
for fn in dc_publisher_stated_address dc_geocodable_site_address dc_derived_address_admitted dc_geocode_input dc_resolve_geography; do
  grep -q "^function,$fn(" "$w/rep_sig.csv" || { echo "FAILED: parity did not cover $fn"; exit 1; }
done
for vw in dc_observation_derived_point dc_geocode_queue dc_identity_candidate dc_entity_geography_evidence; do
  grep -q "^view,$vw," "$w/rep_sig.csv" || { echo "FAILED: parity did not cover $vw"; exit 1; }
done

echo "PHASE A APPLIED: artifact $sha, lock_timeout $LOCK_TIMEOUT asserted in-session, Atlas NOT admitted."
