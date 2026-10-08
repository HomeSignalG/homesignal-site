#!/usr/bin/env bash
# STEP 13 (C9): the marker-loss window, reproduced and closed on a disposable stand-in.
# Builds on the step 11 stand-in (test/dc_map1_address_check_pg/run.sh leaves its database in place), whose
# cron stub already carries the two resolver jobs with production's exact commands, then applies
# docs/dc-marker-loss-watcher.sql and proves: a re-acquisition empties Map 1's canonical layer (the defect);
# the watcher restores it exactly; it is a no-op when nothing is unresolved; it steps aside while a resolver
# holds the lock and resolves once the lock is free; the jobs are exactly as intended, re-applying is a no-op,
# and a drifted resolver job is refused.
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

# Map 1 as a resident sees it, minus last_seen_at: that is the observation's own timestamp, and a real
# re-acquisition advances it too (asserted separately below, so the exclusion cannot hide a stuck value)
M1='select md5(string_agg(x::text, E'"'"'\n'"'"' order by x::text collate "C")) from (select r.zip, to_jsonb(m) - '"'"'last_seen_at'"'"' j from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x'
SEEN="select max(m.last_seen_at) from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.publication_basis = 'canonical'"
CANON="select count(*) from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.publication_basis = 'canonical'"
# a re-acquisition exactly as production makes one: a new, higher run per current run, carrying the same records
REACQ="
  create temp table _new_runs as
    select gen_random_uuid() new_id, r.id old_id, r.source_key, r.distribution_key, r.run_seq
      from public.dc_acquisition_run r
     where r.id in (select c.acquisition_run_id from public.dc_current_observation c);
  insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq)
    select new_id, source_key, distribution_key, (select max(run_seq) from public.dc_acquisition_run) + row_number() over () from _new_runs;
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, publisher_record_id,
      source_row_ordinal, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_address, source_native_lon, source_native_lat, source_native_precision)
    select n.new_id, o.source_key, o.distribution_key, o.publisher_record_id, o.source_row_ordinal, o.raw_payload,
           o.source_native_name, o.source_native_type, o.source_native_status, o.source_native_operator,
           o.source_native_address, o.source_native_lon, o.source_native_lat, o.source_native_precision
      from public.dc_source_observation o join _new_runs n on n.old_id = o.acquisition_run_id;"

P -f docs/dc-marker-loss-watcher.sql >/dev/null
base="$(Q "$M1")"; base_canon="$(Q "$CANON")"; base_seen="$(Q "$SEEN")"
chk 'W0 the stand-in draws canonical markers (positive control)' "$([ "$base_canon" -gt 0 ] && echo yes)" 'yes'

chk 'W1 nothing unresolved: the watcher does nothing' "$(Q "select public.dc_resolve_on_acquisition()")" 'nothing to resolve'
chk 'W1 ... and Map 1 is unchanged' "$(Q "$M1")" "$base"

Q "$REACQ" >/dev/null
chk 'W2 THE DEFECT: a re-acquisition leaves Map 1 with no canonical markers until a resolve' "$(Q "$CANON")" '0'
r="$(Q "select public.dc_resolve_on_acquisition()")"
chk 'W3 the watcher sees the unresolved run and resolves it' "$(echo "$r" | grep -c '^resolved compute_atlas/facilities #')" '1'
chk 'W3 ... and Map 1 is back, row for row, from the canonical resolve alone' "$(Q "$M1")" "$base"
chk 'W3 ... carrying the NEW observation (last_seen_at advanced, not the old one)' "$(Q "select (($SEEN) > '$base_seen'::timestamptz)::text")" 'true'
chk 'W4 a second call does nothing' "$(Q "select public.dc_resolve_on_acquisition()")" 'nothing to resolve'

# the lock: another session holds it (as a running hourly resolver would); the watcher must not wait or resolve
Q "$REACQ" >/dev/null
psql -X -q -d "$DB" -c "select pg_advisory_lock(hashtextextended('dc-resolvers', 0)); select pg_sleep(6);" >/dev/null 2>&1 &
holder=$!
sleep 2
t0=$(date +%s)
r="$(Q "select public.dc_resolve_on_acquisition()")"
t1=$(date +%s)
chk 'W5 lock held elsewhere: the watcher steps aside and names what is waiting' "$(echo "$r" | grep -c '^busy: a resolver holds the lock (unresolved: compute_atlas/facilities #')" '1'
chk 'W5 ... without waiting for the lock' "$([ $((t1 - t0)) -lt 2 ] && echo yes)" 'yes'
chk 'W5 ... and without resolving' "$(Q "$CANON")" '0'
wait "$holder"
chk 'W6 once the lock is free, the next call resolves' "$(Q "select public.dc_resolve_on_acquisition()" | grep -c '^resolved ')" '1'
chk 'W6 ... Map 1 back row for row' "$(Q "$M1")" "$base"

chk 'W7 the serialized wrapper runs both resolvers' "$(Q "select (public.dc_resolve_serialized('canonical') >= 0 and public.dc_resolve_serialized('geography') >= 0)::text")" 'true'
chk 'W7 ... Map 1 unchanged by the hourly pair on a resolved state' "$(Q "$M1")" "$base"
if P -c "select public.dc_resolve_serialized('everything')" >/dev/null 2>&1; then chk 'W7 an unknown resolver is refused' 'ran' 'refused'
else chk 'W7 an unknown resolver is refused' 'refused' 'refused'; fi

chk 'W8 the jobs: both hourly resolvers go through the lock; the watcher every 2 minutes' "$(Q "
  select string_agg(jobname || '|' || schedule || '|' || command, ' ; ' order by jobname)
    from cron.job where jobname like 'dc-resolve%'")" "dc-resolve-canonical|25 * * * *|select public.dc_resolve_serialized('canonical') ; dc-resolve-geography|35 * * * *|set statement_timeout = '300s'; select public.dc_resolve_serialized('geography') ; dc-resolve-on-acquisition|*/2 * * * *|select public.dc_resolve_on_acquisition()"
P -f docs/dc-marker-loss-watcher.sql >/dev/null
chk 'W9 re-applying is a no-op: still exactly three resolver jobs' "$(Q "select count(*) from cron.job where jobname like 'dc-resolve%'")" '3'
# W9b: production's geography job today runs the UNPREFIXED serialized command. The first apply of the 300 s
# version has to accept it (not call it drift) and move it to the prefixed one.
Q "update cron.job set command = 'select public.dc_resolve_serialized(''geography'')' where jobname = 'dc-resolve-geography'" >/dev/null
P -f docs/dc-marker-loss-watcher.sql >/dev/null
chk 'W9b the guard accepts the pre-300s geography command and moves it to the 300 s one' "$(Q "select command from cron.job where jobname = 'dc-resolve-geography'")" "set statement_timeout = '300s'; select public.dc_resolve_serialized('geography')"
Q "update cron.job set command = 'select 1' where jobname = 'dc-resolve-canonical'" >/dev/null
if P -f docs/dc-marker-loss-watcher.sql >/dev/null 2>&1; then chk 'W10 a drifted resolver job is refused' 'applied' 'refused'
else chk 'W10 a drifted resolver job is refused' 'refused' 'refused'; fi
chk 'W10 ... and the refusal changed nothing' "$(Q "select command from cron.job where jobname = 'dc-resolve-canonical'")" 'select 1'

# W12: the hourly wrapper itself holds the lock (not just the watcher's test key). Restore the jobs, stage an
# unresolved run, run the wrapper in another session inside an open transaction, and the watcher must step aside.
P -c "update cron.job set command = 'select count(*) from public.dc_resolve_canonical(true, false)' where jobname = 'dc-resolve-canonical'" >/dev/null
Q "$REACQ" >/dev/null
psql -X -q -d "$DB" -c "begin; select public.dc_resolve_serialized('geography'); select pg_sleep(6); commit;" >/dev/null 2>&1 &
holder=$!
sleep 3
chk 'W12 while an hourly resolver runs through the wrapper, the watcher steps aside' "$(Q "select public.dc_resolve_on_acquisition()" | grep -c '^busy: ')" '1'
wait "$holder"
chk 'W12 ... and resolves once it has finished' "$(Q "select public.dc_resolve_on_acquisition()" | grep -c '^resolved ')" '1'

chk 'W11 neither function can be run by anon or authenticated' "$(Q "
  select (not has_function_privilege('anon', 'public.dc_resolve_on_acquisition()', 'execute')
      and not has_function_privilege('authenticated', 'public.dc_resolve_on_acquisition()', 'execute')
      and not has_function_privilege('anon', 'public.dc_resolve_serialized(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.dc_resolve_serialized(text)', 'execute'))::text")" 'true'

[ "$fails" = 0 ] && echo "ALL STEP 13 MARKER-LOSS CHECKS PASSED" || { echo "$fails FAILED"; exit 1; }
