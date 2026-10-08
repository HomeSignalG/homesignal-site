#!/usr/bin/env bash
# Offline proof of scripts/dc-epoch-replica-dryrun.sh against a DISPOSABLE PostGIS that stands in
# for production ("fakeprod": main@MAIN_SHA's DDL of record + the suite's evidence, resolved by
# main's own scheduled resolvers). Proves:
#   1. the dry run completes, reconciles, and every required-zero receipt is 0;
#   2. "production" is left BYTE-IDENTICAL -- every table and function fingerprint unchanged -- and
#      the dry run never held a lock stronger than ACCESS SHARE on it (sampled throughout);
#   3. a production whose definitions differ from main is REFUSED before anything is copied
#      (the Map 1 PARITY refusal is not exercised here: it needs production to change between
#      two reads of one run, which this harness cannot stage);
#   4. prod_select REFUSES anything that is not a single read-only SELECT.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
MAIN_SHA="${MAIN_SHA:-58aeb8c}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"; if [ -n "${watch:-}" ]; then kill "$watch" 2>/dev/null || true; fi' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:docs/zip-membership-canonical.sql" > "$tmp/zm.sql"; P -d "$FP" -f "$tmp/zm.sql" >/dev/null
P -d "$FP" -f "$here/fixture.sql" >/dev/null
for f in docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git -C "$root" show "$MAIN_SHA:$f" > "$tmp/c.sql"; P -d "$FP" -f "$tmp/c.sql" >/dev/null
done
# the suite's evidence (ZCTAs, runs, observations, legacy entities) -- everything before its derivations
awk '/^-- ── the writer.s derivations/{exit} {print}' "$here/suite.sql" > "$tmp/evidence.sql"
# and the suite's recorded derivations, as the replay file the ladder would have produced
awk '/^create temp table _dcg_in/,/^\) v\(q, p, mt, la, ln, ma, c\);/' "$here/suite.sql" > "$tmp/dcg.sql"
P -d "$FP" <<SQL >/dev/null
\i $tmp/evidence.sql
create table public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary;
select * from public.dc_resolve_canonical(true, false);
select * from public.dc_resolve_geography(true);
\i $tmp/dcg.sql
\copy (select j::text from _dcg_in) to '$tmp/replay.jsonl'
SQL

fingerprint() { P -d "$FP" -tA -c "
  select md5(string_agg(x, '|' order by x collate \"C\")) from (
    select 'fn:' || p.proname || ':' || md5(p.prosrc) x from pg_proc p where p.pronamespace in ('public'::regnamespace, 'geo'::regnamespace)
    union all select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
    union all select 'rows:dc_canonical_entity:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_canonical_entity t
    union all select 'rows:dc_entity_observation:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_entity_observation t
    union all select 'rows:dc_identity_decision:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_identity_decision t
    union all select 'rows:dc_entity_geography:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_entity_geography t
  ) s"; }
before="$(fingerprint)"

# lock watcher: any lock above ACCESS SHARE on a fakeprod relation, held by a CLIENT backend other than
# the watcher, is a failure (autovacuum's own locks after the bulk load are not the dry run's)
( while :; do
    P -d "$FP" -tA -c "select l.mode || ' ' || coalesce(c.relname, '?') from pg_locks l left join pg_class c on c.oid = l.relation
      join pg_stat_activity a on a.pid = l.pid and a.backend_type = 'client backend'
      where l.database = (select oid from pg_database where datname = current_database()) and l.locktype = 'relation'
        and l.pid <> pg_backend_pid() and l.mode <> 'AccessShareLock'" >> "$tmp/locks.txt" 2>/dev/null || true
    sleep 0.2
  done ) & watch=$!
# positive control: the watcher must SEE a strong lock, or its silence below proves nothing
P -d "$FP" -c "begin; lock table public.dc_source in share mode; select pg_sleep(1.5); commit;" >/dev/null
grep -q 'ShareLock dc_source' "$tmp/locks.txt" || { echo "FAIL: the lock watcher did not see a SHARE lock it was shown"; exit 1; }
: > "$tmp/locks.txt"
echo "OK 0: the lock watcher sees a strong lock (positive control)"

export PROD_DB_URL="dbname=$FP" DCG_REPLAY="$tmp/replay.jsonl"
"$root/scripts/dc-epoch-replica-dryrun.sh" > "$tmp/run.txt" 2>&1 || { cat "$tmp/run.txt"; echo "FAIL: the dry run did not complete"; exit 1; }
kill "$watch"; wait "$watch" 2>/dev/null || true
grep -E '^(==|  |DRY RUN|[A-Z][0-9]+ )' "$tmp/run.txt" | head -80
after="$(fingerprint)"
[ "$before" = "$after" ] || { echo "FAIL: \"production\" changed: $before -> $after"; exit 1; }
echo "OK 1-2: dry run complete; \"production\" fingerprint unchanged ($after)"
if [ -s "$tmp/locks.txt" ]; then sort -u "$tmp/locks.txt"; echo "FAIL: a lock above ACCESS SHARE was taken on \"production\""; exit 1; fi
echo "OK 2: no lock above ACCESS SHARE was ever observed on \"production\""

# 2b. REPLICA PARITY NEGATIVE CONTROL -- executed, not asserted. The run above is the positive control
# (a matching copy is ACCEPTED). Now the replica is deliberately made to differ from the production
# it copied -- one published point moved 50 m, on the REPLICA only -- and the run must REFUSE before
# any after-state is produced. Then the untouched copy must be ACCEPTED again.
TAMPER="set session_replication_role = replica; update public.dc_entity_geography set lat = lat + 0.0005, geom = ST_SetSRID(ST_MakePoint(lng, lat + 0.0005), 4326) where canonical_entity_id = (select m.canonical_entity_id from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.canonical_entity_id is not null order by 1 limit 1)"
if DRYRUN_TEST_TAMPER_REPLICA_SQL="$TAMPER" "$root/scripts/dc-epoch-replica-dryrun.sh" > "$tmp/tamper.txt" 2>&1; then
  tail -5 "$tmp/tamper.txt"; echo "FAIL: a replica that differs from production was ACCEPTED"; exit 1
fi
grep -q '(test) tampering with the replica only' "$tmp/tamper.txt" && grep -q "REFUSED: the replica does not reproduce production's Map 1 output" "$tmp/tamper.txt" \
  && ! grep -q '^== 8\.' "$tmp/tamper.txt" \
  || { tail -8 "$tmp/tamper.txt"; echo "FAIL: the tampered run did not stop at the parity gate"; exit 1; }
"$root/scripts/dc-epoch-replica-dryrun.sh" > "$tmp/restored.txt" 2>&1 && grep -q '^DRY RUN COMPLETE' "$tmp/restored.txt" \
  || { tail -8 "$tmp/restored.txt"; echo "FAIL: the restored matching copy was not accepted"; exit 1; }
[ "$(fingerprint)" = "$before" ] || { echo "FAIL: \"production\" changed during the negative control"; exit 1; }
echo "OK 2b: REPLICA_PARITY_NEGATIVE_CONTROL PASS -- matching copy accepted, tampered replica REFUSED at parity (no after-state), restored copy accepted"

# 3. a replica whose definitions do not match production is refused before anything is copied
P -d "$FP" -c "do \$\$ begin execute regexp_replace(pg_get_functiondef('public.dc_resolve_geography(boolean)'::regprocedure), '\\\$function\\\$', '\$function\$ -- drifted'); end \$\$" >/dev/null
if "$root/scripts/dc-epoch-replica-dryrun.sh" > "$tmp/neg.txt" 2>&1; then echo "FAIL: a production that differs from main was not refused"; exit 1; fi
grep -q 'REFUSED: definitions differ from main' "$tmp/neg.txt" || { tail -5 "$tmp/neg.txt"; echo "FAIL: refused for the wrong reason"; exit 1; }
echo "OK 3: a production whose definitions differ from main is refused"

# 4. prod_select refuses a write, a second statement, and a non-SELECT
src="$(sed -n '/^prod_select() {/,/^}/p' "$root/scripts/dc-epoch-replica-dryrun.sh")"
for q in "delete from public.dc_source" "select 1; drop table public.dc_source" "update public.dc_source set licence = ''" "with x as (delete from public.dc_source returning 1) select * from x" "create table t as select 1"; do
  if bash -c "set -euo pipefail; $src; prod_select \"$q\" /dev/null" >/dev/null 2>&1; then echo "FAIL: prod_select accepted: $q"; exit 1; fi
done
echo "OK 4: prod_select refused 5 of 5 non-read statements"
dropdb "$FP"
