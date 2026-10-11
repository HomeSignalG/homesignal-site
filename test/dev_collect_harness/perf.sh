#!/usr/bin/env bash
# MEASURES (on a disposable Postgres, never production) what the accepted-generation trigger adds to the LIVE collector transaction:
# latency of a collector tick with and without the trigger on dense payloads (8 ZIPs/tick like job 14, 2,500 cached sites, ~2.6 MB
# each), rows and bytes written per generation, and growth of the durable table. Prints numbers; asserts nothing.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
bash "$here/build.sh" >/dev/null
P -f "$root/docs/dev-source-receipt.sql" >/dev/null 2>&1
P -f "$root/test/source_receipt_pg/helpers.sql" >/dev/null
SOURCES=${SOURCES:-40}; SITES=${SITES:-2500}; ZIPS=${ZIPS:-8}; ROUNDS=${ROUNDS:-6}
P -c "
create or replace function public.t_dense(z text, n int, srcs int) returns bigint language plpgsql as \$\$
declare id bigint := nextval('net.http_request_queue_id_seq'); reps jsonb; st jsonb;
begin
  select jsonb_agg(public.t_exp('src-'||i, 'v2:box:r3:gabcdef0123456789:c0123456789abcdef')) into reps from generate_series(1, srcs) i;
  select jsonb_agg(jsonb_build_object('title','Permit '||i||' '||repeat('x',700),'source_registry_id','src-'||(i % srcs),'lat',33.1+i/1e5,'lng',-96.9,'scope','point',
         'record_url','https://example.gov/permit/'||i,'status','approved','type','Commercial')) into st from generate_series(1, n) i;
  insert into net._http_response (id,status_code,content,created)
  values (id,200,jsonb_build_object('zip',z,'mode','zip','sites',st,'counts','{\"development\":0}'::jsonb,'arcgis_reports',reps)::text, now());
  return id;
end \$\$;" >/dev/null
bytes="$(P -c "select pg_size_pretty(length(jsonb_build_object('sites',(select jsonb_agg(jsonb_build_object('title','Permit '||i||' '||repeat('x',700),'source_registry_id','src-1','lat',33.1,'lng',-96.9,'scope','point','record_url','https://example.gov/permit/'||i,'status','approved','type','Commercial')) from generate_series(1,$SITES) i))::text)::bigint)")"
echo "payload per ZIP ≈ $bytes ($SITES sites, $SOURCES sources); $ZIPS ZIPs per tick; $ROUNDS ticks per arm"
arm() { # label, with_trigger(1/0)
  P -c "select public.t_reset()" >/dev/null
  if [ "$2" = 0 ]; then P -c "alter table public.development_reports disable trigger dev_reports_generation_receipt_trg" >/dev/null; else P -c "alter table public.development_reports enable trigger dev_reports_generation_receipt_trg" >/dev/null; fi
  for z in $(seq 1 $ZIPS); do P -c "select public.t_zip('9000$z')" >/dev/null; done
  local tot=0 worst=0
  for r in $(seq 1 $ROUNDS); do
    for z in $(seq 1 $ZIPS); do P -c "select public.t_dense('9000$z', $SITES, $SOURCES)" >/dev/null; done
    local t0 t1 ms
    t0=$(date +%s%N); P -c "select public.dev_refresh_collect()" >/dev/null; t1=$(date +%s%N)
    ms=$(( (t1-t0)/1000000 )); tot=$((tot+ms)); [ $ms -gt $worst ] && worst=$ms
  done
  echo "$1: mean tick $((tot/ROUNDS)) ms, worst $worst ms"
}
arm "WITHOUT trigger" 0
arm "WITH trigger   " 1
echo "--- written per accepted generation (the WITH arm)"
P -c "select 'continuity rows='||count(*)||' ('||pg_size_pretty(pg_total_relation_size('public.dev_source_continuity'))||' total, '||(pg_relation_size('public.dev_source_continuity')/greatest(count(*),1))||' B/row heap)' from public.dev_source_continuity"
P -c "select 'generation rows='||count(*)||' ('||pg_size_pretty(pg_total_relation_size('public.dev_refresh_generation'))||')' from public.dev_refresh_generation"
P -c "select 'avg gen_seq per source row='||round(avg(gen_seq),1) from public.dev_source_continuity"
