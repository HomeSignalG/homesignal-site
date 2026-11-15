-- Tab 20 · Weekly Report: VIDEO PRODUCTION (founder, 2026-11-14: "build the video production in tab 20"; "it reviews
-- documents and real images, so it mixes between these images when appropriate to the script"). DDL of record.
-- Needs: weekly files 1 and 2 (weekly_editions), public._hs_is_admin, vault (github_actions_pat), pg_net, and the private
-- bucket impact-media with its admin read policy (docs/impact-stories.sql). One transaction; safe to apply twice.
--
-- Make video (Tab 20) queues ONE job for an edition and dispatches homesignal-ingest weekly-video-render.yml, which
-- renders the edition's committed video script (impact/drafts/weekly-<edition_key>.json, its sources in
-- impact/sources/weekly-<edition_key>) with the Impact Stories renderer: narration, licensed real photos, the source
-- documents drawn as pages with the quoted words highlighted, the quality gate on the finished file. The files go to
-- impact-media/weekly/<edition_key>/<job>/ and are recorded here, one row per file. The founder watches each file in Tab
-- 20 and approves it or asks for changes, with a note. Nothing here publishes anything.
--
-- Rules: one queued or running job per edition; no job for a closed or published edition; the worker writes only
-- through the three service-role functions; decisions are append-only (the newest per file counts); every table has
-- RLS on and no grant to anon or authenticated, so people act only through the admin functions below.

begin;

create table if not exists public.weekly_video_jobs (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.weekly_editions(id),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  error text check (char_length(error) <= 2000),
  result jsonb,
  dispatch_request_id bigint
);
create unique index if not exists weekly_video_jobs_one_active on public.weekly_video_jobs (edition_id)
  where status in ('queued', 'running');
alter table public.weekly_video_jobs enable row level security;
revoke all on public.weekly_video_jobs from public, anon, authenticated;

create table if not exists public.weekly_video_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.weekly_video_jobs(id),
  edition_id uuid not null references public.weekly_editions(id),
  asset text not null check (asset in ('main', 'short_a', 'short_b', 'thumbnail')),
  path text not null check (path ~ '^weekly/[a-z0-9][a-z0-9-]{2,80}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  captions_path text,
  bytes bigint,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  width int, height int, duration_s numeric,
  qc jsonb,
  stills text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (job_id, asset)
);
alter table public.weekly_video_assets enable row level security;
revoke all on public.weekly_video_assets from public, anon, authenticated;

create table if not exists public.weekly_video_decisions (
  id bigserial primary key,
  asset_id uuid not null references public.weekly_video_assets(id),
  decision text not null check (decision in ('approved', 'changes')),
  note text check (char_length(note) <= 4000),
  decided_by text not null,
  decided_at timestamptz not null default now(),
  check (decision = 'approved' or char_length(btrim(coalesce(note, ''))) > 0)
);
alter table public.weekly_video_decisions enable row level security;
revoke all on public.weekly_video_decisions from public, anon, authenticated;
create or replace function public._wk_video_decisions_append_only() returns trigger language plpgsql as $$
begin raise exception 'weekly video decisions are append-only' using errcode = '55000'; end $$;
drop trigger if exists weekly_video_decisions_append_only on public.weekly_video_decisions;
create trigger weekly_video_decisions_append_only before update or delete on public.weekly_video_decisions
  for each row execute function public._wk_video_decisions_append_only();

-- Dispatch the worker for one job. A missing credential fails the job with a readable reason (nothing is lost).
create or replace function public._wk_video_dispatch(p_job uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text; _req bigint;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.weekly_video_jobs set status = 'failed', finished_at = now(),
      error = 'The video could not start because no GitHub credential is stored for the worker. Press Make video again once it is restored.'
     where id = p_job;
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/weekly-video-render.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('job_id', p_job::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-weekly-video', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.weekly_video_jobs set dispatch_request_id = _req where id = p_job;
end $$;
revoke all on function public._wk_video_dispatch(uuid) from public, anon, authenticated;

-- Make video: one job per press, refused while one is queued or running for the edition, or once it is closed or published.
create or replace function public.hs_weekly_video_request(p_edition uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions%rowtype; j public.weekly_video_jobs%rowtype;
begin
  select * into ed from public.weekly_editions where id = p_edition for update;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if ed.closed_at is not null or ed.video_url is not null then
    raise exception 'this edition is closed or published; its video can no longer be remade' using errcode = '55000';
  end if;
  select * into j from public.weekly_video_jobs where edition_id = p_edition and status in ('queued', 'running');
  if found then return jsonb_build_object('job_id', j.id, 'status', j.status, 'existing', true); end if;
  insert into public.weekly_video_jobs (edition_id, requested_by) values (p_edition, e) returning * into j;
  perform public._wk_video_dispatch(j.id);
  select * into j from public.weekly_video_jobs where id = j.id;
  return jsonb_build_object('job_id', j.id, 'status', j.status, 'existing', false, 'error', j.error);
end $$;

-- Worker: take a queued job (a job queued more than 6 hours ago without a worker is failed instead).
create or replace function public.weekly_video_job_claim(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.weekly_video_jobs%rowtype; ed public.weekly_editions%rowtype;
begin
  select * into j from public.weekly_video_jobs where id = p_job for update;
  if j.id is null or j.status <> 'queued' then
    return jsonb_build_object('claimed', false, 'reason', coalesce(j.status, 'unknown job'));
  end if;
  select * into ed from public.weekly_editions where id = j.edition_id;
  update public.weekly_video_jobs set status = 'running', claimed_at = now() where id = p_job;
  return jsonb_build_object('claimed', true, 'job_id', j.id, 'edition_id', ed.id, 'edition_slug', ed.edition_key,
                            'topic', ed.topic, 'period_start', ed.period_start, 'period_end', ed.period_end);
end $$;

-- Worker: the files it uploaded (each under impact-media/weekly/<edition>/<job>/), recorded in one step.
create or replace function public.weekly_video_job_complete(p_job uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.weekly_video_jobs%rowtype; ed public.weekly_editions%rowtype; a jsonb; n int := 0; pre text;
begin
  select * into j from public.weekly_video_jobs where id = p_job for update;
  if j.id is null or j.status <> 'running' then raise exception 'job is not running' using errcode = '55000'; end if;
  select * into ed from public.weekly_editions where id = j.edition_id;
  pre := 'weekly/' || ed.edition_key || '/' || j.id || '/';
  for a in select * from jsonb_array_elements(coalesce(p_result -> 'assets', '[]'::jsonb)) loop
    if left(a ->> 'path', length(pre)) <> pre then
      raise exception 'a file is outside this job''s folder: %', a ->> 'path' using errcode = '22023';
    end if;
    insert into public.weekly_video_assets (job_id, edition_id, asset, path, captions_path, bytes, sha256, width, height,
                                            duration_s, qc, stills)
    values (j.id, j.edition_id, a ->> 'asset', a ->> 'path', a ->> 'captions_path', (a ->> 'bytes')::bigint, a ->> 'sha256',
            (a ->> 'width')::int, (a ->> 'height')::int, (a ->> 'duration_s')::numeric, a -> 'qc',
            coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(a -> 'stills') = 'array'
              then a -> 'stills' else '[]'::jsonb end) x), '{}'));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'a finished video job records at least one file' using errcode = '22023'; end if;
  update public.weekly_video_jobs set status = 'done', finished_at = now(), result = p_result - 'assets' where id = p_job;
  return jsonb_build_object('recorded', n);
end $$;

create or replace function public.weekly_video_job_fail(p_job uuid, p_error text, p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.weekly_video_jobs set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'failed'), 2000),
    result = p_result where id = p_job and status in ('queued', 'running');
  return jsonb_build_object('failed', found);
end $$;

-- Tab 20: the jobs of one edition, newest first, each with its files and each file's decisions (newest first).
create or replace function public.hs_weekly_video_status(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return jsonb_build_object('jobs', coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'status', j.status, 'requested_by', j.requested_by,
      'requested_at', j.requested_at, 'claimed_at', j.claimed_at, 'finished_at', j.finished_at, 'error', j.error,
      'result', j.result,
      'assets', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'asset', a.asset, 'path', a.path,
          'captions_path', a.captions_path, 'bytes', a.bytes, 'width', a.width, 'height', a.height,
          'duration_s', a.duration_s, 'qc', a.qc, 'stills', a.stills,
          'decisions', coalesce((select jsonb_agg(jsonb_build_object('decision', d.decision, 'note', d.note,
              'decided_by', d.decided_by, 'decided_at', d.decided_at) order by d.id desc)
            from public.weekly_video_decisions d where d.asset_id = a.id), '[]'::jsonb))
          order by array_position(array['main', 'short_a', 'short_b', 'thumbnail'], a.asset))
        from public.weekly_video_assets a where a.job_id = j.id), '[]'::jsonb))
      order by j.requested_at desc)
    from (select * from public.weekly_video_jobs where edition_id = p_edition order by requested_at desc limit 10) j), '[]'::jsonb));
end $$;

-- Tab 20: approve a file, or ask for changes with a note.
create or replace function public.hs_weekly_video_decide(p_asset uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); a public.weekly_video_assets%rowtype;
begin
  if p_decision not in ('approved', 'changes') then raise exception 'decision is approved or changes' using errcode = '22023'; end if;
  if p_decision = 'changes' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'say what should change' using errcode = '22023';
  end if;
  select * into a from public.weekly_video_assets where id = p_asset;
  if a.id is null then raise exception 'unknown file' using errcode = '22023'; end if;
  insert into public.weekly_video_decisions (asset_id, decision, note, decided_by)
  values (p_asset, p_decision, nullif(btrim(coalesce(p_note, '')), ''), e);
  return jsonb_build_object('ok', true);
end $$;

do $$
begin
  revoke all on function public.hs_weekly_video_request(uuid) from public, anon, authenticated;
  revoke all on function public.hs_weekly_video_status(uuid) from public, anon, authenticated;
  revoke all on function public.hs_weekly_video_decide(uuid, text, text) from public, anon, authenticated;
  revoke all on function public.weekly_video_job_claim(uuid) from public, anon, authenticated;
  revoke all on function public.weekly_video_job_complete(uuid, jsonb) from public, anon, authenticated;
  revoke all on function public.weekly_video_job_fail(uuid, text, jsonb) from public, anon, authenticated;
  grant execute on function public.hs_weekly_video_request(uuid) to authenticated;
  grant execute on function public.hs_weekly_video_status(uuid) to authenticated;
  grant execute on function public.hs_weekly_video_decide(uuid, text, text) to authenticated;
  grant execute on function public.weekly_video_job_claim(uuid) to service_role;
  grant execute on function public.weekly_video_job_complete(uuid, jsonb) to service_role;
  grant execute on function public.weekly_video_job_fail(uuid, text, jsonb) to service_role;
end $$;

commit;
