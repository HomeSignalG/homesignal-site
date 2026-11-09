#!/usr/bin/env bash
# ZIP facility inventory, END TO END on a DISPOSABLE PostGIS (never production; site CLAUDE.md §7.11):
#   engine response -> public.dev_refresh_collect() (the live body, md5 b17263cc…) -> development_reports
#   -> public.zip_mode_report_sites / public.zip_facility_inventory (what Map 1 and the ZIP page read).
# Every scenario runs first on PRODUCTION's collector and reader (CONTROL: the defects are reproduced), then
# docs/dev-refresh-collect-facility-inventory.sql and docs/zip-facility-inventory.sql are applied (and re-applied as
# no-ops) and every scenario runs again. Prints "ID|t" or "ID|f|got/want".
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
bad=0; ran=0
t() { ran=$((ran+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }

bash "$here/prep.sh"
P -c "create extension if not exists postgis" >/dev/null
P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null 2>&1
P >/dev/null <<'SQL'
alter table public.development_reports
  add column paywall boolean, add column echo jsonb, add column cwa jsonb, add column source_vintage text,
  add column last_collected_response_id bigint, add column facilities_refreshed_at timestamptz,
  add column facilities_unavailable boolean;
SQL
P -f "$root/docs/zip-membership-canonical.sql" >/dev/null 2>&1
t C00 "$(Q "select md5(prosrc) from pg_proc where proname='zip_mode_report_sites'")" "40780011859b87916d043ae20d6d8f41"
t C01 "$(Q "select md5(prosrc)||'|'||length(prosrc) from pg_proc where proname='dev_refresh_collect'")" "b17263cc5eca232dbde8fc33e27093e4|16593"
P >/dev/null <<'SQL'
insert into geo.zcta_boundary (zcta5, geom) values ('99901', ST_Multi(ST_GeomFromText(
  'POLYGON((-100 40, -99.6 40, -99.6 40.18, -99.82 40.18, -99.82 40.22, -99.6 40.22, -99.6 40.4, -100 40.4, -100 40))', 4269)));
update public.epa_frs_probes set probed_at = now(), resolved_at = now(), ok = true;
-- a facility site inside (k='in') or outside (k='out') ZIP 99901's polygon
create or replace function public.i_fac(n int, k text) returns jsonb language sql as $$
  select jsonb_build_object('registry_id', '1100000000' || lpad(n::text, 2, '0'), 'label', 'Plant ' || n, 'scope', 'point',
         'layer', 'industrial', 'record_url', 'https://echo.epa.gov/detailed-facility-report?fid=' || n,
         'lat', case k when 'in' then 40.30 else 40.20 end, 'lng', case k when 'in' then -99.90 + n * 0.001 else -99.70 end) $$;
create or replace function public.i_reset() returns void language sql as $$
  truncate public.development_reports, net._http_response, public.dev_refresh_source_failures $$;
-- stored row, then (optionally) one engine response and ONE collector tick
create or replace function public.i_case(z text, stored_sites jsonb, stored_counts jsonb, stored_unavail boolean, clock_age interval,
                                         resp_sites jsonb, resp_counts jsonb, resp_epa_ok boolean) returns void
language plpgsql as $$
declare id bigint;
begin
  insert into public.development_reports (zip, sites, counts, refreshed_at, facilities_refreshed_at, facilities_unavailable)
  values (z, stored_sites, stored_counts, now() - clock_age, now() - clock_age, stored_unavail);
  if resp_counts is not null then
    id := nextval('net.http_request_queue_id_seq');
    insert into net._http_response (id, status_code, content, created)
    values (id, 200, jsonb_build_object('zip', z, 'mode', 'zip', 'sites', resp_sites, 'counts', resp_counts,
            'epa', jsonb_build_object('ok', resp_epa_ok))::text, now());
    perform public.dev_refresh_collect();
  end if;
end $$;
SQL

# helpers reading the PUBLISHED read paths
inv()  { Q "select coalesce(public.zip_mode_report_sites('$1')->'facility_inventory'->>'$2', '<none>')"; }
inv2() { Q "select coalesce(public.zip_facility_inventory('$1')->>'$2', '<none>')"; }
mem()  { Q "select public.zip_mode_report_sites('$1')->'facility_counts'->>'member'"; }
row()  { Q "select coalesce(counts->>'facilities_coverage','<none>')||'|'||coalesce(counts->>'facilities','?')||'|'||facilities_unavailable||'|'||case when facilities_refreshed_at > now() - interval '1 minute' then 'now' else 'held' end from public.development_reports where zip='$1'"; }
COMPLETE='{"development":0,"facilities":2,"facilities_coverage":"zip_boundary_v1"}'
COMPLETE0='{"development":0,"facilities":0,"facilities_coverage":"zip_boundary_v1"}'
FAILED='{"development":0,"facilities":0}'

scenarios() {  # $1 = before | after
  local A="$1"
  # S1 COMPLETE: a radius-era list (3 stored, 1 of them outside) is replaced by a complete boundary read of 2.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(2,'in'),i_fac(3,'out')), '{\"facilities\":3}', false, '10 days',
       jsonb_build_array(i_fac(1,'in'),i_fac(4,'in')), '$COMPLETE', true)" >/dev/null
  t "$A.S1.row"   "$(row 99901)" "zip_boundary_v1|2|false|now"
  t "$A.S1.count" "$(mem 99901)" "2"
  # S2 COMPLETE ZERO: a stored 0 replaced by a complete boundary read that found nothing.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', '[]', '{\"facilities\":0}', false, '10 days', '[]', '$COMPLETE0', true)" >/dev/null
  t "$A.S2.row"   "$(row 99901)" "zip_boundary_v1|0|false|now"
  # S3 COMPLETE, THEN A FAILED REFRESH (stored 2): the refusal keeps the 2 facilities; the marker must survive too.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(4,'in')), '$COMPLETE', false, '2 days', '[]', '$FAILED', false)" >/dev/null
  t "$A.S3.row"   "$(row 99901)" "zip_boundary_v1|2|true|held"
  t "$A.S3.count" "$(mem 99901)" "2"
  # S3b COMPLETE ZERO, THEN A FAILED REFRESH: not a refusal (nothing stored), so the marker and the clock were lost.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', '[]', '$COMPLETE0', false, '2 days', '[]', '$FAILED', false)" >/dev/null
  t "$A.S3b.row"  "$(row 99901)" "zip_boundary_v1|0|true|held"
  # S4 LEGACY: a radius-era list, latest refresh ok, no read now.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(2,'in'),i_fac(3,'out')), '{\"facilities\":3}', false, '1 day', null, null, null)" >/dev/null
  t "$A.S4.row"   "$(row 99901)" "<none>|3|false|held"
  t "$A.S4.count" "$(mem 99901)" "2"
  # S4b LEGACY, THEN A FAILED BOUNDARY READ (refused: stored 3 kept).
  Q "select i_reset()" >/dev/null
  Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(2,'in'),i_fac(3,'out')), '{\"facilities\":3}', false, '10 days', '[]', '$FAILED', false)" >/dev/null
  t "$A.S4b.row"  "$(row 99901)" "<none>|3|true|held"
  # S5 NO BOUNDARY (99902): nothing can be counted.
  Q "select i_reset()" >/dev/null
  Q "select i_case('99902', jsonb_build_array(i_fac(1,'in')), '{\"facilities\":1}', false, '1 day', null, null, null)" >/dev/null
  # S5b UNRESOLVED RETRIEVAL: a new ZIP whose boundary read has never completed.
  Q "select i_case('99901', '[]', '{\"facilities\":0}', true, '1 day', '[]', '$FAILED', false)" >/dev/null
  t "$A.S5b.row"  "$(row 99901)" "<none>|0|true|held"
}

echo "--- before (production's collector and reader)"
scenarios before || true
before_bad=$bad
t C02 "$(inv 99901 state)" "<none>"
echo "    (CONTROL: production loses the marker on S3/S3b, advances the clock on S3b/S5b, and has no inventory state)"

echo "--- apply"
out="$(P -f "$root/docs/dev-refresh-collect-facility-inventory.sql" 2>&1)"
t A01 "$(grep -c 'EVIDENCE after: md5=bd77573364bc41e2c5691b5f6643d6cf len=17204' <<<"$out")" "1"
out="$(P -f "$root/docs/zip-facility-inventory.sql" 2>&1)"
t A02 "$(grep -c 'EVIDENCE zip_mode_report_sites md5=751f297c73b17c4dc684375df1b5b348' <<<"$out")" "1"
out="$(P -f "$root/docs/dev-refresh-collect-facility-inventory.sql" 2>&1)"; t A03 "$(grep -c 'nothing changed' <<<"$out")" "1"
P -f "$root/docs/zip-facility-inventory.sql" >/dev/null 2>&1; t A04 "$(Q "select md5(prosrc) from pg_proc where proname='zip_mode_report_sites'")" "751f297c73b17c4dc684375df1b5b348"
# The helper is EXACTLY the old facilities_unavailable expression: equal on every combination of its inputs.
t A05 "$(Q "select count(*) from (values (true),(false)) p(ok), (values (true),(false),(null::boolean)) e(eok),
          (values (0),(3)) n(newc), (values (0),(2)) c(cached), (values ('1 day'::interval),('10 days')) a(age)
        where public.dev_facility_read_untrusted(p.ok, jsonb_build_object('epa', jsonb_build_object('ok', e.eok), 'counts', jsonb_build_object('facilities', n.newc)),
                jsonb_build_object('facilities', c.cached), now() - a.age)
          is distinct from (case
             when public.dev_epa_write_refused(p.ok, jsonb_build_object('epa', jsonb_build_object('ok', e.eok), 'counts', jsonb_build_object('facilities', n.newc)),
                jsonb_build_object('facilities', c.cached), now() - a.age) then true
             when n.newc > 0 then false
             when not (p.ok and coalesce(e.eok, true)) then true else false end)")" "0"

echo "--- after"
bad=0
scenarios after
# THE PUBLISHED STATES, read through both read paths.
Q "select i_reset()" >/dev/null
Q "select i_case('99901', '[]', '{\"facilities\":0}', false, '10 days', jsonb_build_array(i_fac(1,'in'),i_fac(4,'in')), '$COMPLETE', true)" >/dev/null
t P1.state "$(inv 99901 state)|$(inv 99901 member_count)|$(inv 99901 latest_refresh)" "complete|2|ok"
t P1.page  "$(inv2 99901 state)|$(inv2 99901 member_count)" "complete|2"
Q "select i_reset()" >/dev/null
Q "select i_case('99901', '[]', '{\"facilities\":0}', false, '10 days', '[]', '$COMPLETE0', true)" >/dev/null
t P2.state "$(inv 99901 state)|$(inv 99901 member_count)" "complete|0"
Q "select i_reset()" >/dev/null
Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(4,'in')), '$COMPLETE', false, '2 days', '[]', '$FAILED', false)" >/dev/null
t P3.state "$(inv 99901 state)|$(inv 99901 member_count)|$(inv 99901 latest_refresh)" "complete_as_of|2|failed"
t P3.date  "$(Q "select (public.zip_facility_inventory('99901')->>'last_success_at')::timestamptz < now() - interval '1 day'")" "t"
Q "select i_reset()" >/dev/null
Q "select i_case('99901', jsonb_build_array(i_fac(1,'in'),i_fac(2,'in'),i_fac(3,'out')), '{\"facilities\":3}', false, '1 day', null, null, null)" >/dev/null
t P4.state "$(inv 99901 state)|$(inv 99901 member_count)|$(inv 99901 latest_refresh)" "not_complete|2|ok"
Q "select i_reset()" >/dev/null
Q "select i_case('99902', jsonb_build_array(i_fac(1,'in')), '{\"facilities\":1}', false, '1 day', null, null, null)" >/dev/null
t P5.state "$(inv 99902 state)|$(inv 99902 member_count)" "not_measured|<none>"
t P5.none  "$(inv2 00000 state)" "not_measured"
Q "select i_reset()" >/dev/null
Q "select i_case('99901', '[]', '{\"facilities\":0}', true, '1 day', '[]', '$FAILED', false)" >/dev/null
t P6.state "$(inv 99901 state)|$(inv 99901 latest_refresh)" "not_complete|failed"
# A complete boundary read that finds 0 where a FRESH (< 7 days) radius-era list had facilities is refused by the
# existing write rule (dev_epa_write_refused, unchanged): the stored list stays, flagged unavailable, never complete.
Q "select i_reset()" >/dev/null
Q "select i_case('99901', jsonb_build_array(i_fac(1,'in')), '{\"facilities\":1}', false, '2 days', '[]', '$COMPLETE0', true)" >/dev/null
t P7.state "$(inv 99901 state)|$(inv 99901 latest_refresh)" "not_complete|failed"

echo "--- reverse"
P -f "$root/docs/dev-refresh-collect-facility-inventory-reverse.sql" >/dev/null 2>&1
t R01 "$(Q "select md5(prosrc)||'|'||length(prosrc) from pg_proc where proname='dev_refresh_collect'")" "b17263cc5eca232dbde8fc33e27093e4|16593"

echo
# CONTROL: production's code must fail EXACTLY the three cases this change exists for (S3, S3b, S5b), no more, no fewer.
if [ "$before_bad" -ne 3 ]; then echo "dev-collect-inventory: CONTROL expected 3 failures on production's code, got $before_bad"; exit 1; fi
if [ "$bad" -ne 0 ]; then echo "dev-collect-inventory: $bad check(s) failed"; exit 1; fi
echo "dev-collect-inventory: all checks passed ($ran checks; $before_bad failed on production's code, as expected)"
