#!/usr/bin/env bash
# Builds, in the DISPOSABLE database named by PGDATABASE, the schema the LIVE public.dev_refresh_collect() reads and writes, the REAL
# source-failure helpers, and the LIVE collector itself: the committed chain (once-per-response + echo-health splices, restart
# heal, batch cap) is rebuilt and must fingerprint to production's md5(prosrc) read on 2026-10-11; the four source helpers likewise.
# NOT real here: dev_epa_write_refused / dev_echo_merge_facility_sites (EPA plane; stubs that change nothing — the receipt never reads them).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
LIVE_COLLECT_MD5=2012877397532a1e8e160b5a7a4c8032; LIVE_COLLECT_LEN=15800
# a bare CI Postgres has none of Supabase's roles
P -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end \$\$;" >/dev/null
P -f "$root/test/dev_refresh_restart_pg/fixture.sql" >/dev/null
python3 "$here/real_helpers.py" | P >/dev/null
python3 "$root/test/dev_refresh_restart_pg/build_live.py" | P >/dev/null
P -f "$root/docs/dev-refresh-collect-restart-heal.sql" >/dev/null
P -f "$root/docs/dev-refresh-collect-batch-cap.sql" >/dev/null
got="$(psql -X -qtA -c "select md5(prosrc) || '|' || length(prosrc) from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace")"
for pair in dev_failed_sources:e735c11ac8acfb96549c611002a99e5d dev_truncated_sources:adb3ede172779ac605edd1313a14462e \
            dev_reported_sources:dc9a96a73b1735854a996e80912b15fa dev_retired_sources:57b84b5ab08ed4843532de7f72a8e914; do
  n="${pair%%:*}"; want="${pair##*:}"
  have="$(psql -X -qtA -c "select md5(prosrc) from pg_proc where proname='$n' and pronamespace='public'::regnamespace")"
  [ "$have" = "$want" ] || { echo "ABORT: $n is $have, production's is $want"; exit 1; }
done
if [ "$got" != "$LIVE_COLLECT_MD5|$LIVE_COLLECT_LEN" ]; then
  echo "ABORT: the rebuilt collector is $got, production's is $LIVE_COLLECT_MD5|$LIVE_COLLECT_LEN (the harness would test a function that does not run)"; exit 1
fi
