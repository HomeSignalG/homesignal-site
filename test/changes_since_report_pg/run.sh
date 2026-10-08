#!/usr/bin/env bash
# CHANGES SINCE REPORT and FOLLOW, end to end on a real database (contract §6 gate 4: "Follow / Changes Since Report continues to
# work while the private context is active ... that must be shown end to end when it is built").
#   1. a fresh DISPOSABLE Postgres gets the shipped ledger, the reportable-events view, the private-context layer and the snapshot
#      SQL, exactly as production has them (only the failure table under the source-health view is a stand-in: standins.sql says why; the view itself is production's);
#   2. roundtrip.mjs assembles a report with the real engine from events read through the real shared reads, stores it with the real
#      writer, then drives the REAL edge function handler and data layer. The data layer's fetch is a small PostgREST translator
#      that runs each request as role service_role against the database, so a missing grant or a wrong column fails here.
# Refuses to run against anything that is not named disposable. Holds no Supabase credential.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
# Apply one file. A failure PRINTS why (psql's own error, which a CI log needs) and stops the run; notices stay quiet.
apply() {
  local out
  out="$(P -f "$1" 2>&1 >/dev/null)" || { echo "FAIL — $1 did not apply:"; echo "$out"; exit 3; }
}
out="$(P -c "drop schema public cascade; create schema public;" 2>&1 >/dev/null)" || { echo "FAIL — the disposable database could not be reset:"; echo "$out"; exit 3; }
apply "$root/test/dev_change_ledger_pg/fixture.sql"
apply "$root/docs/dev-change-ledger.sql"
apply "$root/docs/dev-change-reportable.sql"
apply "$root/docs/report-private-context.sql"
apply "$root/docs/report-snapshot.sql"
apply "$here/standins.sql"
# The REAL view the reader queries, and its lock-down, sliced out of the SQL of record by pattern (rule 7: never transcribe SQL).
slice="$(mktemp)"; trap 'rm -f "$slice"' EXIT
python3 - "$root/docs/dev-change-baseline.sql" > "$slice" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
for pat in (r"create or replace view public\.dev_change_source_fetch_health[\s\S]*?;\n",
            r"revoke all on public\.dev_change_source_fetch_health[^;]*;\n",
            r"grant select on public\.dev_change_source_fetch_health[^;]*;\n"):
    m = re.search(pat, s)
    if not m: sys.exit('the SQL of record no longer holds: ' + pat)
    sys.stdout.write(m.group(0) + "\n")
PY
apply "$slice"
exec node "$here/roundtrip.mjs"
