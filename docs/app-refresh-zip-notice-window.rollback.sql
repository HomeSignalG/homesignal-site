-- ROLLBACK for docs/app-refresh-zip-notice-window.sql. NOT APPLIED by this file's author.
-- A REVERSE SPLICE, not a restore of the archived body: other sessions splice this function too (2026-11-27 14:22Z and
-- 15:25Z), and restoring an archived body would silently undo their later work. Each block is put back exactly as it was
-- (the pre-change text is the first needle of docs/app-refresh-zip-notice-window.sql). Fail-closed on counts.
-- The archived pre-change body is public.app_refresh_zip_def_archive where tag = 'pre-notice-window-20261127'.

do $rollback$
declare
  nd constant text := $e$coalesce(case when a.published_at >= date '2000-01-01' and a.published_at < now() + interval '2 years'
                      then a.published_at::date end, a.created_at::date)$e$;
  d text; n int; r jsonb; i int; arr jsonb;
begin
  d := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  if position('NOTICE WINDOW (founder ruling 2026-11-27)' in d) = 0 then
    raise exception 'the notice window is not present; nothing to roll back';
  end if;
  arr := jsonb_build_array(
    jsonb_build_object('needle',
      $n$    -- NOTICE WINDOW (founder ruling 2026-11-27): shown by the notice's OWN date, today-14 .. today+90, not by ingest time.
    -- Local News below keeps its own 14-day ingest window.
    and $n$ || nd || $n$
        between current_date - 14 and current_date + 90
    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only$n$,
      'repl',
      $n$    and a.created_at >= now() - interval '14 days'
    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only$n$,
      'expect', 1),
    jsonb_build_object('needle',
      $n$    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  -- upcoming first (soonest first), then past within 14 days (newest first), then id
  order by (case when $n$ || nd || $n$ >= current_date then 0 else 1 end),
           (case when $n$ || nd || $n$ >= current_date then $n$ || nd || $n$ end) asc,
           $n$ || nd || $n$ desc,
           a.id limit 48;$n$,
      'repl',
      $n$    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  order by a.created_at desc, a.id limit 48;$n$,
      'expect', 1));
  for i in 0 .. jsonb_array_length(arr) - 1 loop
    r := arr -> i;
    n := (length(d) - length(replace(d, r->>'needle', ''))) / length(r->>'needle');
    if n <> (r->>'expect')::int then
      raise exception 'rollback splice % refused: needle found % time(s), expected %', i, n, r->>'expect';
    end if;
    d := replace(d, r->>'needle', r->>'repl');
  end loop;
  if (length(d) - length(replace(d, 'a.created_at >= now() - interval ''14 days''', ''))) / length('a.created_at >= now() - interval ''14 days''') <> 2 then
    raise exception 'rollback post-condition: expected two 14-day ingest windows';
  end if;
  execute d;
end
$rollback$;
