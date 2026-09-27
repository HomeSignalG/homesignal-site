-- ============================================================================
-- FACILITY CLOCK + DURABLE PER-ZIP EPA OUTCOME (2026-09-27)
--
-- SQL OF RECORD for public.dev_epa_write_refused() and public.dev_refresh_collect(),
-- superseding the collector body parked in docs/dev-refresh-collect-once-per-response.sql
-- (that file remains the rollback path AND the once-per-response pin). The collector
-- body below was produced by SPLICING that parked body with asserted occurrence counts,
-- never by retyping it. Every diagnostic, core guard, and write expression is unchanged
-- except the named additions:
--   (1) the 4th argument of every dev_epa_write_refused() call is now
--       d.facilities_refreshed_at (the REGULATORY clock), not d.refreshed_at (CORE);
--   (2) development_reports.epa_last_outcome is written on every evaluated response
--       (accepted in step (d), withheld/core-refused in step (e));
--   (3) a missing `epa.ok` key fail-closes to false (was true — LATENT case G). The
--       predicate in dev_epa_write_refused and the facilities_unavailable third branch
--       both use coalesce(..., false). A genuine zero must carry epa.ok=true.
--
-- WHAT WAS WRONG
-- ----------------------------------------------------------------------------
-- 1. STALE-FACILITY CLEARING DEFECT. dev_epa_write_refused() judged the 7-day freshness
--    limb by the CORE clock. Development refreshes on a ~53 h sweep, so that limb stayed
--    TRUE forever while core kept writing. A genuine EPA zero therefore could never
--    replace a cached nonzero count. Measured 2026-09-27 (read-only): healthy EPA +
--    genuine zero + cached 12 + core refreshed 1 h ago → refused; same case at 6.9 d →
--    refused; at 7.1 d → accepted. facilities_refreshed_at was never an input.
--    Live: 1,004 ZIPs had a fresh core, a facility layer older than 7 days and a
--    nonzero count; 418 were older than 30 days. Oldest: 97201, facility layer
--    2026-08-07, core 2026-09-26.
--
-- 2. PER-ZIP EPA OUTCOMES ARE NOT INSTRUMENTED. epa.ok, radius_used, reason, attempts,
--    raw_rows, kept and (now) pre_cap exist only in the pg_net response body.
--    net._http_response held 1,590 rows at 00:36Z on 2026-09-27 and 0 at 00:37Z.
--    They are not stored in development_reports, app_projects or any failure table.
--    Source-zero / partial-scope-zero / product-filtered-zero / national cap-hit rate
--    are therefore NOT INSTRUMENTED.
--
-- THE FIX
-- ----------------------------------------------------------------------------
-- The refusal PREDICATE is unchanged: untrusted EPA, OR a fresh facility layer, AND
-- incoming facilities = 0 AND cached facilities > 0. Only the clock that "fresh"
-- consults moves. A genuine EPA zero may now clear an old nonzero count once the
-- facility layer itself is older than 7 days, even while Development keeps refreshing.
--
-- epa_last_outcome is processing/observability state, like last_collected_response_id:
-- no development data, nothing resident-facing reads it, NULL = nothing recorded yet
-- (the safe state — no backfill). The column and the writer ship in one transaction.
--
-- ROLLBACK: re-apply the collector body parked in
-- docs/dev-refresh-collect-once-per-response.sql (it ignores the new column and
-- restores the core-clock argument). The column may stay (NULL-safe) or be dropped.
-- ============================================================================

begin;

alter table public.development_reports
  add column if not exists epa_last_outcome jsonb;

comment on column public.development_reports.epa_last_outcome is
  'Last evaluated per-ZIP EPA FRS outcome for this ZIP (ok, radius_used, raw_rows, pre_cap, kept, reason, attempts), plus collected_at / response_id / write_refused. Written by dev_refresh_collect() on every evaluated response, accepted or refused. Observability only — not a resident-facing fact. NULL = nothing recorded yet. See docs/dev-epa-facility-clock-and-outcome.sql.';

-- ONE definition of the stored outcome so steps (d) and (e) cannot drift.
create or replace function public.dev_epa_outcome_record(
  _epa jsonb,
  _response_id bigint,
  _write_refused boolean
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(_epa, '{}'::jsonb) || jsonb_build_object(
           'collected_at', now(),
           'response_id', _response_id,
           'write_refused', _write_refused
         );
$function$;

comment on function public.dev_epa_outcome_record(jsonb, bigint, boolean) is
  'Compose the durable per-ZIP EPA outcome from the report body plus collector metadata. '
  'The single writer used by both step (d) and step (e) of dev_refresh_collect().';

-- The refusal predicate is BYTE-IDENTICAL except the 4th parameter is now named for the
-- clock it must be given. Passing the core clock is the defect this file exists to end.
create or replace function public.dev_epa_write_refused(
  _epa_ok boolean,
  _j jsonb,
  _cached_counts jsonb,
  _cached_facilities_refreshed_at timestamptz
) returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select (
      (not (coalesce(_epa_ok, false) and coalesce((_j->'epa'->>'ok')::boolean, false))
       or _cached_facilities_refreshed_at >= now() - interval '7 days')
      and coalesce((_j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((_cached_counts->>'facilities')::int, 0) > 0
  );
$function$;

comment on function public.dev_epa_write_refused(boolean, jsonb, jsonb, timestamptz) is
  'True when the incoming EPA facility payload must NOT overwrite the stored one. The 4th '
  'argument is the FACILITY clock (development_reports.facilities_refreshed_at), never the '
  'core refreshed_at. A genuine EPA zero may replace a cached nonzero count only when the '
  'facility layer itself is older than 7 days. Missing epa.ok fail-closes to false.';

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
               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                 then (j->'counts') || jsonb_build_object(
                        'facilities', coalesce((d.counts->>'facilities')::int, 0))
               else j->'counts'
             end,
    -- sites: payload project records, then EITHER the payload facilities or the stored ones.
    sites = coalesce((select jsonb_agg(x order by o)
                        from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                       where not (x ? 'registry_id')), '[]'::jsonb)
            || case
                 when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
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
    -- PER-ZIP EPA OUTCOME. Written on every accepted core write, EPA up or down, refused
    -- or accepted. net._http_response is TEMPORARY (pg_net TTL; measured empty inside a
    -- minute). Without this column, ok / radius_used / raw_rows / pre_cap exist only in
    -- a body that is about to be deleted.
    epa_last_outcome = public.dev_epa_outcome_record(
                         j->'epa', resp.rid,
                         public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)),
    -- REGULATORY freshness. Advances only when the facility layer actually took a write.
    facilities_refreshed_at = case
                                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
    -- ⚖️ REVIEW FIX 2 — THE FLAG FOLLOWS THE FACILITY PLANE, NOT THE EPA READ.
    -- The first Phase 1B build kept the pre-split expression, which had only ever run on
    -- rows where BOTH planes wrote. Under the split it also runs on REFUSED rows, and on
    -- the FRESHNESS limb (EPA healthy, legitimately returns 0, facility layer < 7 days old, cached
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
                               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at) then true
                               when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
                               when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, false)) then true
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

  -- (e) MARK THE REST HANDLED, AND LET THE EPA PLANE MOVE WITHOUT CORE.
  -- Every response that step (d) did not write — source-failure blocked, reduction-guard
  -- refused, shape-withheld — was still fully evaluated. The cursor advances so it is not
  -- replayed. CORE columns (refreshed_at, development counts/sites, paywall) stay put, so
  -- the fire side still retries the ZIP.
  --
  -- REVERSE COUPLING (audit 2026-09-27): a core refusal used to freeze the facility layer
  -- too, while facilities_unavailable stayed false. 74 ZIPs held a nonzero count, a
  -- facility clock older than 14 days, and both clocks equal — old facility data presented
  -- as current. When the payload has an array of sites, the EPA plane writes here under
  -- the same write-guard as step (d). A shape-withheld row cannot iterate sites; it only
  -- flags a stale nonzero count as unavailable.
  update public.development_reports d
     set last_collected_response_id = r.id,
         epa_last_outcome = public.dev_epa_outcome_record(
                              r.content::jsonb->'epa', r.id,
                              public.dev_epa_write_refused(
                                epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)),
         sites = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(d.sites) with ordinality t(x, o)
                                   where not (x ? 'registry_id')), '[]'::jsonb)
                        || coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(r.content::jsonb->'sites') with ordinality t(x, o)
                                   where x ? 'registry_id'), '[]'::jsonb)
                   else d.sites
                 end,
         counts = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then coalesce(d.counts, '{}'::jsonb) || jsonb_build_object(
                          'facilities', coalesce((r.content::jsonb->'counts'->>'facilities')::int, 0))
                   else d.counts
                 end,
         facilities_refreshed_at = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then now()
                   else d.facilities_refreshed_at
                 end,
         facilities_unavailable = case
                   when jsonb_typeof(r.content::jsonb->'sites') is distinct from 'array' then
                     case when coalesce((d.counts->>'facilities')::int, 0) > 0
                           and (d.facilities_refreshed_at is null
                                or d.facilities_refreshed_at < now() - interval '7 days')
                          then true
                          else d.facilities_unavailable
                     end
                   when public.dev_epa_write_refused(
                          epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at) then true
                   when coalesce((r.content::jsonb->'counts'->>'facilities')::int, 0) > 0 then false
                   when not (epa_ok and coalesce((r.content::jsonb->'epa'->>'ok')::boolean, false)) then true
                   else false
                 end
    from net._http_response r
   where r.id = any(_ids)
     and d.zip = (r.content::jsonb->>'zip')
     and coalesce(d.last_collected_response_id, 0) < r.id;

  return n;
end $function$;

-- Fail closed: the body that committed must be the facility-clock / durable-outcome version.
do $verify$
declare src text;
begin
  select prosrc into src from pg_proc where oid = 'public.dev_refresh_collect'::regproc;
  if position('last_collected_response_id' in src) = 0
     or position('pg_try_advisory_xact_lock' in src) = 0
     or position('epa_last_outcome' in src) = 0
     or position('dev_epa_outcome_record' in src) = 0 then
    raise exception 'dev_refresh_collect body is not the facility-clock / durable-outcome version';
  end if;
  if (select count(*) from regexp_matches(src, 'r\.id = any\(_ids\)', 'g')) <> 5 then
    raise exception 'expected 5 consumers of the single response set';
  end if;
  if position('dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)' in src) > 0 then
    raise exception 'collector still passes the CORE clock to the EPA write-guard';
  end if;
  if (select count(*) from regexp_matches(src, 'd\.facilities_refreshed_at\)', 'g')) < 4 then
    raise exception 'expected the facility clock as the write-guard argument';
  end if;
  if to_regclass('public.development_reports') is null
     or not exists (
          select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'development_reports'
             and column_name = 'epa_last_outcome') then
    raise exception 'epa_last_outcome column missing';
  end if;
end $verify$;

commit;
