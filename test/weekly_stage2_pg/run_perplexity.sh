#!/usr/bin/env bash
# docs/weekly-perplexity-api.sql against a DISPOSABLE Postgres (never production). Applies files 1, 2, 2a and the
# Perplexity file (twice: idempotent), runs perplexity.sql, then requires each mutation below to make a check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
F=weekly-perplexity-api.sql
run_once() {   # $1 = the Perplexity file to apply
  reset_db
  for f in weekly-1-base.sql weekly-2-topic-queue.sql weekly-2a-publication-lock.sql; do P -f "$WEEKLY_DOCS/$f" >/dev/null; done
  P -f "$1" >/dev/null 2>"$tmp/err" && P -f "$1" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/perplexity.sql" 2>"$tmp/suite.err" | grep -E '^P[0-9]+\|' || true
}
out="$(run_once "$WEEKLY_DOCS/$F")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -c '|false' <<<"$out" || true)
expected=$(grep -cE "^select 'P[0-9]+\|" "$here/perplexity.sql")
echo "PERPLEXITY: $n of $expected checks printed, $f false"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
mutate() {   # $1 name, $2 python expression transforming s
  python3 - "$WEEKLY_DOCS/$F" "$tmp/m.sql" "$2" <<'PY'
import sys
s = open(sys.argv[1]).read(); t = eval(sys.argv[3])
assert t != s, "mutation changed nothing"
open(sys.argv[2], "w").write(t)
PY
  local o; o="$(run_once "$tmp/m.sql")" || { echo "  BROKEN $1"; exit 1; }
  if grep -qv '|true' <<<"$o" || [ "$(grep -c '|' <<<"$o")" -lt "$expected" ]; then echo "  killed $1"; else echo "  SURVIVED $1"; exit 1; fi
}
mutate no-daily-cap "s.replace('if started >= 20 then', 'if false then')"
mutate four-attempts "s.replace('where c.request_id = q.id) < 3', 'where c.request_id = q.id) < 4').replace('check (attempt between 1 and 3)', 'check (attempt between 1 and 4)')"
mutate answered-sent-again "s.replace('and not exists (select 1 from public.weekly_research_answers a where a.request_id = q.id)', '')"
mutate closed-edition-sent "s.replace(' and e.closed_at is null', '')"
mutate no-stale-timeout "s.replace(\"started_at < now() - interval '15 minutes'\", 'false')"
mutate record-over-pasted "s.replace('if exists (select 1 from public.weekly_research_answers x where x.request_id = c.request_id) then', 'if false then')"
mutate authenticated-may-claim "s.replace(\"execute 'grant execute on function public.hs_weekly_perplexity_status(uuid[]) to authenticated';\", \"execute 'grant execute on function public.hs_weekly_perplexity_status(uuid[]) to authenticated'; execute 'grant execute on function public.weekly_perplexity_claim(text) to authenticated';\")"
mutate reader-without-admin "s.replace('declare e text := public._hs_is_admin();\nbegin\n  return jsonb_build_object(', 'begin\n  return jsonb_build_object(')"
echo "all passed"
