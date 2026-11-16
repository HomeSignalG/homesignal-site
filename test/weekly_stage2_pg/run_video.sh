#!/usr/bin/env bash
# docs/weekly-video.sql against a DISPOSABLE Postgres (never production). Applies files 1, 2, 2a and the video file
# (twice: idempotent), runs video.sql, then requires each mutation below to make a check fail.
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
F=weekly-video.sql
run_once() {   # $1 = the video file to apply
  reset_db
  for f in "${WEEKLY_QUEUE_ONLY[@]}"; do P -f "$WEEKLY_DOCS/$f" >/dev/null; done
  P -f "$1" >/dev/null 2>"$tmp/err" && P -f "$1" >/dev/null 2>>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/video.sql" 2>"$tmp/suite.err" | grep -E '^V[0-9]+\|' || true
}
out="$(run_once "$WEEKLY_DOCS/$F")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -c '|false' <<<"$out" || true)
expected=$(grep -cE "^select 'V[0-9]+\|" "$here/video.sql")
echo "VIDEO: $n of $expected checks printed, $f false"
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
mutate two-jobs-at-once "s.replace(\"  if found then return jsonb_build_object('job_id', j.id, 'status', j.status, 'existing', true); end if;\n\", '')"
mutate any-folder "s.replace(\"if left(a ->> 'path', length(pre)) <> pre then\", 'if false then')"
mutate no-admin-request "s.replace(\"returns jsonb language plpgsql security definer set search_path = public as \$\$\ndeclare e text := public._hs_is_admin(); ed public.weekly_editions%rowtype;\", \"returns jsonb language plpgsql security definer set search_path = public as \$\$\ndeclare e text := 'x'; ed public.weekly_editions%rowtype;\")"
mutate browser-may-claim "s.replace('grant execute on function public.weekly_video_job_claim(uuid) to service_role;', 'grant execute on function public.weekly_video_job_claim(uuid) to service_role, authenticated;')"
mutate published-remade "s.replace('if ed.closed_at is not null or ed.video_url is not null then', 'if false then')"
mutate decisions-editable "s.replace('for each row execute function public._wk_video_decisions_append_only();', 'for each row when (false) execute function public._wk_video_decisions_append_only();')"
mutate changes-without-note "s.replace(\"if p_decision = 'changes' and btrim(coalesce(p_note, '')) = '' then\", 'if false then').replace(\"check (decision = 'approved' or char_length(btrim(coalesce(note, ''))) > 0)\", 'check (true)')"
echo "all passed"
