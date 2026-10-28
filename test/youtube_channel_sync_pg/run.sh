#!/usr/bin/env bash
# Runs the live video queue files, then docs/youtube-channel-sync.sql, on a DISPOSABLE Postgres and executes suite.sql.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; Q="$ROOT/test/video_bluesky_queue_pg"
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
$P -f "$Q/stubs.sql"
$P -f "$ROOT/docs/youtube-video-review.sql" >/dev/null
$P -f "$Q/pre.sql"
$P -f "$ROOT/docs/video-bluesky-queue.sql" >/dev/null
$P -f "$Q/production-decide.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-file-decide-queue-apply.sql" >/dev/null
$P -f "$ROOT/docs/youtube-channel-sync.sql" >/dev/null
$P -f "$ROOT/docs/youtube-channel-sync.sql" >/dev/null    # applying twice is safe
$P -f "$HERE/suite.sql"
