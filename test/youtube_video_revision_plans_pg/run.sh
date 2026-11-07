#!/usr/bin/env bash
# Runs docs/youtube-video-review.sql + docs/youtube-video-revisions.sql + the plan, step-7 and step-8 files on a
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
# step 7 refuses a plan_start it was not written against, then applies (twice)
if $P -c "create or replace function public.hs_youtube_video_plan_start(p_slug text, p_key text, p_note text) returns jsonb language plpgsql as \$\$ begin return null; end \$\$" >/dev/null \
   && $P -f "$ROOT/docs/youtube-video-revision-plans-also.sql" >/dev/null 2>&1; then
  echo "FAIL guard: the step-7 SQL applied over an unknown plan_start"; exit 1
fi
echo "ok step-7 guard refuses an unknown plan_start"
$P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null   # put the step-6 functions back
$P -f "$ROOT/docs/youtube-video-revision-plans-also.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-revision-plans-also.sql" >/dev/null
echo "ok step-7 applies twice"
$P -f "$HERE/suite.sql"
# step 8 refuses a dispatcher it was not written against, then applies (twice)
if $P -c "create or replace function public._hs_yv_dispatch(p_id uuid) returns void language plpgsql as \$\$ begin null; end \$\$" >/dev/null \
   && $P -f "$ROOT/docs/youtube-video-rebuild.sql" >/dev/null 2>&1; then
  echo "FAIL guard: the step-8 SQL applied over an unknown _hs_yv_dispatch"; exit 1
fi
echo "ok step-8 guard refuses an unknown _hs_yv_dispatch"
$P -f "$ROOT/docs/youtube-video-revisions.sql" >/dev/null   # put the real dispatcher back
$P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null   # then the step-6 one (live today)
$P -f "$ROOT/docs/youtube-video-revision-plans-also.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-rebuild.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-rebuild.sql" >/dev/null
echo "ok step-8 applies twice"
$P -f "$HERE/rebuild.sql"
# Full rebuild carries out the saved rejection note (2026-11-07): refuses an unknown rebuild body, applies twice
if $P -c "create or replace function public.hs_youtube_video_rebuild(p_slug text, p_key text) returns jsonb language plpgsql as \$\$ begin return null; end \$\$" >/dev/null \
   && $P -f "$ROOT/docs/youtube-video-rebuild-applies-note.sql" >/dev/null 2>&1; then
  echo "FAIL guard: the rebuild-note SQL applied over an unknown hs_youtube_video_rebuild"; exit 1
fi
echo "ok rebuild-note guard refuses an unknown hs_youtube_video_rebuild"
$P -f "$ROOT/docs/youtube-video-rebuild.sql" >/dev/null   # put the step-8 rebuild back (live before this change)
$P -f "$ROOT/docs/youtube-video-rebuild-applies-note.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-rebuild-applies-note.sql" >/dev/null
echo "ok rebuild-note applies twice"
$P -f "$HERE/rebuild-note.sql"
# Out-of-date files (2026-11-07): production's decide body, then the splice; refuses an unknown body; applies twice
$P -f "$HERE/live-decide.sql" >/dev/null
if $P -c "create or replace function public.hs_youtube_videos_list() returns jsonb language plpgsql as \$\$ begin return '[]'; end \$\$" >/dev/null \
   && $P -f "$ROOT/docs/youtube-video-outdated.sql" >/dev/null 2>&1; then
  echo "FAIL guard: the outdated SQL spliced an unknown hs_youtube_videos_list"; exit 1
fi
echo "ok outdated guard refuses an unknown hs_youtube_videos_list"
$P -f "$ROOT/docs/youtube-video-revisions.sql" >/dev/null   # put the list back
$P -f "$ROOT/docs/youtube-video-revision-plans.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-revision-plans-also.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-rebuild.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-rebuild-applies-note.sql" >/dev/null
$P -f "$HERE/live-decide.sql" >/dev/null
$P -At -c "select md5(prosrc) from pg_proc where proname = 'hs_youtube_videos_list'" | grep -qx 09eecdd3a42974994a243305b9f192d2 \
  || { echo "FAIL the fixture's list is not production's"; exit 1; }
$P -f "$ROOT/docs/youtube-video-outdated.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-outdated.sql" >/dev/null
echo "ok outdated applies twice"
# the parts (2026-11-07): applied on top; the original checks must still pass, then the per-part ones
$P -f "$ROOT/docs/youtube-video-outdated-parts.sql" >/dev/null
$P -f "$ROOT/docs/youtube-video-outdated-parts.sql" >/dev/null
echo "ok outdated parts apply twice"
$P -f "$HERE/outdated.sql"
$P -f "$HERE/outdated-parts.sql"
