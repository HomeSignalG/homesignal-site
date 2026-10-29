#!/usr/bin/env bash
# Executable suite for docs/youtube-video-revisions.sql against a DISPOSABLE Postgres (never production).
# Applies the shipped file twice (idempotency), then runs suite.sql. Needs PGHOST/PGDATABASE (CI provides them).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema if exists public cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null
# the two existing tables/functions the revision file extends
P -f "${SQL_FILE:-$root/docs/youtube-video-revisions.sql}" >/dev/null
P -f "${SQL_FILE:-$root/docs/youtube-video-revisions.sql}" >/dev/null
P -f "$here/suite.sql"
# 56: two Generate clicks at the same moment (two sessions). The second must wait for the first, see its running
# revision, and leave the first note saved. Without the row lock taken first, the second note overwrote the first.
P -c "insert into public.youtube_video_reviews (slug, title, files) values ('c1','C1',jsonb_build_object('final',jsonb_build_object('path','c1/final.mp4','bytes',1,'sha256','c')))" >/dev/null
J="select set_config('test.jwt', '{\"email\":\"founder@example.com\"}', false);"
P -c "begin; $J select public.hs_youtube_video_reject_and_revise('c1','final','note A'); select pg_sleep(2); commit;" >/dev/null &
sleep 0.7
P -c "$J select public.hs_youtube_video_reject_and_revise('c1','final','note B');" >/dev/null
wait
got=$(psql -X -At -c "select (select file_decisions->'final'->>'note' from public.youtube_video_reviews where slug='c1') || '|' || (select count(*) from public.youtube_video_revisions where slug='c1')")
if [ "$got" = "note A|1" ]; then r=PASS; else r=FAIL; fi
echo " 56 two simultaneous clicks: one revision, and the saved note is the one that is running | $r | $got"
[ "$r" = PASS ]
