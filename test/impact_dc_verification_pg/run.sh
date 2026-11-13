#!/usr/bin/env bash
# Executable suite for docs/impact-dc-verification.sql (the Tab 17 data-center project check: queue, triggers, retries,
# stale rules, Recheck, tick) on a DISPOSABLE Postgres with stand-ins for Map 1's readers (fixture.sql).
# 1. the shipped file passes every check (applied twice: it must be re-runnable); 2. each prohibited mutation fails one.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
# Its own database: the fixture replaces the public schema, which must never touch another suite's database.
own="${PGDATABASE}_dcv"
psql -X -q -d "$PGDATABASE" -c "drop database if exists $own" -c "create database $own" >/dev/null
export PGDATABASE="$own"
P() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 "$@"; }
coverage() {   # Hot Topics' own coverage function, read from its SQL of record (the ZIP rule must agree with it)
  python3 - "$root/docs/impact-discovery.sql" <<'PY'
import sys
s = open(sys.argv[1]).read()
i = s.index('create or replace function public.impact_discovery_coverage(')
print(s[i:s.index('end $$;', i) + len('end $$;')])
PY
}
base() { P -f "$here/fixture.sql" >/dev/null 2>&1 || P -f "$here/fixture.sql" >/dev/null; coverage | P >/dev/null; }
suite() { P -tA -F"|" -f "$here/suite.sql" | grep -E "\|[tf]\|" ; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

base
P -f "$root/docs/impact-dc-verification.sql" >/dev/null
P -f "$root/docs/impact-dc-verification.sql" >/dev/null
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 45 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped file does not pass"; exit 1; fi

status=0
while IFS= read -r name; do
  base
  mutated="$(python3 "$here/mutate.py" "$name" "$root/docs/impact-dc-verification.sql")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; grep '|f|' <<<"$out" | sed 's/^/    /' | cut -c1-200 | head -3
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
exit $status
