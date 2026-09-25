-- ============================================================================
-- dev_refresh_collect() EVALUATES EACH HTTP RESPONSE ONCE (2026-09-24)
--
-- SQL OF RECORD for public.dev_refresh_collect(), superseding the body parked in
-- docs/epa-decouple-phase1b-split-write.sql. That parked body was verified equal to
-- live before this change (comments stripped, whitespace collapsed, lower-cased:
-- normalized md5 0df2014d815e35cf881d75650916a1c1 on BOTH sides; pre-apply
-- pg_get_functiondef md5 6fe77ceeb720f3a99a3866734feafc73, 10,697 chars). The body
-- below was produced by SPLICING that parked body with asserted occurrence counts,
-- never by retyping it. Every guard, diagnostic and write expression is unchanged.
--
-- WHAT WAS WRONG
-- ----------------------------------------------------------------------------
-- All four steps re-derived their input from a ROLLING WINDOW of net._http_response:
--     status 200, created in the last 20 minutes, ZIP mode, JSON, newest per ZIP.
-- Nothing recorded that a response had already been evaluated. Job 14 runs
-- dev_refresh_tick(8, 20) every 2 minutes, so each response stayed eligible for
-- ~10 ticks and was re-evaluated, re-logged and (if accepted) re-WRITTEN each time.
-- Measured 2026-09-24 over the pg_net retention window (150 ticks, 0 failed):
--     1,401 responses, 1,401 ZIPs, 12,070 collector evaluations
--     avg 8.62 evaluations per response, median 10, max 10
--     dev_refresh_source_failures fetch_failed: 562 rows in 5h for 43 ZIPs — the
--     same failed payloads logged again on every tick
-- Each accepted re-write rewrote the whole `sites` array and re-fired the BEFORE
-- UPDATE OF sites trigger (dev_reports_enforce_dc_zip_membership). That is the
-- measured ~10.8 writes/fetch, and the temp-block and WAL volume behind it.
--
-- WHY A NEW COLUMN — existing state was checked first and cannot represent this
-- ----------------------------------------------------------------------------
-- * net._http_response is pg_net's table: no "handled" flag, purged on pg_net's own
--   TTL. Not ours to add columns to.
-- * public.dev_refresh_inflight maps request_id -> zip, but ONLY for the fire paths
--   that write it (dev_refresh_fire_batch, dev_refresh_fire_targets,
--   commercial_fire_batch). dev_refresh_fire, dev_backfill_fire, dev_gate_catchup,
--   epa_recovery_repair and epa_recovery_step2 also POST get-address-report and write
--   no inflight row, and this collector consumes their responses too. Inflight rows
--   are also DELETED by dev_refresh_log_fire_failures() as soon as a response lands,
--   in the same tick, so they cannot carry "evaluated" state across ticks.
-- * development_reports.last_refresh_attempt_at is FIRE/cooldown state per ZIP, not a
--   response identity. refreshed_at moves only on an ACCEPTED write, so a refused
--   response would still replay.
-- So: ONE nullable bigint on development_reports, last_collected_response_id — the id
-- of the newest response this collector has fully evaluated for that ZIP. It is
-- processing state only: no development data, no payload copy, and nothing reads it
-- but this function. NULL means "nothing evaluated yet", which is the SAFE state —
-- the next tick evaluates the ZIP's newest in-window response exactly as before. So
-- there is no backfill (backfilling to the newest id would SKIP a response that landed
-- after the last tick), and the old body running against the new column is harmless:
-- the Phase 1B column-then-writer hazard cannot occur. The column and the function
-- still ship in one transaction.
--
-- RESPONSE LIFECYCLE, AFTER
-- ----------------------------------------------------------------------------
-- (0)  eligible = the newest in-window ZIP-mode JSON 200 for a ZIP, AND id > cursor.
--      Computed ONCE into _ids; steps (a)-(e) all read exactly that set.
-- (a)-(c) diagnostics, unchanged — once per response now, not ~10 times.
-- (d)  ACCEPTED -> the resident write and cursor := id, in the SAME row version.
-- (e)  SOURCE-FAILURE BLOCKED / REDUCTION-GUARD REFUSED / SHAPE-WITHHELD -> cursor := id
--      only. No resident-facing column moves, so refreshed_at stays old and
--      dev_refresh_fire_batch (UNCHANGED) re-fires the ZIP oldest-first after the
--      cooldown. RETRY IS A FRESH REQUEST with a new, higher id — never a replay of
--      the payload that was refused.
-- non-200, non-JSON, non-ZIP-mode: never selected by the collector (unchanged).
--      Non-200 fires are still attributed by dev_refresh_log_fire_failures().
-- A ZIP-mode response for a ZIP with no development_reports row is no longer
--      evaluated: it could never be written and there is no row to carry its cursor.
--      Measured 0 such responses of 1,497 at the time of this change.
-- All of (0)-(e) is ONE transaction: a raise anywhere rolls back diagnostics, write
-- and cursor together, and the response is evaluated again on the next tick.
-- A transaction-scoped advisory lock stops two collectors evaluating the same
-- response, and step (d) re-checks the cursor, so a row is never written twice.
--
-- ONE BEHAVIOUR CHANGES, deliberately: a response used to be re-judged on later
-- ticks against a NEWER epa_ok, so facilities_unavailable could flip on a replay of
-- the same payload. It is now judged once, against the EPA health current when it was
-- evaluated. A later EPA recovery reaches the ZIP through its next fresh fetch.
--
-- ROLLBACK: re-apply the dev_refresh_collect() body parked in
-- docs/epa-decouple-phase1b-split-write.sql (it ignores the column). The column may
-- stay (NULL-safe) or be dropped afterwards.
-- ============================================================================

begin;

alter table public.development_reports
  add column if not exists last_collected_response_id bigint;

comment on column public.development_reports.last_collected_response_id is
  'Processing state ONLY: net._http_response.id of the newest get-address-report ZIP-mode response dev_refresh_collect() has fully evaluated for this ZIP (accepted or refused). Stops the same response being re-evaluated on later ticks. NULL = nothing evaluated yet. Not development data. See docs/dev-refresh-collect-once-per-response.sql.';

create or replace function public.dev_refresh_collect()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare n integer;
  epa_ok boolean;
  _ids bigint[];   -- the response set of THIS invocation; see step (0)
begin
  -- ONE COLLECTOR AT A TIME. pg_cron never overlaps job 14 with itself, but a manual call
  -- can, and two collectors would each log the same response's diagnostics. The lock is
  -- transaction-scoped, so it is released by the same COMMIT/ROLLBACK that decides
  -- everything below. A collector that finds it held returns 0: the holder is already
  -- evaluating the same responses. (Step (d) also re-checks the cursor, so even without
  -- the lock a row cannot be written twice for one response.)
  if not pg_try_advisory_xact_lock(hashtext('public.dev_refresh_collect')) then
    return 0;
  end if;

  -- EPA FRS health, read once per collect from the probe cron (job 16).
  -- EVERY target must be healthy, not whichever resolved last. epa_frs_probe_tick()
  -- fires two points on purpose because FRS fails density-dependently
  -- (sheridan-rural r=3, atlanta-dense r=1). A last-row read would flip epa_ok true
  -- the moment the rural point recovered, while dense pages were still failing.
  -- STALENESS BOUND: a signal older than 60 minutes is NOT evidence of health. Without
  -- it, epa_ok would hold whatever the probe last said indefinitely, so a stopped job 16
  -- would OPEN the guard instead of closing it.
  -- FAIL-CLOSED: no rows, any false, or a stale newest all resolve to false.
  select coalesce(
           (select count(*) > 0
                   and bool_and(t.ok)
                   and max(t.resolved_at) > now() - interval '60 minutes'
              from (select distinct on (target) target, ok, resolved_at
                      from public.epa_frs_probes
                     where resolved_at is not null
                     order by target, probed_at desc) t),
           false)
    into epa_ok;

  -- (0) THE RESPONSE SET — decided ONCE, by response IDENTITY, and consumed by every step.
  -- It used to be re-derived four times from a rolling window ("status 200 in the last 20
  -- minutes, newest per ZIP"). Under the */2 tick that window held each response for ~10
  -- ticks, so the SAME response was re-evaluated, re-logged and re-written ~10 times
  -- (measured 2026-09-24: 1,401 responses, 12,070 evaluations, avg 8.62, median 10).
  -- The window is kept only as a scan bound. What decides eligibility now is
  -- development_reports.last_collected_response_id: the id of the newest response this
  -- collector has already fully evaluated for that ZIP, whatever the outcome (accepted,
  -- source-failure blocked, reduction-guard refused, shape-withheld). A response is
  -- eligible only if it is the newest for its ZIP AND newer than that cursor.
  --   * pg_net response ids ARE request ids (one sequence), so "newer" means "fired later".
  --     An older response landing after a newer one was evaluated is skipped — the same
  --     answer "newest per ZIP" always gave.
  --   * RETRY IS A FRESH REQUEST, NEVER A REPLAY. A refused ZIP keeps its old refreshed_at,
  --     so dev_refresh_fire_batch (unchanged) re-fires it oldest-first after the cooldown;
  --     that new request gets a new, higher id and is evaluated on its own merits.
  --   * Fixing the id set up front also means diagnostics, the blocked set, the write and
  --     the cursor all see EXACTLY the same responses; before, each step re-read the window
  --     and a response landing mid-function could be seen by some steps and not others.
  select coalesce(array_agg(c.id order by c.id), '{}')
    into _ids
  from (
    select distinct on (content::jsonb->>'zip') id, content::jsonb->>'zip' as zip
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ) c
  join public.development_reports d on d.zip = c.zip
  where c.id > coalesce(d.last_collected_response_id, 0);

  if cardinality(_ids) = 0 then
    return 0;
  end if;

  -- (a) per-source FETCH FAILURES — refuse the write when the source already contributes.
  with resp as (
    select r.id as rid, r.content::jsonb as j
    from net._http_response r
    where r.id = any(_ids)
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
        (zip, registry_id, reason, cached_records, blocked_update, kind)
  select zip, registry_id, reason, cached_records, cached_records > 0, 'fetch_failed' from scored;

  -- (b) BOUNDED fetches — visible, never blocking (deterministic; a refusal would freeze).
  with resp as (
    select r.id as rid, r.content::jsonb as j
    from net._http_response r
    where r.id = any(_ids)
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
  select (r.j->>'zip'), t.registry_id,
         'max_rows bound the fetch at ' || t.cap || ' — this page is INCOMPLETE',
         t.fetched, false, 'truncated',
         jsonb_build_object('cap', t.cap, 'fetched', t.fetched)
  from resp r, lateral public.dev_truncated_sources(r.j) t;

  -- (c) RETIRED sources — record the explanation that lets step (d) accept a real reduction.
  with resp as (
    select r.id as rid, r.content::jsonb as j
    from net._http_response r
    where r.id = any(_ids)
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
  select (r.j->>'zip'), t.registry_id,
         'source no longer reported for this ZIP (retired from the registry, or coverage changed) — its '
           || t.cached_records || ' cached records are being dropped',
         t.cached_records, false, 'retired',
         jsonb_build_object('cached_records', t.cached_records)
  from resp r, lateral public.dev_retired_sources(r.j->>'zip', r.j) t;

  -- (d) write — TWO INDEPENDENT PLANES composed into one row.
  with resp as (
    select r.id as rid, r.content::jsonb as j
    from net._http_response r
    where r.id = any(_ids)
  ),
  blocked as (
    select distinct (r.j->>'zip') as zip
    from resp r, lateral public.dev_failed_sources(r.j) f
    where exists (
      select 1 from public.development_reports d,
                    lateral jsonb_array_elements(d.sites) e
       where d.zip = (r.j->>'zip')
         and e->>'source_registry_id' = f.registry_id)
  ),
  explained as (
    select distinct (r.j->>'zip') as zip
    from resp r
    where exists (select 1 from public.dev_retired_sources(r.j->>'zip', r.j))
  )
  update public.development_reports d set
    -- counts: core keys from the payload; facilities preserved when the EPA write is refused.
    counts = case
               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                 then (j->'counts') || jsonb_build_object(
                        'facilities', coalesce((d.counts->>'facilities')::int, 0))
               else j->'counts'
             end,
    -- sites: payload project records, then EITHER the payload facilities or the stored ones.
    sites = coalesce((select jsonb_agg(x order by o)
                        from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                       where not (x ? 'registry_id')), '[]'::jsonb)
            || case
                 when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                   then coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(d.sites) with ordinality t(x, o)
                                   where x ? 'registry_id'), '[]'::jsonb)
                 else coalesce((select jsonb_agg(x order by o)
                                  from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                                 where x ? 'registry_id'), '[]'::jsonb)
               end,
    paywall        = coalesce((j->>'paywall')::boolean, false),
    source_vintage = 'get-address-report ZIP mode; pg_cron daily auto-refresh',
    -- CORE freshness. Advances on every accepted core write, EPA up or down. This is the
    -- whole point of Phase 1B: an EPA outage must not make a ZIP look stale.
    refreshed_at   = now(),
    -- this response is now fully evaluated for this ZIP (accepted). Same row version as
    -- the write, so an accepted response costs exactly one row write.
    last_collected_response_id = resp.rid,
    -- REGULATORY freshness. Advances only when the facility layer actually took a write.
    facilities_refreshed_at = case
                                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
    -- ⚖️ REVIEW FIX 2 — THE FLAG FOLLOWS THE FACILITY PLANE, NOT THE EPA READ.
    -- The first Phase 1B build kept the pre-split expression, which had only ever run on
    -- rows where BOTH planes wrote. Under the split it also runs on REFUSED rows, and on
    -- the FRESHNESS limb (EPA healthy, legitimately returns 0, row < 7 days old, cached
    -- count > 0) it evaluated to FALSE while the stale cached count was preserved — so the
    -- page asserted a count EPA had just contradicted as confirmed fact. Pre-split the row
    -- was not written at all, so the flag kept its prior "unknown". Measured 0 rows in that
    -- state at review time, but reachable the moment EPA recovers for a recently-refreshed
    -- ZIP. The refusal branch now leads: if the facility plane did NOT take a trusted write,
    -- the stored result is not current and the count renders as UNKNOWN, never as fact.
    -- Reversion is still a side-effect of the repair: once a refresh actually stores a real
    -- facility count, refused is false, the first branch below fires, and the page stops
    -- saying "unavailable".
    facilities_unavailable = case
                               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at) then true
                               when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
                               when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true
                               else false
                             end
  from resp
  where d.zip = (j->>'zip')
    -- never apply a response at or behind the cursor (EvalPlanQual re-checks this against
    -- a row a concurrent collector just committed, so a response cannot be applied twice).
    and coalesce(d.last_collected_response_id, 0) < resp.rid
    -- ⚖️ REVIEW FIX 1 — PAYLOAD SHAPE GUARD, AT THE WRITE ELIGIBILITY BOUNDARY.
    -- The split iterates j->'sites'; jsonb_array_elements raises 22023 ("cannot extract
    -- elements from a scalar") on anything that is not an array, which aborts the WHOLE
    -- statement — every ZIP in the 20-minute window, re-failing every 2 minutes until the
    -- bad response ages out. The pre-split code assigned `sites = j->'sites'` without
    -- iterating, so this failure mode is one the split introduced. Withholding the row is
    -- the fail-closed answer: no core write, no facility write, no freshness advanced, no
    -- facility data zeroed, and every other row in the batch proceeds untouched.
    -- jsonb_typeof(NULL) is NULL and NULL = 'array' is NULL, so a missing `sites` key is
    -- withheld too. Deliberately NOT applied to d.sites: steps (a) and (c) above already
    -- iterate the stored array, so a malformed STORED value is a pre-existing condition
    -- this guard neither creates nor claims to fix.
    and jsonb_typeof(j->'sites') = 'array'
    -- CORE GUARD 1 — per-source fetch failure where that source already contributes.
    -- dev_failed_sources() reads the first-party connector reports only; EPA reports through
    -- j->'epa'->>'ok' and can never appear here.
    and not exists (select 1 from blocked b where b.zip = d.zip)
    -- CORE GUARD 2 — an unexplained development reduction while the row is FRESH (<7 days).
    -- "Explained" means some contributing source is no longer reported at all (retired entry
    -- or coverage change), which is structural and will not resolve by waiting.
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'development')::int, 0) > 0
      and not exists (select 1 from explained x where x.zip = d.zip)
    );
  get diagnostics n = row_count;

  -- (e) MARK THE REST HANDLED. Every response in the set that step (d) did NOT write —
  -- source-failure blocked, reduction-guard refused, shape-withheld — was nonetheless fully
  -- evaluated above, its diagnostics recorded in (a)-(c) in THIS transaction. Advancing the
  -- cursor here only records that; it touches no resident-facing column (not sites, counts,
  -- paywall, refreshed_at, the facility plane or last_refresh_attempt_at), so the refusal
  -- still leaves the ZIP stale and the fire side still retries it with a fresh request.
  -- Atomic with (a)-(d): if anything above raised, this never commits either, and the
  -- response is evaluated again on the next tick.
  update public.development_reports d
     set last_collected_response_id = r.id
    from net._http_response r
   where r.id = any(_ids)
     and d.zip = (r.content::jsonb->>'zip')
     and coalesce(d.last_collected_response_id, 0) < r.id;

  return n;
end $function$;

-- Fail closed: the body that committed must be the one parked here.
do $verify$
declare src text;
begin
  select prosrc into src from pg_proc where oid = 'public.dev_refresh_collect'::regproc;
  if position('last_collected_response_id' in src) = 0
     or position('pg_try_advisory_xact_lock' in src) = 0 then
    raise exception 'dev_refresh_collect body is not the once-per-response version';
  end if;
  if (select count(*) from regexp_matches(src, 'r\.id = any\(_ids\)', 'g')) <> 5 then
    raise exception 'expected 5 consumers of the single response set';
  end if;
end $verify$;

commit;
