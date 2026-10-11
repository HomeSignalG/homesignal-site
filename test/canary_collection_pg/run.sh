#!/usr/bin/env bash
# Runs scripts/verify-canary-collection.sql against a DISPOSABLE Postgres (PG* env must point at it) through scenarios,
# and runs the PREVIOUS script as a negative control on the lost-canary scenario (it must PASS there — proving the
# scenario is the one the old script could not see — while the new script FAILS it).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
P -f "$here/fixture.sql" >/dev/null
run() { # script zip req fired_after
  sed -e "s/'76258'::text as zip/'$2'::text as zip/" -e "s/0::bigint as request_id/$3::bigint as request_id/" \
      -e "s/'2026-10-11 00:00:00+00'::timestamptz as fired_after/'2026-10-11 00:00:00+00'::timestamptz as fired_after/" "$1" | P -F'|'
}
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=$2 want=$3"; bad=$((bad+1)); fi; }
verdict() { run "$root/scripts/verify-canary-collection.sql" "$1" "$2" | awk -F'|' '{print $NF}'; }
oldverdict() { run "$here/old_verify.sql" "$1" "$2" | awk -F'|' '{print ($2=="t" && $3=="t" && $4=="t")?"PASS":"FAIL"}'; }
V() { [ "$1" = t ] && echo PASS || echo FAIL; }
t 'K01 good canary: response ok, cursor == id, cache applied -> PASS' "$(V "$(verdict 70001 1001)")" PASS
t 'K02 LOST canary then a later rolling refresh of the same ZIP -> FAIL' "$(V "$(verdict 70002 2001)")" FAIL
t 'K03 CONTROL: the previous script PASSES that same lost-canary scenario' "$(oldverdict 70002 2001)" PASS
t 'K04 response exists but the collector rolled back (cursor < id) -> FAIL' "$(V "$(verdict 70003 3001)")" FAIL
t 'K05 response evaluated but REFUSED (cursor == id, refreshed_at did not advance) -> FAIL' "$(V "$(verdict 70004 4001)")" FAIL
t 'K06 response is HTTP 500 -> FAIL' "$(V "$(verdict 70005 5001)")" FAIL
t 'K07 response names a different ZIP -> FAIL' "$(V "$(verdict 70006 6001)")" FAIL
t 'K08 a blocked-update failure since the fire -> FAIL' "$(V "$(verdict 70007 7001)")" FAIL
t 'K09 unknown request id (row purged / never recorded) -> FAIL, not NULL' "$(V "$(verdict 70001 999999)")" FAIL
t 'K10 unknown ZIP -> FAIL, not NULL' "$(V "$(verdict 79999 1001)")" FAIL
echo "CANARY SCRIPT: $n checks, $bad failed"; [ "$bad" -eq 0 ]
