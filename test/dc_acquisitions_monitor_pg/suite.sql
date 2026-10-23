-- Scenarios for the dc_acquisitions check. Each one rebuilds public.dc_source and
-- public.dc_acquisition_run, runs the monitor and reads the row it wrote. PASS arrives as a NOTICE
-- and a failed expectation as an ERROR, so a red run names the scenario.
create or replace function pg_temp.expect(label text, cond boolean, got text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FAIL % -- %', label, got; end if;
  raise notice 'PASS %', label;
end $f$;

create or replace function pg_temp.reset() returns void language sql as
  $$ truncate public.dc_acquisition_run, public.dc_source restart identity; truncate public.pipeline_health_check $$;
create or replace function pg_temp.src(k text, st text, d text[]) returns void language sql as
  $$ insert into public.dc_source values (k, st, d) $$;
-- a run that started h_ago hours ago; dur_min minutes long; state null = still open
create or replace function pg_temp.run(k text, d text, h_ago numeric, state text, dur_min int default 1) returns void language sql as
  $$ insert into public.dc_acquisition_run (source_key, distribution_key, started_at, completed_at, completeness_state)
     values (k, d, now() - make_interval(secs => h_ago * 3600),
             case when state is null then null else now() - make_interval(secs => h_ago * 3600) + make_interval(mins => dur_min) end,
             state) $$;
create or replace function pg_temp.row() returns public.pipeline_health_check language plpgsql as $f$
declare r public.pipeline_health_check;
begin
  drop table if exists pg_temp._eval;
  perform * from public.pipeline_health_tick();
  select * into r from public.pipeline_health_check where check_name = 'dc_acquisitions';
  return r;
end $f$;
create or replace function pg_temp.healthy() returns void language sql as $$
  select pg_temp.src('compute_atlas', 'ACTIVE', array['facilities']);
  select pg_temp.src('epoch_ai', 'ACTIVE', array['data_centers', 'timelines']);
  select pg_temp.run('compute_atlas', 'facilities', 31, 'SUCCESS_COMPLETE');
  select pg_temp.run('compute_atlas', 'facilities', 7, 'SUCCESS_COMPLETE');
  select pg_temp.run('epoch_ai', 'data_centers', 6.5, 'SUCCESS_COMPLETE');
  select pg_temp.run('epoch_ai', 'timelines', 6.5, 'SUCCESS_COMPLETE');
$$;

do $$
declare r public.pipeline_health_check;
begin
  -- 1 every distribution read in the last day
  perform pg_temp.reset(); perform pg_temp.healthy();
  r := pg_temp.row();
  perform pg_temp.expect('S1 all three reads current: ok and alertable',
    r.ok and r.alertable and r.detail like '3 data-centre source read(s) current%', r.detail);

  -- 2 Atlas missed one daily read (the 2026-10-23 shape): newest success 31 h ago
  perform pg_temp.reset(); perform pg_temp.healthy();
  delete from public.dc_acquisition_run where source_key = 'compute_atlas' and started_at > now() - interval '24 hours';
  r := pg_temp.row();
  perform pg_temp.expect('S2 Atlas newest complete read 31 h old: FAILS and alertable', not r.ok and r.alertable, r.detail);
  perform pg_temp.expect('S2 the detail names Atlas and not Epoch',
    r.detail like '1 of 3 %compute_atlas/facilities newest complete %' and r.detail not like '%epoch_ai/%', r.detail);

  -- 3 29 h is inside the limit (a late GitHub schedule is not an incident)
  perform pg_temp.reset(); perform pg_temp.src('compute_atlas', 'ACTIVE', array['facilities']);
  perform pg_temp.run('compute_atlas', 'facilities', 29, 'SUCCESS_COMPLETE');
  r := pg_temp.row();
  perform pg_temp.expect('S3 newest complete read 29 h old: ok', r.ok, r.detail);

  -- 4 one of Epoch's two distributions missed
  perform pg_temp.reset(); perform pg_temp.healthy();
  delete from public.dc_acquisition_run where distribution_key = 'timelines';
  perform pg_temp.run('epoch_ai', 'timelines', 40, 'SUCCESS_COMPLETE');
  r := pg_temp.row();
  perform pg_temp.expect('S4 Epoch timelines stale, data_centers fresh: FAILS on timelines only',
    not r.ok and r.detail like '%epoch_ai/timelines%' and r.detail not like '%epoch_ai/data_centers newest%' , r.detail);

  -- 5 the newest run ran and failed, though a success is recent
  perform pg_temp.reset(); perform pg_temp.healthy();
  perform pg_temp.run('compute_atlas', 'facilities', 1, 'FETCH_FAILED');
  r := pg_temp.row();
  perform pg_temp.expect('S5 newest Atlas run FETCH_FAILED: FAILS and names the state',
    not r.ok and r.detail like '%newest run FETCH_FAILED%', r.detail);

  -- 6 a run still open for 10 minutes is in progress, not a failure
  perform pg_temp.reset(); perform pg_temp.healthy();
  perform pg_temp.run('compute_atlas', 'facilities', 10.0/60, null);
  r := pg_temp.row();
  perform pg_temp.expect('S6 a run open 10 minutes: ok', r.ok, r.detail);

  -- 7 a run open for 3 hours is stuck
  perform pg_temp.reset(); perform pg_temp.healthy();
  perform pg_temp.run('compute_atlas', 'facilities', 3, null);
  r := pg_temp.row();
  perform pg_temp.expect('S7 a run open 3 hours: FAILS', not r.ok and r.detail like '%newest run open%', r.detail);

  -- 8 a source that has never completed a read
  perform pg_temp.reset(); perform pg_temp.healthy(); perform pg_temp.src('new_source', 'ACTIVE', array['records']);
  r := pg_temp.row();
  perform pg_temp.expect('S8 an ACTIVE source never read: FAILS, says never',
    not r.ok and r.detail like '%new_source/records newest complete never%', r.detail);

  -- 9 an inactive source is not watched
  perform pg_temp.reset(); perform pg_temp.healthy(); perform pg_temp.src('paused', 'PAUSED', array['records']);
  r := pg_temp.row();
  perform pg_temp.expect('S9 a PAUSED source with no reads: ok, not counted', r.ok and r.detail like '3 data-centre%', r.detail);

  -- 10 no active source at all is not a silent pass
  perform pg_temp.reset();
  r := pg_temp.row();
  perform pg_temp.expect('S10 no ACTIVE source: FAILS (nothing is being read)', not r.ok and r.detail like '%nothing is being read%', r.detail);

  -- 11 runs of another distribution do not count
  perform pg_temp.reset(); perform pg_temp.src('compute_atlas', 'ACTIVE', array['facilities']);
  perform pg_temp.run('compute_atlas', 'other', 1, 'SUCCESS_COMPLETE');
  r := pg_temp.row();
  perform pg_temp.expect('S11 a fresh read of a different distribution does not satisfy facilities', not r.ok, r.detail);

  -- 12 the check itself breaks
  perform pg_temp.reset(); perform pg_temp.healthy();
  alter table public.dc_acquisition_run rename to dc_acquisition_run_gone;
  r := pg_temp.row();
  alter table public.dc_acquisition_run_gone rename to dc_acquisition_run;
  perform pg_temp.expect('S12 a check that cannot run is a FAILING alertable row',
    not r.ok and r.alertable and r.detail like '%could not run%', coalesce(r.detail, 'no row'));
  perform pg_temp.expect('S12 the stand-in check before the anchor still ran (the monitor is not dead)',
    exists (select 1 from public.pipeline_health_check where check_name = 'stand_in'), 'stand_in row missing');
end $$;
