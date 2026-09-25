#!/usr/bin/env bash
# Offline proof of scripts/dc-atlas-phase-a-apply.sh against a DISPOSABLE stand-in for production
# ("fakeprod": main@f9d1326's DDL of record -- the definitions production carries before Phase A --
# plus the Atlas suite's evidence, settled by those resolvers). Proves, before the script is ever
# pointed at production:
#   1. BOUNDED LOCK WAIT: with another session holding a lock the artifact needs, the apply FAILS on
#      lock_timeout within seconds (not minutes), and NOTHING is committed (atomic);
#   2. the apply then succeeds, runs on the asserted backend, leaves Atlas UNADMITTED, and production's
#      definitions equal main's DDL of record (definition parity);
#   3. a second apply is REFUSED (the drift guard / "already carries this change").
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
PRE_SHA=f9d1326
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_apply
cd "$root"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -f test/zip_membership_pg/fixture_schema.sql >/dev/null
git show "$PRE_SHA:docs/zip-membership-canonical.sql" > "$tmp/zm.sql"; P -d "$FP" -f "$tmp/zm.sql" >/dev/null
git show "$PRE_SHA:test/dc_epoch_geography_pg/fixture.sql" > "$tmp/fx.sql"; P -d "$FP" -f "$tmp/fx.sql" >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git show "$PRE_SHA:$f" > "$tmp/c.sql"; P -d "$FP" -f "$tmp/c.sql" >/dev/null
done
awk '/^-- ── the queue, as the writer reads it/{exit} {print}' "$here/suite.sql" > "$tmp/evidence.sql"
P -d "$FP" <<SQL >/dev/null
\i $tmp/evidence.sql
create table public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary;
select * from public.dc_resolve_canonical(true, false);
select * from public.dc_resolve_geography(true);
SQL
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
newfns() { P -d "$FP" -tA -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('dc_publisher_stated_address','dc_geocodable_site_address','dc_derived_address_admitted')"; }
[ "$(newfns)" = 0 ] || { echo "FAIL: fakeprod is not pre-apply"; exit 1; }
M1() { P -d "$FP" -tA -c "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
map_before="$(M1)"

echo "== 1. NEGATIVE CONTROL: a held lock must make the apply fail FAST and commit NOTHING"
P -d "$FP" -c "begin; lock table public.dc_geocode_queue in access share mode; select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCA_OFFLINE=1 DCA_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-atlas-phase-a-apply.sh > "$tmp/neg.txt" 2>&1
rc=$?
set -e
el=$(( $(date +%s) - t0 ))
kill "$blk" 2>/dev/null || true; wait "$blk" 2>/dev/null || true
sed 's/^/  | /' "$tmp/neg.txt"
[ "$rc" != 0 ] || { echo "FAIL: the apply succeeded while a lock was held"; cat "$tmp/neg.txt"; exit 1; }
grep -q 'canceling statement due to lock timeout' "$tmp/neg.txt" || { echo "FAIL: the apply did not fail on lock_timeout"; cat "$tmp/neg.txt"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(newfns)" = 0 ] || { echo "FAIL: a failed apply left partial state"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s total; 0 objects committed"

echo "== 2. the apply succeeds, Atlas stays unadmitted, definitions equal the DDL of record"
PROD_DB_URL="$URL" DCA_OFFLINE=1 bash scripts/dc-atlas-phase-a-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
sed 's/^/  /' "$tmp/ok.txt"
grep -q '^PHASE A APPLIED' "$tmp/ok.txt" || { echo "FAIL: apply did not complete"; exit 1; }
grep -q 'ATLAS_ADMITTED=false' "$tmp/ok.txt" || { echo "FAIL: admission"; exit 1; }
grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" || { echo "FAIL: parity"; exit 1; }
[ "$(newfns)" = 3 ] || { echo "FAIL: objects not created"; exit 1; }
[ "$(M1)" = "$map_before" ] || { echo "FAIL: Map 1 changed on apply"; exit 1; }
echo "  PASS: Map 1 unchanged ($map_before)"

echo "== 3. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCA_OFFLINE=1 bash scripts/dc-atlas-phase-a-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"
echo "ALL APPLY OFFLINE CHECKS PASSED"
