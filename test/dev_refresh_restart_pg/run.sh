#!/usr/bin/env bash
# Restart heal for dev_refresh_collect(), against a DISPOSABLE Postgres -- never
# production (site CLAUDE.md §7.11: no DDL in production, in any schema, in any
# transaction).
#   0. the LIVE function (build_live.py, fingerprinted to production) must FAIL the
#      restart checks: the suite reproduces the defect before it is trusted to see a fix;
#   1. the shipped migration, applied TWICE, must pass every check;
#   2. every mutation in mutate.py must fail >= 1 check (or refuse to apply).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
MIG="$root/docs/dev-refresh-collect-restart-heal.sql"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
python3 "$here/build_live.py" >"$tmp/live.sql"
reset_db() { P -f "$here/fixture.sql" >/dev/null 2>&1; P -f "$tmp/live.sql" >/dev/null; }
suite() { P -tA -f "$here/suite.sql" 2>"$tmp/suite_err" | grep -E '^R[0-9]+\|' || true; }
FLOOR=13

# ------------------------------------------------------------ 0. the defect, reproduced
reset_db
out="$(suite)"
if ! grep -q '^R01|f$' <<<"$out" || ! grep -q '^R03|f$' <<<"$out"; then
  echo "$out" | sed 's/^/  /'; echo "FAIL -- the live function does not show the restart defect; the suite cannot see it"; exit 1
fi
echo "CONTROL: the live function skips the new answer after a restart (R01|f, R03|f) -- defect reproduced"

# ------------------------------------------------------------ 1. shipped, applied twice
reset_db
P -f "$MIG" >/dev/null 2>"$tmp/err" && P -f "$MIG" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL -- the migration does not apply twice"; exit 1; }
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f$' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed (floor $FLOOR)"
if [ -s "$tmp/suite_err" ] || [ "$n_all" -lt "$FLOOR" ] || [ "$n_fail" -ne 0 ]; then
  cat "$tmp/suite_err" >&2; echo "FAIL -- the restart heal does not pass"; exit 1
fi

# ------------------------------------------------------------ 2. mutations
status=0
for name in heal-sets-null heal-ignores-is-called heal-never-fires heal-touches-every-cursor; do
  if ! python3 "$here/mutate.py" "$name" "$MIG" >"$tmp/m.sql"; then echo "HARNESS  $name -- anchor missing"; status=1; continue; fi
  reset_db
  if ! P -f "$tmp/m.sql" >/dev/null 2>&1; then echo "KILLED   $name (the mutated migration does not apply)"; continue; fi
  mout="$(suite)"
  if [ -s "$tmp/suite_err" ]; then echo "KILLED   $name (suite aborted)"; continue; fi
  killed=$(grep '|f$' <<<"$mout" | cut -d'|' -f1 | tr '\n' ' ' || true)
  if [ -n "$killed" ]; then echo "KILLED   $name by $killed"; else echo "SURVIVED $name"; status=1; fi
done
[ "$status" = 0 ] && echo "MUTATIONS: every prohibited change is killed" || echo "FAIL -- a mutation survived or did not apply"
exit "$status"
