#!/usr/bin/env bash
# docs/weekly-topic-queue.sql against a DISPOSABLE Postgres (never production). Applies the Stage 2 file, then the
# queue file twice (idempotent), seeds the demonstration, runs topic_queue.sql, then checks that each mutation of the
# queue file makes at least one check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
STAGE2="$root/docs/weekly-stage2-slice.sql"; SQL="$root/docs/weekly-topic-queue.sql"
LEADS="$root/test/fixtures/weekly-topic-leads.json"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$STAGE2" >/dev/null 2>&1
}
run_once() {
  reset_db
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  # the Stage 2 file applied again afterwards must not undo anything here
  P -f "$STAGE2" >/dev/null 2>&1
  python3 "$here/build_demo_fixture.py" --seed >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -v leads="$(cat "$LEADS")" -f "$here/topic_queue.sql" 2>"$tmp/suite.err" | grep -E '^Q[0-9]+[a-z]?\|' || true
}
out="$(run_once "$SQL")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select 'Q[0-9]+[a-z]?\|" "$here/topic_queue.sql")
echo "TOPIC QUEUE SHIPPED: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error (a check that errors is not a pass)"; exit 1; fi
if [ "${1:-}" = "--no-mutations" ]; then echo "PASS (mutations skipped)"; exit 0; fi
# every mutation in topic_queue_mutations.py must apply to the queue file and make at least one check fail
bad=0
count=$(python3 "$here/topic_queue_mutations.py" count)
for i in $(seq 0 $((count - 1))); do
  name=$(python3 "$here/topic_queue_mutations.py" apply "$i" "$SQL" "$tmp/m.sql")
  set +e; mo="$(run_once "$tmp/m.sql" 2>/dev/null)"; rc=$?; set -e
  if [ $rc -ne 0 ] || grep -vq '|true$' <<<"$mo" || [ "$(grep -c '|' <<<"$mo")" -lt "$n" ]; then echo "  killed: $name"; else echo "  SURVIVED: $name"; bad=1; fi
done
[ $bad -eq 0 ] || { echo FAIL; exit 1; }
echo "PASS"
