-- app_refresh_zip: a Granicus meeting posted first as an event_id link and then as a clip_id link is ONE notice.
-- Follows app-refresh-zip-notice-dates.sql (same session, same audit: Skagit County WA).
--
-- THE DEFECT. Granicus publishes a meeting's agenda first under AgendaViewer.php?...&event_id=N and, once the
-- video exists, again under ...&clip_id=M. Ingest dedupes notices on the link (and must not dedupe on title:
-- different bodies legitimately post similar titles), so both are stored and both reach the ZIP page.
-- Measured 2026-10-17 (control: 18,143 government notices): 312 stored event_id notices have a clip_id notice
-- with the SAME community, SAME title and SAME published date on granicus.com; 29 communities; they render as
-- 1,522 app_changes rows on 510 ZIP pages. Skagit County shows 12 of them as visible duplicate lines.
--
-- THE FIX is display-only and as narrow as the evidence: public.app_notice_superseded(cid, url) is true ONLY for a
-- granicus.com event_id notice that has a clip_id twin (same community, title, published day). The alerts path
-- and both cached-site shortcut inserts skip it, so the clip_id notice (the later, fuller record) is the one shown.
-- NOTHING is deleted or changed in public.alerts, the ingest dedupe rule is untouched, and a title match without
-- the Granicus event/clip shape is never collapsed.
--
-- Built by splicing the live body (claims rule 7), fail-closed on every needle count, with a post-condition per
-- replace. Pre-change body archived as tag 'pre-granicus-pairs-20261017'.

create or replace function public.app_notice_superseded(p_cid uuid, p_url text)
returns boolean language sql stable as $f$
  select p_url ~ 'granicus\.com' and p_url like '%event_id=%'
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
        where a.community_id = p_cid and a.source_url = p_url and a.pipeline_type = 'government_notice')
$f$;

revoke all on function public.app_notice_superseded(uuid, text) from public, anon, authenticated;
grant execute on function public.app_notice_superseded(uuid, text) to postgres, service_role;

do $splice$
declare
  d text; d0 text; n int; r jsonb; i int;
  arr jsonb := jsonb_build_array(
    jsonb_build_object('needle', E'    and a.pipeline_type = \'government_notice\'\n    and coalesce(a.source_url,\'\')<>\'\'',
      'repl',  E'    and a.pipeline_type = \'government_notice\'\n    and coalesce(a.source_url,\'\')<>\'\'\n    and not public.app_notice_superseded(a.community_id, a.source_url)',
      'expect', 1),
    jsonb_build_object('needle', $n$and public.app_notice_in_window(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url'))$n$,
      'repl',  $n$and public.app_notice_in_window(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url'))
      and not public.app_notice_superseded(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url'))$n$,
      'expect', 2));
begin
  d := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  d0 := d;
  if position('app_notice_superseded' in d) > 0 then
    raise exception 'app_refresh_zip already carries app_notice_superseded; nothing to do';
  end if;
  if position('app_notice_date' in d) = 0 then
    raise exception 'app-refresh-zip-notice-dates.sql must be applied first';
  end if;

  for i in 0 .. jsonb_array_length(arr) - 1 loop
    r := arr -> i;
    n := (length(d) - length(replace(d, r->>'needle', ''))) / length(r->>'needle');
    if n <> (r->>'expect')::int then
      raise exception 'splice % refused: needle found % time(s), expected %', i, n, r->>'expect';
    end if;
    d := replace(d, r->>'needle', r->>'repl');
    if position(r->>'repl' in d) = 0 then
      raise exception 'splice % did not take', i;
    end if;
  end loop;

  if (length(d) - length(replace(d, 'app_notice_superseded', ''))) / length('app_notice_superseded') <> 3 then
    raise exception 'expected exactly 3 app_notice_superseded call sites';
  end if;

  insert into public.app_refresh_zip_def_archive (tag, md5, def)
  values ('pre-granicus-pairs-20261017', md5(d0), d0);

  execute d;
end
$splice$;
