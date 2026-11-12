#!/usr/bin/env bash
# docs/video-endings.sql on a DISPOSABLE Postgres, over the Tab 16 revision chain it builds on
# (the youtube_video_revision_plans_pg stubs). Exit code is the result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; YV="$ROOT/test/youtube_video_revision_plans_pg"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
D="$(mktemp -d)"; PORT="${PGPORT:-55437}"
RUN=""; if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$D"; RUN="su postgres -c"; fi
runas() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
runas "$PGBIN/initdb -D $D/data -A trust -U postgres >/dev/null"
runas "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'runas "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="$PGBIN/psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
P="$P -d t"
$P -f "$YV/stubs.sql"
$P -c "create function public.hs_is_dashboard_admin() returns boolean language sql stable as \$\$ select exists (select 1 from public.dashboard_admins where email = auth.jwt() ->> 'email') \$\$" >/dev/null
for f in youtube-video-review youtube-video-revisions youtube-video-revision-plans youtube-video-revision-plans-also \
         youtube-video-rebuild youtube-video-rebuild-applies-note; do
  $P -f "$ROOT/docs/$f.sql" >/dev/null
done
$P -f "$ROOT/docs/video-endings.sql" >/dev/null
$P -f "$ROOT/docs/video-endings.sql" >/dev/null
echo "ok applies twice"
$P -f "$HERE/suite.sql"
echo "ALL OK"
