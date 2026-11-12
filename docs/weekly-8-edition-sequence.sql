-- Tab 20 · Weekly Report, 8 of 8: THE EDITION'S VIDEO SEQUENCE. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- One weekly edition is one video that may cover several topics, in an order a person chooses.
-- Needs: 1 (base: weekly_sha256, weekly_append_only), 2 (topic queue: weekly_editions), 3 (workbench: weekly_scripts,
--   weekly_version_status, _hs_is_admin), 6 (document cues: weekly_cue_count, weekly_visual_checks), 7 (weekly_version_edition).
-- Application order (docs/weekly-release-order.md): 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8. Additive: it creates two tables and
--   seven functions, changes no object of files 1-7, and is one transaction that is safe to apply twice.
--
-- The model, kept apart on purpose:
--   research and edition membership   files 2-3, unchanged: leads, their dispositions ("included" means kept for this
--                                     edition's reporting, NOT selected for the video), per-topic research and scripts.
--   video selection                   THIS file: an ordered list of entries. Each entry names a contiguous run of segments
--                                     of one APPROVED script version: {"version_id": uuid, "from": n, "to": n}, 0-based,
--                                     inclusive. A topic may return (Air, Water, Air); nothing is regrouped.
--   The topic of an entry is the version's own weekly_scripts.topic, never a segment's free-text "story" label.
--   A segment is used at most once in a sequence, so no narration repeats. Segments a person leaves out are simply
--   not in the video; an included lead is not required to appear.
--   The display derived from the sequence: the opening and thumbnail list each topic once, in order of first appearance;
--   a section card is shown wherever the topic differs from the previous entry's.
--
-- Approval: a person approves the exact sequence. The approval stores a digest the database recomputes from the content:
--   series, edition key, reporting period, and for every entry in order its version id, segment range, topic and
--   weekly_sha256(body::text) of the version (recomputed, not read from a supplied field). Reordering, substituting a
--   version, changing a range, a version gaining a newer version or losing its approval, or editing the edition's display
--   metadata leaves the newest approval naming a different digest (or a non-current version), so the edition reads NOT
--   approved. Document cues keep their existing rule: a version is approved only when its cues were checked against the
--   stored document (6); this file also refuses an entry whose segments carry a cue without a passing visual check.
-- NOT in this file (coordination with the topic-queue release, files 1-2): an edition still has its one queue topic
--   (weekly_editions.topic) for research hand-off and lead assignment. Letting one edition's research span topics needs
--   that queue model changed; this file does not touch it.

begin;

create table if not exists public.weekly_edition_sequences (
  id bigserial primary key,
  edition_id uuid not null references public.weekly_editions (id),
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) between 1 and 200),
  set_by text not null,
  set_at timestamptz not null default now()
);
create table if not exists public.weekly_edition_approvals (
  id bigserial primary key,
  edition_id uuid not null references public.weekly_editions (id),
  sequence_id bigint not null references public.weekly_edition_sequences (id),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  approved_by text not null,
  approved_at timestamptz not null default now()
);
create index if not exists weekly_edition_sequences_edition on public.weekly_edition_sequences (edition_id, id);
create index if not exists weekly_edition_approvals_edition on public.weekly_edition_approvals (edition_id, id);

-- What is wrong with one sequence, in plain words. Empty means every entry resolves to approved, current content.
create or replace function public.weekly_edition_sequence_problems(p_sequence bigint) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare s public.weekly_edition_sequences; e jsonb; i integer := 0; v public.weekly_scripts; st jsonb; n integer;
        f integer; t integer; probs text[] := '{}'; used text[] := '{}'; k text; vc jsonb; linked uuid;
begin
  select * into s from public.weekly_edition_sequences where id = p_sequence;
  if s.id is null then return array['unknown sequence']; end if;
  for e in select x from jsonb_array_elements(s.entries) x loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 3
       or not (e ? 'version_id' and e ? 'from' and e ? 'to') then
      probs := probs || ('entry ' || i || ': an entry has version_id, from and to only'); continue;
    end if;
    if jsonb_typeof(e -> 'from') <> 'number' or jsonb_typeof(e -> 'to') <> 'number'
       or (e ->> 'from')::numeric <> trunc((e ->> 'from')::numeric) or (e ->> 'to')::numeric <> trunc((e ->> 'to')::numeric) then
      probs := probs || ('entry ' || i || ': from and to are segment numbers'); continue;
    end if;
    f := (e ->> 'from')::integer; t := (e ->> 'to')::integer;
    begin
      select * into v from public.weekly_scripts where id = (e ->> 'version_id')::uuid;
    exception when invalid_text_representation then v := null;
    end;
    if v.id is null then probs := probs || ('entry ' || i || ': no such script version'); continue; end if;
    if v.stage <> 'script' then probs := probs || ('entry ' || i || ': that version is a ' || v.stage || ', not a script'); continue; end if;
    st := public.weekly_version_status(v.id);
    if not coalesce((st ->> 'current')::boolean, false) then
      probs := probs || ('entry ' || i || ': that script version is not the current approved version'
                         || coalesce(' (' || (st ->> 'outdated_reason') || ')', ''));
    end if;
    n := jsonb_array_length(coalesce(v.body -> 'segments', '[]'::jsonb));
    if f < 0 or t < f or t >= n then
      probs := probs || ('entry ' || i || ': segments ' || f || '-' || t || ' are not within that version (it has ' || n || ')'); continue;
    end if;
    for k in select v.id::text || ':' || g from generate_series(f, t) g loop
      if k = any (used) then probs := probs || ('entry ' || i || ': segment ' || split_part(k, ':', 2) || ' of that version is already in the sequence'); end if;
      used := used || k;
    end loop;
    if exists (select 1 from generate_series(f, t) g where jsonb_typeof(v.body -> 'segments' -> g -> 'visual') = 'object') then
      vc := public.weekly_visual_checks(v.id);
      if not coalesce((vc ->> 'ok')::boolean, false) then
        probs := probs || ('entry ' || i || ': a document cue in these segments is not resolved against its stored document');
      end if;
    end if;
    linked := public.weekly_version_edition(v.id);
    if linked is not null and linked <> s.edition_id then
      probs := probs || ('entry ' || i || ': that version belongs to another edition');
    end if;
  end loop;
  return probs;
end $$;

-- The approved-content digest of one sequence, recomputed from the content every time.
create or replace function public.weekly_edition_sequence_digest(p_sequence bigint) returns text
language sql stable security definer set search_path = public as $$
  select public.weekly_sha256(jsonb_build_object(
    'series', ed.series, 'edition_key', ed.edition_key, 'period_start', ed.period_start, 'period_end', ed.period_end,
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('version_id', x.e ->> 'version_id', 'from', x.e -> 'from', 'to', x.e -> 'to',
                  'topic', v.topic, 'body_sha256', public.weekly_sha256(v.body::text)) order by x.n), '[]'::jsonb)
                from jsonb_array_elements(s.entries) with ordinality x (e, n)
                left join public.weekly_scripts v on v.id::text = x.e ->> 'version_id'))::text)
  from public.weekly_edition_sequences s join public.weekly_editions ed on ed.id = s.edition_id where s.id = p_sequence
$$;

-- The edition's video as it stands: newest sequence, its problems and digest, whether the newest approval still holds,
-- and the display derived from it (topics once, in order of first appearance; a section card at every topic change).
create or replace function public.weekly_edition_video(p_edition uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ed public.weekly_editions; s public.weekly_edition_sequences; probs text[]; dg text; a public.weekly_edition_approvals;
        approved boolean; why text; items jsonb; topics jsonb;
begin
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then return null; end if;
  select * into s from public.weekly_edition_sequences where edition_id = p_edition order by id desc limit 1;
  if s.id is null then
    return jsonb_build_object('edition_id', ed.id, 'series', ed.series, 'edition_key', ed.edition_key,
      'period_start', ed.period_start, 'period_end', ed.period_end, 'sequence', null, 'approved', false, 'why_not', 'no sequence yet');
  end if;
  probs := public.weekly_edition_sequence_problems(s.id);
  dg := public.weekly_edition_sequence_digest(s.id);
  select * into a from public.weekly_edition_approvals where edition_id = p_edition order by id desc limit 1;
  approved := a.id is not null and a.sequence_id = s.id and a.digest = dg and cardinality(probs) = 0;
  why := case when approved then null
              when cardinality(probs) > 0 then 'the sequence has problems'
              when a.id is null then 'not approved yet'
              when a.sequence_id <> s.id then 'the sequence changed after the newest approval'
              else 'the approved content or edition details changed after the newest approval' end;
  select coalesce(jsonb_agg(jsonb_build_object('n', r.n, 'version_id', r.e ->> 'version_id', 'from', r.e -> 'from', 'to', r.e -> 'to',
           'topic', r.topic, 'section_card', r.card, 'segments', r.segs) order by r.n), '[]'::jsonb)
    into items
    from (select x.n, x.e, v.topic, v.topic is distinct from lag(v.topic) over (order by x.n) as card,
                 (select coalesce(jsonb_agg(v.body -> 'segments' -> g order by g), '[]'::jsonb)
                  from generate_series((x.e ->> 'from')::integer, (x.e ->> 'to')::integer) g
                  where jsonb_typeof(x.e -> 'from') = 'number' and jsonb_typeof(x.e -> 'to') = 'number') as segs
          from jsonb_array_elements(s.entries) with ordinality x (e, n)
          left join public.weekly_scripts v on v.id::text = x.e ->> 'version_id') r;
  select coalesce(jsonb_agg(t order by first_n), '[]'::jsonb) into topics
    from (select i ->> 'topic' t, min((i ->> 'n')::integer) first_n from jsonb_array_elements(items) i
          where i ->> 'topic' is not null group by i ->> 'topic') q;
  return jsonb_build_object('edition_id', ed.id, 'series', ed.series, 'edition_key', ed.edition_key,
    'period_start', ed.period_start, 'period_end', ed.period_end,
    'sequence', jsonb_build_object('id', s.id, 'set_by', s.set_by, 'set_at', s.set_at, 'entries', s.entries),
    'problems', to_jsonb(probs), 'digest', dg, 'approved', approved, 'why_not', why,
    'approval', case when a.id is null then null else jsonb_build_object('sequence_id', a.sequence_id, 'digest', a.digest,
                  'approved_by', a.approved_by, 'approved_at', a.approved_at) end,
    'items', items, 'topics', topics);
end $$;

-- A person sets the edition's sequence (a new row; the old ones stay as history).
create or replace function public.hs_weekly_edition_sequence_set(p_edition uuid, p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; sid bigint; probs text[];
begin
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'a sequence lists at least one entry' using errcode = '22023';
  end if;
  insert into public.weekly_edition_sequences (edition_id, entries, set_by) values (p_edition, p_entries, e) returning id into sid;
  probs := public.weekly_edition_sequence_problems(sid);
  if cardinality(probs) > 0 then raise exception 'sequence refused: %', array_to_string(probs, '; ') using errcode = '22023'; end if;
  return public.weekly_edition_video(p_edition);
end $$;

-- A person approves the sequence they reviewed: p_digest is the digest the page showed them.
create or replace function public.hs_weekly_edition_sequence_approve(p_edition uuid, p_digest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.weekly_edition_sequences; probs text[]; dg text;
begin
  select * into s from public.weekly_edition_sequences where edition_id = p_edition order by id desc limit 1;
  if s.id is null then raise exception 'this edition has no sequence' using errcode = '22023'; end if;
  probs := public.weekly_edition_sequence_problems(s.id);
  if cardinality(probs) > 0 then raise exception 'not approvable: %', array_to_string(probs, '; ') using errcode = '22023'; end if;
  dg := public.weekly_edition_sequence_digest(s.id);
  if p_digest is distinct from dg then
    raise exception 'the sequence or its content changed since you reviewed it; review it again' using errcode = '40001';
  end if;
  insert into public.weekly_edition_approvals (edition_id, sequence_id, digest, approved_by) values (p_edition, s.id, dg, e);
  return public.weekly_edition_video(p_edition);
end $$;

-- The admin read of one edition's video, and the service read a render job uses (adds each version's body and approvals).
create or replace function public.hs_weekly_edition_video(p_edition uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return public.weekly_edition_video(p_edition);
end $$;
create or replace function public.weekly_edition_render_export(p_edition uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.weekly_edition_video(p_edition) || jsonb_build_object('versions', (
    select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'topic', v.topic, 'body', v.body, 'body_sha256', v.body_sha256,
             'approvals', (select coalesce(jsonb_agg(jsonb_build_object('kind', a.approval_kind, 'body_sha256', a.body_sha256,
                             'approved_by', a.approved_by, 'approved_at', a.approved_at) order by a.id), '[]'::jsonb)
                           from public.weekly_script_approvals a where a.script_id = v.id)) order by v.id), '[]'::jsonb)
    from public.weekly_scripts v where v.id::text in (
      select x ->> 'version_id' from public.weekly_edition_sequences s, jsonb_array_elements(s.entries) x
      where s.id = (select max(id) from public.weekly_edition_sequences where edition_id = p_edition))))
$$;

do $$
declare t text; f text;
begin
  foreach t in array array['weekly_edition_sequences', 'weekly_edition_approvals'] loop
    execute format('drop trigger if exists %I_append_only on public.%I', t, t);
    execute format('create trigger %I_append_only before update or delete on public.%I for each row execute function public.weekly_append_only()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach f in array array['weekly_edition_sequence_problems(bigint)', 'weekly_edition_sequence_digest(bigint)',
    'weekly_edition_video(uuid)', 'hs_weekly_edition_sequence_set(uuid,jsonb)', 'hs_weekly_edition_sequence_approve(uuid,text)',
    'hs_weekly_edition_video(uuid)', 'weekly_edition_render_export(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hs_weekly_edition_sequence_set(uuid,jsonb)', 'hs_weekly_edition_sequence_approve(uuid,text)',
    'hs_weekly_edition_video(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on function public.weekly_edition_render_export(uuid) to service_role';
end $$;

commit;
