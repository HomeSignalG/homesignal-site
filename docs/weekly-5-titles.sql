-- Tab 20 · Weekly Report, 5 of 7: TITLES. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- Title versions (stage 'title' in weekly_scripts) with separate editorial, evidence and publication decisions.
-- Needs: 1 (base), 3 (workbench: weekly_scripts, weekly_script_approvals, _wk_queue, weekly_version_status).
-- Application order (docs/weekly-release-order.md): 1 base · 2 topic queue  [the queue-only release ends here]
--   · 3 workbench · 4 source copies · 5 titles · 6 document cues · 7 topic-queue approval gate.
-- Each file is one transaction and is idempotent; re-applying an earlier file after a later one changes nothing.

begin;

-- ── titles ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- The mechanical title checks of a version: its own run's checks, else the newest title_check run done on this exact
-- body hash. NULL means not checked yet.
create or replace function public.weekly_title_checks(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.checks from public.weekly_scripts v where v.id = p_id and v.run_id is not null and v.checks ? 'ok'),
    (select r.result -> 'checks' from public.weekly_runs r join public.weekly_scripts v on v.id = p_id
      where r.kind = 'title_check' and r.status = 'done' and r.input ->> 'version_id' = p_id::text
        and r.result ->> 'body_sha256' = v.body_sha256 order by r.finished_at desc limit 1))
$$;

-- Evidence review and publication, kept apart from the editorial approval.
create or replace function public.weekly_title_review_status(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.weekly_scripts; c jsonb; sel integer; ev text; pub boolean; sc jsonb;
begin
  select * into v from public.weekly_scripts where id = p_id and stage = 'title';
  if v.id is null then return '{}'::jsonb; end if;
  c := public.weekly_title_checks(v.id);
  select a.selected_index into sel from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
    and a.approval_kind = 'editorial' order by a.approved_at desc, a.id desc limit 1;
  ev := case
    when exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
                 and a.approval_kind = 'evidence') then 'cleared'
    when exists (select 1 from public.weekly_corrections x where x.script_id = v.id and x.decision = 'material_issue') then 'concerns_open'
    when c is null then 'not_checked'
    when coalesce((c ->> 'ok')::boolean, false) is not true then 'checks_failed'
    when coalesce((c ->> 'needs_research')::boolean, false) then 'needs_research'
    else 'ready_for_review' end;
  pub := exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
                 and a.approval_kind = 'publication');
  select jsonb_build_object('approved', exists (select 1 from public.weekly_script_approvals a join public.weekly_scripts d on d.id = a.script_id
            where d.id = v.depends_on and a.body_sha256 = d.body_sha256 and a.approval_kind = 'editorial'),
          'superseded', exists (select 1 from public.weekly_scripts n where n.parent_id = v.depends_on)) into sc;
  return jsonb_build_object('selected_index', sel, 'selected_title', v.body -> 'candidates' -> sel ->> 'title',
    'evidence_review', ev, 'title_checks', c, 'publication', case when pub then 'approved' else 'not_approved' end,
    'script', sc);
end $$;

-- A person proposes title wording (no run). The mechanical title checks run afterwards on this exact version.
-- p_parent: a new version of an earlier title (changed words, or the same words checked against a newer script).
create or replace function public.hs_weekly_title_propose(p_script uuid, p_candidates jsonb, p_profile uuid, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); sc public.weekly_scripts; t uuid; c jsonb; bad text[]; q jsonb;
begin
  select * into sc from public.weekly_scripts where id = p_script and stage = 'script';
  if sc.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_editorial_profiles where id = p_profile and scope = 'title') then
    raise exception 'unknown title profile' using errcode = '22023';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 3 then
    raise exception 'one to three title candidates' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(p_candidates) loop
    if char_length(btrim(coalesce(c ->> 'title', ''))) not between 1 and 200 then raise exception 'a title is 1 to 200 characters' using errcode = '22023'; end if;
  end loop;
  select coalesce(array_agg(distinct x), '{}') into bad from (select jsonb_array_elements_text(coalesce(c2 -> 'input' -> 'supporting_claim_ids', '[]')) x
    from jsonb_array_elements(p_candidates) c2) t where x <> all (public.weekly_library_claim_ids(sc.library_version_id));
  if cardinality(bad) > 0 then raise exception 'not in the pinned library: %', array_to_string(bad, ', ') using errcode = '22023'; end if;
  if p_parent is not null and (public.weekly_version_status(p_parent) ->> 'superseded')::boolean then
    raise exception 'that title already has a newer version' using errcode = '22023';
  end if;
  insert into public.weekly_scripts (stage, parent_id, depends_on, topic, library_version_id, profile_id, body, checks, kind)
    values ('title', p_parent, sc.id, sc.topic, sc.library_version_id, p_profile, jsonb_build_object('candidates', p_candidates, 'origin', 'person'),
            jsonb_build_object('label', 'title checks not run yet', 'certifies_accuracy', false), 'human_reviewed')
    returning id into t;
  q := public._wk_queue('title_check', sc.topic, jsonb_build_object('version_id', t), e);
  return jsonb_build_object('title_version', t) || q;
end $$;

-- The same words, checked against a newer script version (a new title version that needs its own approvals).
create or replace function public.hs_weekly_title_refit(p_title uuid, p_script uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.weekly_scripts;
begin
  select * into v from public.weekly_scripts where id = p_title and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  return public.hs_weekly_title_propose(p_script, v.body -> 'candidates', v.profile_id, v.id);
end $$;

-- Three generated candidates from the selected angle, the pinned research and the title profile (a Claude run).
create or replace function public.hs_weekly_titles_request(p_script uuid, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); sc public.weekly_scripts;
begin
  select * into sc from public.weekly_scripts where id = p_script and stage = 'script';
  if sc.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_editorial_profiles p join public.weekly_profile_approvals a on a.profile_id = p.id
                 where p.id = p_profile and p.scope = 'title') then
    raise exception 'the title profile is not approved' using errcode = '22023';
  end if;
  return public._wk_queue('titles', sc.topic, jsonb_build_object('library_version_id', sc.library_version_id, 'profile_id', p_profile,
    'depends_on', sc.id), e);
end $$;

-- Editorial decision on one candidate. 'approved' approves the WORDING of this exact version only; it never clears
-- evidence or approves publication. 'rejected' is kept in the candidate history with its reason.
create or replace function public.hs_weekly_title_decide(p_version uuid, p_index integer, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; t text;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  t := v.body -> 'candidates' -> p_index ->> 'title';
  if t is null then raise exception 'no such candidate' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if p_decision = 'approved' then
    if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; review that one' using errcode = '22023'; end if;
    if (st ->> 'outdated')::boolean then raise exception 'outdated: %; check the title against the new script', st ->> 'outdated_reason' using errcode = '22023'; end if;
    insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, note, approved_by)
      values (v.id, v.body_sha256, 'editorial', p_index, p_reason, e);
  elsif p_decision = 'rejected' then
    insert into public.weekly_corrections (script_id, segment_index, decision, reason, before_text, created_by)
      values (v.id, p_index, 'rejected', p_reason, t, e);
  else
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  return public.weekly_version_status(v.id);
end $$;

-- Evidence review of the editorially approved candidate. 'cleared' needs passing title checks on this exact version,
-- no research gap, no open concern, and an acknowledgement when the checks raised flags. 'concerns' records a flag.
-- Neither one ever changes the title.
create or replace function public.hs_weekly_title_evidence_review(p_version uuid, p_decision text, p_reason text default null,
  p_flags_ack boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; c jsonb;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if (st ->> 'selected_index') is null then raise exception 'approve the wording of one candidate first' using errcode = '22023'; end if;
  if p_decision = 'concerns' then
    insert into public.weekly_corrections (script_id, segment_index, decision, reason, before_text, created_by)
      values (v.id, (st ->> 'selected_index')::integer, 'material_issue', p_reason, st ->> 'selected_title', e);
    return public.weekly_version_status(v.id);
  end if;
  if p_decision <> 'cleared' then raise exception 'decision must be cleared or concerns' using errcode = '22023'; end if;
  if st ->> 'evidence_review' <> 'ready_for_review' then
    raise exception 'evidence cannot be cleared: %', st ->> 'evidence_review' using errcode = '22023';
  end if;
  c := st -> 'title_checks';
  if jsonb_array_length(coalesce(c -> 'candidates' -> (st ->> 'selected_index')::integer -> 'flags', '[]')) > 0 and not coalesce(p_flags_ack, false) then
    raise exception 'the title checks raised flags; acknowledge them to clear' using errcode = '22023';
  end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, high_risk_ack, note, approved_by)
    values (v.id, v.body_sha256, 'evidence', (st ->> 'selected_index')::integer, coalesce(p_flags_ack, false), p_reason, e);
  return public.weekly_version_status(v.id);
end $$;

-- Publication approval of a title. Needs the editorial approval and the evidence clearance of this exact version,
-- written from the current approved script. Nothing here publishes.
create or replace function public.hs_weekly_title_publication_approve(p_version uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if not (st ->> 'current')::boolean then raise exception 'the title wording is not the current approved version' using errcode = '22023'; end if;
  if st ->> 'evidence_review' <> 'cleared' then raise exception 'the evidence review is not cleared' using errcode = '22023'; end if;
  if not (public.weekly_version_status(v.depends_on) ->> 'current')::boolean then
    raise exception 'the script it was written from is not the current approved version' using errcode = '22023';
  end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, note, approved_by)
    values (v.id, v.body_sha256, 'publication', (st ->> 'selected_index')::integer, p_note, e);
  return public.weekly_version_status(v.id);
end $$;

-- The mechanical title checks of one title version (title_check run). Records the checks against the body hash
-- the run read, so a check never attaches to a different text.
create or replace function public.weekly_title_check_record(p_run uuid, p_body_sha256 text, p_checks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'title_check' and status = 'running';
  if r.id is null then raise exception 'run is not a running title check' using errcode = '55000'; end if;
  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then
    raise exception 'the checks were made on a different text' using errcode = '22023';
  end if;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, note)
    values (r.id, 'verification', 'runner_minutes', 'report', 'title checks on a GitHub runner (no AI call)');
  update public.weekly_runs set status = 'done', finished_at = now(),
    result = jsonb_build_object('body_sha256', p_body_sha256, 'checks', p_checks) where id = r.id;
end $$;

-- ── function grants ──
do $$
declare f text;
begin
  foreach f in array array[
    'weekly_title_checks(uuid)', 'weekly_title_review_status(uuid)', 'hs_weekly_title_propose(uuid,jsonb,uuid,uuid)',
    'hs_weekly_title_refit(uuid,uuid)', 'hs_weekly_titles_request(uuid,uuid)', 'hs_weekly_title_decide(uuid,integer,text,text)',
    'hs_weekly_title_evidence_review(uuid,text,text,boolean)', 'hs_weekly_title_publication_approve(uuid,text)',
    'weekly_title_check_record(uuid,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'hs_weekly_title_propose(uuid,jsonb,uuid,uuid)', 'hs_weekly_title_refit(uuid,uuid)', 'hs_weekly_titles_request(uuid,uuid)',
    'hs_weekly_title_decide(uuid,integer,text,text)', 'hs_weekly_title_evidence_review(uuid,text,text,boolean)',
    'hs_weekly_title_publication_approve(uuid,text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'weekly_title_check_record(uuid,text,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
