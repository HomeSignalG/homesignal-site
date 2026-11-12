-- DDL of record (site repo: the data-centre plane is owned here).
--
-- NOT APPLIED. Founder instruction 2026-11-12: prepare in a pull request only; no merge, no deploy.
--
-- DATA-CENTRE SOURCE FRESHNESS (2026-11-12). One public, read-only answer per ACTIVE data-centre
-- source, so Map 1 can say three DIFFERENT dates and never blur them:
--
--   publisher_edition_at   the edition date the PUBLISHER states for the newest read we completed
--                          (dc_acquisition_run.source_declared_freshness). NULL when the publisher
--                          states none. It is the publisher's date for the dataset as a whole, not a
--                          date on which any facility was checked.
--   last_success_at        when OUR newest complete read finished.
--   last_attempt_at/state  when OUR newest read attempt started, and how it ended
--                          (SUCCESS_COMPLETE, FETCH_FAILED, PARTIAL, ... or IN_FLIGHT while open).
--
-- WHY. From 2026-11-07 the Compute Atlas facilities file answered 404 and Map 1 kept drawing the
-- 2026-11-06 read with nothing on the page saying so. The hourly monitor (dc_acquisitions) pages the
-- operator; this is the resident-facing half.
--
-- A source with several distributions (Epoch AI: data_centers + timelines) is reported at its WEAKEST
-- distribution: the oldest of the newest complete reads, the oldest stated edition, and, when any
-- distribution's newest attempt did not succeed, that attempt. So one healthy file can never hide a
-- stale one.
--
-- It reads public.dc_source and public.dc_acquisition_run only, writes nothing, and exposes no
-- request URL, artifact reference, failure detail or record. Safe to apply twice.
-- ROLLBACK: drop function public.dc_source_freshness();

create or replace function public.dc_source_freshness()
returns table(source_key text, source_name text, publisher_edition_at timestamptz,
              last_success_at timestamptz, last_attempt_at timestamptz, last_attempt_state text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with d as (
    select s.source_key, s.publisher, unnest(s.distributions) as distribution_key
      from public.dc_source s
     where s.active_state = 'ACTIVE'
  ), x as (
    select d.source_key, d.publisher, d.distribution_key,
           ok.completed_at as ok_at, ok.source_declared_freshness as edition_at,
           nw.started_at as nw_at, coalesce(nw.completeness_state, 'IN_FLIGHT') as nw_state,
           (nw.started_at is not null and nw.completeness_state is distinct from 'SUCCESS_COMPLETE') as nw_bad
      from d
      left join lateral (select r.completed_at, r.source_declared_freshness
                           from public.dc_acquisition_run r
                          where r.source_key = d.source_key and r.distribution_key = d.distribution_key
                            and r.completeness_state = 'SUCCESS_COMPLETE'
                          order by r.completed_at desc limit 1) ok on true
      left join lateral (select r.started_at, r.completeness_state
                           from public.dc_acquisition_run r
                          where r.source_key = d.source_key and r.distribution_key = d.distribution_key
                          order by r.started_at desc limit 1) nw on true
  ), pick as (
    -- the attempt to report per source: a non-successful newest attempt first, then the newest
    select distinct on (x.source_key) x.source_key, x.nw_at, x.nw_state
      from x
     where x.nw_at is not null
     order by x.source_key, x.nw_bad desc, x.nw_at desc
  )
  select x.source_key, min(x.publisher),
         min(x.edition_at),
         -- NULL (never read completely) on ANY distribution means the source has no complete read
         case when bool_or(x.ok_at is null) then null else min(x.ok_at) end,
         (select p.nw_at from pick p where p.source_key = x.source_key),
         (select p.nw_state from pick p where p.source_key = x.source_key)
    from x
   group by x.source_key
   order by x.source_key collate "C";
$fn$;

revoke all on function public.dc_source_freshness() from public;
grant execute on function public.dc_source_freshness() to anon, authenticated, service_role;

comment on function public.dc_source_freshness() is
  'Map 1 data-centre freshness notice: per ACTIVE dc_source, the publisher''s stated edition date, our '
  'newest complete read and our newest attempt with its outcome. Dataset-level dates only; never a '
  'per-facility verification date. Read-only.';
