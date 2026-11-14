-- Scenarios for the zip_dc_listings check. Each one rebuilds public.canonical_zip_registry and
-- public.zip_dc_listing, runs the monitor and reads the row it wrote. PASS arrives as a NOTICE and a
-- failed expectation as an ERROR, so a red run names the scenario.
create or replace function pg_temp.expect(label text, cond boolean, got text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FAIL % -- %', label, got; end if;
  raise notice 'PASS %', label;
end $f$;

create or replace function pg_temp.reset() returns void language sql as
  $$ truncate public.zip_dc_listing, public.canonical_zip_registry; truncate public.pipeline_health_check $$;
-- n registry ZIPs (10001..), each with a row checked h_ago hours ago; every third one carries a listing
create or replace function pg_temp.healthy(n int default 6, h_ago numeric default 1) returns void language sql as $$
  insert into public.canonical_zip_registry select (10000 + g)::text from generate_series(1, n) g;
  insert into public.zip_dc_listing (zip, listings, member_count, checked_at)
  select (10000 + g)::text,
         case when g % 3 = 0 then '[{"source_key":"dc:x"}]'::jsonb else '[]'::jsonb end,
         case when g % 3 = 0 then 1 else 0 end,
         now() - make_interval(secs => h_ago * 3600)
    from generate_series(1, n) g;
$$;
create or replace function pg_temp.row() returns public.pipeline_health_check language plpgsql as $f$
declare r public.pipeline_health_check;
begin
  drop table if exists pg_temp._eval;
  perform * from public.pipeline_health_tick();
  select * into r from public.pipeline_health_check where check_name = 'zip_dc_listings';
  return r;
end $f$;

do $$
declare r public.pipeline_health_check;
begin
  -- 1 every ZIP checked an hour ago
  perform pg_temp.reset(); perform pg_temp.healthy();
  r := pg_temp.row();
  perform pg_temp.expect('S1 all ZIPs current: ok and alertable', r.ok and r.alertable, r.detail);
  perform pg_temp.expect('S1 the detail counts ZIPs and listings',
    r.detail like '6 ZIPs checked, oldest check 1.0 h ago; 2 ZIPs carry data-center listings', r.detail);

  -- 2 5.9 hours is inside the limit (a slow cycle is not an incident)
  perform pg_temp.reset(); perform pg_temp.healthy(6, 5.9);
  r := pg_temp.row();
  perform pg_temp.expect('S2 oldest check 5.9 h: ok', r.ok, r.detail);

  -- 3 the job stopped: every row 7 hours old
  perform pg_temp.reset(); perform pg_temp.healthy(6, 7);
  r := pg_temp.row();
  perform pg_temp.expect('S3 every row 7 h old: FAILS and alertable', not r.ok and r.alertable, r.detail);
  perform pg_temp.expect('S3 the detail counts 6 stale and names the job',
    r.detail like '%6 last checked over 6 h ago%' and r.detail like '%zip-dc-listing%', r.detail);

  -- 4 one ZIP stuck while the rest move (a stale row is named)
  perform pg_temp.reset(); perform pg_temp.healthy();
  update public.zip_dc_listing set checked_at = now() - interval '8 hours' where zip = '10004';
  r := pg_temp.row();
  perform pg_temp.expect('S4 one stale ZIP: FAILS', not r.ok, r.detail);
  perform pg_temp.expect('S4 the detail names it', r.detail like '%1 last checked over 6 h ago%e.g. 10004%', r.detail);

  -- 5 a read error (the refresh keeps the old row and records why)
  perform pg_temp.reset(); perform pg_temp.healthy();
  update public.zip_dc_listing set last_error = 'reader failed' where zip = '10002';
  r := pg_temp.row();
  perform pg_temp.expect('S5 a read error: FAILS', not r.ok, r.detail);
  perform pg_temp.expect('S5 the detail names the ZIP and the error',
    r.detail like '%1 with a read error%10002 (reader failed)%', r.detail);

  -- 6 a truncated ZIP (the build prints nothing there)
  perform pg_temp.reset(); perform pg_temp.healthy();
  update public.zip_dc_listing set truncated = true where zip = '10003';
  r := pg_temp.row();
  perform pg_temp.expect('S6 a truncated ZIP: FAILS', not r.ok and r.detail like '%1 truncated%', r.detail);

  -- 7 a registry ZIP with no row (a new ZIP, or rows deleted)
  perform pg_temp.reset(); perform pg_temp.healthy();
  insert into public.canonical_zip_registry values ('20001');
  r := pg_temp.row();
  perform pg_temp.expect('S7 a registry ZIP with no row: FAILS',
    not r.ok and r.detail like '%1 registry ZIP(s) with no row%', r.detail);

  -- 8 the table is empty
  perform pg_temp.reset(); perform pg_temp.healthy();
  truncate public.zip_dc_listing;
  r := pg_temp.row();
  perform pg_temp.expect('S8 no rows at all: FAILS',
    not r.ok and r.detail like '%6 registry ZIP(s) with no row%oldest check never%', r.detail);

  -- 9 an empty registry is not a pass
  perform pg_temp.reset();
  r := pg_temp.row();
  perform pg_temp.expect('S9 empty registry: FAILS', not r.ok and r.detail like 'canonical_zip_registry is empty%', r.detail);

  -- 10 the table is gone: the check's own failure row, and the monitor still runs
  perform pg_temp.reset(); perform pg_temp.healthy();
  alter table public.zip_dc_listing rename to zip_dc_listing_away;
  r := pg_temp.row();
  alter table public.zip_dc_listing_away rename to zip_dc_listing;
  perform pg_temp.expect('S10 missing table: a FAILING alertable row',
    not r.ok and r.alertable and r.detail like 'the zip_dc_listings check could not run:%', r.detail);
  perform pg_temp.expect('S10 the other checks still ran',
    exists (select 1 from public.pipeline_health_check where check_name = 'stand_in'), 'stand_in row missing');

  -- 11 rows for ZIPs no longer in the registry are not "missing" and do not fail it
  perform pg_temp.reset(); perform pg_temp.healthy();
  insert into public.zip_dc_listing (zip, checked_at) values ('99999', now());
  r := pg_temp.row();
  perform pg_temp.expect('S11 an extra fresh row: ok', r.ok, r.detail);
end $$;
