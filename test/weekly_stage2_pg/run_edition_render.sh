#!/usr/bin/env bash
# docs/weekly-10-edition-render.sql (the private review render) against a DISPOSABLE Postgres (never production):
# files 1-10 applied twice, TEST DATA seeded through the real functions (build_edition_sequence_state.py),
# edition_render.sql run, then each mutation of file 10 must make at least one check fail. A check that does not
# print, or an SQL error, is a failure. A mutation that does not apply is BROKEN, never counted as caught.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
WEEKLY_WITH_VIDEO=1 . "$here/config.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
expected=$(grep -cE "^select 'R[0-9]+[a-z]?\|" "$here/edition_render.sql")
f10="$WEEKLY_DOCS/weekly-10-edition-render.sql"
run_once() {   # $1: file 10 text to use
  weekly_combine "$tmp/full.sql" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"; cat "$1" >> "$tmp/full.sql"
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$tmp/full.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  python3 "$here/build_edition_sequence_state.py"
  psql -X -q -tA -f "$here/edition_render.sql" 2>"$tmp/suite.err" | grep -E '^R[0-9]+[a-z]?\|' || true
}
out="$(run_once "$f10")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
echo "SHIPPED: $n of $expected checks printed, $f not true"
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error"; exit 1; fi
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { echo FAIL; exit 1; }

MUT=(
 "non-admin-allowed|s.replace(\"declare e text := public._hs_is_admin(); ed public.weekly_editions; v jsonb;\",\"declare e text := 'x'; ed public.weekly_editions; v jsonb;\",1)"
 "unapproved-allowed|s.replace(\"  if not coalesce((v ->> 'approved')::boolean, false) then\n    raise exception 'the edition''s sequence is not approved\",\"  if false then\n    raise exception 'the edition''s sequence is not approved\",1)"
 "digest-unchecked|s.replace(\"  if p_digest is distinct from v ->> 'digest' then\",\"  if false then\",1)"
 "published-allowed|s.replace(\"  if ed.video_url is not null then raise exception 'edition % is published; its video is final', ed.edition_key using errcode = '55000'; end if;\n  v := \",\"  v := \",1)"
 "second-active-render|s.replace(\"  if r.id is not null then return public.weekly_edition_render_json(r.id) || jsonb_build_object('existing', true); end if;\n  select * into r from public.weekly_edition_renders where edition_id = p_edition and status = 'done'\",\"  select * into r from public.weekly_edition_renders where edition_id = p_edition and status = 'done'\",1)"
 "rerender-done|s.replace(\"status = 'done' and digest = v ->> 'digest'\",\"status = 'done' and false\",1)"
 "dispatch-any-ref|s.replace(\"jsonb_build_object('ref', 'main', 'inputs'\",\"jsonb_build_object('ref', 'claude/x', 'inputs'\",1)"
 "no-pat-reported-ok|s.replace(\"  if not sent then\n\",\"  if false then\n\",1)"
 "claim-no-recheck|s.replace(\"  if why is not null then\n    update public.weekly_edition_renders set status = 'failed'\",\"  if false then\n    update public.weekly_edition_renders set status = 'failed'\",1)"
 "claim-ignores-published|s.replace(\"case when (select video_url from public.weekly_editions where id = r.edition_id) is not null then 'the edition is published'\",\"case when false then 'the edition is published'\",1)"
 "claim-twice|s.replace(\"where id = p_render and status = 'queued' returning * into r;\",\"where id = p_render and status in ('queued', 'running') returning * into r;\",1)"
 "finish-no-thumbnail|s.replace(\"array['video', 'captions', 'thumbnail'] loop\",\"array['video', 'captions'] loop\",1)"
 "finish-any-path|s.replace(\"    if left(coalesce(f ->> 'path', ''), length(pre)) <> pre or f ->> 'path' like '%..%' then\",\"    if false then\",1)"
 "finish-no-storage-check|s.replace(\"      if sz is null then probs\",\"      if false then probs\",1)"
 "finish-size-unchecked|s.replace(\"      elsif sz <> (f ->> 'bytes')::bigint then\",\"      elsif false then\",1)"
 "current-ignores-digest|s.replace(\"and v ->> 'digest' = r.digest)\",\")\",1)"
 "guard-identity|s.replace(\"  if (new.id, new.edition_id, new.sequence_id, new.approval_id, new.digest, new.requested_by, new.requested_at)\",\"  if false and (new.id, new.edition_id, new.sequence_id, new.approval_id, new.digest, new.requested_by, new.requested_at)\",1)"
 "guard-delete|s.replace(\"  if tg_op = 'DELETE' then raise exception\",\"  if false then raise exception\",1)"
 "guard-final|s.replace(\"  if old.status in ('done', 'failed') then raise exception\",\"  if false then raise exception\",1)"
 "guard-transition|s.replace(\"  if new.status is distinct from old.status and not (\",\"  if false and not (\",1)"
 "bucket-public|s.replace(\"values ('weekly-media', 'weekly-media', false,\",\"values ('weekly-media', 'weekly-media', true,\",1).replace(\"do update set public = false,\",\"do update set public = true,\",1)"
 "bucket-read-any|s.replace(\"using (bucket_id = 'weekly-media' and public.hs_is_dashboard_admin())\",\"using (bucket_id = 'weekly-media')\",1)"
 "table-readable|s.replace(\"  execute 'revoke all on public.weekly_edition_renders from public, anon, authenticated';\",\"  execute 'grant select on public.weekly_edition_renders to authenticated';\",1)"
 "claim-callable|s.replace(\"  foreach f in array array['weekly_edition_render_claim(uuid)', 'weekly_edition_render_finish(uuid,jsonb,jsonb)'\",\"  execute 'grant execute on function public.weekly_edition_render_claim(uuid) to authenticated';\n  foreach f in array array['weekly_edition_render_claim(uuid)', 'weekly_edition_render_finish(uuid,jsonb,jsonb)'\",1)"
 "version-claim-other-library|s.replace(\"join public.weekly_library_version_findings x3 on x3.finding_id = s3.finding_id and x3.library_version_id = tv.library_version_id\",\"join public.weekly_library_version_findings x3 on x3.finding_id = s3.finding_id\",1)"
)
bad=0
for m in "${MUT[@]}"; do
  name="${m%%|*}"; expr="${m#*|}"
  if ! python3 - "$f10" "$tmp/m.sql" "$expr" <<'PY'
import sys
s = open(sys.argv[1]).read(); t = eval(sys.argv[3], {"s": s})
if t == s: sys.exit(1)
open(sys.argv[2], "w").write(t)
PY
  then echo "  BROKEN (the mutation text was not found, so nothing was tested): $name"; bad=1; continue; fi
  set +e; o="$(run_once "$tmp/m.sql" 2>/dev/null)"; rc=$?; set -e
  k=$(grep -c '|' <<<"$o" || true); nt=$(grep -vc '|true$' <<<"$o" || true)
  if [ $rc -eq 2 ]; then echo "  BROKEN (did not apply, so nothing was tested): $name"; bad=1; continue; fi
  if [ "$k" -eq "$expected" ] && [ "$nt" -eq 0 ]; then echo "  SURVIVED: $name"; bad=1
  else echo "  caught: $name ($(grep -v '|true$' <<<"$o" | cut -d'|' -f1 | tr '\n' ' ')$([ "$k" -lt "$expected" ] && echo "; $((expected-k)) not printed"))"; fi
done
[ "$bad" -eq 0 ] && echo "all ${#MUT[@]} mutations caught" || { echo "FAIL: a mutation survived or did not apply"; exit 1; }
