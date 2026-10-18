#!/usr/bin/env bash
# zip_government_bodies against a DISPOSABLE Postgres (never production).
# 1. the shipped function passes every check; 2. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse "$@" 2> >(grep -v -e NOTICE -e DETAIL -e "^drop cascades" >&2); }
apply_shipped() { P -f "$here/fixture_schema.sql" >/dev/null; P -f "$root/docs/zip-government-bodies.sql" >/dev/null; }
refusals() {
  # every statement in suite_clear_refusals.sql must raise; one '|t|' row per refusal held
  while IFS= read -r line; do
    [ -z "$line" ] || [[ "$line" == --* ]] && continue
    if P -c "$line" >/dev/null 2>&1; then echo "R refusal: $line|f|ran"; else echo "R refusal held|t|"; fi
  done < "$here/suite_clear_refusals.sql"
}
suite() {
  P -tA -F'|' -f "$here/suite.sql" && P -tA -F'|' -f "$here/suite_topics.sql" \
    && P -tA -F'|' -f "$here/suite_clear.sql" && refusals
}
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_shipped
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 41 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped function does not pass"; exit 1; fi

status=0
for m in "$here"/mutations/*.sed; do
  apply_shipped
  sed -f "$m" "$root/docs/zip-government-bodies.sql" > /tmp/zgb_mut.sql
  if cmp -s /tmp/zgb_mut.sql "$root/docs/zip-government-bodies.sql"; then echo "NO-OP    $(basename "$m") — the mutation did not change the file"; status=1; continue; fi
  P -f /tmp/zgb_mut.sql >/dev/null
  if ! out="$(suite 2>&1)"; then echo "KILLED   $(basename "$m") — the suite errored: $(tail -1 <<<"$out")"; continue; fi
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then echo "KILLED   $(basename "$m") — $n_fail check(s) failed"
  else echo "SURVIVED $(basename "$m") — the suite cannot see this regression"; status=1; fi
done
apply_shipped
exit $status
