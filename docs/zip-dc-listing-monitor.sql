-- DDL of record. The hourly monitor learns to see the stored ZIP data-center listings go stale (2026-11-14).
--
-- WHY. public.zip_dc_listing (docs/zip-dc-listing.sql) is filled by pg_cron 'zip-dc-listing' every 10
-- minutes, 1,500 ZIPs a run, oldest checked first, so every registry ZIP is re-read about every 90
-- minutes. The site build prints a ZIP's listings only when its row was checked within 48 hours
-- (scripts/gen_zip_pages.py DC_LISTING_MAX_AGE_HOURS). If the job stops, or every read starts failing,
-- the listings drop off the ZIP pages two days later and nothing says why.
--
-- WHAT IT ADDS: zip_dc_listings, alertable. It FAILS when
--   * a registry ZIP has no row (the table is incomplete), or
--   * any row was last checked more than 6 hours ago (four missed cycles; a stopped job is caught
--     ~42 hours before the build would drop anything), or
--   * any row carries last_error (map1_dc_zip_members failed for that ZIP; its old listings are kept), or
--   * any row is truncated (the reader hit its row limit, so the build prints nothing for that ZIP), or
--   * the table is missing (the check's own failure row).
-- The detail names the counts, the oldest check and up to five failing ZIPs.
--
-- THE SPLICE is docs/dc-acquisitions-monitor.sql's, unchanged: the live definition is read, never
-- retyped; it refuses unless the body fingerprints to the one it was written against (md5
-- 22400e90ff6924470dd237fa606e172d, 67,860 characters, read 2026-11-14) or already carries the check;
-- it proves ONE insertion, that the check name appears exactly twice, and that owner, grants,
-- SECURITY DEFINER, search_path, volatility, arguments and result did not change. Safe to apply twice.
do $mig$
declare
  fn        constant regprocedure := 'public.pipeline_health_tick()'::regprocedure;
  pre_md5   constant text := '22400e90ff6924470dd237fa606e172d';
  _anchor   constant text := 'insert into public.pipeline_health_check as c (';
  _name     constant text := '''zip_dc_listings''';
  _block    constant text := $blk$
  -- ZIP DATA-CENTER LISTINGS (2026-11-14). The stored per-ZIP listings the site build prints:
  -- every registry ZIP has a row, checked in the last 6 hours, with no read error and not truncated.
  begin
    insert into _eval
    select 'zip_dc_listings',
           (s.n_missing = 0 and s.n_stale = 0 and s.n_err = 0 and s.n_trunc = 0 and s.n_reg > 0),
           true,
           case when s.n_reg = 0
                then 'canonical_zip_registry is empty, so no ZIP is being read'
                when s.n_missing + s.n_stale + s.n_err + s.n_trunc > 0
                then 'zip_dc_listing is not current: ' || s.n_missing || ' registry ZIP(s) with no row, '
                     || s.n_stale || ' last checked over 6 h ago, ' || s.n_err || ' with a read error, '
                     || s.n_trunc || ' truncated; oldest check '
                     || coalesce(round(extract(epoch from (_now - s.oldest)) / 3600.0, 1) || ' h ago', 'never')
                     || coalesce('; e.g. ' || s.sample, '')
                     || '. The site build drops a ZIP''s listings 48 h after its last check; check pg_cron job zip-dc-listing'
                else s.n_reg || ' ZIPs checked, oldest check '
                     || round(extract(epoch from (_now - s.oldest)) / 3600.0, 1) || ' h ago; '
                     || s.n_with || ' ZIPs carry data-center listings' end
      from (select (select count(*) from public.canonical_zip_registry) as n_reg,
                   (select count(*) from public.canonical_zip_registry r
                     where not exists (select 1 from public.zip_dc_listing l where l.zip = r.zip)) as n_missing,
                   count(*) filter (where l.checked_at < _now - interval '6 hours') as n_stale,
                   count(*) filter (where l.last_error is not null) as n_err,
                   count(*) filter (where l.truncated) as n_trunc,
                   count(*) filter (where l.member_count > 0) as n_with,
                   min(l.checked_at) as oldest,
                   (select string_agg(x.zip || coalesce(' (' || left(x.last_error, 80) || ')', ''), ', ' order by x.zip collate "C")
                      from (select b.zip, b.last_error from public.zip_dc_listing b
                             where b.checked_at < _now - interval '6 hours' or b.last_error is not null or b.truncated
                             order by b.zip collate "C" limit 5) x) as sample
              from public.zip_dc_listing l) s;
  exception when others then
    insert into _eval values ('zip_dc_listings', false, true,
                              'the zip_dc_listings check could not run: ' || sqlerrm);
  end;

$blk$;
  _src          text;
  _def          text;
  _n            int;
  _attrs_before text;
  _attrs_after  text;
begin
  perform set_config('lock_timeout', '5s', true);

  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;
  if position(_name in _src) > 0 then
    if (length(_src) - length(replace(_src, _name, ''))) / length(_name) <> 2 then
      raise exception 'pipeline_health_tick: % must appear exactly twice (its insert and its failure row). Not applied.', _name;
    end if;
    raise notice 'pipeline_health_tick: zip_dc_listings already present (body md5 %)', md5(_src);
    return;
  end if;
  if md5(_src) <> pre_md5 then
    raise exception 'pipeline_health_tick drifted (body md5 %, expected %). Re-derive this migration. Not applied.',
      md5(_src), pre_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_before from pg_catalog.pg_proc p where p.oid = fn;

  _def := pg_get_functiondef(fn);
  _n := (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  if _n <> 1 then
    raise exception 'pipeline_health_tick: anchor % appears % time(s), expected exactly 1. Not applied.', _anchor, _n;
  end if;

  execute replace(_def, _anchor, _block || '  ' || _anchor);

  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;
  if md5(replace(_src, _block || '  ' || _anchor, _anchor)) <> pre_md5 then
    raise exception 'pipeline_health_tick: the splice was not one clean insertion (excised body md5 %, expected %). Rolled back.',
      md5(replace(_src, _block || '  ' || _anchor, _anchor)), pre_md5;
  end if;
  if (length(_src) - length(replace(_src, _name, ''))) / length(_name) <> 2 then
    raise exception 'pipeline_health_tick: % must appear exactly twice. Rolled back.', _name;
  end if;
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_after from pg_catalog.pg_proc p where p.oid = fn;
  if _attrs_after is distinct from _attrs_before then
    raise exception 'pipeline_health_tick: its attributes changed during the splice (% -> %). Rolled back.', _attrs_before, _attrs_after;
  end if;

  raise notice 'pipeline_health_tick: zip_dc_listings added (body md5 % -> %)', pre_md5, md5(_src);
end
$mig$;

-- VERIFY AFTER APPLYING: the next hourly tick at :10 fills the row.
--   select ok, alertable, detail from public.pipeline_health_check where check_name = 'zip_dc_listings';
