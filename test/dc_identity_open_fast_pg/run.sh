#!/usr/bin/env bash
# IDENTITY-OPEN VIEW (record keys read once; pre-filter) on a DISPOSABLE PostGIS (never production). Proves for docs/dc-identity-open-fast-apply.sql:
#   P1  the "before" view is the definition production holds (md5), and the guard refuses a foreign one
#   P2  applying it yields EXACTLY the definition docs/dc-step3a-canonical-identity.sql builds (md5 of pg_get_viewdef equal)
#   P3  re-applying is a no-op; the view stays security_invoker, closed to anon/authenticated, and keeps its comment
#   P4  the view statement in the apply file is byte-identical to step 3A's
#   P5  the adjudicator is NOT called for a same-source pair (a counting stand-in proves the pre-filter, not just the result),
#       and IS still called for a cross-source pair of different entities
# Row-for-row equivalence of the two definitions is proven by E37 in test/dc_epoch_geography_pg/suite.sql.
# Then each prohibited mutation of the apply file must fail >= 1 check (a mutation that does not apply is a harness failure).
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
cd "$root"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
Q() { P -tA -c "$1"; }
chk() { if [ "$2" = "$3" ]; then echo "PASS — $1"; else echo "FAIL — $1  [got: $2 | want: $3]"; fails=$((fails+1)); fi; }
build() {  # $1 = db name; the checkout's chain
  dropdb --if-exists "$1" >/dev/null 2>&1; createdb "$1"; DB="$1"
  P -f test/zip_membership_pg/fixture_schema.sql >/dev/null 2>&1
  P -f docs/zip-membership-canonical.sql >/dev/null 2>&1
  P -f test/dc_epoch_geography_pg/fixture.sql >/dev/null 2>&1
  P -f docs/dc-step3d-derived-location.sql >/dev/null 2>&1
  P -f docs/dc-step3a-canonical-identity.sql >/dev/null
}
ref="dc_idopen_ref_t"; build "$ref"
NEWDEF=$(DB=$ref Q "select md5(pg_get_viewdef('public.dc_entity_identity_open'::regclass, true))")
DB=dc_idopen_t; build dc_idopen_t; P -f "$here/old_view.sql" >/dev/null

chk "P1 the before view is the definition production holds" "$(Q "select md5(pg_get_viewdef('public.dc_entity_identity_open'::regclass, true))")" "86ab0fcf9fa3aa5c87d08e9c5fbee3df"
P -c "create or replace view public.dc_entity_identity_open with (security_invoker = true) as select 1::uuid::text::uuid as canonical_entity_id, null::uuid other_entity_id, null::text candidate_rule_key, null::text decision_state, null::text decision_rule_key where false" >/dev/null 2>&1 || P -c "create or replace view public.dc_entity_identity_open with (security_invoker = true) as select null::uuid canonical_entity_id, null::uuid other_entity_id, null::text candidate_rule_key, null::text decision_state, null::text decision_rule_key where false" >/dev/null
if P -f docs/dc-identity-open-fast-apply.sql >/dev/null 2>"$tmp/err"; then chk "P1 guard refuses a foreign definition" "applied" "refused"; else chk "P1 guard refuses a foreign definition" "$(grep -c 'is not the definition this change replaces' "$tmp/err")" "1"; fi
P -f "$here/old_view.sql" >/dev/null
P -f docs/dc-identity-open-fast-apply.sql >/dev/null 2>&1 || { echo "FAIL — apply did not apply"; fails=$((fails+1)); }
chk "P2 applying yields exactly step 3A's definition" "$(Q "select md5(pg_get_viewdef('public.dc_entity_identity_open'::regclass, true))")" "$NEWDEF"
P -f docs/dc-identity-open-fast-apply.sql >/dev/null 2>"$tmp/err" && chk "P3 re-applying is a no-op, not an error" ok ok || chk "P3 re-applying is a no-op" error ok
chk "P3 still exactly step 3A's definition after the second apply" "$(Q "select md5(pg_get_viewdef('public.dc_entity_identity_open'::regclass, true))")" "$NEWDEF"
chk "P3 security_invoker, closed to anon/authenticated, comment kept" \
    "$(Q "select ('security_invoker=true' = any (reloptions))::text||' '||(not has_table_privilege('anon','public.dc_entity_identity_open','select'))::text||' '||(not has_table_privilege('authenticated','public.dc_entity_identity_open','select'))::text||' '||(obj_description(oid,'pg_class') is not null)::text from pg_class where oid='public.dc_entity_identity_open'::regclass")" "true true true true"
stmt() { python3 - "$1" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read(); k = "create or replace view public.dc_entity_identity_open"
a = s.index(k); b = s.index(";\n", a); print(s[a:b])
PY
}
chk "P4 the apply file carries step 3A's view statement" "$(stmt docs/dc-identity-open-fast-apply.sql | md5sum)" "$(stmt docs/dc-step3a-canonical-identity.sql | md5sum)"

# P5: count adjudicator calls. Replace dc_adjudicate_pair with a counting wrapper over the real one (renamed), on a tiny state.
P <<'SQL' >/dev/null
create table if not exists public._adj_calls (a uuid, b uuid);
alter function public.dc_adjudicate_pair(uuid, uuid, text) rename to dc_adjudicate_pair_real;
create function public.dc_adjudicate_pair(p_a uuid, p_b uuid, p_rule text)
returns table (decision_state text, decision_rule_key text, evidence jsonb) language plpgsql as $f$
begin insert into public._adj_calls values (p_a, p_b); return query select * from public.dc_adjudicate_pair_real(p_a, p_b, p_rule); end $f$;
SQL
P <<'SQL' >/dev/null
insert into public.dc_source (source_key, publisher, licence, supplies_publisher_record_id) values ('s1','p','l',false),('s2','p','l',false) on conflict do nothing;
with r as (insert into public.dc_acquisition_run (source_key, distribution_key, run_seq) values ('s1','d',1),('s2','d',1) returning id, source_key)
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, source_native_name, source_native_type)
select r.id, r.source_key, 'd', n.name, 'data center' from r join (values ('s1','Same'),('s1','Same'),('s1','Cross'),('s2','Cross')) n(sk, name) on n.sk = r.source_key;
select count(*) from public.dc_resolve_canonical(true, false);
SQL
P -f docs/dc-identity-open-fast-apply.sql >/dev/null 2>&1   # a view binds its function by OID: re-create it so it calls the wrapper
P -c "update public.dc_canonical_entity set classification = 'CONFIRMED_DC'" >/dev/null   # else no entity qualifies and the planner never reaches the adjudicator at all
P -c "truncate public._adj_calls" >/dev/null
Q "select count(*) from public.dc_entity_identity_open" >/dev/null
chk "P5 the adjudicator ran for the cross-source pair only (1 call), never for the same-source pair" \
    "$(Q "select count(*) from public._adj_calls c join public.dc_source_observation x on x.home_signal_observation_id=c.a join public.dc_source_observation y on y.home_signal_observation_id=c.b where x.source_key<>y.source_key")/$(Q "select count(*) from public._adj_calls")" "1/1"
chk "P5 control: the candidate view DID propose the same-source pair (so skipping it is the pre-filter, not an empty input)" \
    "$(Q "select count(*) from public.dc_identity_candidate c join public.dc_source_observation x on x.home_signal_observation_id=c.observation_a join public.dc_source_observation y on y.home_signal_observation_id=c.observation_b where x.source_key=y.source_key")" "1"


# P6: the exclusivity rule keeps its meaning on the rewritten view (rank < 2 only; a singleton never separates two entities)
P <<'SQL' >/dev/null
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, source_native_name, source_native_type)
select acquisition_run_id, 's1', 'd', n.name, 'data center' from public.dc_source_observation x cross join (values ('Other'), ('Dup'), ('Dup')) n(name) where x.source_key='s1' and x.source_native_name='Cross';
select count(*) from public.dc_resolve_canonical(true, false);
update public.dc_canonical_entity set classification = 'CONFIRMED_DC';   -- AFTER the resolver, which recomputes it
SQL
ent() { Q "select eo.canonical_entity_id from public.dc_entity_observation eo join public.dc_source_observation o using (home_signal_observation_id) where o.source_key='$1' and o.source_native_name='$2' limit 1"; }
obs() { Q "select home_signal_observation_id from public.dc_source_observation where source_key='$1' and source_native_name='$2' limit 1"; }
E1=$(ent s1 Cross); E2=$(ent s2 Cross); OTHER=$(obs s1 Other); DUP=$(obs s1 Dup)
open_n() { Q "select count(*) from public.dc_entity_identity_open where canonical_entity_id in ('$E1','$E2') and other_entity_id in ('$E1','$E2')"; }
chk "P6 control: before any exclusivity evidence the cross-source pair is OPEN (both directions)" "$(open_n)" "2"
P -c "update public.dc_entity_observation set canonical_entity_id = '$E2' where home_signal_observation_id = '$OTHER'" >/dev/null
chk "P6 a different stable record of the same source on the other entity SEPARATES the pair (0 open rows)" "$(open_n)" "0"
P -c "update public.dc_entity_observation set canonical_entity_id = '$E1' where home_signal_observation_id = '$OTHER'" >/dev/null
chk "P6 control: that record on the SAME entity does not separate (2 open rows again)" "$(open_n)" "2"
P -c "update public.dc_entity_observation set canonical_entity_id = '$E2' where home_signal_observation_id = '$DUP'" >/dev/null
chk "P6 a SINGLETON-keyed record (a repeated name) never separates two entities (still 2 open rows)" "$(open_n)" "2"

[ "$fails" -eq 0 ] || { echo "FAIL — $fails check(s) failed"; exit 1; }
echo "ALL CHECKS PASSED (shipped)"
mutate() { python3 - "$2" <<PY > "$tmp/mut.sql" || { echo "HARNESS  $1 — did not apply"; exit 2; }
import sys
s = open('docs/dc-identity-open-fast-apply.sql', encoding='utf-8').read()
t = eval(sys.argv[1])
assert t != s, "mutation is a no-op"
sys.stdout.write(t)
PY
}
status=0
run_mut() { mutate "$1" "$2"; cp docs/dc-identity-open-fast-apply.sql "$tmp/orig.sql"; cp "$tmp/mut.sql" docs/dc-identity-open-fast-apply.sql
  if bash "$here/run.sh" --no-mutations >/dev/null 2>&1; then echo "SURVIVED $1"; status=1; else echo "KILLED   $1"; fi
  cp "$tmp/orig.sql" docs/dc-identity-open-fast-apply.sql; }
if [ "${1:-}" != "--no-mutations" ]; then
  run_mut "pre-filter drops the different-source test"  "s.replace(\"     where xa.source_key <> xb.source_key\\n       and xa.canonical_entity_id <> xb.canonical_entity_id\\n), e as (\", \"     where xa.canonical_entity_id <> xb.canonical_entity_id\\n), e as (\", 1)"
  run_mut "pre-filter drops the different-entity test"  "s.replace(\"       and xa.canonical_entity_id <> xb.canonical_entity_id\\n), e as (\", \"\\n), e as (\", 1)"
  run_mut "adjudicator filter on CONFIRMED_DISTINCT removed" "s.replace(\"     where a.decision_state <> 'CONFIRMED_DISTINCT'\\n), both_dirs\", \"\\n), both_dirs\", 1)"
  run_mut "exclusivity counts singleton keys too"       "s.replace(\"     where record_key_rank < 2\\n)\", \"\\n)\", 1)"
  run_mut "exclusivity never separates (always open)"   "s.replace(\"           and r1.record_key <> r2.record_key);\", \"           and false);\", 1)"
  run_mut "guard removed"                               "s.replace(\"elsif md5(_def) <> '86ab0fcf9fa3aa5c87d08e9c5fbee3df' then\", \"elsif false then\")"
  run_mut "view opened to anon"                          "s.replace(\"create or replace view public.dc_entity_identity_open with (security_invoker = true) as\", \"grant select on public.dc_entity_identity_open to anon; create or replace view public.dc_entity_identity_open with (security_invoker = true) as\", 1)"
fi
[ "$status" -eq 0 ] || exit 1
[ "${1:-}" = "--no-mutations" ] || echo "ALL MUTATIONS KILLED"
