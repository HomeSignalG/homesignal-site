#!/usr/bin/env bash
# Executable suite for the "What is changing in my zip code?" email stream, against a
# DISPOSABLE Postgres -- never production (site CLAUDE.md §7.11: no DDL in production,
# in any schema, in any transaction).
#
#   1. fixture.sql (the live shape, 2026-09-25) + the SHIPPED migrations, each applied
#      TWICE (they claim to be idempotent), must pass every check in suite.sql;
#   2. every prohibited mutation in mutate.py must fail >= 1 check (or abort the suite).
#
# The delivery half is homesignal-ingest's
# supabase/migrations/20260925230000_maps_email_delivery.sql. It is applied when found at
# $INGEST_ROOT (default: the sibling checkout). When it is not there -- this repo's own CI,
# which cannot read the private ingest repo -- its checks print as SKIP, which is never
# counted as a pass. REQUIRE_DELIVERY=1 turns that absence into a FAILURE; homesignal-ingest's
# check-maps-email-pg.yml sets it, so the combined run can never go green without its half.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
ingest="${INGEST_ROOT:-$root/../homesignal-ingest}"
A12="$root/docs/alert-subscription-canonical-a12.sql"
DELIVERY="$ingest/supabase/migrations/20260925230000_maps_email_delivery.sql"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(P -tAc "select current_setting('server_version_num')::int >= 170000")" = "t" ]; then
  pg16=0; echo "server: PostgreSQL $(P -tAc 'show server_version') -- shipped SQL applied unmodified"
else
  pg16=1; echo "server: PostgreSQL $(P -tAc 'show server_version') -- LOCAL run: SET EXPRESSION shimmed (CI runs 17)"
fi
have_delivery=0; [ -f "$DELIVERY" ] && have_delivery=1
if [ "$have_delivery" != 1 ]; then
  if [ "${REQUIRE_DELIVERY:-0}" = 1 ]; then
    echo "FAIL -- REQUIRE_DELIVERY=1 and the delivery migration is not at $DELIVERY"; exit 1
  fi
  echo "SKIP -- delivery migration not found at $DELIVERY (the combined run is homesignal-ingest's check-maps-email-pg.yml)"
fi
# The delivery argument, computed ONCE with an if. `d="$([ ... ] && echo ...)"` is a bare
# assignment whose status is the substitution's, so under `set -e` it EXITED the script the
# moment the delivery file was absent -- the site CI shape -- after SHIPPED had printed.
delivery_arg=""; if [ "$have_delivery" = 1 ]; then delivery_arg="$DELIVERY"; fi

prep() {  # $1 = file to apply; writes the (possibly shimmed) copy to $2
  if [ "$pg16" = 1 ]; then python3 "$here/mutate.py" --pg16 "$1" >"$2"; else cp "$1" "$2"; fi
}
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
# apply A12_FILE [DELIVERY_FILE]: each migration twice -- the second pass proves idempotency
apply() {
  prep "$1" "$tmp/a12.sql"
  P -f "$tmp/a12.sql" >/dev/null 2>"$tmp/err" || return 1
  P -f "$tmp/a12.sql" >/dev/null 2>"$tmp/err" || return 1
  if [ -n "${2:-}" ]; then
    P -f "$2" >/dev/null 2>"$tmp/err" || return 1
    P -f "$2" >/dev/null 2>"$tmp/err" || return 1
  fi
}
suite() { P -tA -f "$here/suite.sql" 2>"$tmp/suite_err" | grep -E '^[MD][0-9]' || true; }

# ------------------------------------------------------------------ 1. shipped
reset_db
if ! apply "$A12" "$delivery_arg"; then
  cat "$tmp/err" >&2; echo "FAIL -- the shipped migrations do not apply (twice) to the fixture"; exit 1
fi
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out" || true)
n_fail=$(grep -c '|f$' <<<"$out" || true)
floor=19; [ "$have_delivery" = 1 ] && floor=24
echo "SHIPPED: $n_all checks, $n_fail failed (floor $floor)"
if [ -s "$tmp/suite_err" ] || [ "$n_all" -lt "$floor" ] || [ "$n_fail" -ne 0 ]; then
  cat "$tmp/suite_err" >&2; echo "FAIL -- the shipped MAPS email stream does not pass"; exit 1
fi

# ---------------------------------------------------------------- 2. mutations
status=0
for name in subscriptions-forget-maps zip-scope-guard-not-installed pipeline-type-null-for-maps \
            maps-tap-grants-marketing false-tap-revokes-marketing writer-becomes-delete-to-match \
            old-overload-kept referral-last-touch-wins integrity-view-not-appended \
            ledger-forgets-social-post claim-streams-not-scoped-to-identity claim-opened-to-public; do
  target="$A12"; case "$name" in ledger-*|claim-*) target="$DELIVERY";; esac
  if [ "$target" = "$DELIVERY" ] && [ "$have_delivery" != 1 ]; then echo "SKIP     $name (delivery migration absent)"; continue; fi
  if ! python3 "$here/mutate.py" "$name" "$target" >"$tmp/mutated.sql"; then
    echo "HARNESS  $name -- anchor missing"; status=1; continue
  fi
  reset_db
  if [ "$target" = "$A12" ]; then a="$tmp/mutated.sql"; d="$delivery_arg"
  else a="$A12"; d="$tmp/mutated.sql"; fi
  if ! apply "$a" "$d"; then echo "KILLED   $name (the mutated migration does not apply)"; continue; fi
  mout="$(suite)"
  if [ -s "$tmp/suite_err" ]; then echo "KILLED   $name (suite aborted: $(head -c 120 "$tmp/suite_err" | tr '\n' ' '))"; continue; fi
  killed=$(grep '|f$' <<<"$mout" | cut -d'|' -f1 | tr '\n' ' ' || true)
  if [ -n "$killed" ]; then echo "KILLED   $name by $killed"; else echo "SURVIVED $name"; status=1; fi
done
[ "$status" = 0 ] && echo "MUTATIONS: every prohibited change is killed" || echo "FAIL -- a mutation survived or did not apply"
exit "$status"
