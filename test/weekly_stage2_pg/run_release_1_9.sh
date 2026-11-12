#!/usr/bin/env bash
# The combined release, files 1-9, against a DISPOSABLE Postgres (never production). Run after the existing runners have
# passed on files 1-7 unchanged, and alongside them on 1-9 (WEEKLY_WITH_VIDEO=1 run.sh / run_topic_queue.sh /
# run_queue_only.sh). This runner checks what those cannot:
#   1. the catalog delta 1-7 -> 1-9 is exactly the one release_catalog.py requires (named tables, RLS, privileges,
#      append-only triggers, the new functions' security, exactly four replaced function bodies, nothing else);
#   2. 1-9 applied twice equals 1-9 applied once;
#   3. the upgrade path: files 8 and 9 applied over a seeded 1-7 database leave every existing weekly row as it was;
#   4. the known re-apply hazard: re-applying file 2 or 7 after 9 restores their own bodies of the four functions, and
#      re-applying 9 then restores 9's (so 9 must be re-applied after any re-application of 2 or 7);
#   5. three negative controls, each of which release_catalog.py must refuse.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
unset WEEKLY_WITH_VIDEO; . "$here/config.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
weekly_combine "$tmp/r17.sql" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"
weekly_combine "$tmp/v.sql" "$WEEKLY_DOCS" "${WEEKLY_VIDEO[@]}"
cat "$tmp/r17.sql" "$tmp/v.sql" > "$tmp/r19.sql"
cat_snap() { python3 "$here/release_catalog.py" --snapshot "$1"; }

echo "== 1. catalog delta, 1-7 -> 1-9"
reset_db; P -f "$tmp/r17.sql" >/dev/null 2>&1; cat_snap "$tmp/a.json"
reset_db; P -f "$tmp/r19.sql" >/dev/null 2>&1; cat_snap "$tmp/b.json"
python3 "$here/release_catalog.py" --diff "$tmp/a.json" "$tmp/b.json"

echo "== 2. 1-9 applied twice"
P -f "$tmp/r19.sql" >/dev/null 2>&1; cat_snap "$tmp/b2.json"
cmp -s "$tmp/b.json" "$tmp/b2.json" && echo "  identical catalog after the second application" || { echo "FAIL: the second application changed the catalog"; exit 1; }

echo "== 3. upgrade over seeded rows"
reset_db; P -f "$tmp/r17.sql" >/dev/null 2>&1; python3 "$here/build_demo_fixture.py" --seed >/dev/null
rows() {
  psql -X -q -tA -c "select string_agg(format('select %L || '':'' || coalesce(md5(string_agg(to_jsonb(x)::text, '','' order by to_jsonb(x)::text collate \"C\")), ''-'') || '':'' || count(*) from public.%I x', relname, relname), ' union all ' order by relname)
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%'" > "$tmp/q.sql"
  psql -X -q -tA -f "$tmp/q.sql" | sort
}
rows > "$tmp/before.txt"
P -f "$tmp/v.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL: 8 and 9 did not apply over 1-7"; exit 1; }
rows | grep -v -E '^weekly_edition_(sequences|approvals|topic_events):' > "$tmp/after.txt"
echo "  $(wc -l < "$tmp/before.txt") existing weekly tables, $(awk -F: '{s+=$3} END {print s}' "$tmp/before.txt") rows"
diff "$tmp/before.txt" "$tmp/after.txt" >/dev/null && echo "  every existing weekly row unchanged" || { diff "$tmp/before.txt" "$tmp/after.txt"; echo "FAIL: 8 or 9 changed existing rows"; exit 1; }
[ "$(awk -F: '{s+=$3} END {print s}' "$tmp/before.txt")" -gt 0 ] || { echo "FAIL: the seed wrote nothing, so the comparison proves nothing"; exit 1; }

echo "== 4. re-apply hazard"
reset_db; P -f "$tmp/r19.sql" >/dev/null 2>&1
P -f "$WEEKLY_DOCS/weekly-2-topic-queue.sql" -f "$WEEKLY_DOCS/weekly-7-topic-queue-gate.sql" >/dev/null 2>&1; cat_snap "$tmp/c.json"
if python3 "$here/release_catalog.py" --diff "$tmp/a.json" "$tmp/c.json" >/dev/null; then echo "FAIL: re-applying 2 and 7 should restore their own bodies"; exit 1; fi
python3 - "$tmp/b.json" "$tmp/c.json" <<'PY'
import json, sys
b, c = (json.load(open(p))["functions"] for p in sys.argv[1:3])
d = sorted(k for k in b if b[k] != c.get(k))
print("  re-applying 2 and 7 after 9 changes:", d)
assert d == sorted(["_wk_lead_assign(uuid,uuid,text)", "weekly_lead_request_text(uuid,uuid,text)",
                    "hs_weekly_lead_send_to_research(uuid,uuid,text)", "hs_weekly_edition_link_version(uuid,uuid)"]), d
PY
P -f "$WEEKLY_DOCS/weekly-9-edition-topics.sql" >/dev/null 2>&1; cat_snap "$tmp/c2.json"
cmp -s "$tmp/b.json" "$tmp/c2.json" && echo "  re-applying 9 restores the 1-9 catalog exactly" || { echo "FAIL: re-applying 9 did not restore it"; exit 1; }

echo "== 5. negative controls (release_catalog.py must refuse each)"
for ctl in "grant select on public.weekly_edition_topic_events to authenticated;" \
           "drop trigger weekly_edition_approvals_append_only on public.weekly_edition_approvals;" \
           "grant execute on function public.weekly_edition_render_export(uuid) to authenticated;" \
           "comment on function public.weekly_edition_unresolved(uuid) is 'x'; create or replace function public.weekly_edition_unresolved(p_edition uuid) returns table (lead_id uuid, title text) language sql stable security definer set search_path = public as \$\$ select null::uuid, null::text where false \$\$;"; do
  reset_db; P -f "$tmp/r19.sql" >/dev/null 2>&1; P -c "$ctl" >/dev/null || { echo "FAIL: the control did not apply: $ctl"; exit 1; }; cat_snap "$tmp/n.json"
  if python3 "$here/release_catalog.py" --diff "$tmp/a.json" "$tmp/n.json" >/dev/null; then echo "  NOT REFUSED: $ctl"; exit 1; else echo "  refused: ${ctl:0:70}"; fi
done
echo PASS
