-- Tab 20 · Weekly Report, 10: THE EDITION'S PRIVATE REVIEW RENDER. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- One render job turns an APPROVED edition sequence (8) into a private review video: narration, captions, the
-- person-chosen document visuals, a thumbnail. Nothing here publishes: the files go to the PRIVATE bucket weekly-media,
-- which only dashboard admins can read, and the edition's public video_url is not touched.
-- Needs: 1, 2, 3, 6, 7, 8 (and 9 when an edition covers several topics). Additive: one table, one bucket and its read
--   policy, eight functions, one trigger. Changes no object of files 1-9. One transaction, safe to apply twice.
-- DISPATCHES: hs_weekly_edition_render starts homesignal-ingest's weekly-render.yml (always ref main) through vault's
--   github_actions_pat, like _wk_dispatch in 3. Do not apply this file before weekly-render.yml is on homesignal-ingest main.
--
-- The rules, enforced here and not in the page:
--   * A render may be requested only for the edition's CURRENT approved sequence, and only with the digest the person
--     reviewed (40001 otherwise), and never for a closed or published edition.
--   * One render per edition at a time; asking again for content already rendered returns that render (no second render).
--   * The worker's claim re-checks the approval at claim time. If the approved content changed after the request, the
--     render fails with that reason and renders nothing. The worker then recomputes everything itself (edition_bundle).
--   * A render completes only with its files: a video, captions and a thumbnail, every path under
--     weekly-media/<edition>/<render>/, and (where Storage is installed) each object present with the stated size.
--   * The status moves forward only: queued -> running -> done | failed, queued -> failed. Its edition, sequence,
--     approval, digest and requester never change, and no row is ever deleted.
--   * A finished render is shown as current only while the edition's approved digest still equals the one it rendered.

begin;

create table if not exists public.weekly_edition_renders (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.weekly_editions (id),
  sequence_id bigint not null references public.weekly_edition_sequences (id),
  approval_id bigint not null references public.weekly_edition_approvals (id),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  dispatched boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  files jsonb check (files is null or jsonb_typeof(files) = 'array'),
  result jsonb,
  error text check (char_length(error) <= 2000)
);
create unique index if not exists weekly_edition_renders_one_active on public.weekly_edition_renders (edition_id)
  where status in ('queued', 'running');
create index if not exists weekly_edition_renders_edition on public.weekly_edition_renders (edition_id, requested_at desc);

create or replace function public.weekly_edition_renders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'weekly_edition_renders rows are never deleted' using errcode = '55000'; end if;
  if tg_op <> 'UPDATE' then return null; end if;
  if (new.id, new.edition_id, new.sequence_id, new.approval_id, new.digest, new.requested_by, new.requested_at)
     is distinct from (old.id, old.edition_id, old.sequence_id, old.approval_id, old.digest, old.requested_by, old.requested_at) then
    raise exception 'a render''s edition, sequence, approval, digest and requester never change' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'queued' and new.status in ('running', 'failed')) or (old.status = 'running' and new.status in ('done', 'failed'))) then
    raise exception 'a render cannot go from % to %', old.status, new.status using errcode = '55000';
  end if;
  if old.status in ('done', 'failed') then raise exception 'a finished render is final' using errcode = '55000'; end if;
  return new;
end $$;
drop trigger if exists weekly_edition_renders_guard on public.weekly_edition_renders;
create trigger weekly_edition_renders_guard before update or delete on public.weekly_edition_renders
  for each row execute function public.weekly_edition_renders_guard();

-- ── dispatch (weekly-render.yml only, always ref main) ────────────────────────────────────────────────────────────
create or replace function public._wk_render_dispatch(p_render uuid) returns boolean
language plpgsql security definer set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then return false; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/weekly-render.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('render', p_render::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-weekly-report', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
  return true;
end $$;

-- ── the per-version stored documents a render needs ───────────────────────────────────────────────────────────────
-- For one script version: the same projection weekly_run_claim (3) returns for a visual_check run of that version
-- (cue_version, sources with a stored copy in its library, pinned findings), without claiming a run. "run" names the
-- newest visual_check run done on this exact text (6). The edition-render suite checks the two agree (R20).
create or replace function public.weekly_edition_render_version_claim(p_version uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('run', (select r.id from public.weekly_runs r where r.kind = 'visual_check' and r.status = 'done'
           and r.input ->> 'version_id' = tv.id::text and r.result ->> 'body_sha256' = tv.body_sha256 order by r.finished_at desc limit 1),
    'kind', 'visual_check', 'mode', 'visual_check', 'topic', tv.topic,
    'cue_version', jsonb_build_object('id', tv.id, 'body', tv.body, 'body_sha256', tv.body_sha256),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source_id', w.id, 'url', w.url,
        'publisher', w.publisher, 'title', w.title, 'label', coalesce(w.title, w.publisher, w.url),
        'document_path', w.document_path, 'document_sha256', w.document_sha256, 'document_kind', w.document_kind,
        'finding_ids', (select jsonb_agg(f2.finding_key || '@' || f2.version order by f2.finding_key)
                        from public.weekly_finding_sources s2 join public.weekly_findings f2 on f2.id = s2.finding_id
                        join public.weekly_library_version_findings x2 on x2.finding_id = f2.id and x2.library_version_id = tv.library_version_id
                        where s2.source_id = w.id)) order by w.created_at, w.id), '[]')
        from public.weekly_sources w where w.document_path is not null and exists (select 1 from public.weekly_finding_sources s3
          join public.weekly_library_version_findings x3 on x3.finding_id = s3.finding_id and x3.library_version_id = tv.library_version_id
          where s3.source_id = w.id)),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('claim_id', f.finding_key || '@' || f.version, 'statement', f.statement,
        'qualifiers', f.qualifiers, 'uncertainty', f.uncertainty, 'scope', f.scope,
        'quotes', (select coalesce(jsonb_agg(w.quote order by w.created_at) filter (where w.quote is not null), '[]')
                   from public.weekly_finding_sources fs join public.weekly_sources w on w.id = fs.source_id where fs.finding_id = f.id))
        order by f.finding_key), '[]')
        from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
        where x.library_version_id = tv.library_version_id))
  from public.weekly_scripts tv where tv.id = p_version
$$;

-- ── admin functions (a signed-in dashboard admin) ─────────────────────────────────────────────────────────────────
-- A person asks for a private review render of the sequence they reviewed: p_digest is the digest the page showed them.
create or replace function public.hs_weekly_edition_render(p_edition uuid, p_digest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; v jsonb; a public.weekly_edition_approvals;
        r public.weekly_edition_renders; sent boolean;
begin
  select * into ed from public.weekly_editions where id = p_edition for update;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  if ed.video_url is not null then raise exception 'edition % is published; its video is final', ed.edition_key using errcode = '55000'; end if;
  v := public.weekly_edition_video(p_edition);
  if not coalesce((v ->> 'approved')::boolean, false) then
    raise exception 'the edition''s sequence is not approved: %', v ->> 'why_not' using errcode = '55000';
  end if;
  if p_digest is distinct from v ->> 'digest' then
    raise exception 'the sequence or its content changed since you reviewed it; review it again' using errcode = '40001';
  end if;
  select * into r from public.weekly_edition_renders where edition_id = p_edition and status in ('queued', 'running');
  if r.id is not null then return public.weekly_edition_render_json(r.id) || jsonb_build_object('existing', true); end if;
  select * into r from public.weekly_edition_renders where edition_id = p_edition and status = 'done' and digest = v ->> 'digest'
    order by requested_at desc limit 1;
  if r.id is not null then return public.weekly_edition_render_json(r.id) || jsonb_build_object('existing', true); end if;
  select * into a from public.weekly_edition_approvals where edition_id = p_edition order by id desc limit 1;
  insert into public.weekly_edition_renders (edition_id, sequence_id, approval_id, digest, requested_by)
    values (p_edition, (v -> 'sequence' ->> 'id')::bigint, a.id, v ->> 'digest', e) returning * into r;
  sent := public._wk_render_dispatch(r.id);
  update public.weekly_edition_renders set dispatched = sent where id = r.id;
  if not sent then
    update public.weekly_edition_renders set status = 'failed', finished_at = now(),
      error = 'the dispatch credential is not set up (vault github_actions_pat); nothing was started' where id = r.id;
  end if;
  return public.weekly_edition_render_json(r.id) || jsonb_build_object('existing', false);
end $$;

-- One render, as the page shows it. "current" is true only while the edition's approved digest is the one rendered.
create or replace function public.weekly_edition_render_json(p_render uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'edition_id', r.edition_id, 'sequence_id', r.sequence_id, 'digest', r.digest,
    'status', r.status, 'requested_by', r.requested_by, 'requested_at', r.requested_at, 'dispatched', r.dispatched,
    'started_at', r.started_at, 'finished_at', r.finished_at, 'files', r.files, 'result', r.result, 'error', r.error,
    'current', r.status = 'done' and coalesce((v ->> 'approved')::boolean, false) and v ->> 'digest' = r.digest)
  from public.weekly_edition_renders r, lateral (select public.weekly_edition_video(r.edition_id) v) x where r.id = p_render
$$;

create or replace function public.hs_weekly_edition_renders(p_edition uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return (select coalesce(jsonb_agg(public.weekly_edition_render_json(r.id) order by r.requested_at desc), '[]'::jsonb)
          from public.weekly_edition_renders r where r.edition_id = p_edition);
end $$;

-- ── service functions (weekly-render.yml; service_role only) ──────────────────────────────────────────────────────
-- Claims a queued render. Returns what the worker needs: the render export (8) and one stored-document claim per version
-- in the sequence. If the approved content changed after the request, the render fails here and nothing is returned
-- to render.
create or replace function public.weekly_edition_render_claim(p_render uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.weekly_edition_renders; v jsonb; why text;
begin
  update public.weekly_edition_renders set status = 'running', started_at = now() where id = p_render and status = 'queued' returning * into r;
  if r.id is null then raise exception 'render is not queued' using errcode = '55000'; end if;
  v := public.weekly_edition_video(r.edition_id);
  why := case when (select video_url from public.weekly_editions where id = r.edition_id) is not null then 'the edition is published'
              when (select closed_at from public.weekly_editions where id = r.edition_id) is not null then 'the edition is closed'
              when not coalesce((v ->> 'approved')::boolean, false) then 'the sequence is no longer approved: ' || coalesce(v ->> 'why_not', '')
              when v ->> 'digest' is distinct from r.digest then 'the approved content changed after this render was requested' end;
  if why is not null then
    update public.weekly_edition_renders set status = 'failed', finished_at = now(), error = why where id = r.id;
    return jsonb_build_object('render', r.id, 'ok', false, 'reason', why);
  end if;
  return jsonb_build_object('render', r.id, 'ok', true, 'edition_id', r.edition_id, 'digest', r.digest,
    'output_prefix', r.edition_id::text || '/' || r.id::text || '/',
    'export', public.weekly_edition_render_export(r.edition_id),
    'claims', (select coalesce(jsonb_agg(public.weekly_edition_render_version_claim(q.vid) order by q.vid), '[]'::jsonb)
               from (select distinct (x ->> 'version_id')::uuid vid from jsonb_array_elements(v -> 'sequence' -> 'entries') x) q));
end $$;

-- p_files: [{path, kind, bytes, sha256}], path relative to the bucket. kind: video | captions | thumbnail | still | ledger.
create or replace function public.weekly_edition_render_finish(p_render uuid, p_files jsonb, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.weekly_edition_renders; f jsonb; pre text; k text; probs text[] := '{}'; sz bigint;
begin
  select * into r from public.weekly_edition_renders where id = p_render for update;
  if r.id is null or r.status <> 'running' then raise exception 'render is not running' using errcode = '55000'; end if;
  if jsonb_typeof(p_files) is distinct from 'array' then raise exception 'files must be an array' using errcode = '22023'; end if;
  pre := r.edition_id::text || '/' || r.id::text || '/';
  foreach k in array array['video', 'captions', 'thumbnail'] loop
    if not exists (select 1 from jsonb_array_elements(p_files) x where x ->> 'kind' = k) then probs := probs || ('no ' || k || ' file'); end if;
  end loop;
  for f in select * from jsonb_array_elements(p_files) loop
    if f ->> 'kind' not in ('video', 'captions', 'thumbnail', 'still', 'ledger') then probs := probs || ('unknown file kind ' || coalesce(f ->> 'kind', 'null')); end if;
    if left(coalesce(f ->> 'path', ''), length(pre)) <> pre or f ->> 'path' like '%..%' then
      probs := probs || ('file ' || coalesce(f ->> 'path', 'null') || ' is outside ' || pre);
    end if;
    if coalesce(f ->> 'sha256', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(f -> 'bytes') is distinct from 'number' then
      probs := probs || ('file ' || coalesce(f ->> 'path', 'null') || ' has no sha256 or size');
    elsif to_regclass('storage.objects') is not null then
      execute 'select (metadata ->> ''size'')::bigint from storage.objects where bucket_id = ''weekly-media'' and name = $1'
        into sz using f ->> 'path';
      if sz is null then probs := probs || ('file ' || (f ->> 'path') || ' is not in weekly-media');
      elsif sz <> (f ->> 'bytes')::bigint then probs := probs || ('file ' || (f ->> 'path') || ' has ' || sz || ' bytes, not ' || (f ->> 'bytes'));
      end if;
    end if;
  end loop;
  if cardinality(probs) > 0 then raise exception 'render not recorded: %', array_to_string(probs, '; ') using errcode = '22023'; end if;
  update public.weekly_edition_renders set status = 'done', finished_at = now(), files = p_files, result = p_result where id = r.id;
  return public.weekly_edition_render_json(r.id);
end $$;

create or replace function public.weekly_edition_render_fail(p_render uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.weekly_edition_renders set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'failed'), 2000)
    where id = p_render and status in ('queued', 'running');
end $$;

-- The private bucket for review renders. Read by dashboard admins only; written only by the service role.
-- Skipped where Supabase Storage is absent (test databases without the stand-in).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('weekly-media', 'weekly-media', false, 52428800,
          array['video/mp4', 'image/png', 'application/x-subrip', 'application/json'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists weekly_media_admin_read on storage.objects';
  execute $p$create policy weekly_media_admin_read on storage.objects for select to authenticated
             using (bucket_id = 'weekly-media' and public.hs_is_dashboard_admin())$p$;
end $$;

do $$
declare f text;
begin
  execute 'alter table public.weekly_edition_renders enable row level security';
  execute 'revoke all on public.weekly_edition_renders from public, anon, authenticated';
  foreach f in array array['weekly_edition_renders_guard()', '_wk_render_dispatch(uuid)', 'weekly_edition_render_version_claim(uuid)',
    'hs_weekly_edition_render(uuid,text)', 'weekly_edition_render_json(uuid)', 'hs_weekly_edition_renders(uuid)',
    'weekly_edition_render_claim(uuid)', 'weekly_edition_render_finish(uuid,jsonb,jsonb)', 'weekly_edition_render_fail(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hs_weekly_edition_render(uuid,text)', 'hs_weekly_edition_renders(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['weekly_edition_render_claim(uuid)', 'weekly_edition_render_finish(uuid,jsonb,jsonb)', 'weekly_edition_render_fail(uuid,text)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
