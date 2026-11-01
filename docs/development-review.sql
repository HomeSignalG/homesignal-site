-- ============================================================================================
-- Development dossier REVIEW: the reads and the one dispatch the review screen needs
-- (Acquisition Dashboard tab 18, lib/acq-development-review.js). 2026-10-30.
-- Applies AFTER docs/development-dossier.sql.
--
-- The writes the screen makes already exist and stay the only writes:
--   development_project_create / development_project_set / development_link_decide
--   (docs/development-dossier.sql). This file adds:
--   1. development_review_queue(): every project with its CURRENT link rows (candidates first),
--      for a current reviewer only. The tables stay closed to anon and authenticated.
--   2. development_publish_request(): starts homesignal-ingest publish-development-dossiers.yml
--      (dry_run=false) from main, the same vault token and dispatch shape as
--      hs_request_maps_dc_generation. At most one request every 2 minutes. The publisher still
--      checks the snapshot and refuses a bad one; the site picks the object up on its next build
--      (pages.yml runs at :12 and :42).
-- Nothing here decides a link or a name. Rollback:
--   drop function public.development_publish_request(); drop function public.development_review_queue();
--   drop table public.development_publish_request_log;
-- ============================================================================================

begin;

create table if not exists public.development_publish_request_log (
  id             bigint generated always as identity primary key,
  requested_at   timestamptz not null default now(),
  requested_by   uuid not null,
  net_request_id bigint
);
alter table public.development_publish_request_log enable row level security;
revoke all on public.development_publish_request_log from public, anon, authenticated;

create or replace function public.development_review_queue()
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor();
begin
  if uid is null or not exists (select 1 from public.development_reviewer r where r.user_id = uid and r.revoked_at is null) then
    raise exception 'only a current reviewer can read the review queue' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_key', p.project_key,
               'state', p.state,
               'path', '/development/' || lower(p.state) || '/' || p.project_key || '/',
               'display_name', p.display_name,
               'record_name', public.development_project_record_name(p.project_id),
               'page_state', p.page_state,
               'created_at', p.created_at,
               'links', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'link_id', l.link_id, 'object_kind', l.object_kind, 'object_ref', l.object_ref,
                          'role', l.role, 'grade', l.grade, 'evidence_url', l.evidence_url,
                          'evidence_label', l.evidence_label, 'evidence_quote', l.evidence_quote,
                          'evidence_note', l.evidence_note, 'display_text', l.display_text,
                          'event_date', l.event_date, 'event_date_label', l.event_date_label, 'aspect', l.aspect,
                          'link_state', l.link_state, 'proposed_by', l.proposed_by, 'decided_at', l.decided_at,
                          'decision_reason', l.decision_reason, 'names_private_person', l.names_private_person,
                          'created_at', l.created_at)
                        order by case l.link_state when 'candidate' then 0 when 'approved' then 1 else 2 end,
                                 l.created_at, l.link_id)
                   from public.development_project_link l
                  where l.project_id = p.project_id
                    and not exists (select 1 from public.development_project_link s where s.supersedes = l.link_id)), '[]'::jsonb))
             order by p.created_at, p.project_key)
        from public.development_project p
       where p.merged_into is null), '[]'::jsonb),
    'last_publish_request', (select max(requested_at) from public.development_publish_request_log));
end $fn$;

create or replace function public.development_publish_request()
returns bigint language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $fn$
declare uid uuid := public.development_actor(); _pat text; _req bigint; _recent timestamptz;
begin
  if uid is null or not public.development_reviewer_can(uid, 'project') then
    raise exception 'only a current reviewer can publish' using errcode = '42501';
  end if;
  select max(requested_at) into _recent from public.development_publish_request_log;
  if _recent is not null and _recent > now() - interval '2 minutes' then
    raise exception 'publishing was requested at %; wait 2 minutes before requesting again',
      to_char(_recent, 'HH24:MI:SS') using errcode = '55006';
  end if;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    raise exception 'no GitHub token is stored (vault secret github_actions_pat); publishing cannot be started'
      using errcode = '28000';
  end if;
  select net.http_post(
    url     := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/publish-development-dossiers.yml/dispatches',
    body    := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('dry_run', 'false')),
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || _pat,
                 'Accept', 'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 'User-Agent', 'homesignal-acquisition-dashboard',
                 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000
  ) into _req;
  insert into public.development_publish_request_log (requested_by, net_request_id) values (uid, _req);
  return _req;
end $fn$;

revoke all on function public.development_review_queue() from public, anon, authenticated;
revoke all on function public.development_publish_request() from public, anon, authenticated;
grant execute on function public.development_review_queue() to authenticated;
grant execute on function public.development_publish_request() to authenticated;

commit;
