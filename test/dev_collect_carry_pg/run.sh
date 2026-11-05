#!/usr/bin/env bash
# docs/dev-refresh-collect-carry-failed-sources.sql on a DISPOSABLE Postgres only (never production; site CLAUDE.md §7.11).
# Builds the LIVE collector exactly as production runs it (md5 5afbb783…), runs every case on that body first (CONTROL: the
# defect is reproduced), applies the migration, and runs every case again. Each check prints "ID|t" or "ID|f|…".
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
bad=0; ran=0
t() { ran=$((ran+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }

# ── the live collector, as production runs it ────────────────────────────────────────────────────────────────────────
bash "$root/test/dev_collect_harness/build.sh" >/dev/null 2>&1
P -f "$root/docs/dev-refresh-collect-blocked-plan-stable.sql" >/dev/null 2>&1
P >/dev/null <<'SQL'
do $$ declare def text;
  o text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)$a$;
  n text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)$a$;
begin select pg_get_functiondef(oid) into def from pg_proc where proname = 'dev_refresh_collect'; execute replace(def, o, n); end $$;
SQL
t C00 "$(Q "select md5(prosrc)||'|'||length(prosrc) from pg_proc where proname='dev_refresh_collect'")" "5afbb78376a080f2d9eb095335476a53|16091"

P >/dev/null <<'SQL'
create or replace function public.c_site(src text, n int, typ text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('source_registry_id', src, 'title', src || ' ' || n, 'record_url', 'https://x.test/' || src || '/' || n,
         'lat', 40, 'lng', -100, 'scope', 'point', 'type', typ) || extra $$;
create or replace function public.c_fac(n int) returns jsonb language sql as $$
  select jsonb_build_object('registry_id', '11000000' || n, 'title', 'Facility ' || n, 'lat', 40, 'lng', -100, 'scope', 'point') $$;
create or replace function public.c_rep(src text, failed boolean) returns jsonb language sql as $$
  select jsonb_build_object('registry_id', src, 'fetched', case when failed then 0 else 1 end,
         'quarantined', case when failed then '[{"reason":"fetch failed: ArcGIS error: Token Required","sample":"s"}]'::jsonb else '[]'::jsonb end) $$;
create or replace function public.c_reset() returns void language sql as $$
  truncate public.development_reports, net._http_response, public.dev_refresh_source_failures $$;
-- a stored ZIP row and a response, then ONE collector tick; returns nothing (checks read the row)
create or replace function public.c_case(z text, stored jsonb, stored_counts jsonb, age interval, sites jsonb, counts jsonb, reports jsonb) returns void
language plpgsql as $$
declare id bigint := nextval('net.http_request_queue_id_seq');
begin
  insert into public.development_reports (zip, sites, counts, refreshed_at, facilities_refreshed_at, last_collected_response_id)
  values (z, stored, stored_counts, now() - age, now() - age, null);
  insert into net._http_response (id, status_code, content, created)
  values (id, 200, jsonb_build_object('zip', z, 'mode', 'zip', 'sites', sites, 'counts', counts, 'epa', '{"ok":true}'::jsonb,
          'arcgis_reports', reports)::text, now());
end $$;
SQL

scenarios() {  # $1 = label prefix
  Q "select public.c_reset()" >/dev/null
  # Z1: source A failed (2 stored, 1 proposed + 1 built), source B answered with 1 approved. 3-day-old row.
  Q "select public.c_case('00001',
       jsonb_build_array(c_site('src-a',1,'proposed'), c_site('src-a',2,'built'), c_site('src-b',9,'approved'), c_fac(1)),
       '{\"development\":3,\"proposed\":1,\"approved\":1,\"operating\":1,\"facilities\":1}', '3 days',
       jsonb_build_array(c_site('src-b',10,'approved'), c_fac(1)),
       '{\"development\":1,\"proposed\":0,\"proposed_active\":0,\"proposed_decided\":0,\"approved\":1,\"operating\":0,\"comment_open\":0,\"facilities\":1}',
       jsonb_build_array(c_rep('src-a',true), c_rep('src-b',false)))" >/dev/null
  # Z2: every development record on the page is from the failed source; the answer has none (CORE GUARD 2 shape).
  Q "select public.c_case('00002',
       jsonb_build_array(c_site('src-a',1,'approved'), c_site('src-a',2,'approved')),
       '{\"development\":2,\"approved\":2}', '3 days', '[]'::jsonb, '{\"development\":0,\"approved\":0}',
       jsonb_build_array(c_rep('src-a',true)))" >/dev/null
  # Z3: a partial answer — the failed source still sent one record. Nothing is carried (no padding with old rows).
  Q "select public.c_case('00003',
       jsonb_build_array(c_site('src-a',1,'approved'), c_site('src-a',2,'approved'), c_site('src-b',1,'approved')),
       '{\"development\":3,\"approved\":3}', '3 days',
       jsonb_build_array(c_site('src-a',3,'approved'), c_site('src-b',1,'approved')), '{\"development\":2,\"approved\":2}',
       jsonb_build_array(c_rep('src-a',true), c_rep('src-b',false)))" >/dev/null
  # Z4: no failure — the answer is written as sent.
  Q "select public.c_case('00004',
       jsonb_build_array(c_site('src-b',1,'approved')), '{\"development\":1,\"approved\":1}', '3 days',
       jsonb_build_array(c_site('src-b',2,'proposed')), '{\"development\":1,\"proposed\":1,\"proposed_active\":1}',
       jsonb_build_array(c_rep('src-b',false)))" >/dev/null
  # Z5: a failed source with NO stored records — nothing to carry, the write goes ahead (as before).
  Q "select public.c_case('00005',
       jsonb_build_array(c_site('src-b',1,'approved')), '{\"development\":1,\"approved\":1}', '3 days',
       jsonb_build_array(c_site('src-b',2,'approved')), '{\"development\":1,\"approved\":1}',
       jsonb_build_array(c_rep('src-z',true), c_rep('src-b',false)))" >/dev/null
  # Z6: proposed records with a decision / decided flag count as proposed but not as active.
  Q "select public.c_case('00006',
       jsonb_build_array(c_site('src-a',1,'proposed'), c_site('src-a',2,'proposed','{\"decision\":{\"outcome\":\"denied\"}}'),
                         c_site('src-a',3,'proposed','{\"decided\":true}'), c_site('src-a',4,'proposed','{\"comment_open\":true}')),
       '{\"development\":4}', '3 days', '[]'::jsonb,
       '{\"development\":0,\"proposed\":0,\"proposed_active\":0,\"proposed_decided\":0,\"comment_open\":0}',
       jsonb_build_array(c_rep('src-a',true)))" >/dev/null
  Q "select public.dev_refresh_collect()" >/dev/null
}
written() { Q "select (refreshed_at > now() - interval '1 minute')::text from public.development_reports where zip='$1'"; }
srcs()    { Q "select coalesce(string_agg(coalesce(x->>'source_registry_id','fac'), ',' order by o),'') from public.development_reports d, jsonb_array_elements(d.sites) with ordinality t(x, o) where zip='$1'"; }
cnt()     { Q "select coalesce(counts->>'$2','-') from public.development_reports where zip='$1'"; }

echo "--- CONTROL: production's body"
scenarios
t K01 "$(written 00001)" "false"   # the defect: one failed source froze the page
t K02 "$(written 00002)" "false"
t K04 "$(written 00004)" "true"
t K05 "$(written 00005)" "true"
t K06 "$(Q "select blocked_update::text from public.dev_refresh_source_failures where zip='00001' and registry_id='src-a'")" "true"

echo "--- apply"
orig="$(mktemp)"; Q "select prosrc from pg_proc where proname='dev_refresh_collect'" | head -c -1 > "$orig"
out="$(P -f "$root/docs/dev-refresh-collect-carry-failed-sources.sql" 2>&1)"
t A01 "$(grep -c 'EVIDENCE after: md5=b17263cc5eca232dbde8fc33e27093e4 len=16593' <<<"$out")" "1"
t A02 "$(python3 "$here/expected.py" "$orig" 2>&1 || true)" \
      "$(Q "select md5(prosrc)||' '||length(prosrc) from pg_proc where proname='dev_refresh_collect'")"
out2="$(P -f "$root/docs/dev-refresh-collect-carry-failed-sources.sql" 2>&1)"
t A03 "$(grep -c 'already at the PATCHED fingerprint' <<<"$out2")" "1"
t A04 "$(Q "select has_function_privilege('anon','public.dev_with_carried_sources(jsonb)','execute')::text")" "false"

echo "--- AFTER"
scenarios
t S01 "$(written 00001)" "true"
t S02 "$(srcs 00001)" "src-b,src-a,src-a,fac"
t S03 "$(cnt 00001 development)|$(cnt 00001 proposed)|$(cnt 00001 approved)|$(cnt 00001 operating)|$(cnt 00001 facilities)" "3|1|1|1|1"
t S04 "$(Q "select blocked_update::text||'|'||(detail->>'carried_forward') from public.dev_refresh_source_failures where zip='00001' and registry_id='src-a'")" "false|2"
t S05 "$(written 00002)|$(cnt 00002 development)|$(srcs 00002)" "true|2|src-a,src-a"
t S06 "$(written 00003)|$(srcs 00003)|$(cnt 00003 development)" "true|src-a,src-b|2"
t S07 "$(written 00004)|$(srcs 00004)|$(Q "select counts::text from public.development_reports where zip='00004'")" \
      'true|src-b|{"proposed": 1, "development": 1, "proposed_active": 1}'
t S08 "$(written 00005)|$(srcs 00005)" "true|src-b"
t S09 "$(cnt 00006 proposed)|$(cnt 00006 proposed_active)|$(cnt 00006 proposed_decided)|$(cnt 00006 comment_open)|$(cnt 00006 development)" "4|2|1|1|4"
t S10 "$(Q "select count(*) from public.development_reports where last_collected_response_id is null")" "0"

# the helper alone: a response with no failed source is returned untouched, byte for byte
t H01 "$(Q "select (public.dev_with_carried_sources(j) = j)::text from (select '{\"zip\":\"00004\",\"sites\":[],\"arcgis_reports\":[{\"registry_id\":\"b\",\"quarantined\":[]}]}'::jsonb j) x")" "true"

echo "--- reverse"
P -f "$root/docs/dev-refresh-collect-carry-failed-sources-reverse.sql" >/dev/null 2>&1
t R01 "$(Q "select md5(prosrc)||'|'||length(prosrc) from pg_proc where proname='dev_refresh_collect'")" "5afbb78376a080f2d9eb095335476a53|16091"
t R02 "$(Q "select count(*) from pg_proc where proname='dev_with_carried_sources'")" "0"

echo
[ "$ran" -eq 23 ] || { echo "dev-collect-carry: $ran checks ran, expected 23"; exit 1; }
if [ "$bad" -eq 0 ]; then echo "dev-collect-carry: all checks passed"; else echo "dev-collect-carry: $bad check(s) FAILED"; exit 1; fi
