#!/usr/bin/env bash
# Rebuilds, in the DISPOSABLE database named by PGDATABASE, the LIVE dev_refresh_collect exactly as production runs it on
# 2026-11-09 (md5 b17263cc5eca232dbde8fc33e27093e4, 16,593 chars): the collector harness, the plan-stable blocked lookup, the
# facility-clock argument (dev-frs-start-hint PART 3) and the carry-failed-sources migration. Installs the REAL
# dev_epa_write_refused (production body, md5 1f8b7e38d9d45bdb764903e1857374db) in place of the harness stub.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
bash "$root/test/dev_collect_harness/build.sh" >/dev/null 2>&1
P -f "$root/docs/dev-refresh-collect-blocked-plan-stable.sql" >/dev/null 2>&1
P >/dev/null <<'SQL'
do $$ declare def text;
  o text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)$a$;
  n text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)$a$;
begin select pg_get_functiondef(oid) into def from pg_proc where proname = 'dev_refresh_collect'; execute replace(def, o, n); end $$;
SQL
P -f "$root/docs/dev-refresh-collect-carry-failed-sources.sql" >/dev/null 2>&1
P >/dev/null <<'SQL'
create or replace function public.dev_epa_write_refused(_epa_ok boolean, _j jsonb, _cached_counts jsonb, _cached_refreshed_at timestamp with time zone)
returns boolean language sql as $f$
  select (
      (not (coalesce(_epa_ok, false) and coalesce((_j->'epa'->>'ok')::boolean, true))
       or _cached_refreshed_at >= now() - interval '7 days')
      and coalesce((_j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((_cached_counts->>'facilities')::int, 0) > 0
  );
$f$;
SQL
got="$(psql -X -qtA -c "select md5(prosrc)||'|'||length(prosrc) from pg_proc where proname='dev_refresh_collect'")"
ref="$(psql -X -qtA -c "select md5(prosrc) from pg_proc where proname='dev_epa_write_refused'")"
[ "$got" = "b17263cc5eca232dbde8fc33e27093e4|16593" ] || { echo "ABORT: rebuilt collector is $got, production's is b17263cc…|16593"; exit 1; }
[ "$ref" = "1f8b7e38d9d45bdb764903e1857374db" ] || { echo "ABORT: dev_epa_write_refused is $ref, production's is 1f8b7e38…"; exit 1; }
echo "prep: live collector b17263cc… and dev_epa_write_refused 1f8b7e38… rebuilt"
