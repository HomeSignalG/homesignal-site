-- One-time apply of the Tab 17 "Fix this line" database half (PR #2597), 2026-11-05.
-- Run once with db-sql.yml from main. The guard refuses unless the four live functions still
-- fingerprint as read on 2026-11-05 and the table does not exist yet, so a second run changes nothing.
-- The definitions of record stay in docs/impact-stories.sql.
begin;
set local lock_timeout = '5s';
do $g$
declare bad text;
begin
  select string_agg(x.f, ', ') into bad from (values
    ('hs_impact_story_get','e8809b2226cdeada065d27153a8dc35c'), ('hs_impact_story_job_complete','60a84c6bb3f61d0788e34832805ed16a'),
    ('_hs_is_fix_eligible','7695ea1c8e306815a73d5ec7e5fd145f'), ('impact_fix_batch_complete','95cb81dd4d38f3caa7651533ae1a0f15')) x(f, h)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = x.f and md5(p.prosrc) = x.h);
  if bad is not null then raise exception 'live function changed since it was read: %', bad; end if;
  if to_regclass('public.impact_story_line_notes') is not null then raise exception 'impact_story_line_notes already exists'; end if;
end $g$;

create table if not exists public.impact_story_line_notes (
  id         bigint primary key default nextval('public.impact_story_media_decisions_id_seq'::regclass),
  story_id   uuid not null references public.impact_stories(id),
  version    integer not null,
  path       text not null check (path ~ '^(main|qol|shorts|packaging)(\.([a-z_]{1,20}|[0-9]{1,3})){1,10}$'),
  line_text  text check (line_text is null or char_length(line_text) <= 2000),
  kind       text not null check (kind in ('fix', 'research', 'withdraw')),
  note       text check (note is null or char_length(note) between 1 and 1000),
  withdraws  bigint references public.impact_story_line_notes(id),
  actor      text not null,
  at         timestamptz not null default now(),
  check ((kind = 'withdraw') = (withdraws is not null)),
  check (kind = 'withdraw' or note is not null)
);

create index if not exists impact_story_line_notes_story on public.impact_story_line_notes (story_id, id);

alter table public.impact_story_line_notes enable row level security;

revoke all on public.impact_story_line_notes from public, anon, authenticated;

drop trigger if exists impact_story_line_notes_append_only on public.impact_story_line_notes;

create trigger impact_story_line_notes_append_only before update or delete on public.impact_story_line_notes
  for each row execute function public._hs_is_append_only();

create or replace function public.hs_impact_story_get(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype;
begin
  perform public._hs_is_admin();
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  return jsonb_build_object(
    'story', to_jsonb(s) - 'pack', 'pack', s.pack, 'status', public._hs_is_status(p_story), 'media', public._hs_is_media(p_story),
    'visuals', public._hs_is_visuals(p_story), 'line_notes', public._hs_is_line_notes(p_story),
    'version', case when v.version is null then null else jsonb_build_object('version', v.version, 'parent', v.parent,
      'origin', v.origin, 'body', v.body, 'validation', v.validation, 'derived', v.derived,
      'checked', v.validated_pack_hash is not distinct from s.pack_hash and v.validation is not null,
      'created_by', v.created_by, 'created_at', v.created_at) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', x.version, 'parent', x.parent, 'origin', x.origin,
      'created_by', x.created_by, 'created_at', x.created_at) order by x.version desc) from public.impact_story_versions x where x.story_id = p_story), '[]'),
    'approvals', coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from public.impact_story_approvals a where a.story_id = p_story), '[]'),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) - 'result' order by j.created_at desc) from public.impact_story_jobs j where j.story_id = p_story), '[]'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from public.impact_story_events e where e.story_id = p_story order by id desc limit 200) e), '[]'));
end $$;

create or replace function public.hs_impact_story_job_complete(p_job_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.impact_story_jobs%rowtype; s public.impact_stories%rowtype; nv int; d jsonb; vman jsonb; pfx text; mid bigint;
        ac jsonb; nauto int := 0; ck_before text; vkey text;
begin
  select * into j from public.impact_story_jobs where id = p_job_id for update;
  if not found or j.status <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'job is not running (' || coalesce(j.status, 'missing') || ')');
  end if;
  select * into s from public.impact_stories where id = j.story_id for update;
  d := p_result->'derived';
  if j.kind = 'pack' then
    if jsonb_typeof(p_result->'pack') <> 'object' then
      return public.hs_impact_story_job_fail(p_job_id, 'The worker returned no source pack.');
    end if;
    update public.impact_stories set pack = p_result->'pack', pack_hash = p_result->'pack'->>'hash', pack_checked_at = now(),
           title = case when s.title = s.video_slug then coalesce(p_result->'pack'->>'title', s.title) else s.title end,
           updated_at = now() where id = s.id;
    update public.impact_story_jobs set status = 'complete', completed_at = now(), result = jsonb_build_object('pack_hash', p_result->'pack'->>'hash')
     where id = p_job_id;
    perform public._hs_is_event(s.id, 'pack_checked', jsonb_build_object('hash', p_result->'pack'->>'hash',
      'claims', jsonb_array_length(coalesce(p_result->'pack'->'claims', '[]')), 'verified_at', p_result->'pack'->>'verified_at'), 'worker');
    if s.current_version > 0 and s.pack_hash is distinct from p_result->'pack'->>'hash' then   -- new evidence
      perform public._hs_is_event(s.id, 'freshness_warning', jsonb_build_object('reason', 'The source pack changed. Dependent claims must be re-checked.'), 'worker');
    end if;
    if j.input->>'then' in ('generate', 'analyze') then   -- a Fix batch that added sources: write the new version from them
      begin
        perform public._hs_is_request(s.id, j.input->>'then', 'all', true, 'worker');
      exception when others then
        perform public._hs_is_event(s.id, 'followup_failed', jsonb_build_object('then', j.input->>'then', 'reason', sqlerrm), 'worker');
      end;
    end if;
    perform public._hs_is_followup(s.id, 'worker');
    return jsonb_build_object('ok', true);
  end if;
  if j.kind = 'render' then
    if jsonb_typeof(p_result->'assets') <> 'array'
       or not exists (select 1 from jsonb_array_elements(p_result->'assets') a where a->>'asset' = 'main')
       or not exists (select 1 from jsonb_array_elements(p_result->'assets') a where a->>'asset' = 'thumbnail') then
      return public.hs_impact_story_job_fail(p_job_id, 'The render returned no main video or no thumbnail.');
    end if;
    if exists (select 1 from jsonb_array_elements(p_result->'assets') a
               where left(a->>'path', length(j.story_id::text || '/' || j.id::text || '/')) <> j.story_id::text || '/' || j.id::text || '/') then
      return public.hs_impact_story_job_fail(p_job_id, 'The render returned a file outside this job''s folder.');
    end if;
    insert into public.impact_story_assets (story_id, job_id, version, narrative_hash, renderer, asset, path, captions_path,
      bytes, sha256, width, height, duration_s, preset, qc, stills, shots)
    select j.story_id, j.id, j.base_version, j.input->>'narrative_hash', j.input->>'renderer', a->>'asset', a->>'path', a->>'captions_path',
           (a->>'bytes')::bigint, a->>'sha256', (a->>'width')::int, (a->>'height')::int, (a->>'duration_s')::numeric, a->>'preset',
           coalesce(a->'qc', '{}'::jsonb), coalesce(a->'stills', '[]'::jsonb), coalesce(a->'shots', '[]'::jsonb)
      from jsonb_array_elements(p_result->'assets') a;
    update public.impact_story_jobs set status = 'complete', completed_at = now(),
           result = jsonb_build_object('files', jsonb_array_length(p_result->'assets'), 'storyboard', p_result->'storyboard',
                                       'quality', p_result->'quality', 'currency', p_result->'currency')
     where id = p_job_id;
    perform public._hs_is_event(j.story_id, 'rendered', jsonb_build_object('job_id', j.id, 'version', j.base_version,
      'files', (select jsonb_agg(a->>'asset') from jsonb_array_elements(p_result->'assets') a)), 'worker');
    perform public._hs_is_followup(s.id, 'worker');   -- a save made during the render is checked now
    return jsonb_build_object('ok', true, 'files', jsonb_array_length(p_result->'assets'));
  end if;
  if j.kind = 'visuals' then
    vman := p_result->'manifest';
    pfx := j.story_id::text || '/visuals/' || j.id::text || '/';
    if jsonb_typeof(vman) <> 'object' or coalesce(vman->>'hash', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(vman->'assets') <> 'object'
       or not exists (select 1 from jsonb_each(vman->'assets') a where a.key = 'main')
       or not exists (select 1 from jsonb_each(vman->'assets') a where a.key = 'thumbnail') then
      return public.hs_impact_story_job_fail(p_job_id, 'The visuals job returned no manifest, or one with no main video or no thumbnail.');
    end if;
    if exists (select 1 from jsonb_each(vman->'assets') a, jsonb_array_elements(a.value->'shots') sh
               where left(coalesce(sh->'preview'->>'path', ''), length(pfx)) <> pfx)
       or exists (select 1 from jsonb_array_elements(coalesce(vman->'alternatives', '[]'::jsonb)) g,
                         jsonb_array_elements(coalesce(g->'candidates', '[]'::jsonb)) x
                  where x->'preview' is not null and left(coalesce(x->'preview'->>'path', ''), length(pfx)) <> pfx) then
      return public.hs_impact_story_job_fail(p_job_id, 'The visuals job returned a preview outside this job''s folder.');
    end if;
    ck_before := public._hs_is_choice_key(j.story_id)->>'key';
    for ac in select x from jsonb_array_elements(coalesce(vman->'auto_choices', '[]'::jsonb)) x loop
      if coalesce(ac->>'subject_id', '') = '' or coalesce(ac->>'candidate_id', '') = ''
         or coalesce(ac->'entry'->>'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(ac->'entry'->>'license', '') = ''
         or coalesce(ac->'entry'->>'file_url', '') = '' or ac->'entry'->>'id' is distinct from ac->>'candidate_id' then
        continue;
      end if;
      if exists (select 1 from public._hs_is_rejections(j.story_id) r where r.photo_id = ac->>'candidate_id'
                   or r.entry->>'file_url' = ac->'entry'->>'file_url' or r.entry->>'sha256' = ac->'entry'->>'sha256')
         or exists (select 1 from public._hs_is_choices(j.story_id) c where c.subject_id = ac->>'subject_id' and c.candidate_id = ac->>'candidate_id') then
        continue;
      end if;
      insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
      values (j.story_id, ac->>'subject_id', ac->>'candidate_id', j.id, ac->'entry', 'system:auto-photo');
      nauto := nauto + 1;
    end loop;
    vkey := case when nauto > 0 and coalesce(j.input->>'choices_key', '') = ck_before
                 then public._hs_is_choice_key(j.story_id)->>'key' else coalesce(j.input->>'choices_key', '') end;
    insert into public.impact_story_visual_manifests (story_id, job_id, version, narrative_hash, pack_hash, renderer, manifest_hash,
      choices_key, opts, counts, approvable, manifest)
    values (j.story_id, j.id, j.base_version, j.input->>'narrative_hash', vman->>'pack_hash', coalesce(vman->>'renderer', j.input->>'renderer'),
      vman->>'hash', vkey, coalesce(vman->'opts', '{}'::jsonb), coalesce(vman->'counts', '{}'::jsonb),
      coalesce((vman->>'approvable')::boolean, false) and coalesce((vman->'identity'->>'same')::boolean, false), vman)
    returning id into mid;
    update public.impact_story_jobs set status = 'complete', completed_at = now(),
           result = jsonb_build_object('manifest_id', mid, 'hash', vman->>'hash', 'counts', vman->'counts', 'timing', vman->'timing')
     where id = p_job_id;
    perform public._hs_is_event(j.story_id, 'visuals_prepared', jsonb_build_object('job_id', j.id, 'manifest_id', mid,
      'counts', vman->'counts', 'photos_found', nauto), 'worker');
    perform public._hs_is_followup(s.id, 'worker');   -- a save made while the previews were prepared is checked now
    return jsonb_build_object('ok', true, 'manifest_id', mid);
  end if;
  if j.kind = 'validate' then
    update public.impact_story_versions set validation = d->'validation', validated_pack_hash = d->'validation'->>'pack_hash', derived = d
     where story_id = s.id and version = j.base_version;
    update public.impact_story_jobs set status = 'complete', completed_at = now(), result_version = j.base_version where id = p_job_id;
    perform public._hs_is_event(s.id, 'checked', jsonb_build_object('version', j.base_version), 'worker');
    perform public._hs_is_followup(s.id, 'worker');   -- a newer save may be waiting for its check
    return jsonb_build_object('ok', true, 'version', j.base_version);
  end if;
  if s.current_version <> j.base_version then
    update public.impact_story_jobs set status = 'superseded', completed_at = now(), result = p_result,
           error = 'You saved version ' || s.current_version || ' while this ran on version ' || j.base_version || '. The result is kept here and was not applied.'
     where id = p_job_id;
    perform public._hs_is_event(s.id, 'job_superseded', jsonb_build_object('job_id', j.id), 'worker');
    perform public._hs_is_followup(s.id, 'worker');
    return jsonb_build_object('ok', true, 'superseded', true);
  end if;
  if jsonb_typeof(p_result->'body') <> 'object' then
    return public.hs_impact_story_job_fail(p_job_id, 'The worker returned no draft.');
  end if;
  nv := s.current_version + 1;
  insert into public.impact_story_versions (story_id, version, parent, origin, body, validation, validated_pack_hash, derived, job_id, created_by)
  values (s.id, nv, nullif(s.current_version, 0), j.kind, p_result->'body', d->'validation', d->'validation'->>'pack_hash', d, j.id, 'worker');
  update public.impact_stories set current_version = nv, updated_at = now() where id = s.id;
  update public.impact_story_jobs set status = 'complete', completed_at = now(), result_version = nv where id = p_job_id;
  perform public._hs_is_event(s.id, j.kind || '_done', jsonb_build_object('version', nv, 'job_id', j.id), 'worker');
  return jsonb_build_object('ok', true, 'version', nv);
end $$;

create or replace function public._hs_is_line_notes(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', n.id, 'path', n.path, 'line', n.line_text, 'note', n.note, 'research', n.kind = 'research',
             'version', n.version, 'actor', n.actor, 'at', n.at,
             'status', case
               when exists (select 1 from public.impact_story_line_notes w where w.withdraws = n.id) then 'withdrawn'
               when fb.status in ('plan_queued', 'planning', 'planned', 'queued', 'working') then 'sending'
               when fb.status in ('done', 'needs_you') then coalesce(fo.o->>'outcome', 'needs_you')
               else 'open' end,
             'answer', case when fb.status in ('done', 'needs_you') then fo.o->>'note' end,
             'batch', case when fb.id is null then null else jsonb_build_object('id', fb.id, 'status', fb.status,
                        'completed_at', fb.completed_at, 'next_step', fb.next_step) end) x
      from public.impact_story_line_notes n
      left join lateral (select b.* from public.impact_story_fix_batches b where b.story_id = p_story
                          and b.requests @> jsonb_build_array(jsonb_build_object('id', n.id))
                          order by b.requested_at desc limit 1) fb on true
      left join lateral (select o from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = n.id limit 1) fo(o) on true
     where n.story_id = p_story and n.kind <> 'withdraw') q
$$;

create or replace function public._hs_is_fix_eligible(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', (x->>'id')::bigint, 'kind', 'media', 'asset', x->>'asset', 'note', x->>'note',
             'timecode', x->>'timecode', 'at', x->>'at') r
      from jsonb_array_elements(public._hs_is_media(p_story)->'fix_requests') x
     where x->>'status' = 'open'
       and not exists (select 1 from public.impact_story_fix_batches b where b.story_id = p_story
                         and b.requests @> jsonb_build_array(jsonb_build_object('id', (x->>'id')::bigint))
                         and (b.status in ('plan_queued', 'planning', 'planned', 'queued', 'working')
                              or exists (select 1 from jsonb_array_elements(b.outcomes) o
                                          where (o->>'decision_id')::bigint = (x->>'id')::bigint and o->>'outcome' = 'fixed')))
    union all
    select jsonb_build_object('id', (l->>'id')::bigint, 'kind', 'line', 'asset', 'script', 'path', l->>'path', 'line', l->>'line',
             'note', l->>'note', 'research', (l->>'research')::boolean, 'version', (l->>'version')::int, 'at', l->>'at')
      from jsonb_array_elements(public._hs_is_line_notes(p_story)) l
     where l->>'status' = 'open') q
$$;

create or replace function public.hs_impact_story_line_note(p_story uuid, p_path text, p_line text, p_note text, p_research boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; nid bigint;
begin
  if nullif(btrim(p_note), '') is null then raise exception 'Say what to fix or what to look up.' using errcode = '22023'; end if;
  if char_length(btrim(p_note)) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  if p_path is null or p_path !~ '^(main|qol|shorts|packaging)(\.([a-z_]{1,20}|[0-9]{1,3})){1,10}$' then
    raise exception 'That is not a line of this story.' using errcode = '22023';
  end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  insert into public.impact_story_line_notes (story_id, version, path, line_text, kind, note, actor)
  values (p_story, s.current_version, p_path, left(p_line, 2000), case when p_research then 'research' else 'fix' end, btrim(p_note), e)
  returning id into nid;
  perform public._hs_is_event(p_story, 'line_note', jsonb_build_object('id', nid, 'path', p_path, 'research', coalesce(p_research, false)), e);
  return jsonb_build_object('id', nid, 'line_notes', public._hs_is_line_notes(p_story));
end $$;

create or replace function public.hs_impact_story_line_note_withdraw(p_story uuid, p_note bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st text;
begin
  select x->>'status' into st from jsonb_array_elements(public._hs_is_line_notes(p_story)) x where (x->>'id')::bigint = p_note;
  if st is null then raise exception 'No such note on this story.' using errcode = 'P0002'; end if;
  if st = 'withdrawn' then return jsonb_build_object('line_notes', public._hs_is_line_notes(p_story)); end if;
  if st = 'sending' then raise exception 'The fixer is already working on this note.' using errcode = '55000'; end if;
  insert into public.impact_story_line_notes (story_id, version, path, kind, withdraws, actor)
  select n.story_id, n.version, n.path, 'withdraw', n.id, e from public.impact_story_line_notes n where n.id = p_note;
  return jsonb_build_object('line_notes', public._hs_is_line_notes(p_story));
end $$;

create or replace function public.impact_fix_batch_complete(p_batch uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype; st text := p_payload->>'status'; outs jsonb := coalesce(p_payload->'outcomes', '[]'::jsonb);
        regen text := nullif(p_payload->>'regenerate', ''); job jsonb;
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  if b.status not in ('working', 'planning') then raise exception 'batch is %, not working', b.status using errcode = '55000'; end if;
  if st not in ('done', 'needs_you', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  if b.status = 'planning' and (st <> 'failed' or regen is not null) then
    raise exception 'a plan run can only finish as failed (a written plan is recorded with impact_fix_batch_plan)' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'summary'), '') is null then raise exception 'say what was done' using errcode = '22023'; end if;
  if regen is not null and regen not in ('generate', 'analyze', 'pack') then raise exception 'bad regenerate' using errcode = '22023'; end if;
  if jsonb_typeof(outs) <> 'array' or exists (select 1 from jsonb_array_elements(outs) o
       where o->>'outcome' not in ('fixed', 'needs_you', 'not_changed')
          or not (b.requests @> jsonb_build_array(jsonb_build_object('id', (o->>'decision_id')::bigint)))) then
    raise exception 'outcomes must name requests of this batch with fixed, needs_you or not_changed' using errcode = '22023';
  end if;
  if st in ('done', 'needs_you') and exists (select 1 from jsonb_array_elements(b.requests) r
       where not exists (select 1 from jsonb_array_elements(outs) o where (o->>'decision_id')::bigint = (r->>'id')::bigint)) then
    raise exception 'every request needs an outcome' using errcode = '22023';
  end if;
  if st = 'done' and exists (select 1 from jsonb_array_elements(outs) o where o->>'outcome' = 'needs_you') then
    raise exception 'a request that needs the founder makes the batch needs_you' using errcode = '22023';
  end if;
  if regen = 'pack' then
    job := public._hs_is_queue(b.story_id, 'pack', jsonb_build_object('scope', 'all', 'then', 'generate'), 'fixer', true);
  elsif regen is not null then
    job := public._hs_is_request(b.story_id, regen, 'all', true, 'fixer');
  end if;
  update public.impact_story_fix_batches set status = st, completed_at = now(), summary = left(p_payload->>'summary', 2000),
         next_step = left(nullif(p_payload->>'next_step', ''), 300), outcomes = outs, pr_url = nullif(p_payload->>'pr_url', '')
   where id = b.id;
  perform public._hs_is_event(b.story_id, 'fix_batch_' || st, jsonb_build_object('batch', b.id, 'regenerate', regen,
    'fixed', (select count(*) from jsonb_array_elements(outs) o where o->>'outcome' = 'fixed')), 'fixer');
  return jsonb_build_object('ok', true, 'status', st, 'job', job);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._hs_is_admin()', 'public._hs_is_artifact(jsonb, text)', 'public._hs_is_hash(jsonb, text)',
    'public._hs_is_fresh(public.impact_stories)', 'public._hs_is_artifact_state(uuid, text)', 'public._hs_is_status(uuid)',
    'public._hs_is_event(uuid, text, jsonb, text)', 'public._hs_is_dispatch(uuid)', 'public._hs_is_queue(uuid, text, jsonb, text, boolean)',
    'public._hs_is_retry(uuid, text)', 'public._hs_is_followup(uuid, text)', 'public._hs_is_append_only()', 'public._hs_is_version_guard()',
    'public._hs_is_stuck_after(text)', 'public._hs_is_media(uuid)', 'public._hs_is_not_started(public.impact_story_jobs)',
    'public._hs_is_request(uuid, text, text, boolean, text)', 'public._hs_is_choices(uuid)',
    'public._hs_is_fix_batch(uuid)', 'public._hs_is_fix_eligible(uuid)', 'public._hs_is_fix_dispatch(uuid, text)', 'public._hs_is_fix_checks(uuid)',
    'public._hs_is_line_notes(uuid)',
    'public._hs_is_choice_key(uuid)', 'public._hs_is_visuals(uuid)', 'public._hs_is_rejections(uuid)', 'public._hs_is_shot_decisions(bigint)',
    'public._hs_is_shot_print(jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.hs_impact_story_catalog()', 'public.hs_impact_story_list()', 'public.hs_impact_story_get(uuid)',
    'public.hs_impact_story_version(uuid, integer)', 'public.hs_impact_story_create(text, text)', 'public.hs_impact_story_duplicate(uuid)',
    'public.hs_impact_story_archive(uuid, text, boolean)', 'public.hs_impact_story_request(uuid, text, text, boolean)',
    'public.hs_impact_story_job_retry(uuid)', 'public.hs_impact_story_save(uuid, integer, jsonb, text)',
    'public.hs_impact_story_angle(uuid, integer, text, text)', 'public.hs_impact_story_decide(uuid, text, text, integer, text, text)',
    'public.hs_impact_story_section_revision(uuid, integer, text, text)', 'public.hs_impact_story_render(uuid, integer, boolean)',
    'public.hs_impact_story_media_decide(uuid, bigint, text, text, text)', 'public.hs_impact_story_choose_asset(uuid, uuid, text, text)',
    'public.hs_impact_story_unchoose_asset(uuid, text, text)',
    'public.hs_impact_story_fix_start(uuid)', 'public.hs_impact_story_fix_confirm(uuid, uuid, text)', 'public.hs_impact_story_fix_cancel(uuid, uuid)',
    'public.hs_impact_story_visuals_prepare(uuid, integer, boolean)',
    'public.hs_impact_story_line_note(uuid, text, text, text, boolean)', 'public.hs_impact_story_line_note_withdraw(uuid, bigint)',
    'public.hs_impact_story_visuals_approve(uuid, bigint, text)', 'public.hs_impact_story_visuals_revoke(uuid, bigint, text)',
    'public.hs_impact_story_upload_photo(uuid, text, uuid, text, text, text, boolean, boolean)',
    'public.hs_impact_story_photo_reject(uuid, bigint, text, text)', 'public.hs_impact_story_photo_restore(uuid, text)',
    'public.hs_impact_story_shot_decide(uuid, bigint, text, text, text, text, text)',
    'public.hs_impact_story_shots_approve(uuid, bigint, text, text, _text)', 'public.hs_impact_story_photos_reject(uuid, bigint, _text, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.hs_impact_story_job_claim(uuid)', 'public.hs_impact_story_job_fail(uuid, text, jsonb)',
                           'public.hs_impact_story_job_complete(uuid, jsonb)', 'public.impact_fix_batches_list()',
                           'public.impact_fix_batch_claim(uuid)', 'public.impact_fix_batch_complete(uuid, jsonb)', 'public.impact_fix_batch_plan(uuid, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

commit;
select to_regclass('public.impact_story_line_notes')::text as line_notes_table;
