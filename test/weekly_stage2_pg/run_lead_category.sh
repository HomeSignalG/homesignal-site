#!/usr/bin/env bash
# docs/weekly-2b-lead-category.sql against a DISPOSABLE Postgres (never production). Applies files 1, 2, 2a and 2b (2b
# twice: idempotent), runs lead_category.sql, then requires each mutation below to make a check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
python3 "$here/build_lead_category_sql.py" --check
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
CAT=weekly-2b-lead-category.sql
run_once() {   # $1 = the 2b file to apply
  reset_db
  for f in weekly-1-base.sql weekly-2-topic-queue.sql weekly-2a-publication-lock.sql; do P -f "$WEEKLY_DOCS/$f" >/dev/null; done
  P -f "$1" >/dev/null 2>"$tmp/err" && P -f "$1" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/lead_category.sql" 2>"$tmp/suite.err" | grep -E '^C[0-9]+\|' || true
}
# owner, privileges, security and settings unchanged by 2b
reset_db; for f in weekly-1-base.sql weekly-2-topic-queue.sql weekly-2a-publication-lock.sql; do P -f "$WEEKLY_DOCS/$f" >/dev/null; done
desc="select p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') from pg_proc p where p.proname = 'hs_weekly_lead_save'"
b="$(psql -X -q -tA -c "$desc")"; P -f "$WEEKLY_DOCS/$CAT" >/dev/null; a="$(psql -X -q -tA -c "$desc")"
[ "$b" = "$a" ] || { echo "FAIL: 2b changed hs_weekly_lead_save's owner, privileges, security or settings"; exit 1; }
out="$(run_once "$WEEKLY_DOCS/$CAT")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -c '|false' <<<"$out" || true)
expected=$(grep -cE "^select 'C[0-9]+\|" "$here/lead_category.sql")
echo "LEAD CATEGORY: $n of $expected checks printed, $f false"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
# MUTATIONS: each must apply and make at least one check fail
mutate() {   # $1 name, $2 python expression transforming s
  python3 - "$WEEKLY_DOCS/$CAT" "$tmp/m.sql" "$2" <<'PY'
import sys
s = open(sys.argv[1]).read(); t = eval(sys.argv[3])
assert t != s, "mutation changed nothing"
open(sys.argv[2], "w").write(t)
PY
  local o; o="$(run_once "$tmp/m.sql")" || { echo "  BROKEN $1"; exit 1; }
  if grep -qv '|true' <<<"$o" || [ "$(grep -c '|' <<<"$o")" -lt "$expected" ]; then echo "  killed $1"; else echo "  SURVIVED $1"; exit 1; fi
}
mutate no-null-check "s.replace(\"  if l.topic is null then raise exception 'a topic needs its Local News category' using errcode = '22023'; end if;\n\", '')"
mutate no-move-check "s.replace(\"l.topic is distinct from was_topic and exists\", \"false and exists\")"
mutate move-check-ignores-included "s.replace(\"x.disposition is null or x.disposition = 'included'\", \"x.disposition is null\")"
mutate move-check-blocks-deferred "s.replace(\"x.disposition is null or x.disposition = 'included'\", \"true\")"
mutate was-topic-not-recorded "s.replace(\"    was_topic := l.topic;\n\", '')"
echo "all passed"
