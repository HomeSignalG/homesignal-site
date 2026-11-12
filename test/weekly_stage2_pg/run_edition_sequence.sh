#!/usr/bin/env bash
# docs/weekly-8-edition-sequence.sql against a DISPOSABLE Postgres (never production): files 1-8 applied twice, TEST DATA
# seeded through the real functions (build_edition_sequence_state.py), edition_sequence.sql run, then each mutation of
# file 8 must make at least one check fail. A check that does not print, or an SQL error, is a failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
expected=$(grep -cE "^select 'Q[0-9]+[a-z]?\|" "$here/edition_sequence.sql")
run_once() {   # $1: file 8 text to use
  weekly_combine "$tmp/full.sql" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"; cat "$1" >> "$tmp/full.sql"
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  python3 "$here/build_edition_sequence_state.py"
  psql -X -q -tA -f "$here/edition_sequence.sql" 2>"$tmp/suite.err" | grep -E '^Q[0-9]+[a-z]?\|' || true
}
out="$(run_once "$WEEKLY_DOCS/weekly-8-edition-sequence.sql")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
echo "SHIPPED: $n of $expected checks printed, $f not true"
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error"; exit 1; fi
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { echo FAIL; exit 1; }

src="$WEEKLY_DOCS/weekly-8-edition-sequence.sql"
MUT=(
 "overlap-allowed|s.replace(\"if k = any (used) then\",\"if false then\",1)"
 "not-current-allowed|s.replace(\"if not coalesce((st ->> 'current')::boolean, false) then\",\"if false then\",1)"
 "range-unchecked|s.replace(\"if f < 0 or t < f or t >= n then\",\"if false then\",1)"
 "extra-keys-allowed|s.replace(\"(select count(*) from jsonb_object_keys(e)) <> 3\",\"false\",1)"
 "cue-unchecked|s.replace(\"if not coalesce((vc ->> 'ok')::boolean, false) then\",\"if false then\",1)"
 "topic-from-story-label|s.replace(\"select x.n, x.e, v.topic, v.topic is distinct from lag(v.topic) over (order by x.n) as card,\",\"select x.n, x.e, v.body->'segments'->((x.e->>'from')::int)->>'story' as topic, (v.body->'segments'->((x.e->>'from')::int)->>'story') is distinct from lag(v.body->'segments'->((x.e->>'from')::int)->>'story') over (order by x.n) as card,\",1)"
 "card-every-entry|s.replace(\"v.topic is distinct from lag(v.topic) over (order by x.n) as card\",\"true as card\",1)"
 "topics-not-deduplicated|s.replace(\"select coalesce(jsonb_agg(t order by first_n), '[]'::jsonb) into topics\n    from (select i ->> 'topic' t, min((i ->> 'n')::integer) first_n from jsonb_array_elements(items) i\n          where i ->> 'topic' is not null group by i ->> 'topic') q;\",\"select coalesce(jsonb_agg(i -> 'topic' order by (i ->> 'n')::integer), '[]'::jsonb) into topics from jsonb_array_elements(items) i;\",1)"
 "approval-any-sequence|s.replace(\"approved := a.id is not null and a.sequence_id = s.id and a.digest = dg and cardinality(probs) = 0;\",\"approved := a.id is not null and cardinality(probs) = 0;\",1)"
 "approval-ignores-digest|s.replace(\"a.sequence_id = s.id and a.digest = dg and cardinality\",\"a.sequence_id = s.id and cardinality\",1)"
 "approve-trusts-page|s.replace(\"if p_digest is distinct from dg then\",\"if false then\",1)"
 "digest-ignores-body|s.replace(\", 'body_sha256', public.weekly_sha256(v.body::text))\",\")\",1)"
 "digest-ignores-series|s.replace(\"'series', ed.series, 'edition_key'\",\"'edition_key'\",1)"
)
bad=0
for m in "${MUT[@]}"; do
  name="${m%%|*}"; expr="${m#*|}"
  python3 - "$src" "$tmp/m8.sql" "$expr" <<'PY'
import sys
s = open(sys.argv[1]).read(); t = eval(sys.argv[3], {"s": s})
if t == s: sys.exit("mutation did not apply")
open(sys.argv[2], "w").write(t)
PY
  o="$(run_once "$tmp/m8.sql" 2>/dev/null || true)"
  k=$(grep -c '|' <<<"$o" || true); nt=$(grep -vc '|true$' <<<"$o" || true)
  if [ "$k" -eq "$expected" ] && [ "$nt" -eq 0 ]; then echo "  SURVIVED: $name"; bad=1
  else echo "  killed: $name ($(grep -v '|true$' <<<"$o" | cut -d'|' -f1 | tr '\n' ' ')$([ "$k" -lt "$expected" ] && echo "; $((expected-k)) not printed"))"; fi
done
[ "$bad" -eq 0 ] && echo "all mutations killed" || { echo "FAIL: a mutation survived"; exit 1; }
