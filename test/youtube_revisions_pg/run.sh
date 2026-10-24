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
