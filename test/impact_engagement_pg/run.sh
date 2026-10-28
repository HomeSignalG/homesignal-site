#!/usr/bin/env bash
# Runs docs/impact-stories.sql + docs/impact-discovery.sql + docs/impact-engagement.sql on a DISPOSABLE Postgres (the Impact Stories stand-ins for
# auth/vault/net, plus stand-ins for the attribution tables) and executes suite.sql. Both files are applied twice: they
# must re-apply cleanly. Exit code is the result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
D="$(mktemp -d)"; PORT="${PGPORT:-55436}"
RUN=""; if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$D"; RUN="su postgres -c"; fi
runas() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
runas "$PGBIN/initdb -D $D/data -A trust -U postgres >/dev/null"
runas "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'runas "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="$PGBIN/psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
P="$P -d t"
$P -f "$ROOT/test/impact_stories_pg/stubs.sql"
for i in 1 2; do
  $P -f "$ROOT/docs/impact-stories.sql" >/dev/null
  $P -f "$ROOT/docs/impact-discovery.sql" >/dev/null
  $P -f "$ROOT/docs/impact-engagement.sql" >/dev/null
done
$P -f "$HERE/suite.sql"
