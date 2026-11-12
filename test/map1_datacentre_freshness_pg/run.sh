#!/usr/bin/env bash
# Runs docs/map1-datacentre-freshness.sql against a DISPOSABLE Postgres and checks its answers.
# Stand-in tables carry only the columns the function reads (types as in production).
# Needs PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE for a throwaway database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sql="$here/../../docs/map1-datacentre-freshness.sql"
q() { psql -X -v ON_ERROR_STOP=1 -qtA "$@"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS — $1"; else echo "FAIL — $1: got [$2] want [$3]"; fail=1; fi; }

q <<'SQL'
drop table if exists public.dc_acquisition_run, public.dc_source, public.national_dc_records cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create table public.dc_source(source_key text primary key, publisher text, dataset_name text,
  licence text, active_state text);
create table public.dc_acquisition_run(id uuid primary key, source_key text, run_seq bigint,
  started_at timestamptz, completed_at timestamptz, completeness_state text,
  advanced_observations boolean, source_release_key text, source_declared_freshness timestamptz,
  observed_freshness timestamptz, failure_detail jsonb);
create table public.national_dc_records(id int, imported_at timestamptz);
insert into public.dc_source values
  ('compute_atlas','Compute Atlas (Edward Kubiak)','Compute Atlas US data-center dataset','CC BY 4.0','ACTIVE'),
  ('epoch_ai','Epoch AI','Epoch AI AI Data Centers','CC BY 4.0','ACTIVE'),
  ('retired_src','Old','Old','x','RETIRED');
insert into public.dc_acquisition_run values
  ('00000000-0000-0000-0000-000000000001','compute_atlas',2675,'2026-11-06 09:45:01Z','2026-11-06 09:45:05Z','SUCCESS_COMPLETE',true,'1.35.1','2026-11-05 18:24:03Z','2026-11-05Z',null),
  ('00000000-0000-0000-0000-000000000002','compute_atlas',2700,'2026-11-12 09:44:17Z','2026-11-12 09:44:17Z','FETCH_FAILED',false,null,null,null,'{"http_status":404,"secret":"do-not-leak"}'),
  ('00000000-0000-0000-0000-000000000003','epoch_ai',2694,'2026-11-11 10:16:00Z','2026-11-11 10:16:05Z','SUCCESS_COMPLETE',true,null,null,'2026-11-05Z',null),
  ('00000000-0000-0000-0000-000000000004','epoch_ai',2701,'2026-11-12 10:16:27Z','2026-11-12 10:16:29Z','SUCCESS_COMPLETE',true,null,null,'2026-11-05Z',null),
  ('00000000-0000-0000-0000-000000000005','retired_src',1,'2026-01-01Z','2026-01-01Z','SUCCESS_COMPLETE',true,null,null,null,null);
insert into public.national_dc_records values (1,'2026-09-15 18:46:03Z'),(2,'2026-09-15 18:46:03Z');
SQL

q -f "$sql"
q -f "$sql"   # idempotent

out() { q -c "select $1 from public.map1_datacentre_freshness() where source_key='$2'"; }
check "1 three rows: two active sources and the OSM load; the retired source is left out" \
  "$(q -c "select string_agg(source_key, ',' order by source_key collate \"C\") from public.map1_datacentre_freshness()")" \
  "compute_atlas,epoch_ai,openstreetmap"
check "2 Compute Atlas last success is the Nov 6 read, not the newer failed one" \
  "$(out "to_char(last_success_at at time zone 'UTC','YYYY-MM-DD HH24:MI')" compute_atlas)" "2026-11-06 09:45"
check "3 its last attempt is the failed Nov 12 read, and it did not refresh" \
  "$(out "to_char(last_attempt_at at time zone 'UTC','YYYY-MM-DD')||' '||last_attempt_refreshed" compute_atlas)" "2026-11-12 false"
check "4 publisher edition is the publisher's declared date" \
  "$(out "to_char(publisher_edition_at at time zone 'UTC','YYYY-MM-DD')||' '||last_success_release" compute_atlas)" "2026-11-05 1.35.1"
check "5 Epoch: newest success is the newest read, and it refreshed" \
  "$(out "to_char(last_success_at at time zone 'UTC','YYYY-MM-DD')||' '||last_attempt_refreshed" epoch_ai)" "2026-11-12 true"
check "6 OSM: one-time load, not scheduled, no attempt" \
  "$(out "to_char(last_success_at at time zone 'UTC','YYYY-MM-DD')||' '||scheduled||' '||coalesce(last_attempt_at::text,'none')" openstreetmap)" "2026-09-15 false none"
check "7 no failure detail is reachable through the reader" \
  "$(q -c "select count(*) from public.map1_datacentre_freshness() f where to_jsonb(f)::text like '%do-not-leak%'")" "0"
check "8 anon may execute it; PUBLIC may not" \
  "$(q -c "select has_function_privilege('anon','public.map1_datacentre_freshness()','execute')||' '||coalesce((select bool_or(a.grantee=0) from pg_proc p, aclexplode(p.proacl) a where p.proname='map1_datacentre_freshness' and a.privilege_type='EXECUTE'),false)")" "true false"
q -c "delete from public.national_dc_records"
check "9 no OSM rows: no OSM line" \
  "$(q -c "select count(*) from public.map1_datacentre_freshness() where source_key='openstreetmap'")" "0"
exit $fail
