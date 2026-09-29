#!/usr/bin/env bash
# RESOLVER HARDENING: the dc_resolvers health check, the revoke, and the statement-timeout semantics, on a
# disposable stand-in. Builds on the step 11 stand-in (its stub scheduler already carries production's resolver
# jobs), adds the parts of pg_cron the check reads (job_run_details, username, active), a minimal
# pipeline_health_tick carrying the real anchor and _eval shape, then applies docs/dc-marker-loss-watcher.sql and
# docs/dc-resolver-hardening.sql and proves:
#   H1  anon, authenticated and PUBLIC can no longer run a resolver; the owner and service_role still can
#   H2  a healthy history reads healthy; each failure class fires and each just-inside case passes
#   H3  an absent job, a disabled job, an empty history and a re-granted resolver all FAIL (never read healthy)
#   H4  re-applying changes nothing; a cron job that would lose EXECUTE makes the whole file refuse and the
#       revoke roll back (applied in one transaction, as apply_migration does)
#   H5  the Postgres half of the timeout claim: a SET inside a running statement re-arms nothing, a separate
#       statement ahead of it does
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
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'probe_nobody') then create role probe_nobody nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'probe_cron_user') then create role probe_cron_user nologin; end if;
end $$;
alter table cron.job add column if not exists username text default current_user;
alter table cron.job add column if not exists active boolean default true;
create table if not exists cron.job_run_details (runid bigserial primary key, jobid bigint, status text,
  start_time timestamptz, end_time timestamptz, return_message text);
create table if not exists public.pipeline_health_check (check_name text primary key, ok boolean, alertable boolean,
  detail text, since timestamptz, last_notified_at timestamptz, updated_at timestamptz);
create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
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
# the grants production has today on the two resolvers: PUBLIC, anon, authenticated, service_role (pg_proc.proacl)
P -f docs/dc-marker-loss-watcher.sql >/dev/null 2>&1
P -c "grant execute on function public.dc_resolve_canonical(boolean, boolean), public.dc_resolve_geography(boolean) to public, anon, authenticated, service_role;
      grant execute on function public.dc_resolve_serialized(text), public.dc_resolve_on_acquisition() to service_role;" >/dev/null
can() { Q "select has_function_privilege('$1', '$2', 'execute')::text"; }
RC='public.dc_resolve_canonical(boolean, boolean)'; RG='public.dc_resolve_geography(boolean)'

chk 'H0 before: anon and PUBLIC can run both resolvers (the exposure, reproduced)' \
    "$(can anon "$RC")/$(can anon "$RG")/$(can probe_nobody "$RC")" 'true/true/true'

P -1 -f docs/dc-resolver-hardening.sql >/dev/null 2>&1
chk 'H1 after: anon, authenticated and PUBLIC cannot run either resolver' \
    "$(can anon "$RC")/$(can anon "$RG")/$(can authenticated "$RC")/$(can authenticated "$RG")/$(can probe_nobody "$RC")/$(can probe_nobody "$RG")" 'false/false/false/false/false/false'
chk 'H1 ... and the owner and service_role still can' \
    "$(can "$(Q 'select current_user')" "$RC")/$(can service_role "$RC")/$(can service_role "$RG")" 'true/true/true'

tick() { Q "select count(*) from public.pipeline_health_tick()" >/dev/null
         Q "select ok || '|' || alertable || '|' || detail from public.pipeline_health_check where check_name = 'dc_resolvers'"; }
jid() { Q "select jobid from cron.job where jobname = '$1'"; }
# seed(job, minutes since it ended, seconds it ran, status)
seed() { Q "insert into cron.job_run_details (jobid, status, start_time, end_time)
            select $(jid "$1"), '${4:-succeeded}', now() - interval '$2 minutes' - interval '$3 seconds', now() - interval '$2 minutes'" >/dev/null; }
healthy() { Q "delete from cron.job_run_details" >/dev/null
            seed dc-resolve-canonical 30 20; seed dc-resolve-geography 20 100; seed dc-resolve-on-acquisition 1 1; }
case_is() { # name, then a shell snippet run after healthy(), then expected prefix, then a message fragment ('' = none)
  healthy; eval "$2"; r="$(tick)"
  chk "$1" "$(echo "$r" | cut -d'|' -f1-2)$( [ -n "$4" ] && echo "$r" | grep -q -- "$4" && echo '+msg')" "$3"; }

healthy; r="$(tick)"
chk 'H2 healthy history: ok, alertable, names every job' "$(echo "$r" | grep -c '^true|true|resolver jobs healthy — dc-resolve-canonical ok .*dc-resolve-geography ok .*dc-resolve-on-acquisition ok .*anon/authenticated cannot run')" '1'

# one failed run is one skipped hour, measured 2026-09-28 20:35 — it must NOT alert
case_is 'H2 one failed geography run beside a recent success: pass' "seed dc-resolve-geography 40 120 failed" 'true|true' ''

# quiet: hourly jobs 3 h, watcher 10 min
case_is 'H2 canonical last succeeded 3h01m ago: FAIL'   "Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-canonical)\" >/dev/null; seed dc-resolve-canonical 181 20" 'false|true+msg' 'dc-resolve-canonical has no successful run since'
case_is 'H2 canonical last succeeded 2h59m ago: pass'   "Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-canonical)\" >/dev/null; seed dc-resolve-canonical 179 20" 'true|true' ''
case_is 'H2 geography last succeeded 3h01m ago: FAIL'   "Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-geography)\" >/dev/null; seed dc-resolve-geography 181 100" 'false|true+msg' 'dc-resolve-geography has no successful run since'
case_is 'H2 watcher last succeeded 11 min ago: FAIL'    "Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-on-acquisition)\" >/dev/null; seed dc-resolve-on-acquisition 11 1" 'false|true+msg' 'dc-resolve-on-acquisition has no successful run since'
case_is 'H2 watcher last succeeded 9 min ago: pass'     "Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-on-acquisition)\" >/dev/null; seed dc-resolve-on-acquisition 9 1" 'true|true' ''
case_is 'H2 watcher only FAILED runs recently (last success 11 min ago): FAIL' "seed dc-resolve-on-acquisition 1 1 failed; Q \"delete from cron.job_run_details where jobid = $(jid dc-resolve-on-acquisition) and status = 'succeeded'\" >/dev/null; seed dc-resolve-on-acquisition 11 1" 'false|true+msg' 'no successful run since'

# slow: 2/3 of each job's own statement limit — 80 s of 120, 200 s of 300
case_is 'H2 geography slowest run 201 s: FAIL'          "seed dc-resolve-geography 5 201" 'false|true+msg' 'slowest run in 24h took 201 s, past 200 s'
case_is 'H2 geography slowest run 199 s: pass'          "seed dc-resolve-geography 5 199" 'true|true' ''
case_is 'H2 geography 108 s (today) is comfortably healthy under the 300 s ceiling' "seed dc-resolve-geography 5 108" 'true|true' ''
case_is 'H2 canonical slowest run 81 s: FAIL'           "seed dc-resolve-canonical 5 81" 'false|true+msg' 'slowest run in 24h took 81 s, past 80 s'
case_is 'H2 canonical slowest run 79 s: pass'           "seed dc-resolve-canonical 5 79" 'true|true' ''
case_is 'H2 watcher slowest run 81 s: FAIL'             "seed dc-resolve-on-acquisition 5 81" 'false|true+msg' 'slowest run in 24h took 81 s, past 80 s'
case_is 'H2 a slow run more than 24 h ago no longer counts: pass' "Q \"insert into cron.job_run_details (jobid, status, start_time, end_time) select $(jid dc-resolve-geography), 'succeeded', now() - interval '30 hours' - interval '250 seconds', now() - interval '30 hours'\" >/dev/null" 'true|true' ''

# it must not read healthy when it cannot see
healthy; Q "delete from cron.job_run_details" >/dev/null; r="$(tick)"
chk 'H3 an empty history FAILS (never reads healthy), naming "ever"' "$(echo "$r" | grep -c '^false|true|.*has no successful run since ever')" '1'
healthy; SAVED="$(Q "select command from cron.job where jobname = 'dc-resolve-geography'")"
Q "delete from cron.job where jobname = 'dc-resolve-geography'" >/dev/null; r="$(tick)"
chk 'H3 an unscheduled job FAILS and names it' "$(echo "$r" | grep -c '^false|true|.*job dc-resolve-geography is not scheduled')" '1'
Q "insert into cron.job (jobname, schedule, command) values ('dc-resolve-geography', '35 * * * *', \$\$$SAVED\$\$)" >/dev/null
healthy; Q "update cron.job set active = false where jobname = 'dc-resolve-canonical'" >/dev/null; r="$(tick)"
chk 'H3 a disabled job FAILS and names it' "$(echo "$r" | grep -c '^false|true|.*job dc-resolve-canonical is disabled')" '1'
Q "update cron.job set active = true where jobname = 'dc-resolve-canonical'" >/dev/null
healthy
Q "grant execute on function $RC to anon" >/dev/null; r="$(tick)"
chk 'H3 anon re-granted a resolver: FAIL, names role and function' "$(echo "$r" | grep -c '^false|true|.*anon can run public.dc_resolve_canonical')" '1'
Q "revoke execute on function $RC from anon" >/dev/null
Q "grant execute on function public.dc_resolve_on_acquisition() to authenticated" >/dev/null; r="$(tick)"
chk 'H3 authenticated re-granted the watcher: FAIL, names role and function' "$(echo "$r" | grep -c '^false|true|.*authenticated can run public.dc_resolve_on_acquisition')" '1'
Q "revoke execute on function public.dc_resolve_on_acquisition() from authenticated" >/dev/null
Q "grant execute on function $RG to public" >/dev/null; r="$(tick)"
chk 'H3 a PUBLIC grant reaches anon too: FAIL' "$(echo "$r" | grep -c '^false|true|.*anon can run public.dc_resolve_geography')" '1'
Q "revoke execute on function $RG from public" >/dev/null
r="$(tick)"; chk 'H3 ... and once revoked again it reads healthy' "$(echo "$r" | grep -c '^true|true|resolver jobs healthy')" '1'

# H4 idempotent, and all-or-nothing
P -1 -f docs/dc-resolver-hardening.sql >/dev/null 2>&1
chk 'H4 re-applying leaves exactly one dc_resolvers block in the monitor' "$(Q "select (length(d) - length(replace(d, '''dc_resolvers'',', ''))) / length('''dc_resolvers'',') from (select pg_get_functiondef(oid) d from pg_proc where proname = 'pipeline_health_tick') x")" '1'
Q "grant execute on function $RC to anon" >/dev/null
Q "update cron.job set username = 'probe_cron_user' where jobname = 'dc-resolve-geography'" >/dev/null
if P -1 -f docs/dc-resolver-hardening.sql >/dev/null 2>&1; then chk 'H4 a cron job that would lose EXECUTE makes the file refuse' 'applied' 'refused'
else chk 'H4 a cron job that would lose EXECUTE makes the file refuse' 'refused' 'refused'; fi
chk 'H4 ... and the whole file rolled back: anon still holds the grant the revoke would have removed' "$(can anon "$RC")" 'true'
Q "update cron.job set username = current_user where jobname = 'dc-resolve-geography'" >/dev/null
P -1 -f docs/dc-resolver-hardening.sql >/dev/null 2>&1
chk 'H4 with the job owner fixed it applies and locks again' "$(can anon "$RC")" 'false'

# H5 the Postgres half of the timeout claim, under a 1 s limit with 3 s of work
inside="$(P -tA <<'SQL' 2>&1 || true
set statement_timeout = '1s';
create or replace function pg_temp.raise_inside() returns text language plpgsql as $f$
begin set local statement_timeout = '10s'; perform pg_sleep(3); return 'survived'; end $f$;
select pg_temp.raise_inside();
SQL
)"
chk 'H5 a SET LOCAL inside the running statement is still cancelled at the old limit' "$(echo "$inside" | grep -c 'canceling statement due to statement timeout')" '1'
clause="$(P -tA <<'SQL' 2>&1 || true
set statement_timeout = '1s';
create or replace function pg_temp.with_clause() returns text language plpgsql set statement_timeout = '10s' as $f$
begin perform pg_sleep(3); return 'survived'; end $f$;
select pg_temp.with_clause();
SQL
)"
chk 'H5 a function-level SET clause is cancelled too' "$(echo "$clause" | grep -c 'canceling statement due to statement timeout')" '1'
sep="$(psql -X -q -d "$DB" -tA -c "set statement_timeout = '1s'; set statement_timeout = '10s'; select 'survived' from pg_sleep(3)" 2>&1 || true)"
chk 'H5 a separate statement ahead of the call raises the limit for it' "$(echo "$sep" | grep -c '^survived$')" '1'

[ "$fails" = 0 ] && echo "ALL RESOLVER HARDENING CHECKS PASSED" || { echo "$fails FAILED"; exit 1; }
