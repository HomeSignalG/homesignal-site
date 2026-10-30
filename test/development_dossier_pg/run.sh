#!/usr/bin/env bash
# Development dossier SQL against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop table if exists public.development_project_statement, public.development_project_link, public.development_project, public.development_reviewer cascade" >/dev/null 2>&1
  P -f "$here/fixture_schema.sql" >/dev/null 2>&1
}
shipped="$root/docs/development-dossier.sql"
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

reset_db; P -f "$shipped" >/dev/null
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 40 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped SQL does not pass"; exit 1; fi
P -f "$shipped" >/dev/null && echo "RE-APPLY: ok" || { echo "FAIL — the file does not re-apply"; exit 1; }

status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
for m in "$here"/mutations/*.sed; do
  sed -f "$m" "$shipped" > "$tmp"
  if cmp -s "$tmp" "$shipped"; then
    echo "NO-OP    $(basename "$m") — the mutation did not change the file"; status=1; continue
  fi
  reset_db; P -f "$tmp" >/dev/null 2>&1 || true
  out="$(suite 2>&1 || true)"; n_fail=$(fails_of "$out")
  n_got=$(grep -c '|[tf]|' <<<"$out" || true)
  if [ "$n_fail" -gt 0 ] || [ "$n_got" -lt "$n_all" ]; then
    echo "KILLED   $(basename "$m") — $n_fail check(s) failed"
  else
    echo "SURVIVED $(basename "$m") — the suite cannot see this regression"; status=1
  fi
done
reset_db; P -f "$shipped" >/dev/null
exit $status
