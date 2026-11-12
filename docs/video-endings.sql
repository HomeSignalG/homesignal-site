-- YOUR RECORDED ENDINGS (founder, 2026-11-12: "i will prerecord different endings and i want a button in tab 16, 17 and
-- 20 to be able to upload the recording and have it seamed at end of video"; "video of me and voice of me speaking";
-- "shorts and videos have option of adding it"). Chosen per file; it REPLACES the generated closing line.
--
-- One library, every tab: recordings are uploaded once to the private bucket `video-endings` and chosen per video file.
--   Tab 16 (youtube): choosing starts a Full rebuild of that file whose settings carry the ending, so every later fix or
--     rebuild keeps it (homesignal-ingest video/revise.py, video-revise.yml downloads it and checks its sha256).
--   Tab 17 (impact): the choice is read by the visuals and render jobs (homesignal-ingest impact/render/job.py,
--     video_endings_current). It is part of the approved pictures: changing it means preparing the visuals again.
--   Tab 20 (weekly): the choice is stored; the weekly report has no renderer yet.
-- The join itself: homesignal-ingest video/ending.py. Apply AFTER that engine is merged on main.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-endings', 'video-endings', false, 262144000,
        array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- An admin may add a new file named <uuid>.<ext>; nothing may replace or delete one (no update or delete policy).
drop policy if exists video_endings_admin_upload on storage.objects;
create policy video_endings_admin_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'video-endings' and public.hs_is_dashboard_admin()
    and name ~ '^[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$');
drop policy if exists video_endings_admin_read on storage.objects;
create policy video_endings_admin_read on storage.objects
  for select to authenticated using (bucket_id = 'video-endings' and public.hs_is_dashboard_admin());

create table if not exists public.video_endings (
  id uuid primary key,
  path text not null unique check (path ~ '^[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes > 0),
  mime text not null,
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.video_endings enable row level security;
revoke all on public.video_endings from anon, authenticated;

-- Append-only: the newest row per (tab, target, asset) is the choice; ending_id null = no recorded ending.
create table if not exists public.video_ending_choices (
  id bigint generated always as identity primary key,
  tab text not null check (tab in ('youtube', 'impact', 'weekly')),
  target text not null check (length(target) between 1 and 120),
  asset text not null,
  ending_id uuid references public.video_endings (id),
  revision_id uuid,
  chosen_by text not null,
  created_at timestamptz not null default now(),
  check ((tab = 'youtube' and asset in ('final', 'short1', 'short2'))
      or (tab = 'impact' and asset in ('main', 'short_a', 'short_b'))
      or (tab = 'weekly' and asset in ('main', 'short_a', 'short_b')))
);
create index if not exists video_ending_choices_target on public.video_ending_choices (tab, target, asset, id desc);
alter table public.video_ending_choices enable row level security;
revoke all on public.video_ending_choices from anon, authenticated;

create or replace function public._hs_ve_no_change() returns trigger language plpgsql as $$
begin raise exception 'video_ending_choices is append-only' using errcode = '42501'; end $$;
drop trigger if exists video_ending_choices_append_only on public.video_ending_choices;
create trigger video_ending_choices_append_only before update or delete on public.video_ending_choices
  for each row execute function public._hs_ve_no_change();

create or replace function public._hs_ve_json(e public.video_endings) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', e.id, 'path', e.path, 'sha256', e.sha256, 'label', e.label, 'bytes', e.bytes)
$$;

-- Record an upload the page just made. The storage row must exist with the stated size.
create or replace function public.hs_video_ending_register(p_path text, p_label text, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = public, storage as $fn$
declare who text := public._hs_yv_admin(); o storage.objects%rowtype; e public.video_endings%rowtype;
begin
  if p_path !~ '^[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$' then raise exception 'bad file name' using errcode = '22023'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad checksum' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_label, ''))) not between 1 and 80 then
    raise exception 'give the recording a name (up to 80 characters)' using errcode = '22023';
  end if;
  select * into o from storage.objects where bucket_id = 'video-endings' and name = p_path;
  if not found then raise exception 'the upload did not arrive; upload it again' using errcode = 'P0002'; end if;
  insert into public.video_endings (id, path, label, sha256, bytes, mime, uploaded_by)
  values (split_part(p_path, '.', 1)::uuid, p_path, btrim(p_label), p_sha256,
          coalesce((o.metadata ->> 'size')::bigint, 1), coalesce(o.metadata ->> 'mimetype', 'video/mp4'), who)
  on conflict (id) do nothing
  returning * into e;
  if e.id is null then select * into e from public.video_endings where path = p_path; end if;
  return public._hs_ve_json(e);
end $fn$;

create or replace function public.hs_video_endings_list()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare who text := public._hs_yv_admin();
begin
  return coalesce((select jsonb_agg(public._hs_ve_json(e) || jsonb_build_object('created_at', e.created_at)
                                    order by e.created_at desc)
                     from public.video_endings e where e.archived_at is null), '[]'::jsonb);
end $fn$;

create or replace function public.hs_video_ending_archive(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare who text := public._hs_yv_admin();
begin
  update public.video_endings set archived_at = now() where id = p_id and archived_at is null;
  return jsonb_build_object('archived', found);
end $fn$;

-- The newest choice per asset of one target, with the ending's details. Used by the pages and by the engine.
create or replace function public._hs_ve_current(p_tab text, p_target text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c.asset, case when e.id is null then null else public._hs_ve_json(e) end), '{}'::jsonb)
    from (select distinct on (asset) asset, ending_id from public.video_ending_choices
           where tab = p_tab and target = p_target order by asset, id desc) c
    left join public.video_endings e on e.id = c.ending_id
$$;

create or replace function public.hs_video_ending_choices(p_tab text, p_target text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare who text := public._hs_yv_admin();
begin
  return public._hs_ve_current(p_tab, p_target);
end $fn$;

-- The engine's read (service role only): only assets with a recording chosen.
create or replace function public.video_endings_current(p_tab text, p_target text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from jsonb_each(public._hs_ve_current(p_tab, p_target)) as x(k, v) where v <> 'null'::jsonb
$$;

-- Choose a recording (or none, p_ending null) for one file.
create or replace function public.hs_video_ending_choose(p_tab text, p_target text, p_asset text, p_ending uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin(); e public.video_endings%rowtype;
  r public.youtube_video_reviews%rowtype; cur integer; st jsonb; new_id uuid; broken_n integer; prev jsonb;
begin
  if p_tab not in ('youtube', 'impact', 'weekly') then raise exception 'bad tab' using errcode = '22023'; end if;
  if (p_tab = 'youtube' and p_asset not in ('final', 'short1', 'short2'))
     or (p_tab <> 'youtube' and p_asset not in ('main', 'short_a', 'short_b')) then
    raise exception 'an ending goes on a main video or a Short only' using errcode = '22023';
  end if;
  if p_ending is not null then
    select * into e from public.video_endings where id = p_ending and archived_at is null;
    if not found then raise exception 'that recording is not in your library' using errcode = 'P0002'; end if;
  end if;
  prev := public._hs_ve_current(p_tab, p_target) -> p_asset;
  if (prev is null or prev = 'null'::jsonb) and p_ending is null then
    return jsonb_build_object('changed', false);
  end if;
  if prev is not null and prev <> 'null'::jsonb and (prev ->> 'id')::uuid = p_ending then
    return jsonb_build_object('changed', false);
  end if;
  if p_tab = 'youtube' then
    select * into r from public.youtube_video_reviews where slug = p_target for update;
    if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
    if not (r.files ? p_asset) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;
    if exists (select 1 from public.youtube_video_revisions where slug = p_target and file_key = p_asset
                and status in ('queued', 'running', 'validating')) then
      raise exception 'this file is being built; choose the ending when it is done' using errcode = '55006';
    end if;
    if exists (select 1 from public.youtube_video_revision_plans where slug = p_target and file_key = p_asset and status = 'planning') then
      raise exception 'Claude is reading a note for this file; wait for the plan, or cancel it, then choose the ending' using errcode = '55006';
    end if;
    select count(*) into broken_n from public.youtube_video_revisions
     where slug = p_target and file_key = p_asset and status = 'failed' and created_at > now() - interval '24 hours';
    if broken_n >= 10 then
      raise exception 'revisions of this file failed 10 times in the last 24 hours because of a system problem; ask Claude to look at it' using errcode = '55000';
    end if;
    perform public._hs_yv_ensure_v1(p_target, p_asset);
    cur := public._hs_yv_current_version(p_target, p_asset);
    select coalesce(settings, '{}'::jsonb) into st from public.youtube_video_versions where slug = p_target and file_key = p_asset and version = cur;
    st := case when p_ending is null then coalesce(st, '{}'::jsonb) - 'ending'
               else coalesce(st, '{}'::jsonb) || jsonb_build_object('ending', public._hs_ve_json(e)) end;
    update public.youtube_video_revision_plans set status = 'cancelled', decided_at = now()
     where slug = p_target and file_key = p_asset and status = 'ready';
    insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts, plan)
    values (p_target, p_asset, cur,
            case when p_ending is null then 'Remove your recorded ending; the file ends as the script does.'
                 else 'End with your recording "' || e.label || '" instead of the closing line.' end,
            st, who, 1, '{"mode":"rebuild"}'::jsonb)
    returning id into new_id;
  end if;
  insert into public.video_ending_choices (tab, target, asset, ending_id, revision_id, chosen_by)
  values (p_tab, p_target, p_asset, p_ending, new_id, who);
  if new_id is not null then perform public._hs_yv_dispatch(new_id); end if;
  return jsonb_build_object('changed', true, 'revision_id', new_id,
                            'prepare_again', p_tab = 'impact');
end $fn$;

revoke all on function public.hs_video_ending_register(text, text, text) from public, anon;
revoke all on function public.hs_video_endings_list() from public, anon;
revoke all on function public.hs_video_ending_archive(uuid) from public, anon;
revoke all on function public.hs_video_ending_choices(text, text) from public, anon;
revoke all on function public.hs_video_ending_choose(text, text, text, uuid) from public, anon;
revoke all on function public._hs_ve_current(text, text) from public, anon, authenticated;
revoke all on function public._hs_ve_json(public.video_endings) from public, anon, authenticated;
revoke all on function public.video_endings_current(text, text) from public, anon, authenticated;
grant execute on function public.hs_video_ending_register(text, text, text) to authenticated;
grant execute on function public.hs_video_endings_list() to authenticated;
grant execute on function public.hs_video_ending_archive(uuid) to authenticated;
grant execute on function public.hs_video_ending_choices(text, text) to authenticated;
grant execute on function public.hs_video_ending_choose(text, text, text, uuid) to authenticated;
grant execute on function public.video_endings_current(text, text) to service_role;
commit;
