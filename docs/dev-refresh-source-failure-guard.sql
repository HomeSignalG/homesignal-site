-- ============================================================================
-- PER-SOURCE FETCH-FAILURE GUARD  —  applied 2026-08-03
-- migration: dev_refresh_per_source_failure_guard
-- ============================================================================
--
-- THE DEFECT
-- ----------
-- dev_refresh_collect()'s transient-safe guard tested the AGGREGATE `development`
-- count, so a per-SOURCE collapse hid behind a DIFFERENT source's contribution.
--
-- Measured live 2026-08-03, ZIP 97215 (Portland OR):
--   * the layer holds 414 rows in the connector's own scope — verified with the exact
--     connector WHERE + envelope: {"count":414}, statuses Under Inspection 289 /
--     Issued 122 / Final 2 / Fees Due 1, all four mapped;
--   * portlandmaps.com reset the connection under the tick's parallel fan-out, so the
--     connector reported  "fetch failed: ... Connection reset by peer (os error 104)";
--   * the engine still emitted development=15 from the COUNTY's area planning notices;
--   * 15 > 0, so the guard did not fire, and 414 real permits were overwritten by silence.
--
-- Reproduced deterministically — concurrency is the variable:
--   10 ZIPs fired in parallel  -> 7 return fetched 0
--   the same ZIPs 2 at a time  -> 414 / 407 / 136 / 116
--
-- The engine was never wrong. It diagnoses the failure precisely, per source, in
-- *_reports[].quarantined[].reason. collect() simply threw the diagnosis away.
--
-- A FAILED FETCH AND AN HONEST ZERO MUST BE DISTINGUISHABLE. `fetched: 0` alone means
-- both, which is why a fetch failure could darken a page with nothing to show for it.
--
-- ⚠️ COUPLING: the reason PREFIXES below are a contract with the five connectors in
-- supabase/functions/get-address-report/sources/. Reword one and this guard silently
-- stops guarding. Pinned by test/fetch-failure-reason-contract.test.mjs.
-- ============================================================================

-- ── 1. the discriminator ─────────────────────────────────────────────────────
-- One row per source whose FETCH failed. A source that merely found nothing
-- (fetched 0, quarantined []) is deliberately NOT returned — otherwise the guard would
-- freeze honestly-emptied pages forever, the same shape as the 7-day transient guard
-- blocking an intentional reduction. Config errors and per-record quarantines are also
-- excluded: they are deterministic, so blocking on them would never clear.
create or replace function public.dev_failed_sources(j jsonb)
returns table(registry_id text, reason text)
language sql
immutable
set search_path to 'public'
as $$
  select r->>'registry_id', q->>'reason'
  from jsonb_array_elements(
         coalesce(j->'arcgis_reports',  '[]'::jsonb)
      || coalesce(j->'socrata_reports', '[]'::jsonb)
      || coalesce(j->'carto_reports',   '[]'::jsonb)
      || coalesce(j->'ckan_reports',    '[]'::jsonb)
      || coalesce(j->'csv_reports',     '[]'::jsonb)
       ) r,
       lateral jsonb_array_elements(coalesce(r->'quarantined', '[]'::jsonb)) q
  where q->>'reason' like 'fetch failed:%'         -- arcgis / socrata / carto / ckan
     or q->>'reason' like 'fetch/parse failed:%'   -- csv
$$;

-- ── 2. visibility ────────────────────────────────────────────────────────────
-- A silently-refused update trades one invisible failure for another: the page freezes
-- with no signal. Every failure is recorded whether or not it blocked, so a host going
-- bad is visible BEFORE it costs a page. (It worked immediately: the first collect after
-- this shipped surfaced minneapolis-ccs-permits returning "Unable to perform query. Too
-- many requests." on 55413/55422 — a second source that had been darkening silently.)
create table if not exists public.dev_refresh_source_failures (
  id             bigint generated always as identity primary key,
  zip            text        not null,
  registry_id    text        not null,
  reason         text        not null,
  cached_records integer     not null,   -- what this source currently contributes to the row
  blocked_update boolean     not null,   -- true ⇒ it previously contributed, so the write was refused
  seen_at        timestamptz not null default now()
);
create index if not exists dev_refresh_source_failures_seen_idx
  on public.dev_refresh_source_failures (seen_at desc);
create index if not exists dev_refresh_source_failures_zip_idx
  on public.dev_refresh_source_failures (zip, registry_id);
-- Diagnostics, never resident-facing: RLS ON with NO policy ⇒ anon/authenticated read
-- nothing, while the SECURITY DEFINER writer (table owner) and service role are unaffected.
-- This is the deliberate posture, NOT the page_cache mistake (RLS disabled).
alter table public.dev_refresh_source_failures enable row level security;

create or replace view public.v_dev_refresh_source_health as
  select registry_id,
         count(*)                               as failures_24h,
         count(*) filter (where blocked_update)  as blocked_24h,
         count(distinct zip)                     as zips_24h,
         max(seen_at)                            as last_seen,
         min(reason)                             as sample_reason
  from public.dev_refresh_source_failures
  where seen_at > now() - interval '24 hours'
  group by registry_id
  order by blocked_24h desc, failures_24h desc;

-- ── 3. collect, with the per-source refusal ──────────────────────────────────
create or replace function public.dev_refresh_collect()
returns integer
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare n integer;
begin
  -- 3a. record every per-source fetch failure in this batch, and whether it blocks.
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ),
  fails as (
    select (r.j->>'zip') as zip, f.registry_id, min(f.reason) as reason
    from resp r, lateral public.dev_failed_sources(r.j) f
    group by 1, 2
  ),
  scored as (
    select fl.zip, fl.registry_id, fl.reason,
           (select count(*)
              from public.development_reports d,
                   lateral jsonb_array_elements(d.sites) e
             where d.zip = fl.zip
               and e->>'source_registry_id' = fl.registry_id)::int as cached_records
    from fails fl
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update)
  select zip, registry_id, reason, cached_records, cached_records > 0 from scored;

  -- 3b. write, refusing ONLY rows where a source that ALREADY CONTRIBUTES failed to fetch.
  --     PER-SOURCE, NOT PER-PAGE: a source that failed but contributes nothing here does
  --     not block — an entry newly wired, or out of coverage, must never freeze a page it
  --     has never touched. (Live proof at go-live: minneapolis-ccs-permits failed on three
  --     ZIPs in one batch; 55413/55422 blocked (2,015 and 719 cached records), 55119
  --     accepted (0 cached).)
  --     Blocked rows keep their old refreshed_at, and dev_refresh_fire_batch orders by
  --     `refreshed_at asc nulls first`, so a blocked ZIP becomes the OLDEST and is re-picked
  --     on the next tick past the cooldown. Automatic retry, no new scheduled job.
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ),
  blocked as (
    select distinct (r.j->>'zip') as zip
    from resp r, lateral public.dev_failed_sources(r.j) f
    where exists (
      select 1 from public.development_reports d,
                    lateral jsonb_array_elements(d.sites) e
       where d.zip = (r.j->>'zip')
         and e->>'source_registry_id' = f.registry_id)
  )
  update public.development_reports d set
    counts         = j->'counts',
    sites          = j->'sites',
    paywall        = coalesce((j->>'paywall')::boolean, false),
    source_vintage = 'get-address-report ZIP mode; pg_cron daily auto-refresh',
    refreshed_at   = now()
  from resp
  where d.zip = (j->>'zip')
    -- NEW 2026-08-03: per-source fetch-failure refusal (see header).
    and not exists (select 1 from blocked b where b.zip = d.zip)
    -- TRANSIENT-SAFE, per-dimension — but only while the row is FRESH (<7 days).
    -- Beyond that the "flake" theory is exhausted (7+ consecutive holds) and the
    -- clean 200 response is the truth (chronic escape, 2026-07-25 — ZIP 84089).
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'facilities')::int, 0) + coalesce((d.counts->>'development')::int, 0) > 0
    )
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'development')::int, 0) > 0
    );
  get diagnostics n = row_count;
  return n;
end $function$;

-- ============================================================================
-- BIDIRECTIONAL PROOF — run after applying. Both directions matter: a guard that
-- only ever blocks would freeze every honestly-emptied page forever.
-- ============================================================================
-- with cases(name, j) as (values
--  ('A honest zero (fetched 0, quarantined [])',
--   '{"arcgis_reports":[{"registry_id":"x","fetched":0,"quarantined":[]}]}'::jsonb),
--  ('B arcgis fetch failed',
--   '{"arcgis_reports":[{"registry_id":"p","fetched":0,"quarantined":[{"reason":"fetch failed: Connection reset by peer (os error 104)","sample":"u"}]}]}'::jsonb),
--  ('C csv fetch/parse failed',
--   '{"csv_reports":[{"registry_id":"sd","fetched":0,"quarantined":[{"reason":"fetch/parse failed: boom","sample":"u"}]}]}'::jsonb),
--  ('D truncation quarantine must NOT block',
--   '{"arcgis_reports":[{"registry_id":"y","fetched":20000,"quarantined":[{"reason":"max_rows cap of 20000 bound the fetch","sample":"y"}]}]}'::jsonb),
--  ('E config-error quarantine must NOT block (deterministic — would freeze forever)',
--   '{"arcgis_reports":[{"registry_id":"z","fetched":0,"quarantined":[{"reason":"config error: include_types set but ...","sample":"z"}]}]}'::jsonb),
--  ('F per-record quarantines must NOT block',
--   '{"socrata_reports":[{"registry_id":"w","fetched":50,"quarantined":[{"reason":"no record_url derivable","sample":"t"},{"reason":"geocode failed","sample":"a"}]}]}'::jsonb),
--  ('G two connectors, one failing',
--   '{"arcgis_reports":[{"registry_id":"ok1","fetched":9,"quarantined":[]}],"ckan_reports":[{"registry_id":"bad1","fetched":0,"quarantined":[{"reason":"fetch failed: HTTP 503","sample":"r"}]}]}'::jsonb),
--  ('H no reports at all', '{"counts":{"development":0}}'::jsonb))
-- select c.name,
--        coalesce((select string_agg(f.registry_id, ',') from public.dev_failed_sources(c.j) f), '(none)') as flagged
-- from cases c order by c.name;
--
-- Result 2026-08-03 — A (none) · B p · C sd · D (none) · E (none) · F (none) · G bad1 · H (none)
--
-- LIVE end-to-end proof, same run: 7 Portland ZIPs fired in parallel; 97213's fetch was
-- reset while five siblings succeeded.
--   BEFORE  97213 = 323 portland records, refreshed_at 17:34:00
--   payload 97213 = 0 portland records, dev_failed_sources -> portland-building-permits
--   AFTER   97213 = 323 records HELD, refreshed_at STILL 17:34:00   (refused)
--           97214/97215/97218/97219/97239 updated at 17:45:37, 407/414/196/116/178 intact
--           188 other rows updated in the same call                (not a blanket refusal)
-- Under the old collect 97213 would have been zeroed, exactly as 97215 was at 16:30.


-- ============================================================================
-- PART 2 (2026-08-03) — BOUNDED-FETCH VISIBILITY
-- migration: dev_refresh_truncation_visibility
-- ============================================================================
--
-- "A bound that silently truncates reintroduces the defect you just fixed."  A capped fetch
-- and a complete one differ only by a count, so a page built from 20,000 of N records reads
-- as "we have everything" — the same success-shaped silence.
--
-- Keyed on the `truncated_at_max_rows` FIELD, not on the quarantine prose: csv words its note
-- "bound the emit" while the other four connectors say "bound the fetch", so a prose match
-- would have silently missed one connector in five. (Verified: the field is present in all
-- five run reports, and all five accept `max_rows`.)
--
-- TRUNCATION NEVER BLOCKS THE WRITE. Unlike a fetch failure it is DETERMINISTIC — it recurs
-- on every refresh, so refusing the update would freeze the page permanently.
--
-- MEASURED, cache-wide 2026-08-03 (the sizing evidence, not a global constant):
--   * exactly THREE ZIPs sit at the 20,000 default and are therefore truncated —
--     80011 + 80012 (aurora-building-permits) and 55103 (saint-paul-approved-building-permits).
--     Nothing else in the cache reaches it. (An earlier read of "p95 = 20,000" was an artifact
--     of percentile_disc over 16 values, not "most ZIPs truncated" — corrected by counting.)
--   * row SIZE is the sharper cost: 55103 = 20 MB, 80011/80012/80013/80014 = 18 MB,
--     80010 = 17 MB — about 3x the 5.98 MB Cleveland "high-water mark" recorded in CLAUDE.md,
--     which measures here as 6,158 kB (44127) and is no longer the ceiling.
--   * size alone does NOT prevent a refresh: 80011/80013 at 17-18 MB collect normally.

alter table public.dev_refresh_source_failures
  add column if not exists kind text not null default 'fetch_failed',
  add column if not exists detail jsonb;

create or replace function public.dev_truncated_sources(j jsonb)
returns table(registry_id text, cap integer, fetched integer)
language sql
immutable
set search_path to 'public'
as $$
  select r->>'registry_id',
         (r->>'truncated_at_max_rows')::int,
         (r->>'fetched')::int
  from jsonb_array_elements(
         coalesce(j->'arcgis_reports',  '[]'::jsonb)
      || coalesce(j->'socrata_reports', '[]'::jsonb)
      || coalesce(j->'carto_reports',   '[]'::jsonb)
      || coalesce(j->'ckan_reports',    '[]'::jsonb)
      || coalesce(j->'csv_reports',     '[]'::jsonb)
       ) r
  where r->>'truncated_at_max_rows' is not null
$$;

-- v_dev_refresh_source_health gains a `kind` column (dropped + recreated — Postgres cannot
-- rename a view column in place). dev_refresh_collect() gains step (b), verbatim below; the
-- fetch-failure step (a) and the write step (c) are unchanged from Part 1.
--
--   -- (b) BOUNDED fetches — visible, never blocking (deterministic; a refusal would freeze).
--   with resp as ( ...the same distinct-on-zip response set as steps (a) and (c)... )
--   insert into public.dev_refresh_source_failures
--         (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
--   select (r.j->>'zip'), t.registry_id,
--          'max_rows bound the fetch at ' || t.cap || ' — this page is INCOMPLETE',
--          t.fetched, false, 'truncated',
--          jsonb_build_object('cap', t.cap, 'fetched', t.fetched)
--   from resp r, lateral public.dev_truncated_sources(r.j) t;
--
-- Note `false, 'truncated'` — blocked_update is ALWAYS false for this kind.

-- ---------------------------------------------------------------------------
-- PROOF — the two discriminators are orthogonal (run 2026-08-03):
--   T1 arcgis truncated                      -> truncated: aurora@20000   failed: (none)
--   T2 csv truncated ("bound the emit")      -> truncated: sd@9000        failed: (none)
--   T3 complete fetch                        -> truncated: (none)         failed: (none)
--   T4 fetch FAILURE is not a truncation     -> truncated: (none)         failed: p
-- ---------------------------------------------------------------------------

-- ============================================================================
-- OPEN, MEASURED, NOT YET FIXED — the fire-timeout class (found while sizing)
-- ============================================================================
-- A THIRD invisible failure sits one layer further out than either of the above, and neither
-- guard can see it: `net.http_post` is fired with a 90 s timeout, and a request that exceeds
-- it lands in net._http_response with **status_code NULL**, which dev_refresh_collect filters
-- out (`where status_code = 200`). The row is never updated and nothing records why.
--
-- Receipt (2026-08-03 18:00Z):
--   error_msg = 'Timeout of 90000 ms reached. Total time: 90000.951 ms
--                (DNS 44.817 ms, TCP/SSL 63.738 ms, HTTP Request/Response 89892.309 ms)'
--
-- Consequence, measured:
--   zip    refreshed_at (last SUCCESS)  last_refresh_attempt_at   stuck for
--   55103  2026-07-29 04:15Z            2026-08-03 17:45Z         133.5 h
--   55119  2026-07-29 20:00Z            2026-08-03 18:00Z         118.0 h
--   55109  2026-07-29 21:00Z            2026-08-03 17:45Z         116.7 h
-- They are re-fired every cooldown and have not collected once in five days.
--
-- Two things ride on that stall:
--   1. those pages carry 41,910 records from `saint-paul-approved-building-permits`, an entry
--      that NO LONGER EXISTS in jurisdiction-registry.json — its removal never reached the
--      pages, because the refresh that would have dropped the records cannot complete;
--   2. row COUNT is not the discriminator — 80011 (20,051 sites / 18 MB) collects fine while
--      55109 (10,995 / 11 MB) never does, so the binding constraint is upstream host SPEED,
--      not volume. A global max_rows would not have fixed either.


-- ============================================================================
-- PART 3 (2026-08-03) — FIRE-LEVEL FAILURE VISIBILITY  (the THIRD instance)
-- migration: dev_refresh_fire_failure_visibility
-- ============================================================================
--
-- `net.http_post` fires with a 90 s timeout. An overrun lands in net._http_response with
-- **status_code NULL and no content**, and dev_refresh_collect selects `where status_code = 200`
-- — so it is skipped in silence. NEITHER earlier guard can see it: both read the PAYLOAD, and a
-- timeout has no payload. Same class, third instance.
--
-- A timeout also carries no `zip`, so it cannot be attributed after the fact. Hence
-- `dev_refresh_inflight`: dev_refresh_fire_batch records request_id -> zip AT FIRE TIME, and
-- dev_refresh_log_fire_failures joins net._http_response back to it, logging every fired request
-- that did not return 200 as kind='fire_failed' (NULL status) or 'fire_http_error'. Rows are
-- cleared only once their response has LANDED, with a 6 h backstop for pg_net's own purges.
-- dev_refresh_tick now runs collect -> log_fire_failures -> fire.
--
-- PROOF (2026-08-03, forced): three ZIPs fired with an impossible 1 ms timeout, all landed
-- status_code NULL, all three attributed —
--   55103 fire_failed 'Timeout of 1 ms reached…' cached_records 20042 request_id 4586
--   55109 fire_failed 'Timeout of 1 ms reached…' cached_records 10995 request_id 4587
--   55119 fire_failed 'Timeout of 1 ms reached…' cached_records 10952 request_id 4588
-- dev_refresh_inflight cleared to 0. Before this, all three were invisible.

-- ============================================================================
-- ⚠️ DO NOT "FIX" THE STUCK PAGES WITH A max_rows CAP — VOLUME IS NOT THE CONSTRAINT
-- ============================================================================
-- Measured 2026-08-03, and recorded because a cap is the intuitive wrong answer:
--   * 80011 — 20,051 sites / 18 MB — collects fine on every tick.
--   * 55109 — 10,995 sites / 11 MB — has never collected in five days.
-- Half the volume, permanently stuck. **Host SPEED binds, not row count**, so no per-entry or
-- global max_rows would have fixed either page.
--
-- And the three stuck ZIPs are not too big to fetch at all. Fired ALONE, 55103 returns
-- **200 in seconds, 16 kB**, counts {facilities 40, development 0, civic 2} — the engine is
-- healthy and the retired entry is already gone from its output. The 90 s overruns are
-- CONCURRENCY QUEUING behind the tick's 250-way fan-out, the same trigger as the Portland
-- connection resets.

-- ============================================================================
-- THE ACTUAL BLOCKER ON THOSE THREE PAGES IS THE 7-DAY TRANSIENT GUARD — measured, not fixed
-- ============================================================================
-- With the timeout removed from the picture, the clean 200 above STILL does not land. Its
-- `development` is 0 (correctly — `saint-paul-approved-building-permits` was retired from
-- jurisdiction-registry.json), the cached value is 20,000, and the row is 5 days old, so:
--
--   and not ( d.refreshed_at >= now() - interval '7 days'
--         and coalesce((j->'counts'->>'development')::int,0) = 0
--         and coalesce((d.counts->>'development')::int,0) > 0 )
--
-- refuses it. Verified live: dev_refresh_collect() returned 220 rows updated and 55103 stayed at
-- 20,042 sites / refreshed_at 2026-07-29.
--
-- This is the guard doing exactly what it was written to do, on a case it cannot distinguish:
-- **a legitimate reduction and a transient collapse are identical by COUNT alone** — the same
-- shape as `fetched: 0` meaning both "found nothing" and "could not be reached".
--
-- It self-heals at 2026-08-05 04:15Z (refreshed_at + 7 days), by accident rather than design.
-- Until then those three pages render ~40,000 records from the retired entry:
--   zip    total sites   from the retired entry   with record_url   pinned
--   55103  20,042        20,000  (99.8%)          20,000            19,483
--   55109  10,995        10,968  (99.8%)          10,968            10,364
--   55119  10,952        10,942  (99.9%)          10,942            10,342
-- NOT contained to the materialized layer: homesignalmap.html:1055 reads
-- `development_reports` DIRECTLY (`/rest/v1/development_reports?zip=eq.…&select=…,sites,…`),
-- so residents see them. `app_projects` holding zero saint-paul rows only tells us the app
-- surface is clean.


-- ============================================================================
-- PART 4 (2026-08-03) — RETIRED-SOURCE DISCRIMINATOR
-- migration: dev_refresh_retired_source_discriminator
-- ============================================================================
--
-- THE PROBLEM. The 7-day transient guard refuses a write when `development` drops to 0 on a
-- fresh row. Right for a flake, WRONG for a deliberate reduction — and by COUNT ALONE the two
-- are identical, the same shape as `fetched: 0` meaning both "found nothing" and "could not be
-- reached".
--
-- Measured: `saint-paul-approved-building-permits` was retired from the registry, the engine
-- correctly stopped emitting it, and 55103's clean 200 carried `development: 0` against a cached
-- 20,000. The guard refused it for FIVE DAYS while the page served 20,000 records from a source
-- that no longer exists. Verified live: dev_refresh_collect() returned 220 rows updated and 55103
-- stayed at 20,042 sites / refreshed_at 2026-07-29. It would have self-healed at
-- refreshed_at + 7 days — by accident, not design.
--
-- THE DISCRIMINATOR. A drop is EXPLAINED when a source that currently contributes cached records
-- is ABSENT FROM THE PAYLOAD'S REPORTS ENTIRELY. The engine emits a run report for every entry
-- whose coverage gate matched, so absence means the entry no longer runs for this ZIP — retired,
-- or its coverage changed. Neither is a flake and neither resolves by waiting.
--
-- This STRENGTHENS the guard: an UNEXPLAINED collapse is still refused, and a source that IS
-- reported but failed to fetch is refused by Part 1 regardless of what this says.
--
-- Every registry_id the payload reported on — i.e. every entry whose coverage gate matched.
create or replace function public.dev_reported_sources(j jsonb)
returns table(registry_id text)
language sql
immutable
set search_path to 'public'
as $$
  select r->>'registry_id'
  from jsonb_array_elements(
         coalesce(j->'arcgis_reports',  '[]'::jsonb)
      || coalesce(j->'socrata_reports', '[]'::jsonb)
      || coalesce(j->'carto_reports',   '[]'::jsonb)
      || coalesce(j->'ckan_reports',    '[]'::jsonb)
      || coalesce(j->'csv_reports',     '[]'::jsonb)
       ) r
  where r->>'registry_id' is not null
$$;

-- Sources that CURRENTLY contribute cached records to this ZIP but are absent from the payload's
-- reports. A non-empty result EXPLAINS the reduction.
create or replace function public.dev_retired_sources(_zip text, j jsonb)
returns table(registry_id text, cached_records integer)
language sql
stable
set search_path to 'public'
as $$
  select e->>'source_registry_id', count(*)::int
  from public.development_reports d,
       lateral jsonb_array_elements(d.sites) e
  where d.zip = _zip
    and e->>'source_registry_id' is not null
    and (e->>'source_registry_id') not in (select registry_id from public.dev_reported_sources(j))
  group by 1
$$;

-- collect gains step (c), logging kind='retired' with blocked_update = false, and an `explained`
-- CTE ANDed into BOTH transient clauses:
--
--   explained as (
--     select distinct (r.j->>'zip') as zip from resp r
--     where exists (select 1 from public.dev_retired_sources(r.j->>'zip', r.j))
--   )
--   ...
--   and not ( d.refreshed_at >= now() - interval '7 days'
--         and coalesce((j->'counts'->>'development')::int,0) = 0
--         and coalesce((d.counts->>'development')::int,0) > 0
--         and not exists (select 1 from explained x where x.zip = d.zip) )
--
-- ---------------------------------------------------------------------------
-- PROOF — the discriminator itself (real cached ZIPs, synthetic payloads):
--   R1 source still reported            -> retired: (none)
--   R2 source ABSENT from reports       -> retired: portland-building-permits=414
--   R3 NO reports at all (coverage gone)-> retired: portland-building-permits=414
--   R4 ZIP with no sourced records      -> retired: (none)   [nothing to explain a drop with]
--
-- PROOF — the SHIPPED predicate, evaluated read-only against a real fresh row (97215):
--   P1 development 0, source STILL reported (UNEXPLAINED) -> would_write = FALSE   (guard intact)
--   P2 development 0, source ABSENT      (EXPLAINED)      -> would_write = TRUE    (defect fixed)
--   P3 development 0, source FETCH FAILED                 -> would_write = FALSE   (Part 1 wins)
--   P4 development unchanged and healthy                  -> would_write = TRUE
-- Both directions, and the two refusal paths are independent.
-- ---------------------------------------------------------------------------
