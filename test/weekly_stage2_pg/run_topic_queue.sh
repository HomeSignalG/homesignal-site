#!/usr/bin/env bash
# The topic queue in the FULL weekly configuration (docs/weekly-1..7, in order; config.sh) against a DISPOSABLE Postgres
# (never production). Applies all seven files twice (idempotent), seeds the demonstration, runs topic_queue.sql, then
# checks that each mutation of the queue files (2 and 7) makes at least one check fail.
# The queue-only release (files 1 and 2) has its own runner: run_queue_only.sh.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
LEADS="$root/test/fixtures/weekly-topic-leads.json"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
SQL="$tmp/full.sql"; weekly_combine "$SQL" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
run_once() {
  reset_db
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  python3 "$here/build_demo_fixture.py" --seed >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -v leads="$(cat "$LEADS")" -f "$here/topic_queue.sql" 2>"$tmp/suite.err" | grep -E '^Q[0-9]+[a-z]?\|' || true
}
out="$(run_once "$SQL")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select 'Q[0-9]+[a-z]?\|" "$here/topic_queue.sql")
echo "TOPIC QUEUE SHIPPED: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error (a check that errors is not a pass)"; exit 1; fi
# the queue screen fixture must be what the prepared SQL produces
reset_db; P -f "$SQL" >/dev/null 2>&1; python3 "$here/build_demo_fixture.py" --seed >/dev/null
python3 "$here/build_topic_queue_fixture.py" --check
if [ "${1:-}" = "--no-mutations" ]; then echo "PASS (mutations skipped)"; exit 0; fi
# every mutation in topic_queue_mutations.py must apply to the queue file and make at least one check fail
bad=0
count=$(python3 "$here/topic_queue_mutations.py" count)
for i in $(seq 0 $((count - 1))); do
  rm -rf "$tmp/m"; cp -r "$WEEKLY_DOCS" "$tmp/m"
  name=$(python3 "$here/topic_queue_mutations.py" apply "$i" "$tmp/m/weekly-2-topic-queue.sql" "$tmp/m/weekly-7-topic-queue-gate.sql")
  # 2a is generated from file 2: regenerate it from the MUTATED copy, or the committed 2a would replace three mutated
  # functions with unmutated ones and hide the mutation
  python3 "$here/build_queue_lock_sql.py" --docs "$tmp/m" >/dev/null
  weekly_combine "$tmp/m.sql" "$tmp/m" "${WEEKLY_FULL[@]}"
  set +e; mo="$(run_once "$tmp/m.sql" 2>/dev/null)"; rc=$?; set -e
  if [ $rc -ne 0 ] || grep -vq '|true$' <<<"$mo" || [ "$(grep -c '|' <<<"$mo")" -lt "$n" ]; then echo "  killed: $name"; else echo "  SURVIVED: $name"; bad=1; fi
done
[ $bad -eq 0 ] || { echo FAIL; exit 1; }
echo "PASS"
