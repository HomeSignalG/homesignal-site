-- One-time apply of the Tab 17 creator-directed stories database half (PR #2634), 2026-11-06.
-- Run once with db-sql.yml from main as soon as #2634 merges, before its Pages deploy finishes (the page calls these).
-- GENERATED, not written by hand: every statement of docs/impact-stories.sql and docs/impact-discovery.sql on PR #2634's
-- branch (8b4e4a3, the commit before this file) that is not, after removing comment lines, a statement of the same file on main (ceb97a9), in file
-- order. Statements already on main are already live (checked 2026-11-06: 93 of the 95 Impact functions defined there
-- match production by md5(prosrc); the other two differ only in comment lines). The definitions of record stay in those
-- two files.
-- Each part starts with a guard that refuses unless every function it replaces still fingerprints as read on
-- 2026-11-06, so it cannot overwrite a change another session made since.
begin;
set local lock_timeout = '5s';
do $g$
declare bad text;
begin
  select string_agg(x.f, ', ') into bad from (values ('_hs_is_artifact','ca3fc2c99f479e84a22594dec6c16782'), ('_hs_is_artifact_state','449dc0874f733783f77d29acb0a6f146'), ('_hs_is_status','0b14c690cba0fb2709ab49b6dd43f451'), ('hs_impact_story_get','f4cee73d5c067c09ec530f3cff87dd5f'), ('hs_impact_story_render','7dc1583b8f8912b628c07569f9af25e2'), ('_hs_is_fix_eligible','2d6cf0a132dbed81bd26279e1a8b4d2b'), ('hs_impact_story_line_note','937c253a8e4fe676321191a839374ea4')) x(f, h)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = x.f and md5(p.prosrc) = x.h);
  if bad is not null then raise exception 'impact-stories creator apply: live function changed since it was read: %', bad; end if;
end $g$;

-- CREATOR-DIRECTED STORIES (founder brief 2026-11-06, "Build creator-directed Impact Stories"). A story is made in one of
-- two modes: 'jody' (JODY researches and writes it; everything above) or 'creator' (the founder supplies the script scene
-- by scene; homesignal-ingest impact/creator.py). In creator mode the founder's words are LOCKED: research fact-checks
-- them and FLAGS problems with a suggested replacement, but never changes them. The words change only through the
-- founder's own revision (a row below), which travels to the engine as a Fix request of kind 'creator_script' and comes
-- back as a new version. The one narrative approval ("Approve & Lock Script") covers the script; it is refused while a
-- high-risk flag is open, a low-risk flag is undecided, or a revision is waiting (_hs_is_creator_state).
alter table public.impact_stories add column if not exists creation_mode text not null default 'jody';

alter table public.impact_stories drop constraint if exists impact_stories_creation_mode_check;

alter table public.impact_stories add constraint impact_stories_creation_mode_check check (creation_mode in ('jody', 'creator'));

-- Every version of the founder's script: the original (copied from the topic when the story is created), each revision
-- they propose (their own edits, or a suggestion they accepted), and withdrawals. Append-only. The id comes from the
-- same sequence as the fix requests, so a revision can be one request in a Fix batch.
create table if not exists public.impact_story_creator_scripts (
  id          bigint primary key default nextval('public.impact_story_media_decisions_id_seq'::regclass),
  story_id    uuid not null references public.impact_stories(id),
  kind        text not null check (kind in ('original', 'revision', 'withdraw')),
  script      jsonb,
  script_hash text check (script_hash is null or script_hash ~ '^[0-9a-f]{32}$'),
  based_on    text,                        -- the script version this revision was made from
  source      text check (source is null or source in ('topic', 'edit', 'accept_suggestion')),
  note        text check (note is null or char_length(note) <= 1000),
  withdraws   bigint references public.impact_story_creator_scripts(id),
  actor       text not null,
  at          timestamptz not null default now(),
  check ((kind = 'withdraw') = (withdraws is not null)),
  check (kind = 'withdraw' or (script is not null and script_hash is not null))
);

create index if not exists impact_story_creator_scripts_story on public.impact_story_creator_scripts (story_id, id);

alter table public.impact_story_creator_scripts enable row level security;

revoke all on public.impact_story_creator_scripts from public, anon, authenticated;

-- The founder's decision on one fact-check flag of one script version: 'keep' (keep my words; low-risk flags only) or
-- 'accept' (the suggestion went into a revision). Keyed by the engine's flag key (impact/creator.py _item_key), so a
-- decision never carries over to a different sentence, verdict, suggestion or script version. Append-only.
create table if not exists public.impact_story_creator_flag_decisions (
  id          bigint generated always as identity primary key,
  story_id    uuid not null references public.impact_stories(id),
  script_hash text not null check (script_hash ~ '^[0-9a-f]{32}$'),
  flag_key    text not null check (flag_key ~ '^[0-9a-f]{32}$'),
  decision    text not null check (decision in ('keep', 'accept')),
  note        text check (note is null or char_length(note) <= 1000),
  actor       text not null,
  at          timestamptz not null default now()
);

create index if not exists impact_story_creator_flag_decisions_story on public.impact_story_creator_flag_decisions (story_id, script_hash);

alter table public.impact_story_creator_flag_decisions enable row level security;

revoke all on public.impact_story_creator_flag_decisions from public, anon, authenticated;

drop trigger if exists impact_story_creator_scripts_append_only on public.impact_story_creator_scripts;

create trigger impact_story_creator_scripts_append_only before update or delete on public.impact_story_creator_scripts
  for each row execute function public._hs_is_append_only();

drop trigger if exists impact_story_creator_flag_decisions_append_only on public.impact_story_creator_flag_decisions;

create trigger impact_story_creator_flag_decisions_append_only before update or delete on public.impact_story_creator_flag_decisions
  for each row execute function public._hs_is_append_only();

-- ── creator-directed stories: the script contract (mirrors homesignal-ingest impact/creator.py and lib/creator-script.js) ──
-- The script version: md5 of every scene's n, stage, stage_label, headline and narration, fields joined by U+001F and
-- scenes by U+001E. impact/creator.py script_hash builds the same string, so the engine and the database name a version
-- the same way.
create or replace function public._hs_is_creator_hash(p jsonb)
returns text language sql immutable as $$
  select md5(coalesce(string_agg(coalesce(s->>'n', '') || chr(31) || coalesce(s->>'stage', '') || chr(31)
           || coalesce(s->>'stage_label', '') || chr(31) || coalesce(s->>'headline', '') || chr(31) || coalesce(s->>'narration', ''),
           chr(30) order by o), ''))
    from jsonb_array_elements(case when jsonb_typeof(p->'scenes') = 'array' then p->'scenes' else '[]'::jsonb end) with ordinality x(s, o)
$$;

-- The contract's refusals in plain words (empty = usable). Mirrors impact/creator.py problems().
create or replace function public._hs_is_creator_problems(p jsonb)
returns text[] language plpgsql immutable as $$
declare out text[] := '{}'; s jsonb; i int := 0; tot int := 0; k text; u jsonb; v text; ws text := E' \t\n\r\x0b\x0c';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return array['the creator script is not an object']; end if;
  if p->>'format' is distinct from 'creator-script/1' then out := out || 'the creator script''s format must be creator-script/1'::text; end if;
  if coalesce(jsonb_typeof(p->'target_seconds'), 'null') <> 'null' and (jsonb_typeof(p->'target_seconds') <> 'number'
     or (p->>'target_seconds') !~ '^[0-9]{1,6}$' or (p->>'target_seconds')::int not between 10 and 3600) then
    out := out || 'the target duration must be 10 to 3600 seconds'::text;
  end if;
  if char_length(coalesce(p->>'raw', '')) > 200000 then out := out || 'the pasted storyboard is longer than 200000 characters'::text; end if;
  if coalesce(jsonb_typeof(p->'scenes'), 'null') <> 'array' or jsonb_array_length(p->'scenes') = 0 then
    return out || 'the creator script has no scenes'::text;
  end if;
  if jsonb_array_length(p->'scenes') > 60 then out := out || format('at most 60 scenes (has %s)', jsonb_array_length(p->'scenes')); end if;
  for s in select x from jsonb_array_elements(p->'scenes') x loop
    i := i + 1;
    if jsonb_typeof(s) <> 'object' then out := out || format('Scene %s is not an object', i); continue; end if;
    if (s->>'n') is distinct from i::text or jsonb_typeof(s->'n') <> 'number' then
      out := out || format('Scene %s is numbered %s; scenes are numbered 1, 2, 3 ... in order', i, coalesce(s->>'n', 'nothing'));
    end if;
    if coalesce(s->>'stage', '') not in ('fear', 'anger', 'motivation', 'custom') then
      out := out || format('Scene %s: the emotional stage must be fear, anger, motivation or custom', i);
    end if;
    if s->>'stage' = 'custom' and char_length(coalesce(s->>'stage_label', '')) not between 1 and 60 then
      out := out || format('Scene %s: name the custom stage (1 to 60 characters)', i);
    end if;
    if coalesce(s->>'stage', '') <> 'custom' and coalesce(s->>'stage_label', '') <> '' then
      out := out || format('Scene %s: only a custom stage has a name', i);
    end if;
    if coalesce(jsonb_typeof(s->'seconds'), 'null') <> 'null' and ((s->>'seconds') !~ '^[0-9]{1,6}$' or (s->>'seconds')::int not between 1 and 600) then
      out := out || format('Scene %s: the duration must be 1 to 600 seconds', i);
    end if;
    if coalesce(btrim(s->>'narration', ws), '') = '' then out := out || format('Scene %s has no narration', i); end if;
    if char_length(coalesce(s->>'narration', '')) > 5000 then out := out || format('Scene %s: the narration is longer than 5000 characters', i); end if;
    if char_length(coalesce(s->>'headline', '')) > 300 then out := out || format('Scene %s: the headline is longer than 300 characters', i); end if;
    foreach k in array array['visual', 'audio'] loop
      if char_length(coalesce(s->>k, '')) > 2000 then out := out || format('Scene %s: the %s direction is longer than 2000 characters', i, k); end if;
    end loop;
    foreach k in array array['headline', 'narration', 'visual', 'audio', 'stage_label'] loop
      if coalesce(jsonb_typeof(s->k), 'null') not in ('null', 'string') then
        out := out || format('Scene %s: %s must be text', i, k);
      elsif jsonb_typeof(s->k) = 'string' then
        v := s->>k;
        if v <> btrim(v, ws) or position(chr(13) in v) > 0 then
          out := out || format('Scene %s: %s is not stored in its clean form (outer spaces or CR)', i, k);
        end if;
      end if;
    end loop;
    if coalesce(jsonb_typeof(s->'sources'), 'null') not in ('null', 'array') or jsonb_array_length(coalesce(nullif(s->'sources', 'null'::jsonb), '[]')) > 10 then
      out := out || format('Scene %s: at most 10 source links', i);
    else
      for u in select x from jsonb_array_elements(coalesce(nullif(s->'sources', 'null'::jsonb), '[]')) x loop
        if jsonb_typeof(u) <> 'string' or (u #>> '{}') !~* '^https?://[^\s/?#]+\.[^\s/?#]+(/\S*)?$' or char_length(u #>> '{}') > 1000 then
          out := out || format('Scene %s: %s is not a web link', i, left(u #>> '{}', 80));
        end if;
      end loop;
    end if;
    tot := tot + char_length(coalesce(s->>'narration', ''));
  end loop;
  if tot > 60000 then out := out || format('the narration totals %s characters (at most 60000)', tot); end if;
  return out;
end $$;

-- Raises the first problems in one readable message, or returns the script's version hash.
create or replace function public._hs_is_creator_require(p jsonb)
returns text language plpgsql immutable as $$
declare pr text[] := public._hs_is_creator_problems(p);
begin
  if cardinality(pr) > 0 then
    raise exception 'Your script cannot be saved: %', array_to_string(pr[1:5], '; ') using errcode = '22023';
  end if;
  return public._hs_is_creator_hash(p);
end $$;

-- The slice of a body one approval covers. Mirrors impact/rules.py::artifact_slice.
create or replace function public._hs_is_artifact(p_body jsonb, p_artifact text)
returns jsonb language sql immutable as $$
  select case p_artifact
    -- impact-story/3 adds discovery, concepts and selection, each only when present, so an impact-story/2 body
    -- hashes exactly as before and an approval given before V3 still stands.
    when 'narrative' then jsonb_build_object('arc', p_body->'arc', 'outline', p_body->'outline', 'main', p_body->'main',
         'qol', p_body->'qol', 'shorts', p_body->'shorts', 'packaging', p_body->'packaging')
         || case when coalesce(p_body->'discovery', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('discovery', p_body->'discovery') else '{}'::jsonb end
         || case when coalesce(p_body->'concepts', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('concepts', p_body->'concepts') else '{}'::jsonb end
         || case when coalesce(p_body->'selection', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('selection', p_body->'selection') else '{}'::jsonb end
         -- a creator-directed story: the founder's script and its fact-check are part of what is approved (and locked)
         || case when coalesce(p_body->'creator_script', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('creator_script', p_body->'creator_script') else '{}'::jsonb end
         || case when coalesce(p_body->'creator_review', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('creator_review', p_body->'creator_review') else '{}'::jsonb end
    when 'angle' then jsonb_build_object('selected', p_body->'selected_angle',
         'card', (select a from jsonb_array_elements(coalesce(p_body->'angles', '[]'::jsonb)) a
                   where a->>'id' = p_body->>'selected_angle' limit 1))
    when 'main' then jsonb_build_object('main', p_body->'main', 'qol', p_body->'qol', 'selected', p_body->'selected_angle')
    when 'short_a' then p_body->'shorts'->'a'
    when 'short_b' then jsonb_build_object('b', p_body->'shorts'->'b', 'exception', p_body->'shorts'->'b_exception')
    when 'packaging' then p_body->'packaging'
  end
$$;

-- Per-artifact effective state: approved | rejected | revoked | stale | checking | blocked | pending.
create or replace function public._hs_is_artifact_state(p_story uuid, p_artifact text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; a public.impact_story_approvals%rowtype;
        h text; chk jsonb; st text; why text; cg jsonb;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  if not found then return jsonb_build_object('state', 'pending', 'why', 'Nothing written yet.'); end if;
  h := public._hs_is_hash(v.body, p_artifact);
  chk := v.validation -> p_artifact;
  select * into a from public.impact_story_approvals where story_id = p_story and artifact = p_artifact order by id desc limit 1;
  if v.validation is null or v.validated_pack_hash is distinct from s.pack_hash then
    st := 'checking'; why := 'The engine has not checked this version against the current sources yet.';
  elsif not coalesce((chk->>'ok')::boolean, false) then
    st := 'blocked'; why := coalesce(chk->'blocking'->>0, (v.validation->'pack'->'blocking')->>0, 'Blocked by the evidence checks.');
  elsif not public._hs_is_fresh(s) then
    st := 'blocked'; why := 'The sources were last checked more than ' || coalesce(s.pack->>'fresh_days', '30') || ' days ago. Re-check sources.';
  else
    st := 'pending'; why := 'Ready for your decision.';
  end if;
  -- a creator-directed story: "Approve & Lock Script" needs every flag on the founder's words resolved and no revision waiting
  if p_artifact = 'narrative' and st = 'pending' and s.creation_mode = 'creator' then
    cg := public._hs_is_creator_state(p_story);
    if not coalesce((cg->>'ok')::boolean, false) then st := 'blocked'; why := cg->>'why'; end if;
  end if;
  if a.id is not null then
    if a.decision = 'approved' and a.artifact_hash = h and st = 'pending' then st := 'approved'; why := 'Approved on version ' || a.version || '.';
    elsif a.decision = 'approved' and a.artifact_hash = h then why := 'Your approval of version ' || a.version || ' is on hold: ' || why;
    elsif a.decision = 'approved' then why := 'Changed since you approved version ' || a.version || '. ' || why;
    elsif a.decision = 'rejected' and a.artifact_hash = h then st := 'rejected'; why := coalesce('Rejected: ' || a.note, 'Rejected.');
    elsif a.decision = 'revoked' and a.artifact_hash = h then st := 'revoked'; why := 'Approval revoked' || coalesce(': ' || a.note, '.');
    end if;
  end if;
  return jsonb_build_object('state', st, 'why', why, 'hash', h, 'version', s.current_version,
                            'last_decision', case when a.id is null then null else
                              jsonb_build_object('decision', a.decision, 'version', a.version, 'actor', a.actor, 'at', a.at, 'note', a.note) end);
end $$;

-- Where the story is, and the ONE next action (v2.4 J: one clearly labelled primary action).
create or replace function public._hs_is_status(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; j public.impact_story_jobs%rowtype;
        arts jsonb := '{}'::jsonb; k text; stage text; nxt text; lib text; all_ok boolean := true; m jsonb; vs jsonb;
        owner text := 'you'; cs jsonb;
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
    stage := 'script'; nxt := 'Review and approve the integrated narrative'; lib := 'needs_review';
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
    elsif (m->>'current')::boolean then stage := 'media'; nxt := 'Review each video and the thumbnail'; lib := 'needs_review';
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
      'stuck', (j.status in ('queued', 'running') and j.created_at < now() - public._hs_is_stuck_after(j.kind))
               or public._hs_is_not_started(j) is not null) end);
end $$;

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
    'creator', public._hs_is_creator_state(p_story),
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

-- Save the founder's edits as a NEW version (optimistic lock), then re-check it.
-- Render the approved narrative (16:9 main, 9:16 Shorts, thumbnail, captions, QC stills). Only an APPROVED, checked,
-- fresh narrative can be rendered; the same narrative + renderer returns the existing render unless p_new.
create or replace function public.hs_impact_story_render(p_story uuid, p_expected_version integer, p_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; na jsonb; ch jsonb; ck jsonb; vs jsonb;
        vm public.impact_story_visual_manifests%rowtype;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  na := public._hs_is_artifact_state(p_story, 'narrative');
  if na->>'state' <> 'approved' then
    raise exception 'Approve the integrated narrative before rendering. %', na->>'why' using errcode = '55000';
  end if;
  -- the visuals (every shot's picture) must be approved too (2026-10-29): the render carries that manifest's hash and
  -- the engine refuses a plan that hashes to anything else, so the video shows exactly what was approved
  vs := public._hs_is_visuals(p_story);
  if vs->>'state' <> 'approved' then
    raise exception 'Approve the visuals before rendering. %', vs->>'why' using errcode = '55000';
  end if;
  select * into vm from public.impact_story_visual_manifests where id = (vs->>'manifest_id')::bigint;
  ck := public._hs_is_choice_key(p_story);
  ch := ck->'choices';
  -- the photos chosen are frozen into the job, and their ids and the approved visuals are part of its key, so a new
  -- choice or a new approval makes the next Render a new job while the same ones never render twice
  return public._hs_is_queue(p_story, 'render', jsonb_build_object('scope', 'render|' || (na->>'hash') || '|impact-render-3|'
    || (ck->>'key') || '|' || vm.manifest_hash,
    'narrative_hash', na->>'hash', 'renderer', 'impact-render-3', 'asset_choices', ch, 'rejected_photos', ck->'rejected',
    'visual_manifest', jsonb_build_object('hash', vm.manifest_hash, 'opts', vm.opts, 'manifest_id', vm.id))
    -- a creator-directed story: the locked script version (also inside the narrative hash) is named on the job
    || case when s.creation_mode = 'creator' then jsonb_build_object('creator_script_hash',
         public._hs_is_creator_hash((select v.body->'creator_script' from public.impact_story_versions v
                                     where v.story_id = p_story and v.version = s.current_version))) else '{}'::jsonb end, e, p_new);
end $$;

-- Where a creator-directed story's script stands: the version in the current draft (locked), every revision with its status
-- (current · proposed · sending · applying · superseded · withdrawn), the fact-check flags of the current version with the
-- founder's decisions, and whether "Approve & Lock Script" may be pressed now (ok / why). A JODY-written story returns
-- {mode: 'jody'}. The engine's flags are read only from a validation made against the CURRENT source pack.
create or replace function public._hs_is_creator_state(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; cur text; val jsonb; revs jsonb; pend jsonb;
        flags jsonb; hi int; lo int; why text; okk boolean;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found or s.creation_mode <> 'creator' then return jsonb_build_object('mode', 'jody'); end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  cur := case when v.body ? 'creator_script' then public._hs_is_creator_hash(v.body->'creator_script') end;
  val := case when v.validation is not null and v.validated_pack_hash is not distinct from s.pack_hash then v.validation->'creator' end;
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint desc), '[]'::jsonb) into revs from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'script_hash', c.script_hash, 'based_on', c.based_on, 'source', c.source,
             'note', c.note, 'actor', c.actor, 'at', c.at, 'script', c.script,
             'status', case
               when exists (select 1 from public.impact_story_creator_scripts w where w.withdraws = c.id) then 'withdrawn'
               when c.script_hash = cur then 'current'
               when fb.status in ('plan_queued', 'planning', 'planned', 'queued', 'working') then 'sending'
               when fb.status = 'done' and c.id = (select max(x.id) from public.impact_story_creator_scripts x
                                                    where x.story_id = p_story and x.kind = 'revision') then 'applying'
               when c.kind = 'revision' and c.id = (select max(x.id) from public.impact_story_creator_scripts x
                                                     where x.story_id = p_story and x.kind = 'revision'
                                                       and not exists (select 1 from public.impact_story_creator_scripts w where w.withdraws = x.id))
                 then 'proposed'
               else 'superseded' end,
             'batch', case when fb.id is null then null else jsonb_build_object('id', fb.id, 'status', fb.status, 'next_step', fb.next_step,
                        'outcome', (select o->>'outcome' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = c.id limit 1),
                        'answer', (select o->>'note' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = c.id limit 1)) end) r
      from public.impact_story_creator_scripts c
      left join lateral (select b.* from public.impact_story_fix_batches b where b.story_id = p_story
                          and b.requests @> jsonb_build_array(jsonb_build_object('id', c.id))
                          order by b.requested_at desc limit 1) fb on true
     where c.story_id = p_story and c.kind <> 'withdraw') q;
  select r into pend from jsonb_array_elements(revs) r where r->>'status' in ('proposed', 'sending', 'applying') order by (r->>'id')::bigint desc limit 1;
  select coalesce(jsonb_agg(f || jsonb_build_object(
           'decision', (select d.decision from public.impact_story_creator_flag_decisions d where d.story_id = p_story
                         and d.script_hash = cur and d.flag_key = f->>'key' order by d.id desc limit 1),
           'decision_note', (select d.note from public.impact_story_creator_flag_decisions d where d.story_id = p_story
                         and d.script_hash = cur and d.flag_key = f->>'key' order by d.id desc limit 1),
           'in_revision', pend is not null and (f->>'field') in ('narration', 'headline') and coalesce(f->>'sentence', '') <> ''
             and position(f->>'sentence' in coalesce((select sc->>(f->>'field') from jsonb_array_elements(pend->'script'->'scenes') sc
                                                   where sc->>'n' = f->>'scene' limit 1), '')) = 0)
         order by (f->>'scene')::int nulls last), '[]'::jsonb)
    into flags from jsonb_array_elements(coalesce(val->'flags', '[]'::jsonb)) f;
  select count(*) filter (where f->>'risk' = 'high'),
         count(*) filter (where f->>'risk' = 'low' and f->>'decision' is null and not (f->>'in_revision')::boolean)
    into hi, lo from jsonb_array_elements(flags) f;
  okk := false;
  if cur is null then why := 'The story has no copy of your script yet. Research writes it.';
  elsif v.validation is null or v.validated_pack_hash is distinct from s.pack_hash then why := 'Your script is being fact-checked against the current sources.';
  elsif val is null then why := 'This version carries no fact-check of your script. Ask Claude to redo it (send your script again with Fix).';
  elsif pend is not null and pend->>'status' = 'proposed' then why := 'You proposed a revised script. Send it with Fix (or withdraw it) before you approve.';
  elsif pend is not null then why := 'Your revised script is being applied and fact-checked. Approve the new version when it is ready.';
  elsif hi > 0 then why := format('%s sentence%s of your script %s a high-risk problem. Accept the suggestion or edit the scene; it cannot be kept as is.',
                              hi, case when hi = 1 then '' else 's' end, case when hi = 1 then 'has' else 'have' end);
  elsif lo > 0 then why := format('Decide on %s flag%s: accept the suggestion, edit, or keep your words.', lo, case when lo = 1 then '' else 's' end);
  elsif not coalesce((val->>'ok')::boolean, false) then why := coalesce('Your script: ' || (val->'blocking'->>0), 'Your script does not pass its checks.');
  else okk := true; why := 'Your script is checked. Approving locks it for production.';
  end if;
  return jsonb_build_object('mode', 'creator', 'current_hash', cur, 'script', v.body->'creator_script', 'checked', val is not null,
    'flags', flags, 'items', jsonb_array_length(coalesce(val->'items', '[]'::jsonb)), 'high', hi, 'low_open', lo,
    'timing', coalesce(val->'timing', '[]'::jsonb), 'arc', coalesce(val->'arc', '[]'::jsonb), 'scenes', coalesce(val->'scenes', '[]'::jsonb),
    'revisions', revs, 'pending', pend, 'ok', okk, 'why', why);
end $$;

-- Save a revised script (the founder's own edits). Becomes the one waiting revision; Fix sends it to the engine, which
-- applies it word for word, redoes the fact-check and writes a new version.
create or replace function public.hs_impact_story_creator_revise(p_story uuid, p_expected_version integer, p_script jsonb,
                                                                 p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; h text; st jsonb; rid bigint;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.creation_mode <> 'creator' then raise exception 'This story was written by JODY; it has no creator script.' using errcode = '55000'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  h := public._hs_is_creator_require(p_script);
  st := public._hs_is_creator_state(p_story);
  if h = st->>'current_hash' then raise exception 'This is the script the story has now. Change something first.' using errcode = '22023'; end if;
  if st->'pending'->>'status' in ('sending', 'applying') then
    raise exception 'Your last revision is being applied. Wait for the new version, then revise it.' using errcode = '55000';
  end if;
  if st->'pending'->>'script_hash' = h then return jsonb_build_object('unchanged', true, 'creator', st); end if;
  insert into public.impact_story_creator_scripts (story_id, kind, script, script_hash, based_on, source, note, actor)
  values (p_story, 'revision', p_script, h, st->>'current_hash', 'edit', nullif(btrim(p_note), ''), e) returning id into rid;
  perform public._hs_is_event(p_story, 'creator_revision', jsonb_build_object('id', rid, 'script_hash', h, 'source', 'edit'), e);
  return jsonb_build_object('id', rid, 'creator', public._hs_is_creator_state(p_story));
end $$;

-- The founder's answer to one flag of the current script version. 'keep' keeps their words (a low-risk flag only; a
-- high-risk problem is never kept). 'accept' puts the suggestion into the waiting revision (or starts one from the
-- current script): the sentence must appear exactly once in that scene's field.
create or replace function public.hs_impact_story_creator_flag_decide(p_story uuid, p_expected_version integer, p_flag_key text,
                                                                      p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; st jsonb; f jsonb; base jsonb; based text; fld text; txt text;
        sent text; sug text; n int; i int := 0; sc jsonb; newsc jsonb := '[]'::jsonb; h text; rid bigint; pend jsonb;
begin
  if p_decision not in ('keep', 'accept') then raise exception 'Choose keep or accept.' using errcode = '22023'; end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.creation_mode <> 'creator' then raise exception 'This story was written by JODY; it has no creator script.' using errcode = '55000'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  st := public._hs_is_creator_state(p_story);
  select x into f from jsonb_array_elements(st->'flags') x where x->>'key' = p_flag_key limit 1;
  if f is null then raise exception 'That flag is not on the current version of your script.' using errcode = 'P0002'; end if;
  if p_decision = 'keep' then
    if f->>'risk' <> 'low' then
      raise exception 'A high-risk problem cannot be kept. Accept the suggestion or edit the scene.' using errcode = '55000';
    end if;
    insert into public.impact_story_creator_flag_decisions (story_id, script_hash, flag_key, decision, note, actor)
    values (p_story, st->>'current_hash', p_flag_key, 'keep', nullif(btrim(p_note), ''), e);
    perform public._hs_is_event(p_story, 'creator_flag_kept', jsonb_build_object('flag', p_flag_key, 'scene', f->'scene'), e);
    return jsonb_build_object('creator', public._hs_is_creator_state(p_story));
  end if;
  sug := f->>'suggestion'; sent := f->>'sentence'; fld := f->>'field';
  if nullif(btrim(coalesce(sug, '')), '') is null or coalesce(sent, '') = '' or fld not in ('narration', 'headline') then
    raise exception 'This flag has no suggestion to accept. Edit the scene yourself.' using errcode = '55000';
  end if;
  pend := st->'pending';
  if pend->>'status' in ('sending', 'applying') then
    raise exception 'Your last revision is being applied. Wait for the new version.' using errcode = '55000';
  end if;
  if pend->>'status' = 'proposed' then base := pend->'script'; based := pend->>'based_on';
  else base := st->'script'; based := st->>'current_hash'; end if;
  for sc in select x from jsonb_array_elements(base->'scenes') x loop
    i := i + 1;
    if sc->>'n' = f->>'scene' then
      txt := coalesce(sc->>fld, '');
      n := case when sent = '' then 0 else (char_length(txt) - char_length(replace(txt, sent, ''))) / char_length(sent) end;
      if n <> 1 then
        raise exception 'Scene % does not contain that sentence exactly once any more (your revision already changed it). Edit the scene yourself.', f->>'scene'
          using errcode = '55000';
      end if;
      sc := jsonb_set(sc, array[fld], to_jsonb(btrim(replace(txt, sent, btrim(sug)))));
    end if;
    newsc := newsc || jsonb_build_array(sc);
  end loop;
  base := jsonb_set(base, '{scenes}', newsc);
  h := public._hs_is_creator_require(base);
  insert into public.impact_story_creator_scripts (story_id, kind, script, script_hash, based_on, source, note, actor)
  values (p_story, 'revision', base, h, based, 'accept_suggestion',
          left(coalesce(nullif(btrim(p_note), ''), 'Accepted the suggestion for scene ' || (f->>'scene') || '.'), 1000), e) returning id into rid;
  insert into public.impact_story_creator_flag_decisions (story_id, script_hash, flag_key, decision, note, actor)
  values (p_story, st->>'current_hash', p_flag_key, 'accept', nullif(btrim(p_note), ''), e);
  perform public._hs_is_event(p_story, 'creator_revision', jsonb_build_object('id', rid, 'script_hash', h, 'source', 'accept_suggestion', 'flag', p_flag_key), e);
  return jsonb_build_object('id', rid, 'creator', public._hs_is_creator_state(p_story));
end $$;

-- Take back the waiting revision before it is sent. The current (locked) script is unchanged.
create or replace function public.hs_impact_story_creator_revision_withdraw(p_story uuid, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st jsonb; r jsonb;
begin
  st := public._hs_is_creator_state(p_story);
  select x into r from jsonb_array_elements(coalesce(st->'revisions', '[]'::jsonb)) x where (x->>'id')::bigint = p_revision;
  if r is null then raise exception 'No such revision on this story.' using errcode = 'P0002'; end if;
  if r->>'status' <> 'proposed' then raise exception 'Only a revision you have not sent can be withdrawn (this one is %).', r->>'status' using errcode = '55000'; end if;
  insert into public.impact_story_creator_scripts (story_id, kind, withdraws, actor) values (p_story, 'withdraw', p_revision, e);
  perform public._hs_is_event(p_story, 'creator_revision_withdrawn', jsonb_build_object('id', p_revision), e);
  return jsonb_build_object('creator', public._hs_is_creator_state(p_story));
end $$;

-- The fix requests a new batch would carry: rejected decisions nothing has acted on (no later approval of that file, no
-- render since), not already in an active batch, and not already fixed by an earlier batch; plus every open note on a
-- script line (kind 'line', with the line's path and text, and whether research comes first); plus, in a creator-directed
-- story, the founder's waiting script revision (kind 'creator_script': the engine applies it word for word).
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
     where l->>'status' = 'open'
    union all
    select jsonb_build_object('id', (c->'pending'->>'id')::bigint, 'kind', 'creator_script', 'asset', 'script',
             'script', c->'pending'->'script', 'script_hash', c->'pending'->>'script_hash', 'rev', (c->'pending'->>'id')::bigint,
             'based_on', c->'pending'->>'based_on', 'note', coalesce(c->'pending'->>'note', 'My revised script.'), 'at', c->'pending'->>'at')
      from (select public._hs_is_creator_state(p_story) c) x
     where c->'pending'->>'status' = 'proposed') q
$$;

-- Save a note on one script line. p_research = true asks the fixer to look up the official documents first.
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
  if s.creation_mode = 'creator' and p_path ~ '^main\.(.*\.)?(narration|onscreen)(\.|$)' then
    raise exception 'These are your own words, and they are locked. Change them under Your script (Edit scene), so the change is fact-checked and versioned.'
      using errcode = '55000';
  end if;
  insert into public.impact_story_line_notes (story_id, version, path, line_text, kind, note, actor)
  values (p_story, s.current_version, p_path, left(p_line, 2000), case when p_research then 'research' else 'fix' end, btrim(p_note), e)
  returning id into nid;
  perform public._hs_is_event(p_story, 'line_note', jsonb_build_object('id', nid, 'path', p_path, 'research', coalesce(p_research, false)), e);
  return jsonb_build_object('id', nid, 'line_notes', public._hs_is_line_notes(p_story));
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
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
    'public._hs_is_shot_print(jsonb)', 'public._hs_is_creator_hash(jsonb)', 'public._hs_is_creator_problems(jsonb)',
    'public._hs_is_creator_require(jsonb)', 'public._hs_is_creator_state(uuid)'] loop
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
    'public.hs_impact_story_shots_approve(uuid, bigint, text, text, _text)', 'public.hs_impact_story_photos_reject(uuid, bigint, _text, text)',
    'public.hs_impact_story_creator_revise(uuid, integer, jsonb, text)', 'public.hs_impact_story_creator_flag_decide(uuid, integer, text, text, text)',
    'public.hs_impact_story_creator_revision_withdraw(uuid, bigint)'] loop
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

do $g$
declare bad text;
begin
  select string_agg(x.f, ', ') into bad from (values ('hs_impact_discovery_overview','c0e2bca6ed27f80c58ed31807e4e71ac'), ('hs_impact_discovery_suggest','a6af8cdf70ea8278758bc0f908e799cf'), ('_hs_id_create_story','b81d4d911206e78f9dcaae4641056bd7'), ('impact_discovery_research_claim','b02a78f1d3eb0098b7025ebd7d2850c2')) x(f, h)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = x.f and md5(p.prosrc) = x.h);
  if bad is not null then raise exception 'impact-discovery creator apply: live function changed since it was read: %', bad; end if;
end $g$;

-- Creation mode (founder brief 2026-11-06, "Build creator-directed Impact Stories"): 'jody' (JODY researches the topic and
-- writes the story; the default and everything before) or 'creator' (the founder supplies the script scene by scene:
-- exact narration and headlines, the emotional stage, visual and audio direction). The script is "creator-script/1"
-- (homesignal-ingest impact/creator.py; checked here by _hs_is_creator_problems) and its version is creator_script_hash.
-- Research fact-checks the script and flags problems; it never changes the founder's words.
alter table public.impact_discovery_candidates add column if not exists creation_mode text not null default 'jody';

alter table public.impact_discovery_candidates add column if not exists creator_script jsonb;

alter table public.impact_discovery_candidates add column if not exists creator_script_hash text;

alter table public.impact_discovery_candidates drop constraint if exists impact_discovery_candidates_creation_mode_check;

alter table public.impact_discovery_candidates add constraint impact_discovery_candidates_creation_mode_check
  check (creation_mode in ('jody', 'creator') and (creation_mode = 'creator') = (creator_script is not null)
         and (creator_script is null or creator_script_hash ~ '^[0-9a-f]{32}$'));

-- ── founder functions (authenticated; every one checks the dashboard allowlist) ───────────────────────
create or replace function public.hs_impact_discovery_overview(p_show_closed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.impact_discovery_settings%rowtype; last_ok public.impact_discovery_scans%rowtype; latest public.impact_discovery_scans%rowtype;
begin
  perform public._hs_is_admin();
  select * into st from public.impact_discovery_settings where id;
  select * into latest from public.impact_discovery_scans order by created_at desc limit 1;
  select * into last_ok from public.impact_discovery_scans where status in ('success', 'partial') order by finished_at desc limit 1;
  return jsonb_build_object(
    'settings', to_jsonb(st),
    'latest_scan', case when latest.id is null then null else to_jsonb(latest) end,
    'last_success', case when last_ok.id is null then null else to_jsonb(last_ok) end,
    'next_scan_at', public._hs_id_next_scan(now()),
    'recent_scans', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
        (select * from public.impact_discovery_scans order by created_at desc limit 8) x), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'place', c.place, 'subject', c.subject, 'category', c.category, 'track', c.track,
        'lead_url', c.lead_url, 'lead_author', c.lead_author, 'lead_created_at', c.lead_created_at,
        'related', c.related, 'metrics', c.metrics, 'score', c.score, 'score_parts', c.score_parts, 'reasons', c.reasons,
        'evidence_status', c.evidence_status, 'evidence', c.evidence, 'concept', c.concept, 'coverage', c.coverage,
        'related_candidates', c.related_candidates, 'duplicate_of', c.duplicate_of, 'status', c.status, 'status_note', c.status_note,
        'source_slug', c.source_slug, 'story_id', c.story_id, 'discovered_at', c.discovered_at, 'last_seen_at', c.last_seen_at,
        'last_verified_at', c.last_verified_at, 'origin', c.origin, 'submitted_by', c.submitted_by, 'submitted_note', c.submitted_note, 'start_mode', c.start_mode,
        'creation_mode', c.creation_mode, 'creator_script', c.creator_script, 'creator_script_hash', c.creator_script_hash,
        'research', public._hs_id_research_run(c.id),
        'video', case when c.story_id is null then null else public._hs_id_video_state(c.story_id) end)
        order by (c.origin = 'founder') desc, (c.track = 'core') desc, c.score desc, c.last_seen_at desc)
      from (select * from public.impact_discovery_candidates c
             where (p_show_closed or c.status not in ('rejected', 'dismissed', 'excluded', 'stale'))
               -- the founder's experimental-track switch hides existing experimental topics too, not only new ones
               and (coalesce(st.experimental_enabled, false) or c.track <> 'experimental')
             order by (c.origin = 'founder') desc, (c.track = 'core') desc, c.score desc, c.last_seen_at desc limit 60) c), '[]'::jsonb),   -- same order as above
    'exclusions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.impact_discovery_exclusions x where x.active), '[]'::jsonb),
    'performance', public._hs_id_performance(),
    'learning', public._hs_id_learning());
end $$;

-- "Suggest a topic" (founder, 2026-10-28): a topic the founder wants made into a story. It goes straight to the research
-- queue (status 'nominated', origin 'founder'). Links are leads to check, never evidence; a story is still created only from
-- a verified source pack. One open suggestion per title. Starting evidence (2026-11-05): 'auto' (default), 'document' (needs at
-- least one link to the document) or 'topic' (research from the topic and the note, no document needed). The note is an
-- editorial brief and may be long (12,000 characters; it was 2,000 and clipped a brief that held a whole script).
create or replace function public.hs_impact_discovery_suggest(p_topic jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); t text := btrim(coalesce(p_topic->>'title', ''));
        pl text := nullif(btrim(coalesce(p_topic->>'place', '')), ''); cat text := coalesce(nullif(btrim(coalesce(p_topic->>'category', '')), ''), 'other');
        note text := nullif(btrim(coalesce(p_topic->>'note', '')), ''); leads jsonb := '[]'::jsonb; u text; c public.impact_discovery_candidates%rowtype;
        sm text := coalesce(nullif(btrim(coalesce(p_topic->>'start', '')), ''), 'auto');
        mode text := coalesce(nullif(btrim(coalesce(p_topic->>'mode', '')), ''), 'jody'); cs jsonb; ch text;
begin
  if mode not in ('jody', 'creator') then raise exception 'Creation mode must be jody or creator.' using errcode = '22023'; end if;
  if mode = 'creator' then
    cs := p_topic->'creator_script';
    ch := public._hs_is_creator_require(cs);   -- refuses with the script's problems in plain words
  elsif coalesce(p_topic->'creator_script', 'null'::jsonb) <> 'null'::jsonb then
    raise exception 'A script was sent with "Let JODY write the story". Choose "I will provide the script" to keep it.' using errcode = '22023';
  end if;
  if sm not in ('auto', 'document', 'topic') then raise exception 'Starting evidence must be auto, document or topic.' using errcode = '22023'; end if;
  if char_length(t) < 5 or char_length(t) > 300 then
    raise exception 'Give the topic a title of 5 to 300 characters.' using errcode = '22023';
  end if;
  if cat !~ '^[a-z_]{2,40}$' then raise exception 'Unknown category.' using errcode = '22023'; end if;
  if pl is not null and char_length(pl) > 200 then raise exception 'The place is longer than 200 characters.' using errcode = '22023'; end if;
  if note is not null and char_length(note) > 12000 then raise exception 'The note is longer than 12,000 characters.' using errcode = '22023'; end if;
  if p_topic ? 'links' and jsonb_typeof(p_topic->'links') <> 'array' then raise exception 'Links must be a list.' using errcode = '22023'; end if;
  for u in select distinct btrim(x) from jsonb_array_elements_text(coalesce(p_topic->'links', '[]'::jsonb)) x where btrim(x) <> '' loop
    if u !~* '^https?://[^\s/?#]+\.[^\s/?#]+(/\S*)?$' or char_length(u) > 1000 then
      raise exception 'This is not a web link (it must start with http:// or https://): %', left(u, 120) using errcode = '22023';
    end if;
    leads := leads || jsonb_build_array(jsonb_build_object('url', u, 'kind', 'founder',
      'domain', lower(substring(u from '^[A-Za-z]+://(?:www\.)?([^/:?#]+)'))));
  end loop;
  if jsonb_array_length(leads) > 20 then raise exception 'At most 20 links per topic.' using errcode = '22023'; end if;
  if sm = 'document' and jsonb_array_length(leads) = 0 then
    raise exception 'Source document available needs a link to the document. Add it under Links, or choose Auto-detect or No starting document.' using errcode = '22023';
  end if;
  if exists (select 1 from public.impact_discovery_candidates where origin = 'founder' and lower(title) = lower(t)
              and status not in ('rejected', 'dismissed', 'excluded')) then
    raise exception 'You already suggested a topic with this title. It is in the list below.' using errcode = '23505';
  end if;
  insert into public.impact_discovery_candidates (cluster_key, origin, category, track, title, place, score, reasons, evidence_status,
    evidence, status, submitted_by, submitted_note, start_mode, creation_mode, creator_script, creator_script_hash, discovered_at, last_seen_at)
  values ('founder:' || gen_random_uuid(), 'founder', cat, 'core', t, pl, 0,
    case when mode = 'creator' then '["You suggested this topic and wrote its script."]'::jsonb else '["You suggested this topic."]'::jsonb end,
    case when jsonb_array_length(leads) > 0 then 'leads_found' else 'social_only' end,
    jsonb_build_object('leads', leads), 'nominated', e, note, sm, mode, cs, ch, now(), now())
  returning * into c;
  perform public._hs_id_event(c.id, null, 'suggested', jsonb_build_object('title', t, 'place', pl, 'category', cat, 'links', jsonb_array_length(leads),
    'start', sm, 'mode', mode, 'scenes', case when cs is null then null else jsonb_array_length(cs->'scenes') end, 'script_hash', ch), e);
  return jsonb_build_object('id', c.id, 'status', c.status, 'start_mode', c.start_mode, 'creation_mode', c.creation_mode,
    'creator_script_hash', c.creator_script_hash);
end $$;

-- Save the founder's script on a topic before research starts (Save Draft), or between runs. Refused once the topic has
-- a story (from then on the story's own revisions are the record: hs_impact_story_creator_revise) and while a run is
-- working on it. p_expected_hash: the version the page showed (null for a topic that had no script); a stale page is refused.
create or replace function public.hs_impact_discovery_creator_script_save(p_candidate uuid, p_script jsonb, p_expected_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.impact_discovery_candidates%rowtype; h text;
begin
  select * into c from public.impact_discovery_candidates where id = p_candidate for update;
  if not found then raise exception 'no such topic' using errcode = 'P0002'; end if;
  if c.origin <> 'founder' then raise exception 'Only a topic you suggested can carry your script.' using errcode = '55000'; end if;
  if c.story_id is not null then
    raise exception 'This topic already has a story. Revise the script in the story (Your script).' using errcode = '55000';
  end if;
  if exists (select 1 from public.impact_discovery_research_runs where candidate_id = c.id and status in ('queued', 'working')) then
    raise exception 'Research is working on this topic. Change the script when the run finishes.' using errcode = '55000';
  end if;
  if c.creator_script_hash is distinct from p_expected_hash then
    raise exception 'The script changed since you opened it. Reload, then make your change again.' using errcode = '40001';
  end if;
  h := public._hs_is_creator_require(p_script);
  if h = c.creator_script_hash and c.creator_script = p_script then
    return jsonb_build_object('unchanged', true, 'creator_script_hash', h);
  end if;
  update public.impact_discovery_candidates set creation_mode = 'creator', creator_script = p_script, creator_script_hash = h,
         evidence_status = case when evidence_status in ('verified', 'insufficient') then 'leads_found' else evidence_status end,
         status = case when status = 'insufficient' then 'nominated' else status end, updated_at = now()
   where id = c.id;
  perform public._hs_id_event(c.id, null, 'creator_script_saved', jsonb_build_object('from', c.creator_script_hash, 'to', h,
    'scenes', jsonb_array_length(p_script->'scenes')), e);
  return jsonb_build_object('ok', true, 'creator_script_hash', h);
end $$;

-- ── shared: create the story for a verified topic ───────────────────────────────────────────────────────
create or replace function public._hs_id_create_story(p_candidate uuid, p_actor text, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.impact_discovery_candidates%rowtype; s public.impact_stories%rowtype; st public.impact_discovery_settings%rowtype;
        n int; job jsonb; other uuid;
begin
  -- One story creation at a time: the per-scan limit and the one-story-per-pack rule are checks across candidates, which a
  -- lock on this candidate's row alone cannot protect (two topics prepared at once would both see the old count).
  perform pg_advisory_xact_lock(hashtext('impact_discovery_create_story'));
  select * into c from public.impact_discovery_candidates where id = p_candidate for update;
  if not found then raise exception 'no such topic' using errcode = 'P0002'; end if;
  if c.story_id is not null then
    return jsonb_build_object('story_id', c.story_id, 'existing', true);
  end if;
  if c.evidence_status <> 'verified' or c.source_slug is null then
    raise exception 'This topic has no verified source pack yet, so no story can be written from it. %',
      coalesce('Missing: ' || (select string_agg(x, '; ') from jsonb_array_elements_text(c.evidence->'missing') x), '') using errcode = '55000';
  end if;
  if c.status in ('rejected', 'dismissed', 'excluded') then
    raise exception 'This topic was %. Restore it first.', c.status using errcode = '55000';
  end if;
  select * into s from public.impact_stories where (video_slug = c.source_slug or discovery_candidate_id = c.id) and archived_at is null limit 1;
  if found then   -- the story already exists in the library: never create a second
    select id into other from public.impact_discovery_candidates where story_id = s.id and id <> c.id;
    if other is not null then   -- another topic already owns it: this one is the same event
      -- leaves the research queue: closed as dismissed (shown with Show closed), never researched again
      update public.impact_discovery_candidates set duplicate_of = other, status = 'dismissed', decided_by = p_actor, decided_at = now(),
             status_note = 'Same source pack as another topic.', updated_at = now() where id = c.id;
      perform public._hs_id_event(c.id, null, 'duplicate_of', jsonb_build_object('candidate_id', other, 'story_id', s.id), p_actor);
      return jsonb_build_object('story_id', s.id, 'existing', true, 'duplicate_of', other);
    end if;
    -- an existing story is the founder's: link it, never drive its jobs
    update public.impact_discovery_candidates set story_id = s.id, status = 'ready_for_review',
           status_note = 'This story is already in the library.', updated_at = now() where id = c.id;
    update public.impact_stories set discovery_candidate_id = coalesce(discovery_candidate_id, c.id) where id = s.id;
    return jsonb_build_object('story_id', s.id, 'existing', true);
  end if;
  if p_auto then
    select * into st from public.impact_discovery_settings where id;
    if c.track = 'experimental' and not st.experimental_auto then
      raise exception 'Broader public accountability topics are not prepared automatically.' using errcode = '55000';
    end if;
    -- the per-scan limit is about scanned topics; a founder pick has no scan (all would share a null scan and block each other)
    n := 0;
    if c.origin = 'scan' then
      select count(*) into n from public.impact_discovery_candidates x
       where x.nominated_scan_id is not distinct from c.nominated_scan_id and x.story_id is not null and x.id <> c.id
         and x.origin = 'scan'
         and exists (select 1 from public.impact_stories y where y.id = x.story_id and y.origin = 'auto_discovery');
    end if;
    if c.origin = 'scan' and n >= st.max_prepare_per_scan then
      raise exception 'This scan already prepared % stor%(limit %).', n, case when n = 1 then 'y ' else 'ies ' end, st.max_prepare_per_scan using errcode = '55000';
    end if;
  end if;
  insert into public.impact_stories (video_slug, title, place, created_by, origin, discovery_candidate_id, creation_mode)
  values (c.source_slug, left(c.title, 200), c.place, p_actor, 'auto_discovery', c.id, c.creation_mode) returning * into s;
  if c.creation_mode = 'creator' then   -- the founder's script, version 1 of the story's script record
    insert into public.impact_story_creator_scripts (story_id, kind, script, script_hash, source, actor)
    values (s.id, 'original', c.creator_script, c.creator_script_hash, 'topic', coalesce(c.submitted_by, p_actor));
  end if;
  perform public._hs_is_event(s.id, 'created', jsonb_build_object('video_slug', c.source_slug, 'discovery_candidate_id', c.id,
          'bluesky', c.lead_url, 'auto', p_auto), p_actor);
  update public.impact_discovery_candidates set story_id = s.id, status = 'preparing', updated_at = now() where id = c.id;
  perform public._hs_id_event(c.id, null, 'story_created', jsonb_build_object('story_id', s.id, 'auto', p_auto), p_actor);
  job := public._hs_is_request(s.id, 'pack', 'all', false, p_actor);
  return jsonb_build_object('story_id', s.id, 'existing', false, 'job', job);
end $$;

-- The research job's door (service role only, through homesignal-ingest impact-research-run.yml).
create or replace function public.impact_discovery_research_claim(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.impact_discovery_research_runs%rowtype; c public.impact_discovery_candidates%rowtype;
begin
  select * into r from public.impact_discovery_research_runs where id = p_run for update;
  if not found then raise exception 'no such run' using errcode = 'P0002'; end if;
  if not (r.status = 'queued' or (r.status = 'working' and r.claimed_at < now() - interval '3 hours')) then
    raise exception 'run is % and cannot be claimed', r.status using errcode = '55000';
  end if;
  select * into c from public.impact_discovery_candidates where id = r.candidate_id for update;
  if r.attempts >= 3 or c.status in ('rejected', 'dismissed', 'excluded') or c.story_id is not null then
    update public.impact_discovery_research_runs set status = 'failed', completed_at = now(),
           summary = case when r.attempts >= 3 then 'Three attempts did not finish. Press Start research to try again.'
                          else 'The topic changed (it was closed or already has a story), so the research stopped.' end
     where id = r.id;
    perform public._hs_id_event(c.id, null, 'research_failed', jsonb_build_object('run', r.id, 'reason', 'claim'), 'research');
    raise exception 'run cannot be worked' using errcode = '55000';
  end if;
  update public.impact_discovery_research_runs set status = 'working', claimed_at = now(), attempts = attempts + 1,
         prev_status = coalesce(prev_status, c.status), prev_evidence = coalesce(prev_evidence, c.evidence_status)
   where id = r.id;
  update public.impact_discovery_candidates set status = 'researching', evidence_status = 'researching', updated_at = now()
   where id = c.id;
  perform public._hs_id_event(c.id, null, 'research_working', jsonb_build_object('run', r.id, 'attempt', r.attempts + 1), 'research');
  return jsonb_build_object('ok', true, 'run', r.id,
    'candidate', jsonb_build_object('id', c.id, 'title', c.title, 'place', c.place, 'category', c.category, 'track', c.track,
      'origin', c.origin, 'submitted_note', c.submitted_note, 'start_mode', c.start_mode, 'lead_url', c.lead_url, 'evidence', c.evidence, 'related', c.related,
      'creation_mode', c.creation_mode, 'creator_script', c.creator_script, 'creator_script_hash', c.creator_script_hash,
      'reasons', c.reasons, 'concept', c.concept, 'coverage', c.coverage),
    'library', coalesce((select jsonb_agg(jsonb_build_object('video_slug', s.video_slug, 'title', s.title))
      from public.impact_stories s where s.archived_at is null), '[]'::jsonb));
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._hs_id_event(uuid, uuid, text, jsonb, text)', 'public._hs_id_next_scan(timestamptz)', 'public._hs_id_dispatch(uuid)',
    'public._hs_id_reap()', 'public._hs_id_queue_scan(text, text, text)', 'public._hs_id_performance()', 'public._hs_id_learning()',
    'public._hs_id_create_story(uuid, text, boolean)', 'public.impact_discovery_tick(timestamptz)',
    'public._hs_id_research_run(uuid)', 'public._hs_id_video_state(uuid)', 'public._hs_id_research_dispatch(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.hs_impact_discovery_overview(boolean)', 'public.hs_impact_discovery_scan_now()',
    'public.hs_impact_discovery_decide(uuid, text, text)', 'public.hs_impact_discovery_open_story(uuid)',
    'public.hs_impact_discovery_settings_save(jsonb)', 'public.hs_impact_discovery_suggest(jsonb)', 'public.hs_impact_discovery_set_start(uuid, text)',
    'public.hs_impact_discovery_research_start(uuid)', 'public.hs_impact_discovery_creator_script_save(uuid, jsonb, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.impact_discovery_scan_claim(uuid)', 'public.impact_discovery_coverage(jsonb)',
    'public.impact_discovery_scan_record(uuid, jsonb)', 'public.impact_discovery_scan_finish(uuid, text, jsonb, jsonb, jsonb)',
    'public.impact_discovery_research(uuid, jsonb)', 'public.impact_discovery_prepare(uuid)', 'public.impact_discovery_nominations()',
    'public.impact_discovery_research_claim(uuid)', 'public.impact_discovery_research_complete(uuid, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

commit;
