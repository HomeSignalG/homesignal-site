-- Tab 20 · Weekly Report, 4 of 7: SOURCE COPIES. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- INCOMPLETE WORK, PAUSED: the engine half is unfinished (its end-to-end test is unwritten and its storage path is unverified).
-- A person's grant, then a source_copy run that stores a copy of a source document. Permission, copy state and the
-- stored copy are three separate facts.
-- Also creates the two private storage buckets (weekly-sources, and weekly-visuals used by 6) and their single
-- admin-only read policy, so the policy is defined once.
-- Needs: 1 (base), 3 (workbench: weekly_sources, _wk_queue), public.hs_is_dashboard_admin, Supabase Storage.
-- Application order (docs/weekly-release-order.md): 1 base · 2 topic queue  [the queue-only release ends here]
--   · 3 workbench · 4 source copies · 5 titles · 6 document cues · 7 topic-queue approval gate.
-- Each file is one transaction and is idempotent; re-applying an earlier file after a later one changes nothing.

begin;

-- ── source copies: a person's grant, then a source_copy run ───────────────────────────────────────────────────────
-- Three states, kept apart: granted (permission only) · pending or failed (a run is queued/running, or the newest run
-- failed) · stored (the copy is in private storage and verified). A grant never implies a copy.
create or replace function public.weekly_source_copy_state(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when w.id is null then null
    when w.copy_granted_by is null then jsonb_build_object('state', 'not_granted')
    else jsonb_build_object(
      'state', case when w.document_path is not null then 'stored'
                    when r.status in ('queued', 'running') then 'pending'
                    when r.status = 'failed' then 'failed'
                    else 'granted' end,
      'granted_by', w.copy_granted_by, 'granted_at', w.copy_granted_at, 'basis', w.copy_grant_basis, 'kind', w.copy_kind,
      'attempts', (select count(*) from public.weekly_runs x where x.kind = 'source_copy' and x.input ->> 'source_id' = w.id::text),
      'last_error', case when w.document_path is null and r.status = 'failed' then r.error end,
      'document_sha256', w.document_sha256, 'size', w.copy_size, 'verified_at', w.copy_verified_at, 'quote_match', w.copy_quote_match)
    end
  from (select p_source as sid) q
  left join public.weekly_sources w on w.id = q.sid
  left join lateral (select x.status, x.error from public.weekly_runs x where x.kind = 'source_copy' and x.input ->> 'source_id' = q.sid::text
                     order by x.created_at desc, x.id desc limit 1) r on true
$$;

create or replace function public._wk_source_topic(p_source uuid) returns text
language sql stable security definer set search_path = public as $$
  select q.topic from public.weekly_sources w join public.weekly_research_answers a on a.id = w.answer_id
    join public.weekly_research_requests q on q.id = a.request_id where w.id = p_source
$$;

-- A person grants permission to keep a full copy of ONE source (who, when, why, and the copy's type), then the first copy
-- run is queued. The grant is recorded once and never changed.
create or replace function public.hs_weekly_source_copy_grant(p_source uuid, p_kind text, p_basis text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); w public.weekly_sources; q jsonb;
begin
  select * into w from public.weekly_sources where id = p_source;
  if w.id is null then raise exception 'unknown source' using errcode = '22023'; end if;
  if w.copy_granted_by is not null then raise exception 'full-copy permission is already recorded for this source; it is not changed' using errcode = '22023'; end if;
  if p_kind not in ('pdf', 'html') then raise exception 'the copy is a pdf or an html page' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_basis, ''))) not between 10 and 500 then
    raise exception 'say why a full copy may be kept (10 to 500 characters)' using errcode = '22023';
  end if;
  update public.weekly_sources set storage_permission = 'full_copy', copy_kind = p_kind, copy_granted_by = e, copy_granted_at = now(),
    copy_grant_basis = btrim(p_basis) where id = p_source;
  q := public._wk_queue('source_copy', public._wk_source_topic(p_source), jsonb_build_object('source_id', p_source), e);
  return jsonb_build_object('source_id', p_source, 'copy', public.weekly_source_copy_state(p_source)) || q;
end $$;

-- Try the copy again after a failure. The grant is not touched; a stored copy is never fetched again.
create or replace function public.hs_weekly_source_copy_retry(p_source uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st jsonb := public.weekly_source_copy_state(p_source); q jsonb;
begin
  if st is null then raise exception 'unknown source' using errcode = '22023'; end if;
  if st ->> 'state' = 'not_granted' then raise exception 'no full-copy permission is recorded for this source' using errcode = '22023'; end if;
  if st ->> 'state' = 'stored' then raise exception 'the copy is already stored; it is never fetched again' using errcode = '22023'; end if;
  if st ->> 'state' = 'pending' then raise exception 'a copy run is already pending for this source' using errcode = '55006'; end if;
  q := public._wk_queue('source_copy', public._wk_source_topic(p_source), jsonb_build_object('source_id', p_source), e);
  return jsonb_build_object('source_id', p_source, 'copy', public.weekly_source_copy_state(p_source)) || q;
end $$;

-- The record step: the runner checked the bytes and uploaded them; the database accepts the copy only if the object it
-- names is in private storage, at the one path the source id and checksum give, with the same size.
create or replace function public.weekly_source_copy_record(p_run uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs; w public.weekly_sources; sha text := p_payload ->> 'document_sha256'; k text := p_payload ->> 'document_kind';
        sz bigint := (p_payload ->> 'size')::bigint; nm text; osz bigint;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'source_copy' and status = 'running';
  if r.id is null then raise exception 'run is not a running source copy' using errcode = '55000'; end if;
  select * into w from public.weekly_sources where id = (r.input ->> 'source_id')::uuid;
  if w.copy_granted_by is null then raise exception 'no full-copy permission is recorded for this source' using errcode = '22023'; end if;
  if w.document_path is not null then raise exception 'the stored copy of this source is accepted and is never replaced' using errcode = '55000'; end if;
  if (p_payload ->> 'source_id') is distinct from w.id::text then raise exception 'the copy names another source' using errcode = '22023'; end if;
  if k is distinct from w.copy_kind then raise exception 'the copy is not of the granted type (%)', w.copy_kind using errcode = '22023'; end if;
  if sha !~ '^[0-9a-f]{64}$' then raise exception 'the copy has no sha256' using errcode = '22023'; end if;
  nm := w.id::text || '/' || sha || '.' || k;
  if (p_payload ->> 'document_path') is distinct from 'weekly-sources/' || nm then
    raise exception 'the copy is stored at weekly-sources/<source id>/<sha256>.<kind>' using errcode = '22023';
  end if;
  if to_regclass('storage.objects') is null then raise exception 'storage is not available; nothing is recorded' using errcode = '55000'; end if;
  execute 'select (metadata ->> ''size'')::bigint from storage.objects where bucket_id = ''weekly-sources'' and name = $1' into osz using nm;
  if osz is null then raise exception 'the copy is not in private storage' using errcode = 'P0002'; end if;
  if osz is distinct from sz then raise exception 'the stored object is % bytes, not %', osz, sz using errcode = '22023'; end if;
  update public.weekly_sources set document_path = 'weekly-sources/' || nm, document_sha256 = sha, document_kind = k, copy_size = sz,
    copy_verified_at = now(), copy_quote_match = p_payload ->> 'quote_match' where id = w.id;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, quantity, unit, note)
    values (r.id, 'storage', 'storage_bytes', 'shared', sz, 'bytes', 'a stored source copy (private bucket weekly-sources)'),
           (r.id, 'verification', 'runner_minutes', 'shared', null, null, 'source copy fetch and checks on a GitHub runner (no AI call)');
  update public.weekly_runs set status = 'done', finished_at = now(), result = jsonb_build_object('source_id', w.id, 'document_sha256', sha, 'size', sz)
    where id = r.id;
  return public.weekly_source_copy_state(w.id);
end $$;

-- ── function grants ──
do $$
declare f text;
begin
  foreach f in array array[
    'weekly_source_copy_state(uuid)', '_wk_source_topic(uuid)', 'hs_weekly_source_copy_grant(uuid,text,text)', 'hs_weekly_source_copy_retry(uuid)',
    'weekly_source_copy_record(uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'hs_weekly_source_copy_grant(uuid,text,text)', 'hs_weekly_source_copy_retry(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'weekly_source_copy_record(uuid,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Private buckets for stored source documents and the page images a visual_check makes (Tab 16's staged page PNGs).
-- Read by dashboard admins only; written only by the service role. Skipped where Supabase Storage is absent (test databases).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('weekly-sources', 'weekly-sources', false, 20971520, array['application/pdf', 'text/html']),
         ('weekly-visuals', 'weekly-visuals', false, 10485760, array['image/png'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists weekly_documents_admin_read on storage.objects';
  execute $p$create policy weekly_documents_admin_read on storage.objects for select to authenticated
             using (bucket_id in ('weekly-sources', 'weekly-visuals') and public.hs_is_dashboard_admin())$p$;
end $$;

commit;
