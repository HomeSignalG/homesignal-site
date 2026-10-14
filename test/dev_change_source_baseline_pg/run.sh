#!/usr/bin/env bash
# Executable suite for docs/dev-change-source-baseline.sql (time-bounded SOURCE baseline, City of Denton) on a DISPOSABLE Postgres.
# The ledger is built from the repo's own SQL of record plus the REAL recovery splice; the run proves that base equals the
# live production bodies (md5 2f70e4c7... for dev_change_observe_zip) before anything else counts.
#   1. the exposure exists without the file (B00); 2. the file refuses a drifted body and applies twice identically;
#   3. allowlisted first sightings are is_baseline / not material / not reportable; everything else is unchanged;
#   4. rollback by excision restores the live md5; 5. each prohibited mutation fails >= 1 check.
set -uo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
psql -X -qtA -c 'select 1' >/dev/null 2>&1 || { echo "FAIL - cannot connect to PostgreSQL (a suite that cannot run is a failure, never a skip)"; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
SQL="$root/docs/dev-change-source-baseline.sql"
LIVE_OBS=2f70e4c786ae301d0efe9cdeb333f46d
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { psql -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
ok=0; bad=0
t() { if [ "$2" = "$3" ]; then echo "PASS $1"; ok=$((ok+1)); else echo "FAIL $1 got [$2] want [$3]"; bad=$((bad+1)); fi; }

build_base() {
  P -c "drop schema if exists public cascade; create schema public;" >/dev/null 2>&1
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null || return 1
  P -f "$root/test/dev_change_baseline_pg/fixture.sql" >/dev/null || return 1
  for d in dev-change-ledger dev-change-baseline dev-change-reportable; do
    P -f "$root/docs/$d.sql" >/dev/null 2>&1 || { echo "FAIL - docs/$d.sql does not apply"; return 1; }
  done
  sed -n '/^create or replace function public.app_source_key(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" > "$tmp/key.sql"
  sed -n '/^create or replace function public.app_source_key_basis(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" >> "$tmp/key.sql"
  P -f "$tmp/key.sql" >/dev/null || return 1
  P -f "$root/test/dev_change_recovery_pg/fixture.sql" >/dev/null || return 1
  P -c "drop schema if exists net cascade; create schema net; create table net._http_response (id bigint primary key, status_code integer, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz not null default now());" >/dev/null 2>&1
  python3 "$root/test/dev_collect_harness/real_helpers.py" | P >/dev/null 2>&1
  P -f "$root/docs/dev-source-receipt.sql" >/dev/null 2>"$tmp/e" || { cat "$tmp/e"; echo "FAIL - receipt does not apply"; return 1; }
  P -1 -f "$root/docs/dev-change-recovery.sql" >/dev/null 2>"$tmp/e" || { cat "$tmp/e"; echo "FAIL - recovery does not apply"; return 1; }
}
apply_file() { psql -X -q -1 -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null 2>"$tmp/e"; }
obs_md5() { Q "select md5(prosrc) from pg_proc where proname='dev_change_observe_zip'"; }

# a Denton-shaped site: source_id arcgis:<registry>:<id>, otherwise the recovery fixture's site
D() { echo "jsonb_set(public.sim_site('$1','Issued','2020-01-01', false, null, '$2'), '{source_id}', '\"arcgis:$2:$1\"')"; }
ev() { Q "select coalesce((select is_baseline::text||'/'||material::text from public.dev_change_event where identity_key='$1' and event_type='first_detected'),'none')"; }
rp() { Q "select count(*) from public.dev_change_event_reportable where identity_key='$1'"; }
baselined_zip() { # zip, existing id : refresh + baseline observation
  Q "select public.sim_refresh('$1', jsonb_build_array(public.sim_site('$2','Issued','2024-01-01')), now() - interval '5 hours')" >/dev/null
  Q "select public.sim_observe('$1', true)" >/dev/null; }
arrive() { # zip, existing id, then extra site expressions...
  local z="$1" e="$2"; shift 2; local extra; extra="$(IFS=,; echo "$*")"
  Q "select public.sim_refresh('$z', jsonb_build_array(public.sim_site('$e','Issued','2024-01-01'), $extra), now() - interval '4 hours')" >/dev/null
  Q "select public.sim_observe('$z', false)" >/dev/null; }

scenarios() {
  baselined_zip 76202 E2
  arrive 76202 E2 "$(D D1 denton-city-projects-decided)" "$(D D2 denton-city-projects-zoning)" "$(D D3 denton-city-projects-notlisted)" "public.sim_site('N1','Issued','2026-10-10')"
  t "C01 allowlisted decided -> baseline, not material" "$(ev arcgis:denton-city-projects-decided:D1)" true/false
  t "C02 allowlisted zoning -> baseline, not material" "$(ev arcgis:denton-city-projects-zoning:D2)" true/false
  t "C03 NOT allowlisted denton-prefixed id -> still news" "$(ev arcgis:denton-city-projects-notlisted:D3)" false/true
  t "C04 POSITIVE CONTROL other source new record -> news" "$(ev arcgis:fixture:N1)" false/true
  t "C05 allowlisted record not reportable" "$(rp arcgis:denton-city-projects-decided:D1)" 0
  t "C06 control record reportable" "$(rp arcgis:fixture:N1)" 1
  t "C07 allowlisted rows still tracked as comparable projects" "$(Q "select count(*) from public.dev_change_project where identity_key like 'arcgis:denton-city-projects-%:D_' and comparable")" 4
  # a later real change to a known Denton record stays news
  Q "select public.sim_refresh('76202', jsonb_build_array(public.sim_site('E2','Issued','2024-01-01'), jsonb_set($(D D1 denton-city-projects-decided),'{stage}','\"Approved\"')), now() - interval '2 hours')" >/dev/null
  Q "update public.dev_change_zip_cursor set observed_at = now() - interval '2 days' where zip='76202'" >/dev/null 2>&1
  Q "select public.sim_observe('76202', false)" >/dev/null
  t "C08 later status change on a baselined Denton record is a material event" "$(Q "select count(*) from public.dev_change_event_reportable where identity_key='arcgis:denton-city-projects-decided:D1' and event_type='status_changed' and material")" 1
  # window expiry / early close
  Q "update public.dev_change_source_baseline set baseline_until = now() - interval '1 minute' where registry_id='denton-city-projects-site-plan'" >/dev/null
  Q "update public.dev_change_source_baseline set closed_at = now() where registry_id='denton-city-projects-annexation'" >/dev/null
  baselined_zip 76203 E3
  arrive 76203 E3 "$(D D4 denton-city-projects-site-plan)" "$(D D5 denton-city-projects-annexation)" "$(D D6 denton-city-projects-subdivision)"
  t "D01 expired window -> news" "$(ev arcgis:denton-city-projects-site-plan:D4)" false/true
  t "D02 closed window -> news" "$(ev arcgis:denton-city-projects-annexation:D5)" false/true
  t "D03 open window still baseline" "$(ev arcgis:denton-city-projects-subdivision:D6)" true/false
  # an allowlisted id inside a later key segment must not match
  baselined_zip 76204 E4
  arrive 76204 E4 "jsonb_set(public.sim_site('T1','Issued','2024-01-01',false,null,'other'),'{source_id}','\"arcgis:other:denton-city-projects-zoning\"')"
  t "E01 id in a later key segment does not match" "$(ev arcgis:other:denton-city-projects-zoning)" false/true
  # purely table-driven: emptied allowlist -> Denton is news again
  Q "truncate public.dev_change_source_baseline" >/dev/null
  baselined_zip 76205 E5
  arrive 76205 E5 "$(D D7 denton-city-projects-decided)"
  t "F01 empty allowlist -> Denton is news again" "$(ev arcgis:denton-city-projects-decided:D7)" false/true
}

# ---- normal run ----
build_base || exit 1
t "A00 the repo-built base equals the LIVE observe_zip body" "$(obs_md5)" "$LIVE_OBS"
Q "create or replace function public.dev_change_observe_zip(p_zip text, p_run uuid) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$" >/dev/null
if apply_file; then t "A01 refuses a drifted body" applied refused; else t "A01 refuses a drifted body" "$(grep -c 'written against 2f70e4c7' "$tmp/e")" 1; fi
t "A01b nothing created on refusal" "$(Q "select to_regclass('public.dev_change_source_baseline') is null")" t
build_base || exit 1
baselined_zip 76201 E1
arrive 76201 E1 "$(D D0 denton-city-projects-decided)"
t "B00 EXPOSURE reproduced without the file: Denton first sighting is material and reportable" "$(Q "select count(*) from public.dev_change_event_reportable where identity_key='arcgis:denton-city-projects-decided:D0' and material and event_type='first_detected'")" 1
apply_file || { cat "$tmp/e"; echo "FAIL - the file does not apply"; exit 1; }
m1="$(obs_md5)"; apply_file; m2="$(obs_md5)"
t "A02 applying twice changes nothing" "$m1" "$m2"
t "A03 observe_zip is changed" "$([ "$m1" != "$LIVE_OBS" ] && echo y)" y
t "A04 allowlist is the 7 registry ids (fingerprint)" "$(Q "select count(*)||'|'||md5(string_agg(registry_id, ',' order by registry_id collate \"C\")) from public.dev_change_source_baseline")" "7|40ee6c7656c91446829f639845737880"
t "A05 anon/authenticated cannot execute or read" "$(Q "select has_function_privilege('anon','public.dev_change_source_baseline_active(text,text)','execute') or has_function_privilege('authenticated','public.dev_change_source_baseline_active(text,text)','execute') or has_table_privilege('anon','public.dev_change_source_baseline','select')")" f
scenarios
cat > "$tmp/rb.sql" <<'EOF'
do $rb$ declare _o oid := 'public.dev_change_observe_zip(text, uuid)'::regprocedure; _d text := pg_get_functiondef(_o);
begin execute replace(_d,
  E'         -- dev_change_source_baseline: an allowlisted source family''s FIRST sighting is not news (open, unexpired window only)\n'
  || E'         not (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n'
  || E'         (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n',
  E'         not (_baseline or rc.identity_key is not null),\n         (_baseline or rc.identity_key is not null),\n'); end $rb$;
EOF
P -f "$tmp/rb.sql" >/dev/null
t "G01 rollback by excision restores the live md5" "$(obs_md5)" "$LIVE_OBS"
echo "CHECKS: $ok passed, $bad failed"
total_bad=$bad

# ---- mutations: each must make at least one scenario check fail ----
killed=0; muts=0
mutate() { # name, function body
  muts=$((muts+1)); build_base || exit 1; apply_file || exit 1
  Q "create or replace function public.dev_change_source_baseline_active(p_registry_id text, p_identity_key text) returns boolean language sql as \$\$ $2 \$\$" >/dev/null
  before=$bad; scenarios >"$tmp/m.out" 2>&1; after=$bad
  if [ "$after" -gt "$before" ]; then killed=$((killed+1)); echo "KILLED $1 ($((after-before)) checks failed)"; else echo "SURVIVED $1"; fi
  bad=$before   # mutant failures are expected; they must not count against the shipped result
}
mutate "guard always true (everything baselined)" "select true"
mutate "guard always false (nothing protected)" "select false"
mutate "ignores the window (expiry/close not honoured)" "select exists (select 1 from public.dev_change_source_baseline b where b.registry_id in (coalesce(p_registry_id,''), coalesce(split_part(p_identity_key,':',2),'')))"
mutate "substring match on the key" "select exists (select 1 from public.dev_change_source_baseline b where b.closed_at is null and now() < b.baseline_until and p_identity_key like '%'||b.registry_id||'%')"
echo "MUTATIONS: $killed of $muts killed"
[ "$total_bad" -eq 0 ] && [ "$killed" -eq "$muts" ] || { echo "FAIL"; exit 1; }
echo "OK"
