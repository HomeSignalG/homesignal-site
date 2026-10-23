-- app_refresh_zip: one row per official record on a ZIP page, and a meeting summary that does not repeat its place.
-- Found in the Pierce County WA launch audit, 2026-10-22. Founder: "ye fix".
--
-- DEFECT 1, THE SAME RECORD LISTED TWO OR THREE TIMES. app_refresh_zip fills the Government & civic / Planning & zoning
-- feed from three places: (1) the cached report's area sites (dev_sites_deduped), (2) public.meetings (the meeting
-- mirror), (3) public.alerts. Only (3) skips a source_ref already written. (1) and (2) do not check each other, so a
-- council meeting that is both a cached civic copy and an upcoming meeting is written twice, and the page shows both.
-- Nothing removes repeats on the site either (lib/data.js changes() reads app_changes as stored).
-- Measured 2026-10-22 (control: 127,723 Government & civic rows nationally): 7,189 repeated rows on 2,597 ZIP pages.
-- Pierce County WA: 239 of 957 government rows, on all 65 pages ("Pierce County Council Meeting" for Oct 27 shown
-- as a notice and again as "Public meeting — Pierce County Council Meeting").
--
-- DEFECT 2, "Puyallup Puyallup City Council, Boards & Commissions on Oct 26". The meeting mirror's summary is
-- <place> <meeting_type> on <date>, and many sources' meeting_type already starts with the place
-- ("Pierce County Pierce County Council meeting"). Measured 2026-10-22 (control: 24,444 meeting rows on 4,685 pages):
-- 2,192 rows on 742 pages start with a repeated word group (a regex lead; the helper below is the rule).
--
-- THE FIX (nothing else moves; no category, date, window, limit or source rule changes):
--   * public.app_meeting_label(place, meeting_type): place || ' ' || type as before, except when the type already
--     starts with the place (case-insensitive, at a word boundary), then the type alone. An empty type still reads
--     '<place> meeting'.
--   * one delete, after every Government/Planning insert and before the notice count: for each source_ref on the page
--     (Local News excluded) keep ONE row: the meeting, then a High-confidence notice, then the cached copy; ties by
--     newest date, then md5 of the text (deterministic, never by the random row id).
--
-- BUILT BY SPLICING THE LIVE BODY (claims rule 7), fail-closed on each needle's exact count, with a post-condition per
-- replace. The pre-change body is archived to public.app_refresh_zip_def_archive (tag below) for rollback:
--   select def from public.app_refresh_zip_def_archive where tag = 'pre-one-row-per-record-20261022';  -- then execute it.
-- Existing app_changes rows are not edited here: each ZIP is rebuilt by its next refresh (the sweep).

create or replace function public.app_meeting_label(p_place text, p_type text)
returns text language sql immutable as $f$
  select case
    when nullif(p_type, '') is null then coalesce(p_place, '') || ' meeting'
    when coalesce(p_place, '') = '' then p_type
    when lower(left(p_type, length(p_place))) = lower(p_place)
         and (length(p_type) = length(p_place) or substr(p_type, length(p_place) + 1, 1) !~ '[[:alnum:]]')
      then p_type
    else p_place || ' ' || p_type
  end
$f$;

revoke all on function public.app_meeting_label(text, text) from public, anon, authenticated;
grant execute on function public.app_meeting_label(text, text) to postgres, service_role;

do $splice$
declare
  d text; d0 text; n int; r jsonb; i int;
  arr jsonb := jsonb_build_array(
    -- the meeting mirror's place expression opens with this line; wrap it in the label helper
    jsonb_build_object('needle', $n$    case when m.community_id = coalesce(_root,_cid) then coalesce(_county||' County','County')$n$,
      'repl',  $n$    public.app_meeting_label(case when m.community_id = coalesce(_root,_cid) then coalesce(_county||' County','County')$n$,
      'expect', 1),
    -- and closes here: the type is the helper's second argument
    jsonb_build_object('needle', $n$||' '||coalesce(nullif(m.meeting_type,''),'meeting')||' on '$n$,
      'repl',  $n$, m.meeting_type)||' on '$n$,
      'expect', 1),
    -- one row per official record, before the notice count reads the page
    jsonb_build_object('needle', $n$  select count(*) into _nc from public.app_changes where zip=_zip and coalesce(source_ref,'')<>'';$n$,
      'repl',  $n$  -- one row per official record on the page (2026-10-22): keep the meeting, then a High notice, then the copy
  delete from public.app_changes x
   using (select id, row_number() over (
            partition by source_ref
            order by (title like 'Public meeting — %') desc, (confidence = 'High') desc,
                     occurred_at desc nulls last, md5(coalesce(title,'')||'|'||coalesce(plain_language,''))) as rn
          from public.app_changes
          where zip=_zip and category <> 'Local News' and coalesce(source_ref,'')<>'') dup
   where x.id = dup.id and dup.rn > 1;

  select count(*) into _nc from public.app_changes where zip=_zip and coalesce(source_ref,'')<>'';$n$,
      'expect', 1));
begin
  d := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  d0 := d;
  if position('app_meeting_label' in d) > 0 then
    raise exception 'app_refresh_zip already carries app_meeting_label; nothing to do';
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
  if (length(d) - length(replace(d, 'app_meeting_label', ''))) / length('app_meeting_label') <> 1 then
    raise exception 'expected exactly 1 app_meeting_label call site';
  end if;
  if position($n$coalesce(nullif(m.meeting_type,''),'meeting')$n$ in d) > 0 then
    raise exception 'the old meeting summary survived';
  end if;
  if (length(d) - length(replace(d, 'one row per official record', ''))) / length('one row per official record') <> 1 then
    raise exception 'expected exactly 1 per-record delete';
  end if;
  if position('one row per official record' in d) > position('select count(*) into _nc' in d) then
    raise exception 'the per-record delete must run before the notice count';
  end if;

  insert into public.app_refresh_zip_def_archive (tag, md5, def)
  values ('pre-one-row-per-record-20261022', md5(d0), d0);

  execute d;
end
$splice$;
