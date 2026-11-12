#!/usr/bin/env bash
# docs/weekly-8-edition-sequence.sql and docs/weekly-9-edition-topics.sql against a DISPOSABLE Postgres (never
# production): files 1-9 applied twice, TEST DATA seeded through the real functions (build_edition_sequence_state.py),
# edition_sequence.sql run, then each mutation of file 8 or 9 must make at least one check fail. A check that does not
# print, or an SQL error, is a failure. File 9 must also match its generator (build_edition_topics_sql.py --check).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
python3 "$here/build_edition_topics_sql.py" --check
expected=$(grep -cE "^select 'Q[0-9]+[a-z]?\|" "$here/edition_sequence.sql")
run_once() {   # $1: file 8 text to use, $2: file 9 text to use
  weekly_combine "$tmp/full.sql" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"; cat "$1" "$2" >> "$tmp/full.sql"
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  python3 "$here/build_edition_sequence_state.py"
  psql -X -q -tA -f "$here/edition_sequence.sql" 2>"$tmp/suite.err" | grep -E '^Q[0-9]+[a-z]?\|' || true
}
f8="$WEEKLY_DOCS/weekly-8-edition-sequence.sql"; f9="$WEEKLY_DOCS/weekly-9-edition-topics.sql"
out="$(run_once "$f8" "$f9")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
echo "SHIPPED: $n of $expected checks printed, $f not true"
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error"; exit 1; fi
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { echo FAIL; exit 1; }

MUT=(
 "8|overlap-allowed|s.replace(\"if k = any (used) then\",\"if false then\",1)"
 "8|not-current-allowed|s.replace(\"if not coalesce((st ->> 'current')::boolean, false) then\",\"if false then\",1)"
 "8|range-unchecked|s.replace(\"if f < 0 or t < f or t >= n then\",\"if false then\",1)"
 "8|extra-keys-allowed|s.replace(\"(select count(*) from jsonb_object_keys(e)) <> 3\",\"false\",1)"
 "8|cue-unchecked|s.replace(\"if not coalesce((vc ->> 'ok')::boolean, false) then\",\"if false then\",1)"
 "8|topic-from-story-label|s.replace(\"select x.n, x.e, v.topic, v.topic is distinct from lag(v.topic) over (order by x.n) as card,\",\"select x.n, x.e, v.body->'segments'->((x.e->>'from')::int)->>'story' as topic, (v.body->'segments'->((x.e->>'from')::int)->>'story') is distinct from lag(v.body->'segments'->((x.e->>'from')::int)->>'story') over (order by x.n) as card,\",1)"
 "8|card-every-entry|s.replace(\"v.topic is distinct from lag(v.topic) over (order by x.n) as card\",\"true as card\",1)"
 "8|topics-not-deduplicated|s.replace(\"select coalesce(jsonb_agg(t order by first_n), '[]'::jsonb) into topics\n    from (select i ->> 'topic' t, min((i ->> 'n')::integer) first_n from jsonb_array_elements(items) i\n          where i ->> 'topic' is not null group by i ->> 'topic') q;\",\"select coalesce(jsonb_agg(i -> 'topic' order by (i ->> 'n')::integer), '[]'::jsonb) into topics from jsonb_array_elements(items) i;\",1)"
 "8|approval-any-sequence|s.replace(\"approved := a.id is not null and a.sequence_id = s.id and a.digest = dg and cardinality(probs) = 0;\",\"approved := a.id is not null and cardinality(probs) = 0;\",1)"
 "8|approval-ignores-digest|s.replace(\"a.sequence_id = s.id and a.digest = dg and cardinality\",\"a.sequence_id = s.id and cardinality\",1)"
 "8|approve-trusts-page|s.replace(\"if p_digest is distinct from dg then\",\"if false then\",1)"
 "8|digest-ignores-body|s.replace(\", 'body_sha256', public.weekly_sha256(v.body::text))\",\")\",1)"
 "8|digest-ignores-series|s.replace(\"'series', ed.series, 'edition_key'\",\"'edition_key'\",1)"
 "8|unlinked-allowed|s.replace(\"    if linked is null then\n      probs := probs || ('entry ' || i || ': that version is not linked to this edition; link it first');\n    elsif linked <> s.edition_id then\",\"    if linked is not null and linked <> s.edition_id then\",1)"
 "8|other-edition-allowed|s.replace(\"    elsif linked <> s.edition_id then\n      probs\",\"    elsif false then\n      probs\",1)"
 "8|undisposed-leads-allowed|s.replace(\"  if n > 0 then\n    probs := probs || (n || ' lead(s)\",\"  if false then\n    probs := probs || (n || ' lead(s)\",1)"
 "9|lead-any-topic|s.replace(\"  if l.topic is not null and not (l.topic = any (public.weekly_edition_topics(ed.id))) then\",\"  if false then\",1)"
 "9|link-any-topic|s.replace(\"  if not (v.topic = any (public.weekly_edition_topics(ed.id))) then raise\",\"  if false then raise\",1)"
 "9|request-under-edition-topic|s.replace(\"values (coalesce((select topic from public.weekly_topic_leads where id = p_lead), ed.topic), txt, e)\",\"values (ed.topic, txt, e)\",1)"
 "9|request-text-edition-topic|s.replace(\"' (' || coalesce(l.topic, ed.topic) || '), edition '\",\"' (' || ed.topic || '), edition '\",1)"
 "9|add-topic-any-category|s.replace(\"  if t is null or not exists (select 1 from public.alert_topic_catalog c where c.stream = 'news' and c.topic = t) then\",\"  if t is null then\",1)"
 "9|add-topic-no-admin|s.replace(\"declare e text := public._hs_is_admin(); ed public.weekly_editions; t text\",\"declare e text := 'x'; ed public.weekly_editions; t text\",1)"
 "9|topic-events-not-append-only|s.replace(\"  execute 'create trigger weekly_edition_topic_events_append_only\",\"  -- execute 'create trigger weekly_edition_topic_events_append_only\",1)"
 "9|topic-events-readable|s.replace(\"  execute 'revoke all on public.weekly_edition_topic_events from public, anon, authenticated';\",\"  execute 'grant select on public.weekly_edition_topic_events to authenticated';\",1)"
)
bad=0
for m in "${MUT[@]}"; do
  which="${m%%|*}"; rest="${m#*|}"; name="${rest%%|*}"; expr="${rest#*|}"
  src="$f8"; [ "$which" = 9 ] && src="$f9"
  python3 - "$src" "$tmp/m.sql" "$expr" <<'PY'
import sys
s = open(sys.argv[1]).read(); t = eval(sys.argv[3], {"s": s})
if t == s: sys.exit("mutation did not apply")
open(sys.argv[2], "w").write(t)
PY
  if [ "$which" = 8 ]; then o="$(run_once "$tmp/m.sql" "$f9" 2>/dev/null || true)"; else o="$(run_once "$f8" "$tmp/m.sql" 2>/dev/null || true)"; fi
  k=$(grep -c '|' <<<"$o" || true); nt=$(grep -vc '|true$' <<<"$o" || true)
  if [ "$k" -eq "$expected" ] && [ "$nt" -eq 0 ]; then echo "  SURVIVED: $which/$name"; bad=1
  else echo "  killed: $which/$name ($(grep -v '|true$' <<<"$o" | cut -d'|' -f1 | tr '\n' ' ')$([ "$k" -lt "$expected" ] && echo "; $((expected-k)) not printed"))"; fi
done
[ "$bad" -eq 0 ] && echo "all ${#MUT[@]} mutations killed" || { echo "FAIL: a mutation survived"; exit 1; }
