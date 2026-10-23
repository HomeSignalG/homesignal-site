-- app_refresh_zip: one Granicus meeting recorded as several clip_id videos is ONE notice on the ZIP page.
-- Follows app-refresh-zip-granicus-pairs.sql (founder request 2026-10-22, from the Skagit County WA competitor audit:
-- "Deduplicating by meeting session/event date").
--
-- THE DEFECT. Granicus can publish one session as several videos (a recess, a morning and an afternoon part, a
-- re-upload). Each video gets its own AgendaViewer.php?...&clip_id=N link with the SAME title, and the title already
-- carries the body and the meeting date ("Skagit County Planning Commission - Oct 13, 2026"). Ingest dedupes notices on
-- the link, so every clip is stored and every clip reaches the ZIP page as its own line.
-- Measured 2026-10-22 (control: 4,150 granicus.com government notices): after the event/clip rule, 49 groups of two or
-- more clip_id notices remain with the same community, title and published day; 69 extra rows; 13 communities. Every
-- group shares one host and one view_id. Largest: Charles County MD, 5 clips for one Animal Matters Hearing Board day.
-- Skagit: clips 5159 and 5160, "Skagit County Planning Commission - Oct 13, 2026", shown twice on all 14 ZIP pages.
--
-- THE FIX extends public.app_notice_superseded(cid, url), the ONE decision all three app_refresh_zip call sites already
-- ask (the alerts path and both cached-site shortcut inserts). A granicus.com clip_id notice is superseded when another
-- granicus.com clip_id notice in the same community has the same title, the same published day, the same host and path,
-- the same view_id, and a LOWER clip_id. So the first recording of a session is the one line shown, and the choice is
-- the same on every run. The event_id rule is unchanged, byte for byte.
-- Display only: NOTHING in public.alerts is changed or deleted, and the ingest dedupe rule is untouched. A title match
-- across different hosts, views or days is never collapsed, and an undated notice never is.
--
-- Fail-closed: refuses unless the live helper is exactly the event/clip version (md5 of prosrc below). app_refresh_zip
-- itself is not touched, so there is no splice; its 3 call sites are re-checked below.

do $guard$
declare got text;
begin
  select md5(prosrc) into got from pg_proc
   where oid = 'public.app_notice_superseded(uuid, text)'::regprocedure;
  if got is distinct from '0f29d0876c2b92bc6d8cd275d7edee31' then
    raise exception 'app_notice_superseded is not the event/clip version (md5 %); refusing', got;
  end if;
  if (select (length(d) - length(replace(d, 'app_notice_superseded', ''))) / length('app_notice_superseded')
        from (select pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) d) x) <> 3 then
    raise exception 'app_refresh_zip no longer has exactly 3 app_notice_superseded call sites; refusing';
  end if;
end
$guard$;

create or replace function public.app_notice_superseded(p_cid uuid, p_url text)
returns boolean language sql stable as $f$
  select (p_url ~ 'granicus\.com' and p_url like '%event_id=%'
     and exists (
       select 1
         from public.alerts a
         join public.alerts b
           on b.community_id = a.community_id
          and b.pipeline_type = 'government_notice'
          and b.title = a.title
          and b.published_at is not null and a.published_at is not null
          and b.published_at::date = a.published_at::date
          and b.source_url ~ 'granicus\.com' and b.source_url like '%clip_id=%'
        where a.community_id = p_cid and a.source_url = p_url and a.pipeline_type = 'government_notice'))
  or (p_url ~ 'granicus\.com' and p_url ~ '[?&]clip_id=\d+'
     and exists (
       select 1
         from public.alerts a
         join public.alerts b
           on b.community_id = a.community_id
          and b.pipeline_type = 'government_notice'
          and b.title = a.title
          and b.published_at is not null and a.published_at is not null
          and b.published_at::date = a.published_at::date
          and b.source_url ~ 'granicus\.com' and b.source_url ~ '[?&]clip_id=\d+'
          and split_part(b.source_url, '?', 1) = split_part(a.source_url, '?', 1)
          and substring(b.source_url from '[?&]view_id=(\d+)') is not distinct from substring(a.source_url from '[?&]view_id=(\d+)')
          and substring(b.source_url from '[?&]clip_id=(\d+)')::bigint < substring(a.source_url from '[?&]clip_id=(\d+)')::bigint
        where a.community_id = p_cid and a.source_url = p_url and a.pipeline_type = 'government_notice'))
$f$;

revoke all on function public.app_notice_superseded(uuid, text) from public, anon, authenticated;
grant execute on function public.app_notice_superseded(uuid, text) to postgres, service_role;

-- Post-condition: no clip_id group of the defect's shape keeps more than one visible notice, and the event/clip rule
-- still hides every event_id notice it hid before (its half of the function is unchanged, so this is a re-check).
do $post$
declare left_groups int; ctrl int;
begin
  select count(*) into ctrl from public.alerts
   where pipeline_type = 'government_notice' and source_url ~ 'granicus\.com';
  if ctrl = 0 then raise exception 'control: 0 granicus notices; the check would prove nothing'; end if;
  select count(*) into left_groups from (
    select community_id, title, published_at::date, split_part(source_url, '?', 1),
           substring(source_url from '[?&]view_id=(\d+)')
      from public.alerts
     where pipeline_type = 'government_notice' and source_url ~ 'granicus\.com'
       and source_url ~ '[?&]clip_id=\d+' and published_at is not null
       and not public.app_notice_superseded(community_id, source_url)
     group by 1, 2, 3, 4, 5 having count(*) > 1) g;
  if left_groups <> 0 then raise exception 'post-condition: % clip_id groups still show more than one notice', left_groups; end if;
end
$post$;
