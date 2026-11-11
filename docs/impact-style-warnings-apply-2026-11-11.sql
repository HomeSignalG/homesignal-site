-- Tab 17 audit, 2026-11-11: style checks are warnings, a fix run that never started reads "stalled", and style checks
-- get one automatic fix round per story. GENERATED from docs/impact-stories.sql (the DDL of record): the seven function
-- statements below are copied from it byte for byte. It refuses unless each function it replaces is either the body
-- that was live on 2026-11-11 or already the new one, and checks every body after.
begin;
do $g$
declare r record; live text;
begin
  for r in select * from (values
    ('_hs_is_media', '0c8669fe5609d8bcd382b0aef3150621', '17ae7cc9e20b6fff3d465099d20c87d2'),
    ('_hs_is_status', 'e1be0d1664b4c9d0cc76beba005b4db2', '7ed7b6d85e72ce1ff13d0cdd8881cd66'),
    ('hs_impact_story_media_decide', 'c9be77449e75c1c69064ea1ac2e06bcc', '72f7a5b672e41ec9e62780d7b6e7a268'),
    ('_hs_is_fix_batch', '0c47feaec944f9920ed28b2f44e50309', '9c686806f83ff327589692f06a535361'),
    ('_hs_is_auto_fix', '0195c7b5e82232a36794faafcd2f2f0c', '215f53681c44dd46eab8156e8be132b9')) v(name, old_md5, new_md5) loop
    select md5(prosrc) into live from pg_proc where pronamespace = 'public'::regnamespace and proname = r.name;
    if live is null or live not in (r.old_md5, r.new_md5) then
      raise exception 'refusing: public.% is %, expected % (live on 2026-11-11) or % (already applied)', r.name, coalesce(live, 'missing'), r.old_md5, r.new_md5;
    end if;
  end loop;
end $g$;

create or replace function public._hs_is_hard_quality_codes()
returns text[] language sql immutable as $$ select array['audio_defect'] $$;

create or replace function public._hs_is_style_warnings(p_qc jsonb)
returns text language sql immutable as $$
  select case when coalesce((p_qc->>'ok')::boolean, false) and (p_qc->'quality'->>'ok') = 'false'
                   and jsonb_typeof(p_qc->'quality'->'failures') = 'array' and jsonb_array_length(p_qc->'quality'->'failures') > 0
                   and not exists (select 1 from jsonb_array_elements(p_qc->'quality'->'failures') f
                                    where coalesce(f->>'code', '') = '' or f->>'code' = any (public._hs_is_hard_quality_codes()))
              then (select string_agg(distinct coalesce(f->>'label', f->>'code'), '; ') from jsonb_array_elements(p_qc->'quality'->'failures') f) end
$$;

create or replace function public._hs_is_media(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare na jsonb := public._hs_is_artifact_state(p_story, 'narrative'); j public.impact_story_jobs%rowtype;
        files jsonb := '[]'::jsonb; r record; d public.impact_story_media_decisions%rowtype; st text; why text;
        cur boolean; n int := 0; nok int := 0; b public.impact_story_jobs%rowtype; blocked jsonb; choices jsonb; fixes jsonb;
        vs jsonb := public._hs_is_visuals(p_story); stale_reason text; hum boolean; sw text;
begin
  select * into j from public.impact_story_jobs where story_id = p_story and kind = 'render' and status = 'complete'
   order by completed_at desc limit 1;
  -- EVERY fix request ever made on this story's files, newest first, and where each one stands. A file card shows only
  -- its latest decision; this list never drops one. Status: closed (that file was approved later) · rendering (a render
  -- started after the request is queued or running) · rerendered (a render finished after it; narrative_changed says
  -- whether the narrative differs from the one the file was made from) · open (nothing has happened yet).
  -- Nothing here proves a fix was made: a request is a note until a Claude Code session changes the story and renders again.
  select coalesce(jsonb_agg(jsonb_build_object('id', md.id, 'asset', ia.asset, 'note', md.note, 'timecode', md.timecode,
           'actor', md.actor, 'at', md.at,
           'status', case
             when exists (select 1 from public.impact_story_media_decisions xd where xd.asset_id = md.asset_id and xd.id > md.id and xd.decision = 'approved') then 'closed'
             when exists (select 1 from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                           and rj.status in ('queued', 'running') and rj.created_at > md.at) then 'rendering'
             when exists (select 1 from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                           and rj.status = 'complete' and rj.completed_at > md.at) then 'rerendered'
             else 'open' end,
           'rerendered_at', (select max(rj.completed_at) from public.impact_story_jobs rj where rj.story_id = p_story
                              and rj.kind = 'render' and rj.status = 'complete' and rj.completed_at > md.at),
           'narrative_changed', (select rj.input->>'narrative_hash' is distinct from ia.narrative_hash
                                   from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                                    and rj.status = 'complete' and rj.completed_at > md.at
                                  order by rj.completed_at desc limit 1),
           -- the newest "Start fixes" batch that carried this request, and what it did with it
           'batch', (select jsonb_build_object('id', fb.id, 'status', fb.status, 'requested_at', fb.requested_at,
                       'claimed_at', fb.claimed_at, 'completed_at', fb.completed_at, 'next_step', fb.next_step,
                       'outcome', (select o->>'outcome' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = md.id limit 1),
                       'note', (select o->>'note' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = md.id limit 1))
                       from public.impact_story_fix_batches fb
                      where fb.story_id = p_story and fb.requests @> jsonb_build_array(jsonb_build_object('id', md.id))
                      order by fb.requested_at desc limit 1)
         ) order by md.id desc), '[]'::jsonb)
    into fixes
    from public.impact_story_media_decisions md join public.impact_story_assets ia on ia.id = md.asset_id
   where md.story_id = p_story and md.decision = 'rejected';
  -- a newer render the engine stopped before rendering (a missing essential photo, an outdated status): what is
  -- missing, the licensed candidates it found, and what a person must do. Shown until a later render completes.
  select * into b from public.impact_story_jobs where story_id = p_story and kind = 'render' and status = 'failed'
     and coalesce((result->>'blocked')::boolean, false)
     and (j.id is null or completed_at > j.completed_at)
   order by completed_at desc limit 1;
  if b.id is not null then
    blocked := jsonb_build_object('job_id', b.id, 'at', b.completed_at, 'error', b.error,
      'failures', coalesce(b.result->'failures', '[]'::jsonb), 'candidates', coalesce(b.result->'candidates', '[]'::jsonb),
      'candidates_error', b.result->'candidates_error', 'currency', b.result->'currency');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('subject_id', c.subject_id, 'candidate_id', c.candidate_id, 'job_id', c.job_id,
           'title', c.entry->>'title', 'license', c.entry->>'license', 'author', c.entry->>'author',
           'page_url', c.entry->>'page_url', 'source', coalesce(c.entry->>'source', 'commons'), 'upload_id', c.upload_id,
           'actor', c.actor, 'at', c.at) order by c.subject_id), '[]'::jsonb)
    into choices from public._hs_is_choices(p_story) c;
  if j.id is null then
    return jsonb_build_object('render_job', null, 'current', false, 'complete', false, 'files', '[]'::jsonb,
      'blocked', blocked, 'choices', choices, 'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
  end if;
  -- Videos are current only when they were made from BOTH the approved narrative AND the approved picture set (UI audit
  -- 2026-11-03: Stratos was rendered Oct 29, its pictures approved Nov 2, and the page still sent the founder to review the
  -- old videos). The render job records the picture set it used (input.visual_manifest.hash, hs_impact_story_render).
  stale_reason := case
    when not (na->>'state' = 'approved' and j.input->>'narrative_hash' = na->>'hash') then 'narrative'
    when not (vs->>'state' = 'approved' and j.input#>>'{visual_manifest,hash}' is not distinct from vs->>'manifest_hash'
              and j.input#>>'{visual_manifest,hash}' is not null) then 'pictures'
    end;
  cur := stale_reason is null;
  -- The background hum was removed from the engine on 2026-10-30 17:31:56Z (homesignal-ingest #980). A render job that
  -- started before then checked out the old code, so its videos still carry the hum (founder: never hum).
  hum := coalesce(j.started_at, j.created_at) < timestamptz '2026-10-30 17:31:56+00';
  for r in select * from public.impact_story_assets where job_id = j.id
           order by array_position(array['main', 'short_a', 'short_b', 'thumbnail'], asset) loop
    select * into d from public.impact_story_media_decisions where asset_id = r.id order by id desc limit 1;
    sw := public._hs_is_style_warnings(r.qc);
    if not cur then st := 'stale';
      why := case stale_reason when 'pictures' then 'Made before you approved the current pictures. Render the videos again.'
                               else 'Made from an earlier script. Render the videos again.' end;
    elsif not coalesce((r.qc->>'ok')::boolean, r.asset = 'thumbnail') then st := 'blocked'; why := 'The media checks failed: see the checks below.';
    elsif sw is not null and d.decision = 'approved' then   -- style checks only, and the founder approved it anyway
      st := 'approved'; why := 'Approved by ' || d.actor || ' with style warnings: ' || sw || '.';
    elsif (r.qc->'quality'->>'ok') = 'false' then   -- the storyboard and frame gates (impact/visual_gate.py)
      st := 'blocked';
      why := 'The visual quality gate failed: ' || coalesce((select string_agg(distinct f->>'label', '; ')
               from jsonb_array_elements(coalesce(r.qc->'quality'->'failures', '[]'::jsonb)) f), 'see the checks below') || '.';
    elsif d.id is null then st := 'pending'; why := 'Watch it, then approve or reject.';
    elsif d.decision = 'approved' then st := 'approved'; why := 'Approved by ' || d.actor || '.';
    elsif d.decision = 'rejected' then st := 'rejected'; why := 'Rejected: ' || coalesce(d.note, '') || coalesce(' (at ' || d.timecode || ')', '');
    else st := 'revoked'; why := 'Approval revoked' || coalesce(': ' || d.note, '.');
    end if;
    n := n + 1; if st = 'approved' then nok := nok + 1; end if;
    files := files || jsonb_build_object('id', r.id, 'asset', r.asset, 'path', r.path, 'captions_path', r.captions_path,
      'bytes', r.bytes, 'sha256', r.sha256, 'width', r.width, 'height', r.height, 'duration_s', r.duration_s,
      'preset', r.preset, 'qc', r.qc, 'stills', r.stills, 'shots', r.shots, 'version', r.version, 'renderer', r.renderer,
      'created_at', r.created_at, 'state', st, 'why', why, 'hum', hum and r.asset <> 'thumbnail',
      -- style checks only: the founder may approve it after watching (hs_impact_story_media_decide)
      'style_warnings', sw, 'approve_anyway', st = 'blocked' and sw is not null,
      'last_decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'note', d.note,
        'timecode', d.timecode, 'actor', d.actor, 'at', d.at) end);
  end loop;
  return jsonb_build_object('render_job', j.id, 'rendered_at', j.completed_at, 'version', j.base_version,
    'renderer', j.input->>'renderer', 'current', cur, 'stale_reason', stale_reason, 'hum', hum,
    'complete', cur and n > 0 and nok = n, 'files', files,
    'quality', j.result->'quality', 'currency', j.result->'currency', 'blocked', blocked, 'choices', choices,
    'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
end $$;

create or replace function public._hs_is_status(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; j public.impact_story_jobs%rowtype;
        arts jsonb := '{}'::jsonb; k text; stage text; nxt text; lib text; all_ok boolean := true; m jsonb; vs jsonb;
        owner text := 'you'; cs jsonb; fb jsonb; npend int := 0; nblk int := 0; nunsent int := 0; pend_names text;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  select * into j from public.impact_story_jobs where story_id = p_story order by created_at desc limit 1;
  arts := jsonb_build_object('narrative', public._hs_is_artifact_state(p_story, 'narrative'));
  all_ok := arts->'narrative'->>'state' = 'approved';
  if s.archived_at is not null then stage := 'archived'; nxt := 'Archived.'; lib := 'archived';
  elsif s.pack is null then stage := 'intake'; nxt := 'Check sources'; lib := 'draft';
  elsif jsonb_array_length(coalesce(s.pack->'claims', '[]')) = 0 then stage := 'sources_needed'; nxt := 'Sources needed'; lib := 'draft';
  elsif not public._hs_is_fresh(s) then stage := 'sources_needed'; nxt := 'Re-check sources'; lib := 'draft';
  elsif v.version is null or v.body->'arc' is null then
    stage := 'outline'; lib := 'draft';
    nxt := case when v.body ? 'angles' then 'Analyze again to get the story outline' else 'Analyze story' end;
  elsif v.body->'main' is null then stage := 'outline'; nxt := 'Review the outline, then Generate story'; lib := 'needs_review';
  elsif not all_ok then
    stage := 'script'; lib := 'needs_review';
    -- a blocked script cannot be approved (the button is off), so the next step is to fix it, never to approve it
    -- (founder, 2026-11-06: an Approve that did nothing while the step said "approve").
    nxt := case when arts->'narrative'->>'state' = 'blocked'
                then 'Fix the script first: the checks found problems, listed under Integrated narrative. Write what to change with "Fix this line", then press Fix. Approve turns on once the script passes.'
                else 'Review and approve the integrated narrative' end;
    if s.creation_mode = 'creator' then   -- a creator-directed story: the founder's script comes first
      cs := public._hs_is_creator_state(p_story);
      nxt := case when cs->'pending'->>'status' = 'proposed' then 'Send your revised script with Fix'
                  when cs->'pending'->>'status' in ('sending', 'applying') then 'Applying your revised script…'
                  when (cs->>'high')::int > 0 or (cs->>'low_open')::int > 0 then 'Review the flags on your script'
                  when (cs->>'ok')::boolean then 'Approve & lock your script'
                  else 'Review your script' end;
      if cs->'pending'->>'status' in ('sending', 'applying') then owner := 'working'; end if;
    end if;
  else
    m := public._hs_is_media(p_story);
    vs := public._hs_is_visuals(p_story);
    if (m->>'complete')::boolean then stage := 'distribution'; nxt := 'Ready to export. Publishing is not built yet.'; lib := 'ready'; owner := 'done';
    elsif (m->>'current')::boolean then stage := 'media'; lib := 'needs_review';
      -- The next step follows what the founder already did here (founder, 2026-11-07: "the update in needs you needs to be
      -- automatic once i review and complete an action"). It used to say "Review each video and the thumbnail" whatever
      -- had been approved, rejected or sent, so a finished review looked like nothing had happened.
      fb := m->'fix_batch';
      select count(*) filter (where f->>'state' = 'pending'),
             count(*) filter (where f->>'state' = 'blocked' and f->'last_decision' is null),
             string_agg(case when f->>'state' = 'pending' then case f->>'asset' when 'main' then 'main video' when 'short_a' then 'Short A'
                          when 'short_b' then 'Short B' else f->>'asset' end end, ', ')
        into npend, nblk, pend_names from jsonb_array_elements(coalesce(m->'files', '[]'::jsonb)) f;
      -- fix requests saved but not sent: a rejection nothing has acted on, in no batch (or in one that was cancelled or failed)
      select count(*) into nunsent from jsonb_array_elements(coalesce(m->'fix_requests', '[]'::jsonb)) x
       where x->>'status' = 'open' and coalesce(x->>'note', '') !~* '\mhum(ming)?\M'
         and (x->'batch' is null or jsonb_typeof(x->'batch') = 'null' or x->'batch'->>'status' in ('cancelled', 'failed'));
      if (fb->>'auto')::boolean and fb->>'status' in ('plan_queued', 'planning', 'planned', 'queued', 'working') then
        -- videos that failed the checks are being fixed by the system (_hs_is_auto_fix): nothing to watch yet
        owner := 'working'; nxt := 'Fixing the videos that failed the checks, before you review them…';
      elsif fb->>'status' = 'planned' then
        nxt := 'Read Claude''s fix plan in Media review, then press Confirm. Nothing changes until you do.';
      elsif fb->>'status' in ('plan_queued', 'planning') then
        owner := 'working'; nxt := 'Claude is reading your fix requests and writing a plan (a few minutes). Nothing changes until you confirm it.';
      elsif fb->>'status' in ('queued', 'working') then
        owner := 'working'; nxt := 'Claude is making the fixes you confirmed. When it finishes, this says what to do next.';
      elsif fb->>'status' = 'needs_you' then
        nxt := coalesce(fb->>'next_step', 'The fixer needs something from you: see Media review');
      elsif fb->>'status' = 'stalled' then
        nxt := 'The fix run did not start or stopped before it finished. Press Fix in Media review to send your requests again.';
      elsif nunsent > 0 then
        nxt := 'Send your ' || nunsent || ' fix request' || case when nunsent = 1 then '' else 's' end || ' with Fix in Media review';
      elsif npend > 0 then
        nxt := 'Review ' || case when npend = 1 then 'the ' else 'these: ' end || pend_names;
      elsif nblk > 0 then
        nxt := nblk || ' video' || case when nblk = 1 then '' else 's' end || ' failed the checks. In Media review, watch and approve anyway where that is offered, or save a fix request and press Fix';
      else
        nxt := coalesce(case when fb->>'status' = 'done' then fb->>'next_step' end, 'Review each video and the thumbnail');
      end if;
    elsif vs->>'state' = 'approved' then stage := 'media'; nxt := 'Render the videos'; lib := 'needs_review';
    else
      stage := 'visuals'; lib := 'needs_review';
      nxt := case vs->>'state' when 'ready' then 'Review the visuals, then Approve all visuals'
                                when 'needs_fixes' then 'Replace the blocked pictures, then prepare the visuals again'
                                when 'preparing' then 'Preparing the preview stills…'
                                else 'Prepare the visuals' end;
    end if;
  end if;
  if stage = 'archived' then owner := 'archived'; end if;
  if j.status in ('queued', 'running') and public._hs_is_not_started(j) is not null then
    nxt := 'The job did not start. Press Retry.'; owner := 'you';
  elsif j.status in ('queued', 'running') then
    owner := 'working';
    if j.kind = 'render' then lib := 'rendering'; end if;
    nxt := case j.kind when 'pack' then 'Checking sources…' when 'analyze' then 'Analyzing…' when 'generate' then 'Writing the story…'
                       when 'render' then 'Rendering the videos (about 1 to 3 hours)…'
                       when 'visuals' then 'Preparing the preview stills (about 10 to 20 minutes)…' else 'Running checks…' end;
  end if;
  -- owner: whose turn it is (UI audit 2026-11-03), so the page can say "Your next step", "Working on it" or "Done".
  return jsonb_build_object('stage', stage, 'next', nxt, 'library', lib, 'owner', owner, 'artifacts', arts,
    'fresh', public._hs_is_fresh(s), 'job', case when j.id is null then null else jsonb_build_object(
      'id', j.id, 'kind', j.kind, 'status', j.status, 'error', coalesce(j.error, public._hs_is_not_started(j)), 'attempts', j.attempts,
      'created_at', j.created_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
      'not_started', public._hs_is_not_started(j) is not null,
      'visuals_changed', public._hs_is_visuals_changed(j.kind, j.status, j.result, j.error),
      'stuck', (j.status in ('queued', 'running') and j.created_at < now() - public._hs_is_stuck_after(j.kind))
               or public._hs_is_not_started(j) is not null) end);
end $$;

create or replace function public.hs_impact_story_media_decide(p_story uuid, p_asset_id bigint, p_decision text,
                                                               p_note text default null, p_timecode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); m jsonb; f jsonb;
begin
  if p_decision not in ('approved', 'rejected', 'revoked') then raise exception 'bad decision' using errcode = '22023'; end if;
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  m := public._hs_is_media(p_story);
  select x into f from jsonb_array_elements(m->'files') x where (x->>'id')::bigint = p_asset_id;
  if f is null then raise exception 'That file is not part of the current render.' using errcode = '55000'; end if;
  if f->>'state' = 'stale' then raise exception 'That file was rendered from an earlier narrative. Render again.' using errcode = '55000'; end if;
  if p_decision = 'approved' then
    if f->>'state' = 'approved' then return jsonb_build_object('state', 'approved', 'unchanged', true); end if;
    -- a failed FILE check or a hard quality code blocks; style checks alone do not (the founder watched it and decides)
    if f->>'state' = 'blocked' and not coalesce((f->>'approve_anyway')::boolean, false) then
      raise exception 'Cannot approve: %', f->>'why' using errcode = '55000';
    end if;
    if f->>'state' = 'blocked' then p_note := left('Approved with style warnings: ' || (f->>'style_warnings'), 1000); end if;
  elsif p_decision = 'rejected' then
    if nullif(btrim(p_note), '') is null then raise exception 'Say what to fix.' using errcode = '22023'; end if;
  elsif f->>'state' <> 'approved' then
    raise exception 'There is no approval to revoke.' using errcode = '55000';
  end if;
  insert into public.impact_story_media_decisions (story_id, asset_id, decision, note, timecode, actor)
  values (p_story, p_asset_id, p_decision, nullif(btrim(p_note), ''), nullif(btrim(p_timecode), ''), e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'media_decision', jsonb_build_object('asset', f->>'asset', 'asset_id', p_asset_id,
    'decision', p_decision, 'timecode', nullif(btrim(p_timecode), '')), e);
  return jsonb_build_object('state', p_decision);
end $$;

create or replace function public._hs_is_fix_batch(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'status', case when b.status in ('working', 'planning') and b.claimed_at < now() - interval '3 hours' then 'stalled'
             when b.status in ('queued', 'plan_queued') and coalesce(b.confirmed_at, b.requested_at) < now() - interval '30 minutes' then 'stalled'
             else b.status end,
           'phase', case when b.status in ('plan_queued', 'planning', 'planned') or (b.status in ('failed', 'cancelled') and b.confirmed_at is null) then 'plan' else 'work' end,
           'plan', b.plan, 'plan_md5', b.plan_md5, 'planned_at', b.planned_at, 'confirmed_at', b.confirmed_at,
           'requests', jsonb_array_length(b.requests), 'requested_by', b.requested_by, 'requested_at', b.requested_at,
           'claimed_at', b.claimed_at, 'completed_at', b.completed_at, 'attempts', b.attempts, 'summary', b.summary,
           'next_step', b.next_step, 'outcomes', b.outcomes, 'version_after', b.version_after, 'pr_url', b.pr_url,
           -- started by the system because a render failed its checks (_hs_is_auto_fix), not by the founder
           'auto', b.requested_by = 'system:auto-fix')
    from public.impact_story_fix_batches b where b.story_id = p_story order by b.requested_at desc limit 1
$$;

create or replace function public._hs_is_auto_fix(p_story uuid, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m jsonb := public._hs_is_media(p_story); j public.impact_story_jobs%rowtype; f jsonb; bl jsonb; ids bigint[] := '{}';
        did bigint; reqs jsonb; b public.impact_story_fix_batches%rowtype; q jsonb; lab text;
begin
  select * into j from public.impact_story_jobs where id = p_job;
  if not found or m->>'render_job' is distinct from p_job::text or not coalesce((m->>'current')::boolean, false) then
    return jsonb_build_object('action', 'none', 'reason', 'not the current render');
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into bl from jsonb_array_elements(m->'files') x
   where x->>'state' = 'blocked' and x->>'asset' <> 'thumbnail';
  if jsonb_array_length(bl) = 0 then return jsonb_build_object('action', 'none'); end if;
  -- rendering again helps only when, for every failed video, the media checks failed or the one problem is the
  -- renderer not drawing what was planned (the page's renderAgainHelps says the same)
  if j.input->>'auto_rerender_of' is null and not exists (select 1 from jsonb_array_elements(bl) x
       where coalesce((x->'qc'->>'ok')::boolean, false)
         and not (jsonb_array_length(coalesce(x->'qc'->'quality'->'failures', '[]'::jsonb)) > 0
                  and not exists (select 1 from jsonb_array_elements(x->'qc'->'quality'->'failures') y
                                   where y->>'code' is distinct from 'render_mismatch'))) then
    q := public._hs_is_queue(p_story, 'render', j.input || jsonb_build_object('auto_rerender_of', p_job), 'system:auto-fix', true);
    perform public._hs_is_event(p_story, 'auto_rerender', jsonb_build_object('job_id', p_job, 'new_job', q->>'job_id',
      'files', (select jsonb_agg(x->>'asset') from jsonb_array_elements(bl) x)), 'system:auto-fix');
    return jsonb_build_object('action', 'render', 'job', q);
  end if;
  if exists (select 1 from public.impact_story_fix_batches where story_id = p_story
               and status in ('plan_queued', 'planning', 'planned', 'queued', 'working')) then
    return jsonb_build_object('action', 'none', 'reason', 'a fix batch is already active');
  end if;
  -- Style checks get ONE automatic fix round per story (Tab 17 audit, 2026-11-11: one story went through 13 fix
  -- batches and 9 renders without a passing video). After that the videos are shown with their warnings and the
  -- founder approves them anyway or asks for a fix. File-check and hard failures are still fixed every time.
  if not exists (select 1 from jsonb_array_elements(bl) x where not coalesce((x->>'approve_anyway')::boolean, false))
     and exists (select 1 from public.impact_story_fix_batches fb2, jsonb_array_elements(fb2.requests) rq
                   join public.impact_story_media_decisions md on md.id = (rq->>'id')::bigint
                   join public.impact_story_assets pa on pa.id = md.asset_id
                  where fb2.story_id = p_story and fb2.requested_by = 'system:auto-fix' and fb2.status in ('done', 'needs_you')
                    and rq->>'kind' = 'media' and public._hs_is_style_warnings(pa.qc) is not null) then
    perform public._hs_is_event(p_story, 'auto_fix_skipped', jsonb_build_object('job_id', p_job,
      'reason', 'style checks already had their one automatic fix round'), 'system:auto-fix');
    return jsonb_build_object('action', 'none', 'reason', 'style checks already had their one automatic fix round');
  end if;
  for f in select x from jsonb_array_elements(bl) x loop
    if exists (select 1 from public.impact_story_media_decisions where asset_id = (f->>'id')::bigint and actor = 'system:auto-fix') then
      continue;
    end if;
    select string_agg(distinct l, '; ') into lab from (
      select y->>'label' l from jsonb_array_elements(coalesce(f->'qc'->'quality'->'failures', '[]'::jsonb)) y
      union all
      select c->>'name' from jsonb_array_elements(coalesce(f->'qc'->'checks', '[]'::jsonb)) c where not coalesce((c->>'ok')::boolean, true)) z
     where l is not null;
    insert into public.impact_story_media_decisions (story_id, asset_id, decision, note, actor)
    values (p_story, (f->>'id')::bigint, 'rejected',
            left('The automatic checks failed on this video' || coalesce(': ' || lab, '') || '. It was not shown for review. '
                 || 'Fix every failed check in the checks report for this video.', 1000), 'system:auto-fix')
    returning id into did;
    ids := ids || did;
  end loop;
  if cardinality(ids) = 0 then return jsonb_build_object('action', 'none', 'reason', 'already sent'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into reqs from jsonb_array_elements(public._hs_is_fix_eligible(p_story)) r
   where r->>'kind' = 'media' and (r->>'id')::bigint = any (ids);
  if jsonb_array_length(reqs) = 0 then return jsonb_build_object('action', 'none', 'reason', 'nothing eligible'); end if;
  insert into public.impact_story_fix_batches (story_id, requests, requested_by, status)
  values (p_story, reqs, 'system:auto-fix', 'plan_queued') returning * into b;
  perform public._hs_is_event(p_story, 'fix_batch_queued', jsonb_build_object('batch', b.id, 'requests', jsonb_array_length(reqs),
    'phase', 'plan', 'auto', true, 'job_id', p_job), 'system:auto-fix');
  perform public._hs_is_fix_dispatch(b.id, 'plan');
  return jsonb_build_object('action', 'fix', 'batch', b.id, 'requests', jsonb_array_length(reqs));
end $$;

revoke all on function public._hs_is_hard_quality_codes() from public, anon, authenticated;
revoke all on function public._hs_is_style_warnings(jsonb) from public, anon, authenticated;

do $g$
declare r record; live text;
begin
  for r in select * from (values
    ('_hs_is_hard_quality_codes', '8087ec134fe651c3da249d2ce0d40823'),
    ('_hs_is_style_warnings', '4e2f6120ae5bb017cf037423771ebe93'),
    ('_hs_is_media', '17ae7cc9e20b6fff3d465099d20c87d2'),
    ('_hs_is_status', '7ed7b6d85e72ce1ff13d0cdd8881cd66'),
    ('hs_impact_story_media_decide', '72f7a5b672e41ec9e62780d7b6e7a268'),
    ('_hs_is_fix_batch', '9c686806f83ff327589692f06a535361'),
    ('_hs_is_auto_fix', '215f53681c44dd46eab8156e8be132b9')) v(name, new_md5) loop
    select md5(prosrc) into live from pg_proc where pronamespace = 'public'::regnamespace and proname = r.name;
    if live is distinct from r.new_md5 then raise exception 'post-check: public.% is %, expected %', r.name, live, r.new_md5; end if;
  end loop;
  if has_function_privilege('anon', 'public._hs_is_style_warnings(jsonb)', 'execute')
     or has_function_privilege('anon', 'public._hs_is_hard_quality_codes()', 'execute') then
    raise exception 'post-check: a visitor can run a new helper';
  end if;
end $g$;
commit;
