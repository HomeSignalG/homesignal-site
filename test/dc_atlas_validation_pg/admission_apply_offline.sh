#!/usr/bin/env bash
# Offline proof of scripts/dc-atlas-admission-apply.sh (STAGE 10) against a DISPOSABLE stand-in for
# production ("fakeprod"): this checkout's DDL of record, then the Atlas suite up to (not including)
# PHASE D -- i.e. the Epoch-only switch production carries today, with Atlas derivations acquired and
# settled by the resolvers. Proves, before the script is ever pointed at production:
#   1. DRIFT GUARD: a live switch that is not byte-for-byte Phase A's is refused inside the artifact,
#      and nothing is committed;
#   2. BOUNDED LOCK WAIT: with another session holding the switch's catalog row, the apply FAILS on
#      lock_timeout within seconds and commits nothing;
#   3. the apply then succeeds on the asserted backend: Atlas and Epoch admitted, nothing else,
#      definitions equal the DDL of record, and Map 1 does not move until a resolver runs;
#   4. a second apply is REFUSED.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_admission
cd "$root"
PHASE_A_FN="create or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text)
returns boolean language sql immutable set search_path to 'public', 'pg_temp'
as \$\$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers')) \$\$;"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -f test/zip_membership_pg/fixture_schema.sql >/dev/null
P -d "$FP" -f docs/zip-membership-canonical.sql >/dev/null
P -d "$FP" -f test/dc_epoch_geography_pg/fixture.sql >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  P -d "$FP" -f "$f" >/dev/null
done
awk '/^-- ── PHASE D: the reviewed admission/{exit} {print}' "$here/suite.sql" > "$tmp/phase_a.sql"
grep -q '^create temp table _s1 as' "$tmp/phase_a.sql" || { echo "FAIL: the suite's PHASE A section was not located"; exit 1; }
P -d "$FP" -v loadsql="$root/docs/dc-geocode-observations-load.sql" -v queuesql="$root/docs/dc-geocode-observations-queue.sql" \
  -v qfile="$tmp/q.txt" <<SQL >/dev/null
\i $tmp/phase_a.sql
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;
SQL
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
Q() { P -d "$FP" -tA -c "$1"; }
gate() { Q "select public.dc_derived_address_admitted('compute_atlas','facilities') || '/' || public.dc_derived_address_admitted('epoch_ai','data_centers') || '/' || (select md5(prosrc) from pg_proc where proname = 'dc_derived_address_admitted')"; }
M1() { Q "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
[ "$(gate)" = "false/true/cd968b64ada7adaee18a4dc8be0c4a4b" ] || { echo "FAIL: fakeprod is not Phase A ($(gate))"; exit 1; }
[ "$(Q "select count(*) from public.dc_observation_derived_point where source_key = 'compute_atlas'")" -gt 0 ] \
  || { echo "FAIL: control: fakeprod carries no Atlas derivation"; exit 1; }
map_before="$(M1)"
[ -n "$map_before" ] || { echo "FAIL: control: Map 1 is empty in fakeprod"; exit 1; }
echo "  fakeprod: switch $(gate), Map 1 $map_before"

echo "== 1. DRIFT GUARD: a switch that is not Phase A's text is refused inside the artifact"
Q "create or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text) returns boolean language sql immutable set search_path to 'public', 'pg_temp' as \$\$ select p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' \$\$" >/dev/null
drift="$(gate)"
set +e
PROD_DB_URL="$URL" DCA_OFFLINE=1 bash scripts/dc-atlas-admission-apply.sh > "$tmp/drift.txt" 2>&1; rc=$?
set -e
sed 's/^/  | /' "$tmp/drift.txt"
[ "$rc" != 0 ] && grep -q 'DRIFT: the live admission switch' "$tmp/drift.txt" || { echo "FAIL: drifted switch not refused by the guard"; exit 1; }
[ "$(gate)" = "$drift" ] || { echo "FAIL: a refused apply changed the switch"; exit 1; }
Q "$PHASE_A_FN" >/dev/null
[ "$(gate)" = "false/true/cd968b64ada7adaee18a4dc8be0c4a4b" ] || { echo "FAIL: Phase A switch not restored"; exit 1; }
echo "  PASS: refused by the in-artifact guard; switch untouched"

echo "== 2. NEGATIVE CONTROL: a session holding the switch's catalog row makes the apply fail FAST"
PGAPPNAME=dc-offline-blocker P -d "$FP" -c "begin; $PHASE_A_FN select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCA_OFFLINE=1 DCA_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-atlas-admission-apply.sh > "$tmp/neg.txt" 2>&1; rc=$?
set -e
el=$(( $(date +%s) - t0 ))
Q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'dc-offline-blocker'" >/dev/null
wait "$blk" 2>/dev/null || true
sed 's/^/  | /' "$tmp/neg.txt"
[ "$rc" != 0 ] || { echo "FAIL: the apply succeeded while the row was held"; exit 1; }
grep -q 'canceling statement due to lock timeout' "$tmp/neg.txt" || { echo "FAIL: the apply did not fail on lock_timeout"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(gate)" = "false/true/cd968b64ada7adaee18a4dc8be0c4a4b" ] || { echo "FAIL: a failed apply left partial state ($(gate))"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s total; switch unchanged"

echo "== 3. the apply succeeds: Atlas admitted, definitions equal the DDL of record, Map 1 unmoved"
PROD_DB_URL="$URL" DCA_OFFLINE=1 bash scripts/dc-atlas-admission-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
sed 's/^/  /' "$tmp/ok.txt"
grep -q '^ATLAS ADMITTED' "$tmp/ok.txt" && grep -q 'ATLAS_ADMITTED=true' "$tmp/ok.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" \
  || { echo "FAIL: apply did not complete"; exit 1; }
case "$(gate)" in true/true/*) ;; *) echo "FAIL: switch after apply $(gate)"; exit 1;; esac
[ "$(M1)" = "$map_before" ] || { echo "FAIL: Map 1 moved on the apply itself (before any resolver run)"; exit 1; }
echo "  PASS: switch $(gate); Map 1 unchanged until the next resolver run"
Q "select count(*) from public.dc_resolve_geography(true)" >/dev/null
[ "$(M1)" != "$map_before" ] || { echo "FAIL: control: a resolver run after admission changed nothing (the switch reaches no decision)"; exit 1; }
echo "  PASS: the next resolver run moves Map 1 (the admission reaches decisions)"

echo "== 4. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCA_OFFLINE=1 bash scripts/dc-atlas-admission-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"
echo "ALL ADMISSION APPLY OFFLINE CHECKS PASSED"
