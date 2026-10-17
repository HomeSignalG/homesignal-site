-- app_refresh_zip: a government notice is dated by ITS OWN published date, and the newest are chosen.
-- Founder instruction 2026-10-17 ("everything needs to be fixed that is wrong"), from the Skagit County WA audit.
--
-- THE DEFECT. app_refresh_zip builds the Government & civic / Planning & zoning feed from two places:
--   (1) public.alerts            - dated by published_at (correct)
--   (2) the cached report's area sites (dev_sites_deduped) - dated current_date, or file_date else current_date,
--       and the 6 rows were picked by `order by md5(el::text)` (pseudo-random, not newest).
-- (2) runs first, and (1) skips any source_ref (2) already wrote, so the wrong date won. Measured 2026-10-17
-- (control: 219,306 app_changes): of 120,728 notice rows matched to an alert, 55,005 (46%) carried a date different
-- from the notice's published_at, 36,414 of them by more than 30 days, across 6,549 ZIP pages. On Skagit County
-- every notice read 2026-10-17, so the page sorted by title, not date.
--
-- THE FIX (one canonical date owner: alerts.published_at, via two helpers; nothing else moves):
--   * public.app_notice_date(cid, url)      - the same date the alerts path writes
--                                             (published_at::date when sane, else created_at::date).
--   * public.app_notice_in_window(cid, url) - the founder's GN window (dated notice: today-365 .. today+730;
--                                             undated kept), which the shortcut path never applied.
--   * both shortcut inserts: date = file_date (unchanged precedence) else the notice's own date else
--     current_date (only when NO alert exists); pick the NEWEST 6 (nulls last) instead of md5; apply the window.
-- Category labels, the alerts path, the 14-day rule and every other statement are untouched.
--
-- BUILT BY SPLICING THE LIVE BODY (claims rule 7), fail-closed on each needle's exact count, with a post-condition
-- per replace. The pre-change body is archived to public.app_refresh_zip_def_archive (tag below) for rollback:
--   select def from public.app_refresh_zip_def_archive where tag = 'pre-notice-dates-20261017';  -- then execute it.
-- Existing app_changes rows are not edited here: each ZIP is rebuilt by its next refresh (~53 h sweep).

create or replace function public.app_notice_date(p_cid uuid, p_url text)
returns date language sql stable as $f$
  select coalesce(
           case when a.published_at >= date '2000-01-01' and a.published_at < now() + interval '2 years'
                then a.published_at::date end,
           a.created_at::date)
    from public.alerts a
   where a.community_id = p_cid and a.source_url = p_url and a.pipeline_type = 'government_notice'
   limit 1
$f$;

create or replace function public.app_notice_in_window(p_cid uuid, p_url text)
returns boolean language sql stable as $f$
  select not exists (
    select 1 from public.alerts a
     where a.community_id = p_cid and a.source_url = p_url and a.pipeline_type = 'government_notice'
       and a.published_at is not null
       and a.published_at::date not between current_date - 365 and current_date + 730)
$f$;

revoke all on function public.app_notice_date(uuid, text) from public, anon, authenticated;
revoke all on function public.app_notice_in_window(uuid, text) from public, anon, authenticated;
grant execute on function public.app_notice_date(uuid, text) to postgres, service_role;
grant execute on function public.app_notice_in_window(uuid, text) to postgres, service_role;

do $splice$
declare
  d text; d0 text; n int; r jsonb; i int;
  arr jsonb := jsonb_build_array(
    jsonb_build_object('needle', $n$order by md5(el::text)$n$,
      'repl',  $n$order by public.app_notice_date(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url')) desc nulls last, md5(el::text)$n$,
      'expect', 2),
    jsonb_build_object('needle', $n$then left(el->>'file_date',10)::date else current_date end,$n$,
      'repl',  $n$then left(el->>'file_date',10)::date else coalesce(public.app_notice_date(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url')), current_date) end,$n$,
      'expect', 1),
    jsonb_build_object('needle', E'      current_date, coalesce(el->>\'record_url\', el->>\'url\'), \'Medium\', \'safety\'',
      'repl',  E'      coalesce(public.app_notice_date(coalesce(_root,_cid), coalesce(el->>\'record_url\', el->>\'url\')), current_date), coalesce(el->>\'record_url\', el->>\'url\'), \'Medium\', \'safety\'',
      'expect', 1),
    -- the needle carries the NEXT line because the bare `where ... ='development'` also opens the _ndp count
    -- (scope = 'point'); only this insert has `<> 'point'`.
    jsonb_build_object('needle', $n$where coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')<>'point'$n$,
      'repl',  $n$where coalesce(el->>'relevance','')='development'
      and public.app_notice_in_window(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url'))
      and coalesce(el->>'scope','')<>'point'$n$,
      'expect', 1),
    jsonb_build_object('needle', $n$where coalesce(el->>'relevance','')='civic' and $n$,
      'repl',  $n$where coalesce(el->>'relevance','')='civic'
      and public.app_notice_in_window(coalesce(_root,_cid), coalesce(el->>'record_url', el->>'url')) and $n$,
      'expect', 1));
begin
  d := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  d0 := d;
  if position('app_notice_date' in d) > 0 then
    raise exception 'app_refresh_zip already carries app_notice_date; nothing to do';
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

  -- post-conditions on the whole body
  if (length(d) - length(replace(d, 'app_notice_date', ''))) / length('app_notice_date') <> 4 then
    raise exception 'expected exactly 4 app_notice_date call sites';
  end if;
  if (length(d) - length(replace(d, 'app_notice_in_window', ''))) / length('app_notice_in_window') <> 2 then
    raise exception 'expected exactly 2 app_notice_in_window call sites';
  end if;
  if position('order by md5(el::text)' in d) > 0 and
     (length(d) - length(replace(d, 'order by md5(el::text)', ''))) > 0 then
    raise exception 'a bare md5 ordering survived';
  end if;

  insert into public.app_refresh_zip_def_archive (tag, md5, def)
  values ('pre-notice-dates-20261017', md5(d0), d0);

  execute d;
end
$splice$;
