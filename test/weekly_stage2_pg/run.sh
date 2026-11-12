#!/usr/bin/env bash
# The FULL weekly configuration (docs/weekly-1..7, in order; config.sh) against a DISPOSABLE Postgres (never production).
# Applies all seven files twice (idempotent, and an earlier file re-applied after a later one changes nothing), runs
# suite.sql, then checks that each mutation makes at least one check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
. "$here/config.sh"
SQL="$tmp/full.sql"; weekly_combine "$SQL" "$WEEKLY_DOCS" "${WEEKLY_FULL[@]}"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
run_once() {
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
        drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  psql -X -q -tA -v rls_tables="$WEEKLY_RLS_TABLES" -f "$here/suite.sql" 2>"$tmp/suite.err" | grep -E '^[A-Z][0-9]+[a-z]?\|' || true
}
out="$(run_once "$SQL")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -vc '|true$' <<<"$out" || true)
expected=$(grep -cE "^select '[A-Z][0-9]+[a-z]?\|" "$here/suite.sql")
echo "SHIPPED: $n of $expected checks printed, $f not true"
[ "$n" -eq "$expected" ] && [ "$f" -eq 0 ] || { cat "$tmp/suite.err" >&2; echo FAIL; exit 1; }
if grep -q ERROR "$tmp/suite.err"; then cat "$tmp/suite.err" >&2; echo "FAIL: the suite printed an SQL error (a check that errors is not a pass)"; exit 1; fi
# the workbench screen fixture must be what the prepared SQL produces
P -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade;
      drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
P -f "$here/fixture.sql" >/dev/null; P -f "$SQL" >/dev/null 2>&1
python3 "$here/build_demo_fixture.py" --check
MUT=(
 "findings-not-append-only|s.replace(\"  foreach t in array array['weekly_findings',\n\",\"  foreach t in array array[\n\",1)"
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
 "rubric-total-ungated|s.replace(\"  if total < 21 then probs := probs || ('total ' || total || '/28 is below 21'); end if;\n\",\"\")"
 "rubric-factual-3-ok|s.replace(\"if (p_rubric ->> 'factual_discipline')::integer <> 4 then\",\"if (p_rubric ->> 'factual_discipline')::integer < 3 then\")"
 "rubric-hook-ungated|s.replace(\"foreach k in array array['hook_conflict', 'emotional_force', 'argument_coherence'] loop\",\"foreach k in array array['emotional_force', 'argument_coherence'] loop\")"
 "approval-not-version-bound|s.replace(\"approved := exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256\n\",\"approved := exists (select 1 from public.weekly_script_approvals a join public.weekly_scripts x on x.id = a.script_id where x.stage = v.stage and x.topic = v.topic\n\")"
 "superseded-approvable|s.replace(\"  if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; review that one' using errcode = '22023'; end if;\n  if (st ->> 'outdated')\",\"  if (st ->> 'outdated')\")"
 "dependency-change-ignored|s.replace(\"    if (d ->> 'superseded')::boolean then outdated := true;\",\"    if false then outdated := true;\")"
 "selection-change-ignored|s.replace(\"if sel is distinct from v.selected_index then outdated := true;\",\"if false then outdated := true;\")"
 "material-issue-ignored|s.replace(\"               and c.decision in ('material_issue', 'quote_not_found_in_sources', 'quote_contradicted')) then\",\"               and false) then\")"
 "high-risk-no-ack|s.replace(\"if card ->> 'category' in ('false_claim', 'knowing_deception', 'improper_influence') and not coalesce(p_high_risk_ack, false) then\",\"if false then\")"
 "angle-without-evidence|s.replace(\"                                where jsonb_array_length(coalesce(a -> 'finding_ids', '[]')) = 0) then\",\"                                where false) then\")"
 "local-lesson-allowed|s.replace(\"  if c.lesson_scope <> 'reusable' then raise exception\",\"  if false then raise exception\")"
 "rewrite-overwrites-original|s.replace(\"    update public.weekly_corrections set after_text = newtext, result_script_id = sid where id = (r.input ->> 'review_id')::uuid;\",\"    update public.weekly_corrections set after_text = newtext, result_script_id = sid where id = (r.input ->> 'review_id')::uuid;\n    update public.weekly_scripts set body = p_payload -> 'body' where id = (r.input ->> 'parent_id')::uuid;\")"
 "contradiction-without-findings|s.replace(\"  constraint weekly_corrections_contradicted_ck check (decision <> 'quote_contradicted' or cardinality(finding_ids) > 0)\",\"  constraint weekly_corrections_contradicted_ck check (true)\")"
 "review-refilled|s.replace(\"  if old.decision <> 'rewrite' or old.result_script_id is not null or\",\"  if old.decision <> 'rewrite' or\")"
 "title-editorial-grants-evidence|s.replace(\"    when exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256\n                 and a.approval_kind = 'evidence') then 'cleared'\",\"    when exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256) then 'cleared'\")"
 "title-publication-without-evidence|s.replace(\"  if st ->> 'evidence_review' <> 'cleared' then raise exception 'the evidence review is not cleared' using errcode = '22023'; end if;\n\",\"\")"
 "title-check-any-text|s.replace(\"  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then\",\"  if false then\")"
 "title-approval-not-version-bound|s.replace(\"  select a.selected_index into sel from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256\n    and a.approval_kind = 'editorial' order by a.approved_at desc, a.id desc limit 1;\n  ev := case\",\"  select a.selected_index into sel from public.weekly_script_approvals a join public.weekly_scripts x on x.id = a.script_id where x.stage = 'title'\n    and a.approval_kind = 'editorial' order by a.approved_at desc, a.id desc limit 1;\n  ev := case\")"
 "title-outdated-ignored|s.replace(\"    if (st ->> 'outdated')::boolean then raise exception 'outdated: %; check the title against the new script'\",\"    if false then raise exception 'outdated: %; check the title against the new script'\")"
 "title-concerns-ignored|s.replace(\"    when exists (select 1 from public.weekly_corrections x where x.script_id = v.id and x.decision = 'material_issue') then 'concerns_open'\n\",\"\")"
 "title-profile-unscoped|s.replace(\"  if not exists (select 1 from public.weekly_editorial_profiles where id = p_profile and scope = 'title') then\",\"  if not exists (select 1 from public.weekly_editorial_profiles where id = p_profile) then\")"
 "cue-approval-ungated|s.replace(\"    if public.weekly_cue_count(v.body) > 0\\n       and coalesce((public.weekly_visual_checks(v.id) ->> 'ok')::boolean, false) is not true then\",'    if false then',1)"
 "cue-person-may-change-text|s.replace('    if public.weekly_without_visuals(new.body) is distinct from public.weekly_without_visuals(p.body)\\n       or new.library_version_id','    if false\\n       and new.library_version_id',1)"
 "cue-any-source|s.replace(\"     where w.id::text = p_cue ->> 'source_id' and f.finding_key || '@' || f.version = cid;\",\"     where w.id::text = p_cue ->> 'source_id';\",1)"
 "cue-excerpt-allowed|s.replace(\"    if src.document_path is null then\\n      raise exception 'no stored copy\",\"    if false then\\n      raise exception 'no stored copy\",1)"
 "cue-highlight-any|s.replace(\"    if p_cue ->> 'highlight' is distinct from 'yellow' then\",'    if false then',1)"
 "cue-not-cited-allowed|s.replace(\"    if not (g -> 'claim_ids') ? cid then\",'    if false then',1)"
 "visual-check-any-text|s.replace(\"  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then\\n    raise exception 'the checks were made on a different text' using errcode = '22023';\\n  end if;\\n  if coalesce(jsonb_typeof\",\"  if false then\\n    raise exception 'the checks were made on a different text' using errcode = '22023';\\n  end if;\\n  if coalesce(jsonb_typeof\",1)"
 "rewrite-cue-unchecked|s.replace(\"    perform public._wk_queue('visual_check', r.topic, jsonb_build_object('version_id', sid), r.requested_by);\\n\",'',1)"
 "document-without-grant|s.replace(\"    and (document_path is null or (copy_granted_by is not null and document_kind = copy_kind\",\"    and (document_path is null or (true and document_kind = copy_kind\",1)"
 "copy-replaceable|s.replace(\"  if old.copy_granted_by is not null and old.document_path is null and new.document_path is not null\",\"  if old.copy_granted_by is not null and new.document_path is not null\",1)"
 "grant-changeable|s.replace(\"  if old.copy_granted_by is null and new.copy_granted_by is not null and old.document_path is null\",\"  if new.copy_granted_by is not null and old.document_path is null\",1)"
 "regrant-allowed|s.replace(\"  if w.copy_granted_by is not null then raise exception 'full-copy permission is already recorded\",\"  if false then raise exception 'full-copy permission is already recorded\",1)"
 "grant-implies-stored|s.replace(\"      'state', case when w.document_path is not null then 'stored'\",\"      'state', case when w.copy_granted_by is not null then 'stored'\",1)"
 "copy-not-in-storage|s.replace(\"  if osz is null then raise exception 'the copy is not in private storage'\",\"  if false then raise exception 'the copy is not in private storage'\",1)"
 "copy-size-unchecked|s.replace(\"  if osz is distinct from sz then raise exception\",\"  if false then raise exception\",1)"
 "copy-any-path|s.replace(\"  if (p_payload ->> 'document_path') is distinct from 'weekly-sources/' || nm then\",\"  if false then\",1)"
 "copy-any-kind|s.replace(\"  if k is distinct from w.copy_kind then raise exception\",\"  if false then raise exception\",1)"
 "retry-after-stored|s.replace(\"  if st ->> 'state' = 'stored' then raise exception 'the copy is already stored; it is never fetched again'\",\"  if false then raise exception 'the copy is already stored; it is never fetched again'\",1)"
 "copy-record-not-running|s.replace(\"  select * into r from public.weekly_runs where id = p_run and kind = 'source_copy' and status = 'running';\",\"  select * into r from public.weekly_runs where id = p_run and kind = 'source_copy';\",1)"
 "storage-bucket-public|s.replace(\"  values ('weekly-sources', 'weekly-sources', false,\",\"  values ('weekly-sources', 'weekly-sources', true,\",1).replace(\"  on conflict (id) do update set public = false,\",\"  on conflict (id) do update set public = excluded.public,\",1)"
 "storage-policy-any-user|s.replace(\"             using (bucket_id in ('weekly-sources', 'weekly-visuals') and public.hs_is_dashboard_admin())\",\"             using (bucket_id in ('weekly-sources', 'weekly-visuals'))\",1)"
 "cue-no-check-queued|s.replace(\"  if public.weekly_cue_count(b) > 0 then\\n    q := public._wk_queue('visual_check'\",\"  if false then\\n    q := public._wk_queue('visual_check'\",1)"
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
