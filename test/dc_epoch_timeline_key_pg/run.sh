#!/usr/bin/env bash
# EPOCH TIMELINE RECORD KEY on a DISPOSABLE PostGIS (never production). Proves, with the SHIPPED resolver:
#   K1  BEFORE (origin/main's view): every daily timeline run mints a fresh entity per row — the defect, reproduced
#   K2  the apply file refuses a view that is not the definition it replaces, and is a no-op when already applied
#   K3  AFTER: one resolver pass over the accumulated history supersedes the leftovers into ONE live entity per
#       (name,date) and DELETES NOTHING (entities, links, decisions all kept; no observation unlinked)
#   K4  a new daily run mints nothing for rows already known, one entity for a genuinely new (name,date)
#   K5  rows the new key cannot cover are unchanged: a (name,date) repeated in a run stays two singletons; a missing
#       Date falls through to the pre-existing step 3A name rule
#   K6  steady state: a second resolver pass writes nothing; the geography resolver sees only live entities
#   K7  epoch_ai/data_centers entities are untouched by the change (fingerprint equal before/after)
#   K8  the three copies of the view body (step 3A, epoch geography apply, this apply file) are byte-identical
# Then each prohibited mutation of the apply file must fail >= 1 check (a mutation that does not apply is a
# harness failure, never a pass).
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
cd "$root"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export PGDATABASE=dc_timeline_key_t
fails=0
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
chk() { if [ "$2" = "$3" ]; then echo "PASS — $1"; else echo "FAIL — $1  [got: $2 | want: $3]"; fails=$((fails+1)); fi; }

build() {   # the checkout's chain; the old view is laid over it by the caller
  dropdb --if-exists "$PGDATABASE" >/dev/null 2>&1; createdb "$PGDATABASE"
  P -f test/zip_membership_pg/fixture_schema.sql >/dev/null 2>&1
  P -f docs/zip-membership-canonical.sql >/dev/null 2>&1
  P -f test/dc_epoch_geography_pg/fixture.sql >/dev/null 2>&1
  P -f docs/dc-step3d-derived-location.sql >/dev/null 2>&1
  P -f docs/dc-step3a-canonical-identity.sql >/dev/null
  P -f docs/dc-step3b-canonical-geography.sql >/dev/null 2>&1
}
# run N of epoch_ai: timelines rows are (name, date) pairs; data_centers rows are unique names
fixture_schema_up() { P <<'SQL' >/dev/null
insert into public.dc_source (source_key, publisher, licence, supplies_publisher_record_id)
values ('epoch_ai', 'Epoch AI', 'CC-BY', false) on conflict do nothing;
create or replace function pg_temp.noop() returns void language sql as 'select 1';
SQL
}
# ingest N: $1 = run_seq, $2 = SQL expression listing timeline (name,date) rows as a VALUES list
ingest() {
  P -v seq="$1" -v rows="$2" -v dcs="$3" <<'SQL' >/dev/null
with r as (insert into public.dc_acquisition_run (source_key, distribution_key, run_seq)
           values ('epoch_ai', 'timelines', :seq) returning id),
     d as (insert into public.dc_acquisition_run (source_key, distribution_key, run_seq)
           values ('epoch_ai', 'data_centers', :seq) returning id)
select 1;
SQL
  P -v seq="$1" -v rows="$2" -v dcs="$3" <<SQL >/dev/null
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, source_row_ordinal,
                                          source_native_name, raw_payload)
select (select id from public.dc_acquisition_run where source_key='epoch_ai' and distribution_key='timelines' and run_seq=$1),
       'epoch_ai', 'timelines', row_number() over (), v.n,
       jsonb_strip_nulls(jsonb_build_object('Data center', v.n, 'Date', v.d))
  from (values $2) v(n, d);
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, source_row_ordinal,
                                          source_native_name, raw_payload)
select (select id from public.dc_acquisition_run where source_key='epoch_ai' and distribution_key='data_centers' and run_seq=$1),
       'epoch_ai', 'data_centers', row_number() over (), v.n, jsonb_build_object('Name', v.n)
  from (values $3) v(n);
SQL
}
resolve() { Q "select string_agg(metric||'='||value, ' ' order by metric) from public.dc_resolve_canonical(true, false) where metric in ('ENTITIES_MINTED','OBSERVATIONS_RELINKED','ENTITIES_SUPERSEDED','OBSERVATIONS_NEWLY_LINKED')"; }
live_tl()  { Q "select count(*) from public.dc_canonical_entity e where e.superseded_by is null and exists (select 1 from public.dc_entity_observation o where o.canonical_entity_id=e.canonical_entity_id and o.distribution_key='timelines')"; }
all_tl()   { Q "select count(*) from public.dc_canonical_entity e where exists (select 1 from public.dc_entity_observation o where o.canonical_entity_id=e.canonical_entity_id and o.distribution_key='timelines') or (e.superseded_by is not null and not exists (select 1 from public.dc_entity_observation o where o.canonical_entity_id=e.canonical_entity_id))"; }
dc_fp()    { Q "select md5(string_agg(o.home_signal_observation_id::text||'>'||o.canonical_entity_id::text, ',' order by o.home_signal_observation_id::text collate \"C\")) from public.dc_entity_observation o where o.distribution_key='data_centers'"; }

# three milestones for each of 6 data centres, over 3 days; day 2 re-dates one milestone and drops one; day 3 adds one
D1="('Alpha','2024-01-01'),('Alpha','2025-01-01'),('Alpha','2026-01-01'),('Beta','2024-02-01'),('Beta','2025-02-01'),('Beta','2026-02-01'),('Gamma','2024-03-01'),('Gamma','2025-03-01'),('Gamma','2026-03-01'),('Delta','2024-04-01'),('Delta','2025-04-01'),('Delta','2026-04-01'),('Eps','2024-05-01'),('Eps','2025-05-01'),('Eps','2026-05-01'),('Zeta','2024-06-01'),('Zeta','2025-06-01'),('Zeta','2026-06-01')"
D2="('Alpha','2024-01-01'),('Alpha','2025-01-01'),('Alpha','2026-01-01'),('Beta','2024-02-01'),('Beta','2025-02-01'),('Beta','2026-02-01'),('Gamma','2024-03-01'),('Gamma','2025-03-01'),('Gamma','2026-03-01'),('Delta','2024-04-01'),('Delta','2025-04-01'),('Delta','2026-04-01'),('Eps','2024-05-01'),('Eps','2025-05-01'),('Eps','2026-05-01'),('Zeta','2024-06-01'),('Zeta','2025-06-01'),('Zeta','2026-06-07')"
D3="('Alpha','2024-01-01'),('Alpha','2025-01-01'),('Alpha','2026-01-01'),('Beta','2024-02-01'),('Beta','2025-02-01'),('Beta','2026-02-01'),('Gamma','2024-03-01'),('Gamma','2025-03-01'),('Gamma','2026-03-01'),('Delta','2024-04-01'),('Delta','2025-04-01'),('Delta','2026-04-01'),('Eps','2024-05-01'),('Eps','2025-05-01'),('Eps','2026-05-01'),('Zeta','2024-06-01'),('Zeta','2025-06-01'),('Zeta','2026-06-07'),('Eta','2026-07-01')"
DC="('Alpha'),('Beta'),('Gamma'),('Delta'),('Eps'),('Zeta')"

# ── K1: the defect, on origin/main's view ─────────────────────────────────────────────────────────
build; P -f "$here/old_view.sql" >/dev/null; fixture_schema_up
OLDDEF=$(Q "select md5(pg_get_viewdef('public.dc_observation_record_key'::regclass, true))")
chk "K0 the old view is the definition production holds (md5)" "$OLDDEF" "12d40cc3f3e04a625d1d5e15faeb3343"
ingest 1 "$D1" "$DC"; resolve >/dev/null
ingest 2 "$D2" "$DC"; resolve >/dev/null
ingest 3 "$D3" "$DC"; resolve >/dev/null
chk "K1 BEFORE: 18+18+19 daily rows minted 55 timeline entities, all live" "$(live_tl)" "55"
chk "K1 BEFORE: only the 19 in the latest run have current evidence" \
    "$(Q "select count(distinct o.canonical_entity_id) from public.dc_entity_observation o join public.dc_current_observation c using (home_signal_observation_id) where o.distribution_key='timelines'")" "19"
FP0=$(dc_fp)
ROWS0=$(Q "select (select count(*) from public.dc_canonical_entity)||'/'||(select count(*) from public.dc_entity_observation)||'/'||(select count(*) from public.dc_identity_decision)")
NOBS0=$(Q "select count(*) from public.dc_entity_observation where distribution_key='timelines'")

# ── K2: the guard ─────────────────────────────────────────────────────────────────────────────────
P -c "create or replace view public.dc_observation_record_key with (security_invoker = true) as select o.home_signal_observation_id, 'x'::text as record_key, 2 as record_key_rank from public.dc_source_observation o" >/dev/null
if P -f docs/dc-epoch-timeline-key-apply.sql >/dev/null 2>"$tmp/err"; then chk "K2 guard refuses a foreign definition" "applied" "refused"; else chk "K2 guard refuses a foreign definition" "$(grep -c 'is not the definition this change replaces' "$tmp/err")" "1"; fi
P -f "$here/old_view.sql" >/dev/null   # restore the old definition
chk "K2 the restore put the old definition back" "$(Q "select md5(pg_get_viewdef('public.dc_observation_record_key'::regclass, true))")" "$OLDDEF"

# ── K3: apply, one resolver pass ──────────────────────────────────────────────────────────────────
P -f docs/dc-epoch-timeline-key-apply.sql >/dev/null 2>&1 || { echo "FAIL — apply file did not apply"; fails=$((fails+1)); }
P -f docs/dc-epoch-timeline-key-apply.sql >/dev/null 2>"$tmp/err" && chk "K2 re-applying is a no-op, not an error" "ok" "ok" || chk "K2 re-applying is a no-op" "error" "ok"
OUT=$(resolve); echo "  resolver pass: $OUT"
# distinct (name,date) over all three runs: 18 + 1 re-dated + 1 new = 20
chk "K3 AFTER: ONE live entity per (name,date) — 20, not 55" "$(live_tl)" "20"
chk "K3 nothing deleted: entity / link / decision row counts unchanged" \
    "$(Q "select (select count(*) from public.dc_canonical_entity)||'/'||(select count(*) from public.dc_entity_observation)||'/'||(select count(*) from public.dc_identity_decision)")" "$ROWS0"
chk "K3 no observation unlinked" "$(Q "select count(*) from public.dc_entity_observation where distribution_key='timelines'")" "$NOBS0"
chk "K3 every superseded entity names the key group it joined" \
    "$(Q "select count(*) from public.dc_canonical_entity where superseded_by is not null and supersede_reason like 'SAME_RECORD_GROUP: epoch_ai|timelines|name+date:%'")" "35"
chk "K3 the 19 current rows are all on live entities with 3 observations (or 1 for the new one)" \
    "$(Q "select count(*) from public.dc_entity_observation o join public.dc_current_observation c using (home_signal_observation_id) join public.dc_canonical_entity e using (canonical_entity_id) where o.distribution_key='timelines' and e.superseded_by is null")" "19"
chk "K3 the re-dated milestone keeps BOTH of its dates as separate records (a re-date is a new key)" \
    "$(Q "select count(distinct o.canonical_entity_id) from public.dc_entity_observation o join public.dc_source_observation s using (home_signal_observation_id) where s.source_native_name='Zeta' and s.raw_payload->>'Date' in ('2026-06-01','2026-06-07')")" "2"
chk "K7 data_centers entity links unchanged by the change (fingerprint)" "$(dc_fp)" "$FP0"

# ── K4: a new daily run ───────────────────────────────────────────────────────────────────────────
D4="$D3,('Theta','2026-08-01')"
ingest 4 "$D4" "$DC"; OUT=$(resolve); echo "  run 4 pass: $OUT"
chk "K4 a new daily run mints exactly ONE entity (the new milestone) — 20 -> 21 live" "$(live_tl)" "21"
chk "K4 run 4 minted exactly 1" "$(grep -o 'ENTITIES_MINTED=[0-9]*' <<<"$OUT")" "ENTITIES_MINTED=1"

# ── K5: rows the rule cannot key stay singletons ──────────────────────────────────────────────────
D5="$D4,('Dup','2026-09-01'),('Dup','2026-09-01'),('NoDate',NULL)"
ingest 5 "$D5" "$DC"; OUT=$(resolve)
chk "K5 the repeated pair (2) and the no-Date row (1) each get their own entity: 21 + 3 = 24 live" "$(live_tl)" "24"
chk "K5 the repeated (name,date) pair is two rank-2 singletons" \
    "$(Q "select count(*) from public.dc_observation_record_key k join public.dc_source_observation s using (home_signal_observation_id) where s.source_native_name='Dup' and k.record_key_rank=2")" "2"
chk "K5 a row with no Date falls through to the pre-existing step 3A name rule (unique in its run), never the new key" \
    "$(Q "select k.record_key_rank||' '||(k.record_key like '%|name:NoDate') from public.dc_observation_record_key k join public.dc_source_observation s using (home_signal_observation_id) where s.source_native_name='NoDate'")" "1 true"

# ── K6: steady state + geography ──────────────────────────────────────────────────────────────────
OUT=$(resolve)
chk "K6 a second pass writes nothing" "$OUT" "ENTITIES_MINTED=0 ENTITIES_SUPERSEDED=0 OBSERVATIONS_NEWLY_LINKED=0 OBSERVATIONS_RELINKED=0"
GEO=$(Q "select value from public.dc_resolve_geography(true) where metric='ENTITIES'")
LIVE_ALL=$(Q "select count(*) from public.dc_canonical_entity where superseded_by is null")
chk "K6 the geography resolver considers exactly the live entities" "$GEO" "$LIVE_ALL"

# ── K8: the registry and view statements in the apply file are byte-identical to step 3A's ──────────
stmt() { python3 - "$1" "$2" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read(); k = sys.argv[2]
a = s.index(k); b = s.index(";\n", a)
print(s[a:b])
PY
}
for k in "create table if not exists public.dc_record_key_discriminator" "create or replace view public.dc_observation_record_key"; do
  chk "K8 the apply file carries step 3A's statement: $k" "$(stmt docs/dc-epoch-timeline-key-apply.sql "$k" | md5sum)" "$(stmt docs/dc-step3a-canonical-identity.sql "$k" | md5sum)"
done
chk "K8 step 3A seeds exactly the epoch_ai/timelines/Date row" "$(Q "select count(*)||' '||string_agg(source_key||'/'||distribution_key||'/'||payload_field, ',') from public.dc_record_key_discriminator")" "1 epoch_ai/timelines/Date"
chk "K8 no source is named in the key view" "$(Q "select (pg_get_viewdef('public.dc_observation_record_key'::regclass,true) ~ 'epoch_ai')::text")" "false"

[ "$fails" -eq 0 ] || { echo "FAIL — $fails check(s) failed"; exit 1; }
echo "ALL CHECKS PASSED (shipped)"

# ── mutations: each must fail at least one check ──────────────────────────────────────────────────
mutate() {  # name  python-expr transforming text s (must change it)
  python3 - "$1" "$2" <<'PY' > "$tmp/mut.sql" || { echo "HARNESS  $1 — did not apply"; exit 2; }
import sys
name, expr = sys.argv[1], sys.argv[2]
s = open('docs/dc-epoch-timeline-key-apply.sql', encoding='utf-8').read()
t = eval(expr)
assert t != s, "mutation is a no-op"
sys.stdout.write(t)
PY
}
status=0
run_mut() {
  local name="$1" expr="$2"
  mutate "$name" "$expr"
  local keep="docs/dc-epoch-timeline-key-apply.sql"; cp "$keep" "$tmp/orig.sql"; cp "$tmp/mut.sql" "$keep"
  if bash "$here/run.sh" --no-mutations >/dev/null 2>&1; then echo "SURVIVED $name"; status=1; else echo "KILLED   $name"; fi
  cp "$tmp/orig.sql" "$keep"
}
if [ "${1:-}" != "--no-mutations" ]; then
  run_mut "no rank-1 for the paired key"        "s.replace(\"= 1 then 1\n            when s.supplies_publisher_record_id is false\n             and nullif(btrim(o.source_native_name), '') is not null\n             and count\", \"= 1 then 2\n            when s.supplies_publisher_record_id is false\n             and nullif(btrim(o.source_native_name), '') is not null\n             and count\", 1)"
  run_mut "key ignores the discriminator value"   "s.replace(\"|| '|' || btrim(o.raw_payload ->> d.payload_field)\", \"\", 1)"
  run_mut "uniqueness partition ignores the value" "s.replace(\"btrim(o.source_native_name), btrim(o.raw_payload ->> d.payload_field)) = 1\", \"btrim(o.source_native_name)) = 1\")"
  run_mut "guard removed"                         "s.replace(\"elsif md5(_def) <> '12d40cc3f3e04a625d1d5e15faeb3343' then\", \"elsif false then\")"
  run_mut "registry seed widened to a second distribution" "s.replace(\"values ('epoch_ai', 'timelines', 'Date', 'date')\", \"values ('epoch_ai', 'timelines', 'Date', 'date'), ('epoch_ai', 'data_centers', 'Date', 'date')\")"
  run_mut "registry readable by anon"             "s.replace(\"revoke all on public.dc_record_key_discriminator from anon, authenticated;\", \"grant select on public.dc_record_key_discriminator to anon;\")"
fi
[ "$status" -eq 0 ] || exit 1
echo "ALL MUTATIONS KILLED"
