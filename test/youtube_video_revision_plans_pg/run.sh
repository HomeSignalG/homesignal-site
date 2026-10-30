#!/usr/bin/env bash
# Runs docs/youtube-video-review.sql + docs/youtube-video-revisions.sql + docs/youtube-video-revision-plans.sql on a
# DISPOSABLE Postgres (stubbed auth/vault/net) and executes suite.sql. Exit code is the result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
D="$(mktemp -d)"; PORT="${PGPORT:-55433}"
RUN=""; if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$D"; RUN="su postgres -c"; fi
runas() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
runas "$PGBIN/initdb -D $D/data -A trust -U postgres >/dev/null"
runas "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'runas "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="$PGBIN/psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
P="$P -d t"
$P -f "$HERE/stubs.sql"
$P -f "$ROOT/docs/youtube-video-review.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-revisions.sql" >/dev/null
# the guard refuses a _hs_yv_dispatch it was not written against
if $P -c "create or replace function public._hs_yv_dispatch(p_id uuid) returns void language plpgsql as \$\$ begin null; end \$\$" >/dev/null \
   && $P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null 2>&1; then
  echo "FAIL guard: the plan SQL applied over an unknown _hs_yv_dispatch"; exit 1
fi
echo "ok guard refuses an unknown _hs_yv_dispatch"
$P -f "$ROOT/docs/youtube-video-revisions.sql" >/dev/null   # put the real dispatcher back
$P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null   # a re-run is accepted
echo "ok applies twice"
$P -f "$HERE/suite.sql"
