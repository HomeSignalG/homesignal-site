#!/usr/bin/env bash
# docs/weekly-bluesky-sources.sql against a DISPOSABLE Postgres (never production): files 1, 2, 2a, then this file twice
# (idempotent), then suite.sql. Then each mutation below must make at least one check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/../weekly_stage2_pg/config.sh"
FILE=weekly-bluesky-sources.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
run_once() {   # $1 = the bluesky-sources file to apply
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/../weekly_stage2_pg/fixture.sql" >/dev/null 2>&1
  for f in "${WEEKLY_QUEUE_ONLY[@]}"; do P -f "$WEEKLY_DOCS/$f" >/dev/null 2>&1; done
  # the topics as Tab 20 has them: "data centers" with no report category (as in production), and test topics
  P >/dev/null 2>&1 <<'SQL'
set test.jwt = '{"email":"founder@test.invalid"}';
select public.hs_weekly_lead_save(null, '{"title":"data centers"}');
select public.hs_weekly_lead_save(null, '{"title":"Air Quality","topic":"Air Quality"}');
select public.hs_weekly_lead_save(null, '{"title":"Noise"}');
select public.hs_weekly_lead_save(null, '{"title":"noise"}');
SQL
  P -f "$1" >/dev/null 2>"$tmp/err" && P -f "$1" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/suite.sql" 2>"$tmp/suite.err" | grep -E '^B[0-9]+\|' || true
}
out="$(run_once "$WEEKLY_DOCS/$FILE")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select 'B[0-9]+\|" "$here/suite.sql")
echo "BLUESKY SOURCES: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }

# MUTATIONS: each must still apply and make at least one check fail.
mutate() {   # name, python replacement (old, new)
  python3 - "$WEEKLY_DOCS/$FILE" "$tmp/m.sql" "$2" "$3" <<'PY'
import sys
src, out, old, new = sys.argv[1:]
t = open(src).read()
assert t.count(old) >= 1, "mutation anchor not found: " + old
open(out, "w").write(t.replace(old, new, 1))
PY
  m="$(run_once "$tmp/m.sql" || echo 'BROKEN|apply')"
  if grep -q 'BROKEN' <<<"$m"; then echo "  mutation $1: BROKEN (did not apply)"; exit 1; fi
  if [ "$(grep -c '|' <<<"$m")" -eq "$expected" ] && ! grep -vq '|true$' <<<"$m"; then echo "  mutation $1: SURVIVED"; exit 1; fi
  echo "  mutation $1: killed"
}
mutate no-word-boundary "and (char_length(k) = char_length(key) or substr(k, char_length(key) + 1, 1) !~ '[[:alnum:]]')" ""
mutate ambiguous-picks-one "if n = 1 then lead_id" "if n >= 1 then lead_id"
mutate merge-drops-old "union all select x, 1 from jsonb_array_elements(coalesce(p_old -> 'thread'" "union all select x, 1 from jsonb_array_elements(coalesce(null::jsonb"
mutate no-lease-check "perform public._wk_bsky_lease(p_owner);
  select account_did into acct" "select account_did into acct"
mutate published-reads-newest "(p_as_of is null or x.created_at <= p_as_of)" "true"
mutate checkpoint-moves-back "greatest(coalesce(high_water_at, p_high_water), p_high_water)" "p_high_water"
mutate any-account "if p_post ->> 'author_did' is distinct from acct or" "if false and"
mutate prefix-anywhere "select case when t ~* E'^" "select case when t ~* E'"
echo "BLUESKY SOURCES: all mutations killed"
