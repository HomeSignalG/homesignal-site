-- map1_datacentre_freshness: when each data-centre source was last refreshed, and when we last tried.
--
-- Founder, 2026-11-12: "Show the data-centre layer's last successful refresh date and its age.
-- Clearly distinguish that from when our workflow last attempted a fetch. Do not imply that each
-- facility was individually verified on the refresh date."
--
-- WHY: Compute Atlas moved its bulk files behind a subscription on 2026-11-07. Every daily read
-- since then is FETCH_FAILED (HTTP 404). Map 1 keeps serving the newest complete read (release
-- 1.35.1, read 2026-11-06 09:45 UTC), which is correct, but nothing on the page said how old it was.
--
-- ONE RULE FOR "LAST SUCCESSFUL REFRESH": the same one dc_current_observation uses to choose the
-- records Map 1 shows (newest run per source AND distribution with completeness_state
-- SUCCESS_COMPLETE and advanced_observations). A source with several distributions is reported at
-- its weakest: the oldest of those reads, refreshed only when every distribution's newest attempt
-- is its successful read.
--
-- What this returns, per ACTIVE dc_source:
--   last_success_at        when the run that supplied the records on the map completed
--   last_success_release   the publisher's own release key for that read (e.g. 1.35.1); null
--                          when the distributions disagree
--   publisher_edition_at   the publisher's own as-of date for that edition, else the newest
--                          record date in it. Never ours.
--   last_attempt_at        when our newest read of this source started, whatever its outcome
--   last_attempt_refreshed true only when, for every distribution, the newest read is the
--                          successful one above
--   as_of                  the database clock, so the page computes ages from one clock
--   scheduled              false for the OpenStreetMap rows, which were loaded ONCE into
--                          national_dc_records (2026-09-15) and have no recurring read; their
--                          last_success_at is that load and last_attempt_at is null.
-- It returns no failure detail, URL, error text or artifact reference.
--
-- STATUS: NOT APPLIED. The page (homesignalmap.html) calls it and renders nothing when it is
-- absent, so either order is safe. Apply only with the founder's go.

create or replace function public.map1_datacentre_freshness()
returns table(source_key text, publisher text, dataset_name text, licence text,
              last_success_at timestamptz, last_success_release text,
              publisher_edition_at timestamptz, last_attempt_at timestamptz,
              last_attempt_refreshed boolean, scheduled boolean, as_of timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Per (source_key, distribution_key), exactly as dc_current_observation chooses Map 1's
  -- records. A source with several files (Epoch AI: data_centers + timelines) is then reported at
  -- its WEAKEST file, so one healthy file can never hide a stale one.
  with ok as (
    select distinct on (a.source_key, a.distribution_key) a.source_key, a.distribution_key, a.id,
           a.completed_at, a.source_release_key,
           coalesce(a.source_declared_freshness, a.observed_freshness) as edition
      from public.dc_acquisition_run a
     where a.completeness_state = 'SUCCESS_COMPLETE' and a.advanced_observations
     order by a.source_key, a.distribution_key, a.run_seq desc
  ), last as (
    select distinct on (a.source_key, a.distribution_key) a.source_key, a.distribution_key, a.id,
           a.started_at
      from public.dc_acquisition_run a
     order by a.source_key, a.distribution_key, a.run_seq desc
  ), per as (
    select last.source_key, last.started_at, ok.completed_at, ok.source_release_key, ok.edition,
           ok.id is not null and last.id = ok.id as refreshed
      from last left join ok on ok.source_key = last.source_key
                            and ok.distribution_key = last.distribution_key
  ), src as (
    select per.source_key,
           -- a file never read completely means the source has no complete read
           case when bool_or(per.completed_at is null) then null else min(per.completed_at) end as ok_at,
           case when count(distinct per.source_release_key) = 1 then min(per.source_release_key) end as release,
           min(per.edition) as edition,
           max(per.started_at) as attempt_at,
           bool_and(per.refreshed) as refreshed
      from per group by per.source_key
  ), rows as (
  select s.source_key, s.publisher, s.dataset_name, s.licence,
         src.ok_at, src.release, src.edition, src.attempt_at, src.refreshed, true, now()
    from public.dc_source s
    left join src on src.source_key = s.source_key
   where s.active_state = 'ACTIVE'
  union all
  -- The OpenStreetMap compatibility layer: a one-time load, named as such (source_name
  -- 'OpenStreetMap' on map1_dc_zip_members rows).
  select 'openstreetmap', 'OpenStreetMap', 'OpenStreetMap data centres (one-time load)',
         'ODbL', max(n.imported_at), null, null, null, null, false, now()
    from public.national_dc_records n
  having count(*) > 0
  )
  select * from rows order by source_key collate "C";
$function$;

comment on function public.map1_datacentre_freshness() is
  'Per active data-centre source: last successful refresh (the run whose records Map 1 shows), '
  'the publisher''s edition date, and our last attempt. docs/map1-datacentre-freshness.sql.';

revoke all on function public.map1_datacentre_freshness() from public;
grant execute on function public.map1_datacentre_freshness() to anon, authenticated, service_role;
