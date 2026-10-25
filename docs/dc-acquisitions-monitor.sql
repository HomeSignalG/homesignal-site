-- DDL of record (site repo: the data-centre plane is owned here; homesignal-ingest's Step-2A isolation
-- gate forbids that repo naming dc_* objects, which is why dc_resolvers and dc_address_check live here too).
--
-- The hourly monitor learns to see a missed data-centre source read (2026-10-23).
--
-- WHY. Compute Atlas (09:40 UTC) and Epoch AI (10:10 UTC) are read once a day by GitHub Actions
-- (ingest-compute-atlas.yml, ingest-epoch-ai.yml). On 2026-10-23 both scheduled runs got no
-- runner (runner_id 0, 2 s, logs 404) and wrote nothing. Nothing in pipeline_health_tick() read
-- public.dc_acquisition_run (read 2026-10-23: the body names it 0 times), so the miss showed only
-- as a red run in GitHub. It was found by hand and both reads were re-run that afternoon. The same
-- shape hit both sources on 2026-10-21 (the Actions outage).
--
-- Measured before writing (2026-10-23, every run ever, control = the run counts): Atlas
-- facilities 33 runs, Epoch data_centers 30, Epoch timelines 29, every one SUCCESS_COMPLETE; the
-- longest gap between successes in 30 days is 48.0 h on all three, and both of those gaps are
-- the two missed days above. On every other day the gap is about 24 h.
--
-- WHAT IT ADDS: dc_acquisitions, alertable. For every ACTIVE public.dc_source and every
-- distribution it declares, it FAILS when
--   * no SUCCESS_COMPLETE run completed in the last 30 hours (the schedule is daily, so 30 h is
--     one missed read plus 6 h for a late GitHub schedule), or none ever has; or
--   * the newest run of that distribution did not complete SUCCESS_COMPLETE (a read that ran and
--     failed, or one still open more than 2 h after it started).
-- A distribution with a fresh success and a clean newest run is fine. The detail names each
-- failing source/distribution, the time of its newest success and the newest run's state. The
-- check is wrapped, so a failure of its own is a FAILING alertable row and never a dead monitor.
--
-- THE SPLICE follows homesignal-ingest 20261023160000 (n5_proof_failing): the live definition is read, never retyped; it refuses unless
-- the body fingerprints to the one it was written against (md5 7f307c9cb6357e1c1bcafd21fbd9e58c,
-- 48,910 characters, read 2026-10-23) or already carries the check; and it proves the change was
-- ONE insertion, that the check name appears exactly twice, and that owner, grants, SECURITY
-- DEFINER, search_path, volatility, arguments and result did not change. Safe to apply twice.
do $mig$
declare
  fn        constant regprocedure := 'public.pipeline_health_tick()'::regprocedure;
  pre_md5   constant text := '7f307c9cb6357e1c1bcafd21fbd9e58c';
  _anchor   constant text := 'insert into public.pipeline_health_check as c (';
  _name     constant text := '''dc_acquisitions''';
  _block    constant text := $blk$
  -- DC ACQUISITIONS (2026-10-23). A data-centre source whose daily read did not land: no
  -- complete read in 30 hours, or a newest read that did not complete.
  begin
    insert into _eval
    select 'dc_acquisitions',
           (s.n_bad = 0 and s.n_dist > 0),
           true,
           case when s.n_dist = 0
                then 'no ACTIVE data-centre source declares a distribution, so nothing is being read'
                when s.n_bad > 0
                then s.n_bad || ' of ' || s.n_dist || ' data-centre source read(s) did not land: ' || s.bad_note
                     || '. Map 1 keeps the last complete read; re-run the source''s ingest workflow (mode=apply)'
                else s.n_dist || ' data-centre source read(s) current: ' || s.ok_note end
      from (select count(*) as n_dist,
                   count(*) filter (where x.bad) as n_bad,
                   string_agg(x.note, '; ' order by x.k collate "C") filter (where x.bad) as bad_note,
                   string_agg(x.note, '; ' order by x.k collate "C") filter (where not x.bad) as ok_note
              from (select d.source_key || '/' || d.distribution_key as k,
                           (ok.completed_at is null
                            or ok.completed_at < _now - interval '30 hours'
                            or (nw.completeness_state is distinct from 'SUCCESS_COMPLETE'
                                and (nw.completed_at is not null or nw.started_at < _now - interval '2 hours'))) as bad,
                           d.source_key || '/' || d.distribution_key || ' newest complete '
                             || coalesce(to_char(ok.completed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC ('
                                         || round(extract(epoch from (_now - ok.completed_at)) / 3600.0, 1) || ' h ago)', 'never')
                             || coalesce(', newest run ' || coalesce(nw.completeness_state, 'open') || ' at '
                                         || to_char(nw.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', '') as note
                      from (select s.source_key, unnest(s.distributions) as distribution_key
                              from public.dc_source s where s.active_state = 'ACTIVE') d
                      left join lateral (select r.completed_at
                                           from public.dc_acquisition_run r
                                          where r.source_key = d.source_key and r.distribution_key = d.distribution_key
                                            and r.completeness_state = 'SUCCESS_COMPLETE'
                                          order by r.completed_at desc limit 1) ok on true
                      left join lateral (select r.started_at, r.completed_at, r.completeness_state
                                           from public.dc_acquisition_run r
                                          where r.source_key = d.source_key and r.distribution_key = d.distribution_key
                                          order by r.started_at desc limit 1) nw on true) x) s;
  exception when others then
    insert into _eval values ('dc_acquisitions', false, true,
                              'the dc_acquisitions check could not run: ' || sqlerrm);
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
    raise notice 'pipeline_health_tick: dc_acquisitions already present (body md5 %)', md5(_src);
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

  raise notice 'pipeline_health_tick: dc_acquisitions added (body md5 % -> %)', pre_md5, md5(_src);
end
$mig$;

-- VERIFY AFTER APPLYING: the next hourly tick at :10 fills the row.
--   select ok, alertable, detail from public.pipeline_health_check where check_name = 'dc_acquisitions';
