#!/usr/bin/env bash
# The publication lock of the queue-only release (docs/weekly-2a-publication-lock.sql) against a DISPOSABLE Postgres
# (never production). Applies files 1, 2 and 2a (2a twice: idempotent), runs publication_lock.sql, checks the
# re-apply hazard and that files 3-7 applied later keep the lock, then requires every mutation below to make a check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
python3 "$here/build_queue_lock_sql.py" --check
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
reset_db() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
}
LOCK=weekly-2a-publication-lock.sql
locked() { psql -X -q -tA -c "select count(*) from pg_proc where proname in ('_wk_lead_assign','hs_weekly_lead_send_to_research','hs_weekly_lead_disposition') and prosrc like '%is published;%'"; }
run_once() {   # $1 = directory holding the three files
  reset_db
  P -f "$1/weekly-1-base.sql" >/dev/null 2>"$tmp/err" && P -f "$1/weekly-2-topic-queue.sql" >/dev/null 2>>"$tmp/err" \
    && P -f "$1/$LOCK" >/dev/null 2>>"$tmp/err" && P -f "$1/$LOCK" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/publication_lock.sql" 2>"$tmp/suite.err" | grep -E '^L[0-9]+[a-z]?\|' || true
}
# the functions before and after the lock: body differs by exactly the inserted lines; everything else identical
reset_db; P -f "$WEEKLY_DOCS/weekly-1-base.sql" >/dev/null; P -f "$WEEKLY_DOCS/weekly-2-topic-queue.sql" >/dev/null
desc="select string_agg(p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_userbyid(p.proowner)
        || '|' || coalesce(p.proacl::text, 'default') || '|' || p.provolatile::text || '|' || pg_get_function_result(p.oid), E'\n' order by p.proname)
      from pg_proc p where p.proname in ('_wk_lead_assign','hs_weekly_lead_send_to_research','hs_weekly_lead_disposition')"
src="select string_agg(replace(p.prosrc, E'\n', '¶'), E'\n' order by p.proname) from pg_proc p
      where p.proname in ('_wk_lead_assign','hs_weekly_lead_send_to_research','hs_weekly_lead_disposition')"
b_desc="$(psql -X -q -tA -c "$desc")"; psql -X -q -tA -c "$src" > "$tmp/src.before"
P -f "$WEEKLY_DOCS/$LOCK" >/dev/null
a_desc="$(psql -X -q -tA -c "$desc")"; psql -X -q -tA -c "$src" > "$tmp/src.after"
[ "$b_desc" = "$a_desc" ] || { echo "FAIL: the lock changed a function's owner, privileges, security or settings"; diff <(echo "$b_desc") <(echo "$a_desc"); exit 1; }
python3 - "$tmp/src.before" "$tmp/src.after" <<'PY'
import sys
b, a = (open(f).read().splitlines() for f in sys.argv[1:])
for x, y in zip(b, a):
    xl, yl = x.split('¶'), y.split('¶')
    extra = [l for l in yl if l not in xl]
    assert len(yl) == len(xl) + 1 and len(extra) == 1 and [l for l in yl if l != extra[0]] == xl, (xl[:2], extra)
    assert "if ed.video_url is not null then raise exception 'edition % is published; " in extra[0], extra
print("  each of the 3 functions: file 2's body plus exactly one line; owner, privileges, security definer, search_path unchanged")
PY
out="$(run_once "$WEEKLY_DOCS")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select 'L[0-9]+[a-z]?\|" "$here/publication_lock.sql")
echo "PUBLICATION LOCK: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error"; exit 1; fi
# the re-apply hazard, as documented: file 2 again removes the lock; 2a again restores it
P -f "$WEEKLY_DOCS/weekly-2-topic-queue.sql" >/dev/null; [ "$(locked)" = 0 ] || { echo "FAIL: re-applying file 2 did not behave as documented"; exit 1; }
P -f "$WEEKLY_DOCS/$LOCK" >/dev/null; [ "$(locked)" = 3 ] || { echo "FAIL: re-applying 2a did not restore the lock"; exit 1; }
echo "  re-apply hazard: file 2 again removes the lock (0 of 3), 2a again restores it (3 of 3)"
# the later files 3-7 do not replace these functions: the lock survives them
for f in weekly-3-workbench.sql weekly-4-source-copy.sql weekly-5-titles.sql weekly-6-doc-cues.sql weekly-7-topic-queue-gate.sql; do P -f "$WEEKLY_DOCS/$f" >/dev/null 2>&1; done
[ "$(locked)" = 3 ] || { echo "FAIL: files 3-7 removed the lock"; exit 1; }
echo "  files 3-7 applied afterwards: the lock is still on all 3 functions"
# MUTATIONS of the committed lock file. Each must apply (else BROKEN) and make at least one check fail.
mut() { python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2].encode().decode('unicode_escape'), sys.argv[3].encode().decode('unicode_escape')
s = open(p).read()
if old not in s: sys.exit(3)
open(p, 'w').write(s.replace(old, new, 1))
PY
}
L="  if ed.video_url is not null then raise exception 'edition % is published; "
M=(
 "assign-unlocked|${L}its topics are final', ed.edition_key using errcode = '55000'; end if;\n|"
 "disposition-unlocked|${L}its decisions stand', ed.edition_key using errcode = '55000'; end if;\n|"
 "lock-wrong-code|errcode = '55000'; end if;\n  if l.topic|errcode = '22023'; end if;\n  if l.topic"
 "lock-before-closed|  if ed.closed_at is not null then raise exception 'edition % is closed; its decisions stand', ed.edition_key using errcode = '55000'; end if;\n${L}its decisions stand', ed.edition_key using errcode = '55000'; end if;\n|${L}its decisions stand', ed.edition_key using errcode = '55000'; end if;\n  if ed.closed_at is not null then raise exception 'edition % is closed; its decisions stand', ed.edition_key using errcode = '55000'; end if;\n"
 "lock-on-closed-column|if ed.video_url is not null then raise exception 'edition % is published; its decisions stand'|if ed.closed_at is not null and ed.video_url is not null then raise exception 'edition % is published; its decisions stand'"
 "grant-dropped|    execute format('grant execute on function public.%s to authenticated', f);|    null;"
 "grant-to-anon|    execute format('grant execute on function public.%s to authenticated', f);|    execute format('grant execute on function public.%s to authenticated, anon', f);"
 "definer-dropped|create or replace function public.hs_weekly_lead_disposition(p_lead uuid, p_edition uuid, p_disposition text, p_reason text default null) returns jsonb\nlanguage plpgsql security definer|create or replace function public.hs_weekly_lead_disposition(p_lead uuid, p_edition uuid, p_disposition text, p_reason text default null) returns jsonb\nlanguage plpgsql security invoker"
)
bad=0
for m in "${M[@]}"; do
  IFS='|' read -r name old new <<<"$m"
  rm -rf "$tmp/m"; cp -r "$WEEKLY_DOCS" "$tmp/m"
  set +e; mut "$tmp/m/$LOCK" "$old" "$new"; mrc=$?; set -e
  if [ $mrc -ne 0 ]; then echo "  BROKEN (did not apply): $name"; bad=1; continue; fi
  set +e; mo="$(run_once "$tmp/m" 2>/dev/null)"; rc=$?; set -e
  if [ $rc -ne 0 ] || grep -vq '|true$' <<<"$mo" || [ "$(grep -c '|' <<<"$mo")" -lt "$n" ]; then echo "  caught: $name"; else echo "  SURVIVED: $name"; bad=1; fi
done
# the send-to-research lock alone (the assignment lock would otherwise answer first for a new lead; L03 needs this one)
rm -rf "$tmp/m"; cp -r "$WEEKLY_DOCS" "$tmp/m"
python3 - "$tmp/m/$LOCK" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
i = s.index("create or replace function public.hs_weekly_lead_send_to_research(")
line = "  if ed.video_url is not null then raise exception 'edition % is published; its topics are final', ed.edition_key using errcode = '55000'; end if;\n"
j = s.index(line, i); open(p, 'w').write(s[:j] + s[j + len(line):])
PY
set +e; mo="$(run_once "$tmp/m" 2>/dev/null)"; rc=$?; set -e
if [ $rc -ne 0 ] || grep -vq '|true$' <<<"$mo"; then echo "  caught: send-to-research-unlocked"; else echo "  SURVIVED: send-to-research-unlocked"; bad=1; fi
[ $bad -eq 0 ] || { echo FAIL; exit 1; }
echo PASS
