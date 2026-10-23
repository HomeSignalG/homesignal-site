#!/usr/bin/env bash
# dc-osm-dedupe-apply.sh — the founder's same-building ruling (2026-10-23, "b"): applies
# docs/dc-osm-dedupe-apply.sql (public.dc_names_same_site + the Map 1 reader that hides an OSM pin whose one
# canonical twin on the same ZIP page lies within 150 m and names the same site) to production EXACTLY ONCE,
# byte for byte, with a BOUNDED LOCK WAIT, and proves it.
#
# Same discipline as scripts/dc-osm-map1-apply.sh (C3c, applied 2026-09-27):
#   * the artifact runs with psql `\i` from the committed file, hash pinned here -- never pasted;
#   * lock_timeout / statement_timeout are SESSION settings asserted in the applying session, on the
#     same backend pid, immediately before `\i`; the artifact sets no session state of its own;
#   * refused inside the :18-:45 resolver window, with a DC session active, or with a lock held on a
#     DC relation; a transaction-mode pooler (which cannot hold session state) is refused;
#   * the artifact is one transaction with an in-transaction drift guard and post-condition.
# In CI it runs only after scripts/dc-osm-dedupe-gate.sh has passed on a replica of production in the SAME
# workflow run.
#
# DCD_MODE=rollback runs the SAME discipline in reverse with docs/dc-osm-dedupe-rollback.sql.
set -euo pipefail

: "${PROD_DB_URL:?PROD_DB_URL is required}"
MODE="${DCD_MODE:-apply}"
case "$MODE" in
  apply)    ART=docs/dc-osm-dedupe-apply.sql
            EXPECTED_SHA256=7073d4e185fd0108caf8d5a845316add6639ef4c05f7c19812191d654f8ee36d
            HELPER_BEFORE=false; HELPER_AFTER=true ;;
  rollback) ART=docs/dc-osm-dedupe-rollback.sql
            EXPECTED_SHA256=17f98cdf46b45067248e5b548e30f2d0dc0d01383c1621c2e779a6f8e59ac294
            HELPER_BEFORE=true; HELPER_AFTER=false ;;
  *) echo "REFUSED: DCD_MODE must be apply or rollback"; exit 1 ;;
esac
MAP1_BEFORE=2146b68afc2cda03948b1e1cd51b29b8
echo "MODE: $MODE"
LOCK_TIMEOUT=5s
STMT_TIMEOUT=2min
APP=dc-osm-dedupe-apply
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
python3 test/map1_dc_publication_pg/build_osm_dedupe.py --check
[ "$(grep -c "map1_dc_zip_members" "$ART")" -ge 1 ] || { echo "REFUSED: control: the artifact does not name the Map 1 reader"; exit 1; }
if grep -niE '^\s*(create|alter|drop)\s+(table|view)|^\s*(insert|update|delete|truncate)\b' "$ART"; then echo "REFUSED: the artifact touches a table or view, or writes rows"; exit 1; fi

echo "== 1. PREFLIGHT (read-only; nothing written)"
port="$(python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.argv[1]).port or 5432)' "$PROD_DB_URL")"
echo "  connection port: $port"
[ "$port" != 6543 ] || { echo "REFUSED: transaction-mode pooler port; session settings cannot be held"; exit 1; }
min="$(date -u +%M)"; min=$((10#$min))
echo "  UTC minute: $min (resolvers run at :25 and :35)"
if [ "${DCD_OFFLINE:-}" != 1 ] && [ "$min" -ge 18 ] && [ "$min" -le 45 ]; then echo "REFUSED: inside the :25/:35 resolver window"; exit 1; fi
P -tA <<'SQL' > "$w/pre.txt"
set lock_timeout = '5s';
select 'pid1=' || pg_backend_pid();
select 'pid2=' || pg_backend_pid();
select 'lock_timeout=' || current_setting('lock_timeout');
select 'helper=' || (to_regprocedure('public.dc_names_same_site(text,text,text,text)') is not null);
select 'map1_md5=' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'map1_dc_zip_members';
select 'conflicting_sessions=' || count(*) from pg_stat_activity
 where pid <> pg_backend_pid() and state <> 'idle'
   and (query ilike '%dc\_resolve%' or query ilike '%dc\_address\_geocode%' or query ilike '%map1\_dc\_zip\_members%');
select 'locks_on_dc_relations=' || count(*) from pg_locks l join pg_class c on c.oid = l.relation
 join pg_namespace n on n.oid = c.relnamespace
 where l.pid <> pg_backend_pid() and n.nspname = 'public' and (c.relname like 'dc\_%' or c.relname like 'map1\_%');
select 'blocked_sessions=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
select 'queue_rows=' || count(*) from public.dc_geocode_queue;
SQL
sed 's/^/  /' "$w/pre.txt"
v() { grep "^$1=" "$w/pre.txt" | cut -d= -f2; }
[ "$(v pid1)" = "$(v pid2)" ] || { echo "REFUSED: backend changed between statements"; exit 1; }
[ "$(v lock_timeout)" = 5s ] || { echo "REFUSED: lock_timeout did not hold in-session"; exit 1; }
[ "$(v helper)" = "$HELPER_BEFORE" ] || { echo "REFUSED: production already carries this change (helper=$(v helper), $MODE expects $HELPER_BEFORE)"; exit 1; }
if [ "$MODE" = apply ]; then
  [ "$(v map1_md5)" = "$MAP1_BEFORE" ] || { echo "REFUSED: the Map 1 reader is not the 2026-10-23 body ($(v map1_md5))"; exit 1; }
fi
[ "$(v conflicting_sessions)" = 0 ] || { echo "REFUSED: an active DC session is running"; exit 1; }
if [ "${DCD_OFFLINE_ALLOW_LOCKS:-}" = 1 ] && [ "${DCD_OFFLINE:-}" = 1 ]; then
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
select 'HELPER=' || (to_regprocedure('public.dc_names_same_site(text,text,text,text)') is not null);
select 'MAP1_PROSRC_MD5=' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'map1_dc_zip_members';
select 'QUEUE_ROWS_AFTER=' || count(*) from public.dc_geocode_queue;
select 'BLOCKED_SESSIONS_AFTER=' || count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0;
SQL
p() { grep "^$1=" "$w/post.txt" | cut -d= -f2; }
[ "$(p HELPER)" = "$HELPER_AFTER" ] || { echo "FAILED: after $MODE the helper reads $(p HELPER) (expected $HELPER_AFTER)"; exit 1; }
if [ "$MODE" = apply ]; then
  [ "$(p MAP1_PROSRC_MD5)" != "$MAP1_BEFORE" ] || { echo "FAILED: the Map 1 reader did not change"; exit 1; }
else
  [ "$(p MAP1_PROSRC_MD5)" = "$MAP1_BEFORE" ] || { echo "FAILED: the Map 1 reader is not the 2026-10-23 body"; exit 1; }
fi
[ "$(p QUEUE_ROWS_AFTER)" = "$(v queue_rows)" ] || { echo "FAILED: the queue moved ($(v queue_rows) -> $(p QUEUE_ROWS_AFTER)); this change must not touch it"; exit 1; }

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
  # the reader is proven equal to its 2026-10-23 body in-transaction and the helper is dropped; every
  # other object must still equal the DDL of record
  grep -vE '^(function,dc_names_same_site\(|function,map1_dc_zip_members\()' "$w/rep_sig.csv" > "$w/rep_sig.x"; mv "$w/rep_sig.x" "$w/rep_sig.csv"
fi
missing="$(LC_ALL=C comm -23 "$w/rep_sig.csv" "$w/prod_sig.csv")"
if [ -n "$missing" ]; then echo "FAILED: DDL-of-record objects that differ in production:"; echo "$missing" | sed 's/^/    /'; exit 1; fi
if [ "$MODE" = apply ]; then
  grep -q '^function,dc_names_same_site(' "$w/rep_sig.csv" && grep -q '^function,map1_dc_zip_members(' "$w/rep_sig.csv" \
    || { echo "FAILED: parity did not cover the helper and the reader"; exit 1; }
fi
grep -q '^function,dc_resolve_geography(' "$w/rep_sig.csv" || { echo "FAILED: control: parity did not cover the resolver"; exit 1; }
echo "  DEFINITION_PARITY PASS: $(wc -l < "$w/rep_sig.csv") dc_% views/functions + map1 reader identical to the DDL of record"

if [ "$MODE" = apply ]; then
  echo "SAME-BUILDING RULE APPLIED: artifact $sha, lock_timeout $LOCK_TIMEOUT asserted in-session. Map 1 reads it live; no resolver run needed."
else
  echo "SAME-BUILDING RULE ROLLED BACK: artifact $sha. The reader is the 2026-10-23 body and the helper is gone."
fi
