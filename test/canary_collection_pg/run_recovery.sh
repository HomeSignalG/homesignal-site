#!/usr/bin/env bash
# scripts/verify-canary-recovery.sql on a DISPOSABLE Postgres: the expected recovered key SET must equal the cache's stamps and the
# ledger's recoveries; collection alone is not recovery.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
P -f "$here/fixture_recovery.sql" >/dev/null
v() { # zip expected-array-literal
  sed -e "s/'76258'::text as zip/'$1'::text as zip/" -e "s/array\[''\]::text\[\] as expected/$2::text[] as expected/" "$root/scripts/verify-canary-recovery.sql" | P -F'|' | awk -F'|' '{print $NF}'
}
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=$2 want=$3"; bad=$((bad+1)); fi; }
t 'R01 expected == cache stamps == ledger recoveries, none announced, pair ready -> PASS' "$(v 71001 "array['a:1','a:2']")" t
t 'R02 an expected key that was NOT recovered -> FAIL' "$(v 71002 "array['b:1','b:2']")" f
t 'R03 an UNEXPECTED recovered key -> FAIL' "$(v 71003 "array['c:1']")" f
t 'R04 a recovered key that was ANNOUNCED -> FAIL (backfill must stay silent)' "$(v 71004 "array['d:1']")" f
t 'R05 collection passed but the ledger recovered nothing -> FAIL (collection is not recovery)' "$(v 71005 "array['e:1']")" f
t 'R06 the cache stamps a key the operator did not expect -> FAIL' "$(v 71006 "array['f:1']")" f
t 'R07 readiness not established -> FAIL' "$(v 71007 "array['g:1']")" f
t 'R10 a readiness row that only COUNTS held records (no baseline) is not READY -> FAIL' "$(v 71008 "array['h:1']")" f
t 'R08 an EMPTY expected set -> FAIL (a zero proves nothing)' "$(v 71001 "array[]")" f
t 'R09 an unknown ZIP -> FAIL, not NULL' "$(v 79999 "array['a:1']")" f
echo "CANARY RECOVERY: $n checks, $bad failed"; [ "$bad" -eq 0 ]
