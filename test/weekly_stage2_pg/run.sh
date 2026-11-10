#!/usr/bin/env bash
# docs/weekly-stage2-slice.sql against a DISPOSABLE Postgres (never production). Applies the file twice
# (idempotent), runs suite.sql, then checks that each mutation makes at least one check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
SQL="$root/docs/weekly-stage2-slice.sql"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
run_once() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -f "$here/suite.sql" 2>"$tmp/suite.err" | grep -E '^W[0-9]' || true
}
out="$(run_once "$SQL")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -c "^select 'W" "$here/suite.sql")
echo "SHIPPED: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error (a check that errors is not a pass)"; exit 1; fi
MUT=(
 "findings-not-append-only|s.replace(\"'weekly_research_answers', 'weekly_sources', 'weekly_findings',\n\",\"'weekly_research_answers', 'weekly_sources',\n\",1)"
 "quote-match-approves|s.replace(\"limit 1), 'pending') as human_decision\",\"limit 1), (select case when bool_or(w.quote_match = 'exact') then 'approved' end from public.weekly_finding_sources fs join public.weekly_sources w on w.id = fs.source_id where fs.finding_id = f.id), 'pending') as human_decision\",1)"
 "seal-takes-pending|s.replace(\"s.is_latest and s.human_decision = 'approved'\",\"s.is_latest and s.human_decision <> 'rejected'\")"
 "sealed-version-open|s.replace(\"    raise exception 'library version is sealed' using errcode = '55000';\",\"    null;\")"
 "export-ignores-permission|s.replace(\"case when w.export_permission = 'include'\",\"case when true\")"
 "extra-usage-default-on|s.replace(\"extra_usage_enabled boolean not null default false\",\"extra_usage_enabled boolean not null default true\")"
 "lessons-not-checked|s.replace(\"  if not included <@ retrieved then raise exception 'a lesson was included that was not retrieved' using errcode = '22023'; end if;\n\",\"\")"
 "anon-can-read|s.replace(\"execute format('revoke all on public.%I from public, anon, authenticated', t);\",\"execute format('grant select on public.%I to anon', t);\")"
 "unknown-date-filled|s.replace(\"or (date_extraction in ('not_stated', 'unknown') and published_date is null)\",\"or (date_extraction in ('not_stated', 'unknown'))\")"
 "review-twice|s.replace(\"if old.reviewer_decision <> 'pending' or new.reviewer_decision\",\"if new.reviewer_decision\")"
 "no-profile-gate|s.replace(\"if not exists (select 1 from public.weekly_profile_approvals where profile_id = p_profile) then\n    raise exception 'editorial profile is not approved'\",\"if false then\n    raise exception 'editorial profile is not approved'\")"
 "dispatch-branch-ref|s.replace(\"'ref', 'main'\",\"'ref', 'claude/x'\")"
 "short-quote-cleared|s.replace(\"publication_permission text not null default 'to_confirm'\",\"publication_permission text not null default 'cleared'\")"
 "plan-cost-amount|s.replace(\"constraint weekly_cost_plan_ck check (cost_type <> 'no_incremental_api_charge' or amount_usd is null)\",\"constraint weekly_cost_plan_ck check (true)\")"
)
bad=0
for m in "${MUT[@]}"; do
  name="${m%%|*}"; expr="${m#*|}"
  python3 -c "import sys;s=open(sys.argv[1]).read();t=$expr;assert t!=s,'mutation did not apply: '+sys.argv[3];open(sys.argv[2],'w').write(t)" "$SQL" "$tmp/m.sql" "$name"
  set +e; mo="$(run_once "$tmp/m.sql")"; rc=$?; set -e
  if [ $rc -ne 0 ] || grep -vq '|true$' <<<"$mo" || [ "$(grep -c '|' <<<"$mo")" -lt "$n" ]; then echo "  killed: $name"; else echo "  SURVIVED: $name"; bad=1; fi
done
[ $bad -eq 0 ] || { echo FAIL; exit 1; }
echo "PASS"
