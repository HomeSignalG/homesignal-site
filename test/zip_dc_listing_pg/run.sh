#!/usr/bin/env bash
# docs/zip-dc-listing.sql on a DISPOSABLE Postgres, applied twice. Exit code is the result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
D="$(mktemp -d)"; PORT="${PGPORT:-55447}"
RUN=""; if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$D"; chmod 755 "$D"; RUN="su postgres -c"; fi
runas() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
runas "$PGBIN/initdb -D $D/data -A trust -U postgres >/dev/null"
runas "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'runas "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="psql -X -q -v ON_ERROR_STOP=1 -h $D -p $PORT -U postgres -d postgres"
$P -f "$HERE/fixture.sql"
$P -f "$ROOT/docs/zip-dc-listing.sql"
$P -f "$ROOT/docs/zip-dc-listing.sql"     # re-applying is safe
$P -o /dev/null -f "$HERE/suite.sql" 2>&1 | sed -e "s/^.*NOTICE:  //"
echo "zip_dc_listing suite passed"
