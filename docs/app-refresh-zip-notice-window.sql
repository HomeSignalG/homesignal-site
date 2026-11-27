-- app_refresh_zip: a Government & civic NOTICE is shown by ITS OWN date, not by when it was ingested.
-- Founder ruling 2026-11-27 (from the ZIP 80021 investigation). NOT APPLIED to production by this file's author.
--
-- THE DEFECT. The notice insert selected `a.created_at >= now() - interval '14 days'` (ingest time). A notice created
-- more than 14 days ago left the page even when its event is still ahead. Measured 2026-11-27 (control: today
-- 2026-11-27): 2,110 government-notice alerts across 132 communities are dated in the future and were created more than
-- 14 days ago (865 inside the next 30 days; 1,784 of them also live in `meetings`, so about 326 disappear entirely).
-- ZIP 80021 lost two Board of County Commissioners items dated 11-17 on 11-27 for this reason.
--
-- THE RULE (this statement only, the Government & civic notice insert):
--   * notice_date = the sane published_at (2000-01-01 .. now()+2 years) else created_at::date. This is the SAME date the
--     insert already writes to occurred_at (see public.app_notice_date); it is inlined because app_notice_date is scoped
--     to pipeline_type = 'government_notice' and this insert also admits tagged news alerts, which would read NULL.
--   * show when  current_date - 14 <= notice_date <= current_date + 90.
--   * under the 48 cap: upcoming (notice_date >= today) soonest first, then past (within 14 days) newest first, then a.id.
--   * UNCHANGED: the Local News insert (its own 14-day ingest window), the shortcut inserts (public.app_notice_in_window),
--     the 365/730 GN floor, every other statement.
-- Accepted effect (founder): about 138 recently ingested notices whose own date is more than 14 days old stop showing.
-- Existing pages change only when each ZIP is next refreshed (about every 53 hours).
--
-- BUILT BY SPLICING THE LIVE BODY (claims rule 7), never retyped. Fail-closed:
--   1. the live function's md5 must equal the value this file was authored against (v_expected_md5), or it refuses;
--   2. each needle must occur exactly once, and each replacement is checked to have taken;
--   3. whole-body post-conditions; the pre-change body is archived to public.app_refresh_zip_def_archive FIRST.
-- ANOTHER SESSION SPLICES THIS FUNCTION (tile-tags 14:22Z and topic-gate 15:25Z on 2026-11-27). If the live md5 has moved,
-- this refuses on purpose: re-read the live body, confirm the two needles, update v_expected_md5, and re-run the test.
-- Rollback: docs/app-refresh-zip-notice-window.rollback.sql (a reverse splice that keeps later changes by others).

do $splice$
declare
  v_expected_md5 constant text := 'e42d6011bde9d2aa95e8b9ec3d43dbdd';
  nd constant text := $e$coalesce(case when a.published_at >= date '2000-01-01' and a.published_at < now() + interval '2 years'
                      then a.published_at::date end, a.created_at::date)$e$;
  d text; d0 text; n int; r jsonb; i int; arr jsonb;
begin
  d := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  d0 := d;
  if md5(d) <> v_expected_md5 then
    raise exception 'live app_refresh_zip md5 is % (authored against %): re-read the live body and re-run', md5(d), v_expected_md5;
  end if;
  if position('NOTICE WINDOW (founder ruling 2026-11-27)' in d) > 0 then
    raise exception 'app_refresh_zip already carries the notice window; nothing to do';
  end if;

  arr := jsonb_build_array(
    -- 1. the window (line 308). The next comment line makes the needle unique: the Local News insert carries the same
    --    `created_at >= now() - interval '14 days'` line and must NOT change.
    jsonb_build_object('needle',
      $n$    and a.created_at >= now() - interval '14 days'
    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only$n$,
      'repl',
      $n$    -- NOTICE WINDOW (founder ruling 2026-11-27): shown by the notice's OWN date, today-14 .. today+90, not by ingest time.
    -- Local News below keeps its own 14-day ingest window.
    and $n$ || nd || $n$
        between current_date - 14 and current_date + 90
    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only$n$,
      'expect', 1),
    -- 2. the order under the 48 cap (line 315). The preceding line makes the needle unique (Local News ends the same way).
    jsonb_build_object('needle',
      $n$    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  order by a.created_at desc, a.id limit 48;$n$,
      'repl',
      $n$    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  -- upcoming first (soonest first), then past within 14 days (newest first), then id
  order by (case when $n$ || nd || $n$ >= current_date then 0 else 1 end),
           (case when $n$ || nd || $n$ >= current_date then $n$ || nd || $n$ end) asc,
           $n$ || nd || $n$ desc,
           a.id limit 48;$n$,
      'expect', 1));

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

  -- post-conditions on the whole body: exactly one 14-day ingest window is left (Local News), exactly one old-style
  -- ordering is left (Local News), and the notice insert carries the new window once.
  if (length(d) - length(replace(d, 'a.created_at >= now() - interval ''14 days''', ''))) / length('a.created_at >= now() - interval ''14 days''') <> 1 then
    raise exception 'expected exactly one 14-day ingest window to remain (Local News)';
  end if;
  if (length(d) - length(replace(d, 'order by a.created_at desc, a.id limit 48;', ''))) / length('order by a.created_at desc, a.id limit 48;') <> 1 then
    raise exception 'expected exactly one created_at ordering to remain (Local News)';
  end if;
  if (length(d) - length(replace(d, 'between current_date - 14 and current_date + 90', ''))) / length('between current_date - 14 and current_date + 90') <> 1 then
    raise exception 'expected the new window exactly once';
  end if;

  insert into public.app_refresh_zip_def_archive (tag, md5, def)
  values ('pre-notice-window-20261127', md5(d0), d0);

  execute d;
end
$splice$;
