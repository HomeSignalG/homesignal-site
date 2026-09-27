#!/usr/bin/env bash
# STEP 12 (C8): the daily address-check monitor on a disposable stand-in.
# Builds on the step 11 stand-in (test/dc_map1_address_check_pg/run.sh leaves its database in place), adds a
# minimal pipeline_health_tick carrying the real anchor and _eval shape, applies docs/dc-address-check-monitor.sql
# and proves: the snapshot equals the view; each failure class fires, each just-inside case passes; the check
# is not alertable before any evidence exists; the splice is idempotent and refuses a missing anchor.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
cd "$root"
bash test/dc_map1_address_check_pg/run.sh >/dev/null
DB=dc_map1_address_check_t
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
Q() { P -tA -c "$1"; }
fails=0
chk() { if [ "$2" = "$3" ]; then echo "PASS — $1"; else echo "FAIL — $1  [got: $2 | want: $3]"; fails=$((fails+1)); fi; }

P <<'SQL' >/dev/null
create table public.pipeline_health_check (check_name text primary key, ok boolean, alertable boolean, detail text,
  since timestamptz, last_notified_at timestamptz, updated_at timestamptz);
create function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
language plpgsql as $function$
declare _now timestamptz := now();
begin
  create temp table _eval (c_name text, c_ok boolean, c_alertable boolean, c_detail text) on commit drop;
  insert into _eval select 'stub', true, true, 'stub';
  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
  on conflict (check_name) do update set ok = excluded.ok, alertable = excluded.alertable,
                                         detail = excluded.detail, updated_at = _now;
  return query select e.c_name, e.c_ok, e.c_detail from _eval e;
end $function$;
SQL
P -f docs/dc-address-check-monitor.sql >/dev/null 2>&1
tick() { Q "select count(*) from public.pipeline_health_tick()" >/dev/null
         Q "select ok || '|' || alertable || '|' || detail from public.pipeline_health_check where check_name = 'dc_address_check'"; }

# M0 — before any snapshot: not a pass, not a failure
r="$(tick)"; chk 'M0 no snapshot: ok, NOT alertable, says UNMEASURED' "${r%%|UNMEASURED*}" 'true|false'
# M1 — the real snapshot equals the view it reads
Q "select public.dc_address_check_snapshot()" >/dev/null
chk 'M1 snapshot counts equal the view (markers, per state, per reason)' "$(Q "
  with v as (select * from public.dc_map1_address_check), d as (select * from public.dc_address_check_daily)
  select ((select markers from d) = (select count(*) from v)
      and (select checked from d) = (select count(*) from v where check_state='CHECKED')
      and (select not_checkable from d) = (select count(*) from v where check_state='NOT_CHECKABLE')
      and (select no_clean_match from d) = (select count(*) from v where check_state='CHECKABLE_NO_CLEAN_MATCH')
      and (select by_reason from d) = (select jsonb_object_agg(k, n) from (select layer||'|'||check_state||'|'||reason_code k, count(*) n from v group by 1) x)
      and (select markers from d) > 0)::text")" 'true'
chk 'M1 every decision function is fingerprinted, none MISSING' "$(Q "
  select (select count(*) from jsonb_each_text(decision_defs) where value = 'MISSING') || '/' || (select count(*) from jsonb_object_keys(decision_defs))
    from public.dc_address_check_daily")" '0/7'
chk 'M1 the admitted set is recorded' "$(Q "select (admitted <> '')::text from public.dc_address_check_daily")" 'true'
r="$(tick)"; chk 'M1 one snapshot: healthy baseline' "$(echo "$r" | grep -c '^true|true|snapshot .*baseline')" '1'
Q "select public.dc_address_check_snapshot()" >/dev/null
r="$(tick)"; chk 'M2 two identical snapshots: healthy, unchanged' "$(echo "$r" | grep -c '^true|true|.*unchanged')" '1'

# crafted pairs: p = previous (24h ago), l = latest; each case starts from the real snapshot row
# every case starts from the untouched real snapshot, never from the previous case's mutated row
Q "create table public._pristine as select * from public.dc_address_check_daily order by taken_at desc limit 1" >/dev/null
pair() { Q "create temp table _b as select * from public._pristine;
            delete from public.dc_address_check_daily;
            insert into public.dc_address_check_daily select * from _b;
            update public.dc_address_check_daily set taken_at = now() - interval '24 hours', $1;
            insert into public.dc_address_check_daily select * from _b;
            update public.dc_address_check_daily set taken_at = now(), $2 where taken_at <> now() - interval '24 hours';" >/dev/null; }
case_is() { pair "$2" "$3"; r="$(tick)"; chk "$1" "$(echo "$r" | cut -d'|' -f1)$( [ -n "${4:-}" ] && echo "$r" | grep -q -- "$4" && echo '+msg')" "$5"; }

case_is 'M3 markers fell 6%: FAIL'             'markers = 100' 'markers = 94'  'Map 1 markers fell' 'false+msg'
case_is 'M3 markers fell 4%: pass'             'markers = 100' 'markers = 96'  ''                   'true'
case_is 'M4 CHECKED fell 6%: FAIL'             'checked = 100' 'checked = 94'  'CHECKED markers fell' 'false+msg'
case_is 'M5 an impossible reason code: FAIL'   'invariant_breaks = 0' 'invariant_breaks = 1' 'pipeline broke' 'false+msg'
case_is 'M6 queue waited, nothing for 31h: FAIL' 'queue_n = 5' "queue_n = 5, newest_geocode_at = now() - interval '31 hours'" 'dc-geocode-observations' 'false+msg'
case_is 'M6 queue waited, geocoded 29h ago: pass' 'queue_n = 5' "queue_n = 5, newest_geocode_at = now() - interval '29 hours'" '' 'true'
case_is 'M6 queue new since yesterday: pass'   'queue_n = 0' "queue_n = 5, newest_geocode_at = now() - interval '31 hours'" '' 'true'
case_is 'M7 admitted set changed: FAIL'        "admitted = admitted" "admitted = admitted || ' x/y=true'" 'admitted set changed' 'false+msg'
case_is 'M8 a decision definition changed: FAIL, named' "decision_defs = decision_defs" "decision_defs = jsonb_set(decision_defs, '{dc_derived_point_verdict}', '\"x\"')" 'changed: dc_derived_point_verdict (' 'false+msg'

Q "update public.dc_address_check_daily set taken_at = taken_at - interval '27 hours';
   delete from public.dc_address_check_daily where taken_at < now() - interval '40 hours'" >/dev/null
r="$(tick)"; chk 'M9 newest snapshot 27h old: FAIL, job not running' "$(echo "$r" | grep -c '^false|true|.*is not running')" '1'

P -f docs/dc-address-check-monitor.sql >/dev/null 2>&1
chk 'M10 re-apply is a no-op: the check appears once' "$(Q "
  select (length(d) - length(replace(d, '''dc_address_check'',', ''))) / length('''dc_address_check'',')
    from (select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) d) x")" '1'
Q "create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
   language plpgsql as \$f\$ begin return; end \$f\$" >/dev/null
if P -f docs/dc-address-check-monitor.sql >/dev/null 2>&1; then chk 'M11 a missing anchor is refused' 'applied' 'refused'
else chk 'M11 a missing anchor is refused' 'refused' 'refused'; fi

[ "$fails" = 0 ] && echo "ALL STEP 12 MONITOR CHECKS PASSED" || { echo "$fails FAILED"; exit 1; }
