#!/usr/bin/env bash
# The QUEUE-ONLY release (docs/weekly-1-base.sql + docs/weekly-2-topic-queue.sql; config.sh) against a DISPOSABLE
# Postgres (never production). Applies the two files twice (idempotent) and runs queue_only.sql. Then applies the FULL
# configuration on top (the later upgrade path) and requires every captured lead, event and edition to be unchanged.
# It also checks the read-only production preflight (docs/weekly-preflight-queue-only.sql; build_preflight.py), and
# last that test/fixtures/weekly-queue-only-flow.json is what this SQL produces (build_queue_only_flow.py).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
LEADS="$root/test/fixtures/weekly-topic-leads.json"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
weekly_combine "$tmp/queue.sql" "$WEEKLY_DOCS" "${WEEKLY_QUEUE_ONLY[@]}"
weekly_combine "$tmp/full.sql" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
      drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null
python3 "$here/build_preflight.py" --snapshot before "$tmp/before.json"
P -f "$tmp/queue.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo FAIL; exit 1; }
python3 "$here/build_preflight.py" --snapshot after "$tmp/after.json"
# the production preflight (docs/weekly-preflight-queue-only.sql) must list exactly what these two files create, and,
# run here WITH the release installed, must report every one of those objects as already existing
python3 "$here/build_preflight.py" --check "$tmp/before.json" "$tmp/after.json"
PRE="$WEEKLY_DOCS/weekly-preflight-queue-only.sql"
psql -X -q -tA -v ON_ERROR_STOP=1 -f "$PRE" > "$tmp/with.json"
python3 - "$tmp/with.json" <<'PY'
import json, sys
o = json.load(open(sys.argv[1]))
seen = {k: len(v) for k, v in o["already_exists"].items()}
assert o["verdict"].startswith("no-go") and seen == o["will_create"] and all(seen.values()), (o["verdict"], seen, o["will_create"])
print("  preflight, release installed: no-go, and it sees all %d created objects" % sum(seen.values()))
PY
P -f "$tmp/queue.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo FAIL; exit 1; }
out="$(psql -X -q -tA -v leads="$(cat "$LEADS")" -f "$here/queue_only.sql" 2>"$tmp/suite.err" | grep -E '^K[0-9]+[a-z]?\|' || true)"
echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select 'K[0-9]+[a-z]?\|" "$here/queue_only.sql")
echo "QUEUE-ONLY RELEASE: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error (a check that errors is not a pass)"; exit 1; fi
# the upgrade path: the other five files applied later must leave the queue's rows exactly as they were
fp="select (select count(*) from public.weekly_topic_leads) || ' leads, ' || (select count(*) from public.weekly_topic_lead_events) || ' events, ' ||
     (select count(*) from public.weekly_editions) || ' editions, ' || (select count(*) from public.weekly_research_requests) || ' requests, md5 ' ||
     md5((select string_agg(to_jsonb(l)::text, ',' order by l.id::text collate \"C\") from public.weekly_topic_leads l) ||
         (select string_agg(to_jsonb(e)::text, ',' order by e.id) from public.weekly_topic_lead_events e) ||
         (select string_agg(to_jsonb(d)::text, ',' order by d.id::text collate \"C\") from public.weekly_editions d))"
before="$(psql -X -q -tA -c "$fp")"
P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: the full configuration did not apply over the queue-only release"; exit 1; }
after="$(psql -X -q -tA -c "$fp")"
echo "  before the upgrade: $before"; echo "  after the upgrade:  $after"
[ -n "$before" ] && [ "$before" = "$after" ] || { echo "FAIL: applying the other files changed the queue's rows"; exit 1; }
caps="$(psql -X -q -tA -c "select set_config('test.jwt', '{\"email\":\"founder@test.invalid\"}', false); set role authenticated; select public.hs_weekly_topic_queue() -> 'capabilities'" | tail -1)"
echo "  capabilities after the upgrade: $caps"
[ "$caps" = '{"version_linking": true, "answer_processing_installed": true}' ] || { echo "FAIL: the upgraded read model does not report the installed parts"; exit 1; }
# the real-page browser test replays a recorded flow: that recording must be what the queue-only SQL produces
P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
      drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null; P -f "$tmp/queue.sql" >/dev/null 2>&1
# on a database WITHOUT the release the same preflight must find every prerequisite and no conflict
P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
      drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null
[ "$(psql -X -q -tA -v ON_ERROR_STOP=1 -f "$PRE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["verdict"])')" = "go" ] \
  || { echo "FAIL: the preflight does not say go on a database that has the prerequisites and none of the objects"; exit 1; }
echo "  preflight, release absent: go"
P -f "$tmp/queue.sql" >/dev/null 2>&1
python3 "$here/build_queue_only_flow.py" --check
# the read-only production verification queries (docs/weekly-verify-after-1.sql, -2.sql) must be what these files
# produce, pass on the clean release and fail on each tampered one (build_verify.py; it wipes and rebuilds the database)
python3 "$here/build_verify.py" --check
echo "PASS"
