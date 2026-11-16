#!/usr/bin/env bash
# OFFICIAL DOCUMENTS PR 1 (site half) on a DISPOSABLE PostGIS, never production.
#   1. the shipped DC chain in production order + the serialized resolver entry (dc-marker-loss-watcher)
#   2. seed_before.sql: Compute Atlas only, resolved; fingerprints of the canonical tables and of Map 1
#   3. docs/official-documents-map-gate.sql (the file under test), applied twice (idempotent)
#   4. suite.sql: official-documents observations with G3 closed (byte-identical), then G3 open in the suite
#      only (the design's cases), then the kill switch and its rollback
#   5. each prohibited mutation of the file must fail >= 1 check
# A mutation whose anchor is missing, or that does not change the file, is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
DB=official_documents_t
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
GATE="$root/docs/official-documents-map-gate.sql"

build() {  # build [gate-file]
  dropdb --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
  for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
           docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql \
           docs/map1-dc-publication.sql docs/dc-marker-loss-watcher.sql; do
    P -f "$root/$f" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: $f did not apply"; return 1; }
  done
  # the Step-2A columns this change reads, as production has them (docs/dc-step2a-foundation.sql), and the
  # official_documents registry row docs/official-documents-contract.sql writes
  P -c "alter table public.dc_acquisition_run add column if not exists source_contract jsonb not null default '{}'::jsonb;
        insert into public.dc_source values ('official_documents', 'Official government documents', 'public record', true);" >/dev/null
  P -f "$here/seed_before.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: seed"; return 1; }
  P -f "${1:-$GATE}" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
}
suite() { P -tA -f "$here/suite.sql" 2>"$tmp/suite_err" | grep -E '\|[tf]\|' || true; }

# THE EVIDENCE CONTRACT (docs/official-documents-contract.sql) on the REAL Step-2A files
CDB=official_documents_contract_t
CONTRACT="$root/docs/official-documents-contract.sql"
C() { psql -X -q -v ON_ERROR_STOP=1 -d "$CDB" "$@"; }
contract_build() {  # contract_build [contract-file]; leaves the md5 of the pre-existing contracts in $fp_before
  dropdb --if-exists "$CDB" >/dev/null 2>&1; createdb "$CDB"
  C -c "do \$\$ begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
          if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
        end \$\$;
        create extension if not exists pgcrypto;
        create schema if not exists storage;
        create table if not exists storage.objects (bucket_id text, name text, metadata jsonb);" >/dev/null
  for f in docs/dc-step2a-foundation.sql docs/dc-step2b1a-atomic-evidence-commit.sql docs/dc-artifact-foundation.sql; do
    C -f "$root/$f" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: $f did not apply"; return 1; }
  done
  fp_before=$(C -tAc "select md5(string_agg(source_key || ':' || contract_version || ':' || contract_fingerprint, ',' order by source_key collate \"C\")) from public.dc_source")
  C -f "${1:-$CONTRACT}" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  C -f "${1:-$CONTRACT}" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
}
contract_suite() { C -tA -v fp_before="$fp_before" -f "$here/contract_suite.sql" 2>"$tmp/suite_err" | grep -E '\|[tf]\|' || true; }

cd "$root"
contract_build
cout="$(contract_suite)"; echo "$cout" | sed 's/^/  /'
c_all=$(grep -c '|' <<<"$cout" || true); c_fail=$(grep -c '|f|' <<<"$cout" || true)
echo "CONTRACT: $c_all checks, $c_fail failed"
if [ "$c_all" -lt 9 ] || [ "$c_fail" -ne 0 ]; then cat "$tmp/suite_err" >&2; echo "FAIL — the contract file does not pass"; exit 1; fi

build
P -f "$GATE" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: the file does not re-apply"; exit 1; }
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 35 ] || [ "$n_fail" -ne 0 ]; then
  cat "$tmp/suite_err" >&2; echo "FAIL — the shipped file does not pass"; exit 1
fi

[ "${OD_SKIP_MUTATIONS:-}" = 1 ] && exit 0
status=0
while read -r name; do
  python3 "$here/mutate.py" "$name" "$GATE" >"$tmp/mutated.sql" || { echo "HARNESS  $name — anchor missing"; status=1; continue; }
  if cmp -s "$GATE" "$tmp/mutated.sql"; then echo "HARNESS  $name — mutation changed nothing"; status=1; continue; fi
  rc=0; build "$tmp/mutated.sql" || rc=$?
  if [ "$rc" = 2 ]; then echo "KILLED   $name (the file refused to apply)"; continue; fi
  [ "$rc" = 0 ] || { echo "HARNESS  $name — build failed"; status=1; continue; }
  m="$(suite)"; f=$(grep -c '|f|' <<<"$m" || true); a=$(grep -c '|' <<<"$m" || true)
  if [ "$f" -gt 0 ] || [ "$a" -lt 35 ]; then echo "KILLED   $name ($f failed of $a)"
  else echo "SURVIVED $name"; status=1; fi
done < <(python3 "$here/mutate.py" --list)
while read -r name; do
  python3 "$here/mutate.py" --contract "$name" "$CONTRACT" >"$tmp/mutated.sql" || { echo "HARNESS  $name — anchor missing"; status=1; continue; }
  if cmp -s "$CONTRACT" "$tmp/mutated.sql"; then echo "HARNESS  $name — mutation changed nothing"; status=1; continue; fi
  rc=0; contract_build "$tmp/mutated.sql" || rc=$?
  if [ "$rc" = 2 ]; then echo "KILLED   $name (the file refused to apply)"; continue; fi
  [ "$rc" = 0 ] || { echo "HARNESS  $name — build failed"; status=1; continue; }
  m="$(contract_suite)"; f=$(grep -c '|f|' <<<"$m" || true); a=$(grep -c '|' <<<"$m" || true)
  if [ "$f" -gt 0 ] || [ "$a" -lt 9 ]; then echo "KILLED   $name ($f failed of $a)"
  else echo "SURVIVED $name"; status=1; fi
done < <(python3 "$here/mutate.py" --contract-list)
[ "$status" = 0 ] && echo "PASS — every mutation killed" || { echo "FAIL — see above"; exit 1; }
