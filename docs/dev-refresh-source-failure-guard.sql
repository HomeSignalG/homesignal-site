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
