-- Tab 20 · Weekly Report, 6 of 7: DOCUMENT-EVIDENCE CUES. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- A person-chosen document visual per script segment, checked by a visual_check run.
-- Needs: 1 (base), 3 (workbench), 4 (source copies: a cue shows a page of a STORED source copy; the weekly-visuals bucket).
-- Application order (docs/weekly-release-order.md): 1 base · 2 topic queue  [the queue-only release ends here]
--   · 3 workbench · 4 source copies · 5 titles · 6 document cues · 7 topic-queue approval gate.
-- Each file is one transaction and is idempotent; re-applying an earlier file after a later one changes nothing.

begin;

-- ── document-evidence cues (a segment's visual) ──────────────────────────────────────────────────────────────────
-- A cue says: while this segment is spoken, show this page of this stored source with these words highlighted in yellow.
-- It is resolved by homesignal-ingest weekly_slice/doc_cue.py with Tab 16's own document code (video/pdf_tools.find_quote,
-- video/build.stage_assets, video/build.visual -> the DocScene props). A cue is chosen by a person (hs_weekly_doc_cue_set);
-- a segment that only cites a document gets no document visual. An unresolved cue blocks approval; nothing is substituted.
create or replace function public.weekly_cue_count(b jsonb) returns integer language sql immutable parallel safe as $$
  select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(b -> 'segments') = 'array' then b -> 'segments' else '[]'::jsonb end) g
  where jsonb_typeof(g -> 'visual') = 'object'
$$;

-- The document cue checks of a version: the newest visual_check run done on this exact text.
create or replace function public.weekly_visual_checks(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select r.result -> 'checks' from public.weekly_runs r join public.weekly_scripts v on v.id = p_id
   where r.kind = 'visual_check' and r.status = 'done' and r.input ->> 'version_id' = p_id::text
     and r.result ->> 'body_sha256' = v.body_sha256 order by r.finished_at desc limit 1
$$;

-- A person sets (or, with p_cue null, removes) one segment's document cue. The result is a NEW script version that differs
-- from p_script only in that cue (the lineage guard enforces it); it needs its own approval, and a visual_check run
-- resolves its cues against the stored documents.
create or replace function public.hs_weekly_doc_cue_set(p_script uuid, p_segment integer, p_cue jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; g jsonb; b jsonb; nv uuid; q jsonb := '{}';
        cid text; src public.weekly_sources;
begin
  select * into v from public.weekly_scripts where id = p_script and stage = 'script';
  if v.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; set the cue on that one' using errcode = '22023'; end if;
  if (st ->> 'outdated')::boolean then raise exception 'this script is outdated' using errcode = '22023'; end if;
  g := v.body -> 'segments' -> p_segment;
  if g is null then raise exception 'no such segment' using errcode = '22023'; end if;
  if p_cue is not null and jsonb_typeof(p_cue) <> 'null' then
    if jsonb_typeof(p_cue) <> 'object' or exists (select 1 from jsonb_object_keys(p_cue) k
         where k not in ('type', 'claim_id', 'source_id', 'page', 'quote', 'highlight')) then
      raise exception 'a cue has type, claim_id, source_id, page, quote and highlight only' using errcode = '22023';
    end if;
    if p_cue ->> 'type' is distinct from 'doc' then raise exception 'a document cue has type doc' using errcode = '22023'; end if;
    if p_cue ->> 'highlight' is distinct from 'yellow' then raise exception 'the highlight is yellow' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_cue ->> 'quote', ''))) not between 1 and 1000 then
      raise exception 'the words to highlight are 1 to 1000 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(p_cue -> 'page') not in ('null', 'number') or (jsonb_typeof(p_cue -> 'page') = 'number'
         and ((p_cue ->> 'page')::numeric <> trunc((p_cue ->> 'page')::numeric) or (p_cue ->> 'page')::numeric < 1)) then
      raise exception 'the page is a page number (1 or more) or empty' using errcode = '22023';
    end if;
    cid := p_cue ->> 'claim_id';
    if not (g -> 'claim_ids') ? cid then raise exception 'the segment does not cite %', cid using errcode = '22023'; end if;
    select w.* into src from public.weekly_sources w
      join public.weekly_finding_sources fs on fs.source_id = w.id
      join public.weekly_findings f on f.id = fs.finding_id
      join public.weekly_library_version_findings x on x.finding_id = f.id and x.library_version_id = v.library_version_id
     where w.id::text = p_cue ->> 'source_id' and f.finding_key || '@' || f.version = cid;
    if src.id is null then raise exception 'that source is not a source of % in this library', cid using errcode = '22023'; end if;
    if src.document_path is null then
      raise exception 'no stored copy of that source (only an excerpt or a link is kept)' using errcode = '22023';
    end if;
    if src.document_kind = 'html' and jsonb_typeof(p_cue -> 'page') = 'number' then
      raise exception 'a saved web page has no page numbers' using errcode = '22023';
    end if;
    b := jsonb_set(v.body, array['segments', p_segment::text, 'visual'],
                   jsonb_build_object('type', 'doc', 'claim_id', cid, 'source_id', src.id, 'page', p_cue -> 'page',
                                      'quote', btrim(p_cue ->> 'quote'), 'highlight', 'yellow'));
  else
    b := jsonb_set(v.body, array['segments', p_segment::text, 'visual'], 'null'::jsonb);
  end if;
  -- a segment with no visual key and one with visual null both have no cue
  if coalesce(b -> 'segments' -> p_segment -> 'visual', 'null'::jsonb) = coalesce(g -> 'visual', 'null'::jsonb) then
    raise exception 'the cue is unchanged' using errcode = '22023';
  end if;
  insert into public.weekly_scripts (stage, parent_id, depends_on, selected_index, topic, library_version_id, profile_id,
                                     lessons_included, body, checks, kind)
    values ('script', v.id, v.depends_on, v.selected_index, v.topic, v.library_version_id, v.profile_id, v.lessons_included,
            b, v.checks || jsonb_build_object('text_checks_from', v.id), 'human_reviewed')
    returning id into nv;
  if public.weekly_cue_count(b) > 0 then
    q := public._wk_queue('visual_check', v.topic, jsonb_build_object('version_id', nv), e);
  end if;
  return jsonb_build_object('script_version', nv) || q;
end $$;

-- The document cue checks of one script version (visual_check run, no AI step). Recorded against the body hash.
create or replace function public.weekly_visual_check_record(p_run uuid, p_body_sha256 text, p_checks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'visual_check' and status = 'running';
  if r.id is null then raise exception 'run is not a running visual check' using errcode = '55000'; end if;
  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then
    raise exception 'the checks were made on a different text' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_checks -> 'ok'), '') <> 'boolean' or coalesce(jsonb_typeof(p_checks -> 'segments'), '') <> 'array' then
    raise exception 'document cue checks have ok and segments' using errcode = '22023';
  end if;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, note)
    values (r.id, 'verification', 'runner_minutes', 'report', 'document cue checks on a GitHub runner (no AI call)');
  update public.weekly_runs set status = 'done', finished_at = now(),
    result = jsonb_build_object('body_sha256', p_body_sha256, 'checks', p_checks) where id = r.id;
end $$;

-- ── function grants ──
do $$
declare f text;
begin
  foreach f in array array[
    'weekly_cue_count(jsonb)', 'weekly_visual_checks(uuid)', 'hs_weekly_doc_cue_set(uuid,integer,jsonb)',
    'weekly_visual_check_record(uuid,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'hs_weekly_doc_cue_set(uuid,integer,jsonb)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'weekly_visual_check_record(uuid,text,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
