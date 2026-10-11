-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER — COVERAGE-RECOVERY PROTECTION   (PR B; SQL OF RECORD, NOT APPLIED)   rule_version 4
--
-- THE PROBLEM
--   When the ZIP-mode scope is widened to the polygon (docs/zip-scope-members.sql, sources/scope-members.ts) a ZIP
--   suddenly SEES records that were always there. The ledger cannot tell "HomeSignal started looking here" from "the
--   publisher published something", so the first ordinary run writes `first_detected`, `material = true`, and every
--   reader of public.dev_change_event_reportable (the report, Follow, property watches, buyer alerts) says a new
--   development appeared. A baseline run would suppress it but also hides a genuine filing that arrives in the same
--   window, and it needs a human per ZIP. Neither is acceptable at 12,722.
--
-- WHAT THIS DOES (one rule, evaluated by the ledger's ONE writer, in the transaction that creates the identity)   rule_version 4
--   "HomeSignal began looking here" and "the publisher published something" are different facts. The first produces a one-time
--   BASELINE; once a source has a VERIFIED, CONTINUOUS baseline in a ZIP, a record that is new after it is ordinary news again.
--   (rule_version 2 treated every stamped first sighting as recovery forever: a permanent blind spot. rule_version 3 proved a
--   source was monitored by the presence of a stamped record and by the absence of a failure log: an empty expanded read could not
--   establish a baseline, and "no failure row" was read as success. rule_version 4 replaces both with a positive receipt.)
--   1. EVIDENCE = THE SOURCE COMPLETION RECEIPT (docs/dev-source-receipt.sql, from the connectors' scope_receipt). For each ZIP x
--      source it states the scope that RAN (expanded | fallback | legacy | failed), the scope VERSION (rule + envelope + radius) and
--      whether the read COMPLETED (no truncation, no failed or unresolved membership test, no overflow). It is linked to the cache
--      generation by its tick_at = development_reports.refreshed_at. A stamped record is never needed as proof; completeness is never
--      inferred from the absence of a failure.
--   2. READINESS (public.dev_change_scope_ready, one row per ZIP x source, bound to a scope version). A complete EXPANDED receipt
--      baselines the pair at that version — even when the ring is EMPTY. It is CONTINUOUS only while every receipt since the
--      baseline's verified generation is also a complete expanded read at the same version; any other receipt (incomplete, fallback,
--      legacy, failed), a missing receipt, a 'lost' response, a changed scope version or a suspended row breaks it.
--   3. CLASSIFICATION of a NEW comparable stamped identity, per ZIP x source, NO DATE EVER DECIDES:
--        complete expanded read, continuous baseline ..... ordinary first_detected: material, reportable (a GENUINE ARRIVAL)
--        complete expanded read, no continuous baseline ... coverage_recovered: non-material, is_baseline, audited (the BASELINE,
--                                                            or the RE-BASELINE after a break: records new across a coverage gap
--                                                            cannot be told from backfill, so they are not claimed as news)
--        incomplete / fallback / failed / no receipt ...... HELD: not observed at all this time; a later complete read classifies it
--      An UNSTAMPED record (legacy scope) is untouched: byte for byte the old behaviour.
--   4. SUSPENSION, per source. A synchronised observation that finds a source's receipt is not a complete expanded read (or has no
--      receipt while its ZIP has others) suspends THAT source's baseline (lapsed_at) and nothing else: source A's health never
--      keeps source B ready. A suspended source is listed in public.dev_change_scope_health, explicitly, until a complete expanded
--      read re-baselines it. A persistently incomplete source stays HELD and listed; it is never presented as verified.
--   5. SYNCHRONISATION (fail closed). The stamps live in the cache and the identities in app_projects; they describe the same
--      records only when app_projects was materialised from the CURRENT cache generation. One SQL statement (one snapshot):
--      public.dev_change_recovery_probe(zip, keys, scan) reads the cache clock, every development row's generation (equality, never
--      >= / max), the key binding, the stamps, the receipts and the readiness rows together. If not synchronised the observation
--      returns {status:'deferred'} and writes NOTHING; dev_change_tick does not advance the ZIP's cursor. With nothing new to
--      classify an unsynchronised ZIP is observed normally and readiness upkeep waits. The probe runs only when there is a new
--      comparable identity, a standing baseline, or a non-legacy receipt for the current generation; before any widening, never.
--   6. THE READER RULE moves with the decision owner: public.dev_change_event_reportable additionally excludes events with
--      is_baseline = true. Today that excludes NOTHING (measured 2026-10-11: 0 of 50,183 ordinary-run events are is_baseline).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It never baselines by hand and never names a ZIP or a source. Every ZIP and source follows the same rule.
--   * It never equates "new to HomeSignal" with "newly filed by the government". Silence at a baseline is the absence of a claim.
--   * It never deletes or rewrites an event, and never touches an identity the ledger already knows.
--   * It does not change first-detection for an UNSTAMPED record, whatever its age.
--
-- RESIDUAL RISKS (stated; see docs/zip-scope-recovery-review-2026-10-11.md)
--   * Records that arrive across a coverage gap (a break in complete expanded reads) are baselined silently, not announced.
--   * Receipts are kept 7 days: a baseline whose verified generation has been pruned cannot prove continuity and is re-baselined.
--   * A response whose receipt is never recorded (lost / refused) leaves that generation without evidence: new stamped records are HELD.
--   * Until the receipt PR is deployed and its collect job scheduled there are NO receipts: every stamped record is held (fail closed).
--
-- HOW IT IS APPLIED: by splicing the LIVE bodies (pg_get_functiondef) at apply time — never a retyped copy (CLAUDE.md
-- ingest rule 7). It refuses unless the live bodies fingerprint to the ones this was written against, proves each splice
-- by excising the inserted text and recovering the original md5, and is idempotent. ROLLBACK is at the foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ----------------------------------------------------------------------------
do $pre$
declare
  _o text; _t text; _v text;
  _o_done boolean; _t_done boolean;
begin
  if to_regprocedure('public.dev_change_observe_zip(text, uuid)') is null
     or to_regprocedure('public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)') is null
     or to_regclass('public.dev_change_event_reportable') is null
     or to_regprocedure('public.dev_sites_deduped(text)') is null
     or to_regprocedure('public.app_source_key(jsonb)') is null
     or to_regclass('public.dev_refresh_source_receipt') is null or to_regclass('public.dev_source_receipt_current') is null then
    raise exception 'dev_change_recovery: the ledger, its tick, the reportable view, dev_sites_deduped, app_source_key or the source completion receipt (docs/dev-source-receipt.sql) is missing';
  end if;
  if to_regprocedure('pg_input_is_valid(text, text)') is null then
    raise exception 'dev_change_recovery: pg_input_is_valid (PostgreSQL 16+) is required to read generation stamps without raising';
  end if;
  select prosrc into _o from pg_proc where oid = 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  select prosrc into _t from pg_proc where oid = 'public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)'::regprocedure;
  _o_done := position('-- dev_change_recovery:' in _o) > 0;
  _t_done := position('-- dev_change_recovery:' in _t) > 0;
  if _o_done <> _t_done then
    raise exception 'dev_change_recovery: half-applied (observe_zip spliced=%, tick spliced=%) — refusing', _o_done, _t_done;
  end if;
  if not _o_done and md5(_o) <> '042ce94641c713c6c0b6e7d18c4addb6' then
    raise exception 'dev_change_recovery: live dev_change_observe_zip is % — written against 042ce946…; re-review before applying', md5(_o);
  end if;
  if not _t_done and md5(_t) <> '59ce03a97d78ca872735d613d286c991' then
    raise exception 'dev_change_recovery: live dev_change_tick is % — written against 59ce03a9…; re-review before applying', md5(_t);
  end if;
  _v := pg_get_viewdef('public.dev_change_event_reportable'::regclass);
  if position('is_baseline' in substring(_v from position('WHERE' in _v))) = 0 and md5(_v) <> '46e9ec8b1c28601f52bc87010bedaf89' then
    raise exception 'dev_change_recovery: live dev_change_event_reportable is not the definition this was written against';
  end if;
end $pre$;

-- ---- 1. THE AUDIT TABLE ---------------------------------------------------------------------------------------------
-- One row per coverage-recovered identity. The date fields are DESCRIPTIVE: they say what the publisher stated and never
-- decided anything. cache_refreshed_at names the cache generation the classification was synchronised with.
create table if not exists public.dev_change_recovery (
  identity_key         text primary key references public.dev_change_project (identity_key),
  zip                  text not null,
  run_id               uuid not null references public.dev_change_run (id),
  outcome              text not null check (outcome = 'coverage_recovered'),
  publisher_event_date date,
  date_kind            text,
  date_state           text not null check (date_state in ('dated', 'undated', 'future')),
  observed_at          timestamptz not null,
  cache_refreshed_at   timestamptz,
  rule_version         smallint not null,
  classified_at        timestamptz not null default now()
);
alter table public.dev_change_recovery enable row level security;
revoke all on public.dev_change_recovery from public, anon, authenticated, service_role;
grant select, insert on public.dev_change_recovery to service_role;

-- READINESS: the minimal durable evidence that a source's expanded coverage in a ZIP has a verified baseline. State, not
-- history (history is dev_change_recovery, the ledger and the receipts): one row per ZIP x source, updated in place by the one
-- writer. It is bound to the SCOPE VERSION the baseline was taken under; a different version is a different baseline.
create table if not exists public.dev_change_scope_ready (
  zip                  text not null,
  registry_id          text not null,
  scope_version        text not null,
  established_cache_at timestamptz not null,   -- the generation whose complete expanded receipt baselined the pair
  established_run_id   uuid references public.dev_change_run (id),
  verified_cache_at    timestamptz not null,   -- the newest generation with a complete expanded receipt at this version
  lapsed_at            timestamptz,            -- set when an observation saw the pair NOT complete+expanded; reported, not silent
  rule_version         smallint not null,
  primary key (zip, registry_id)
);
alter table public.dev_change_scope_ready enable row level security;
revoke all on public.dev_change_scope_ready from public, anon, authenticated, service_role;
grant select, insert, update on public.dev_change_scope_ready to service_role;

-- The unhealthy sources, explicitly: pairs whose newest receipt is not a complete expanded read, plus pairs with a baseline that
-- is suspended. A persistently incomplete source stays here until a complete expanded read replaces it.
create or replace view public.dev_change_scope_health with (security_invoker = true) as
select c.zip, c.registry_id, c.scope, c.scope_version, c.complete, c.tick_at, c.describes_current_cache,
       (s.zip is not null) as has_baseline, s.lapsed_at is not null as baseline_suspended, s.scope_version as baseline_version
  from public.dev_source_receipt_current c
  left join public.dev_change_scope_ready s on s.zip = c.zip and s.registry_id = c.registry_id
 where c.scope in ('fallback', 'failed') or (c.scope = 'expanded' and not c.complete) or s.lapsed_at is not null;
revoke all on public.dev_change_scope_health from public, anon, authenticated, service_role;
grant select on public.dev_change_scope_health to service_role;

-- ---- 2. THE RULE VERSION AND THE PROBE ---------------------------------------------------------------------------------
create or replace function public.dev_change_recovery_rule_version() returns smallint
language sql immutable as $$ select 4::smallint $$;

-- THE PROBE. ONE SQL statement = ONE snapshot, so the generation check, the binding of the identities being classified,
-- the stamp read, the source receipts and the readiness rows cannot straddle a concurrent collector write, receipt write or
-- materialisation. `p_keys` are the new comparable identities the caller is about to classify; `p_scan` asks for the receipts
-- even with no keys (a ZIP that may hold readiness). Returns exactly one row.
--   synchronized   true only when classification may proceed (reason 'ok' or 'no_cache')
--   reason         ok | no_cache | cache_clock_missing | invalid_row_generation | rows_not_from_current_cache |
--                  requested_key_not_in_current_generation | empty_materialisation_nonempty_cache
--   stamped_keys   the requested keys the CACHE says were reached only by the polygon widening
--   sources        one object per source that has a receipt for THIS cache generation (receipt.tick_at = cache clock):
--                    reg, scope (expanded|fallback|legacy|failed), version, complete,
--                    baseline (a readiness row exists), continuous (see below)
--                  `continuous` is true only when ALL hold: the receipt is a COMPLETE EXPANDED read; a readiness row exists, is not
--                  suspended and carries the SAME scope version; the receipt of the baseline's own verified generation is still
--                  on record and was a complete expanded read at that version; and NO receipt between that generation and this
--                  one (nor any 'lost' marker for the ZIP) says anything else. A missing receipt is a break, never a pass.
-- The stamp filter is the filter of app_refresh_zip's `src` CTE, read through the same dev_sites_deduped. The cache is read ONLY
-- when synchronised and (keys were requested or p_scan).
create or replace function public.dev_change_recovery_probe(p_zip text, p_keys text[] default '{}', p_scan boolean default false)
returns table (synchronized boolean, reason text, cache_refreshed_at timestamptz, rows_total integer, rows_stale integer,
               rows_invalid integer, keys_requested integer, keys_unmatched integer, stamped_keys text[], sources jsonb)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with c as (
    select d.refreshed_at from public.development_reports d where d.zip = p_zip
  ), m as (
    select a.source_key,
           case when pg_input_is_valid(a.provenance->>'refreshed_at', 'timestamptz')
                then (a.provenance->>'refreshed_at')::timestamptz end as g
      from public.app_projects a
     where a.zip = p_zip and a.record_kind = 'development' and a.source_key is not null
  ), s as (
    select count(*)::integer as total,
           (count(*) filter (where m.g is null))::integer as invalid,
           (count(*) filter (where m.g is not null and m.g is distinct from (select c.refreshed_at from c)))::integer as stale
      from m
  ), k as (
    select count(*)::integer as requested,
           (count(*) filter (where not exists (select 1 from m where m.source_key = q.key and m.g = (select c.refreshed_at from c))))::integer as unmatched
      from unnest(coalesce(p_keys, '{}'::text[])) as q(key)
  ), v as (
    select case
      when not exists (select 1 from c)                 then 'no_cache'
      when (select c.refreshed_at from c) is null       then 'cache_clock_missing'
      when (select s.invalid from s) > 0                then 'invalid_row_generation'
      when (select s.stale from s) > 0                  then 'rows_not_from_current_cache'
      when (select k.unmatched from k) > 0              then 'requested_key_not_in_current_generation'
      when (select s.total from s) = 0 and exists (
             select 1 from public.dev_sites_deduped(p_zip) d
              where coalesce(d.el->>'relevance','') = 'development' and coalesce(d.el->>'scope','') = 'point'
                and coalesce(d.el->>'record_url', d.el->>'url','') <> '')
                                                        then 'empty_materialisation_nonempty_cache'
      else 'ok' end as reason
  ), want as (
    select (select v.reason from v) = 'ok' and (coalesce(p_scan, false) or (select k.requested from k) > 0) as on
  ), st as (
    select x.sk
      from (select public.app_source_key(d.el) as sk
              from public.dev_sites_deduped(p_zip) as d
             where (select want.on from want)
               and d.el->>'scope_origin' = 'polygon_member'
               and coalesce(d.el->>'relevance','') = 'development'
               and coalesce(d.el->>'scope','') = 'point'
               and coalesce(d.el->>'record_url', d.el->>'url','') <> ''
               and public.app_source_key(d.el) is not null) x
  ), rc as (
    select distinct on (r.registry_id) r.registry_id as reg, r.scope, r.scope_version as ver, r.complete
      from public.dev_refresh_source_receipt r
     where (select want.on from want) and r.zip = p_zip and r.registry_id <> '' and r.tick_at = (select c.refreshed_at from c)
     order by r.registry_id, r.response_id desc
  ), rd as (
    select sr.registry_id as reg, sr.scope_version as ver, sr.verified_cache_at as vat, sr.lapsed_at
      from public.dev_change_scope_ready sr where (select want.on from want) and sr.zip = p_zip
  ), src as (
    select rc.reg, rc.scope, rc.ver, rc.complete,
           (rd.reg is not null) as baseline,
           (rc.scope = 'expanded' and rc.complete and rd.reg is not null and rd.lapsed_at is null and rd.ver = rc.ver
            and exists (select 1 from public.dev_refresh_source_receipt a
                         where a.zip = p_zip and a.registry_id = rc.reg and a.tick_at = rd.vat
                           and a.scope = 'expanded' and a.complete and a.scope_version = rd.ver)
            and not exists (select 1 from public.dev_refresh_source_receipt b
                             where b.zip = p_zip and b.tick_at > rd.vat and b.tick_at < (select c.refreshed_at from c)
                               and ((b.registry_id = rc.reg and not (b.scope = 'expanded' and b.complete and b.scope_version = rd.ver))
                                    or (b.registry_id = '' and b.scope = 'lost')))
           ) as continuous
      from rc left join rd on rd.reg = rc.reg
  )
  select v.reason in ('ok', 'no_cache'),
         v.reason,
         (select c.refreshed_at from c),
         (select s.total from s), (select s.stale from s), (select s.invalid from s),
         (select k.requested from k), (select k.unmatched from k),
         coalesce((select array_agg(distinct st.sk) from st where st.sk = any(p_keys)), '{}'::text[]),
         coalesce((select jsonb_agg(jsonb_build_object('reg', src.reg, 'scope', src.scope, 'version', src.ver, 'complete', src.complete,
                                                      'baseline', src.baseline, 'continuous', src.continuous)) from src), '[]'::jsonb)
    from v
$fn$;

-- The ZIP-wide verdict alone (no identities to bind), for tests, the canary gate and operators.
create or replace function public.dev_change_materialization_current(p_zip text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p.synchronized from public.dev_change_recovery_probe(p_zip, '{}'::text[]) p
$$;

-- ---- 3. SPLICE THE TWO LIVE BODIES ------------------------------------------------------------------------------------
do $splice$
declare
  _oid_o oid := 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  _oid_t oid := 'public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)'::regprocedure;
  _def text; _new text; _orig_src text; _new_src text; _back text;
  _pairs_o text[][]; _pairs_t text[][]; i int; n int;
begin
  if position('-- dev_change_recovery:' in (select prosrc from pg_proc where oid = _oid_o)) > 0 then
    return;     -- already spliced (the precondition proved tick is too)
  end if;

  -- ---- dev_change_observe_zip ----
  _pairs_o := array[
    -- declarations
    array[E'  _newconf integer := 0;  -- new identities recorded non-comparable because their copies already contradict\nbegin',
          E'  _newconf integer := 0;  -- new identities recorded non-comparable because their copies already contradict\n  _rec_supp integer := 0;   -- dev_change_recovery: stamped first sightings classified as coverage recovery (not news)\n  _rec_keys text[];         -- dev_change_recovery: the new comparable identities to classify\n  _rp record;               -- dev_change_recovery: the synchronisation probe\n  _rec_cache_at timestamptz; -- dev_change_recovery: the cache generation the probe saw\n  _rec_held integer := 0;   -- dev_change_recovery: stamped first sightings HELD (not observed) because their source was not clean\n  _rdy_ok integer := 0;     -- dev_change_recovery: ZIP x source readiness rows established or re-verified\n  _rdy_lapsed integer := 0; -- dev_change_recovery: readiness rows lapsed (the widening is no longer evidenced)\nbegin'],
    -- classification, before the new identities are written
    array[E'  -- New identities (state first, so events can reference them). One whose copies already contradict is',
          E'  -- dev_change_recovery (rule_version 4): classify first sightings of identities the polygon widening alone reached, per ZIP x\n  -- source x SCOPE VERSION, from the source COMPLETION RECEIPT of this very cache generation (docs/dev-source-receipt.sql), never by\n  -- date and never from the absence of a failure. Receipt = a complete EXPANDED read and a CONTINUOUS verified baseline at the same\n  -- version -> an ordinary first_detected (a genuine arrival). Complete expanded read but no continuous baseline -> coverage_recovered\n  -- (the baseline, or a re-baseline after any break). No receipt / incomplete / fallback / failed -> HELD: the identity is not created\n  -- now, so a later complete read classifies it. A pair is baselined by its receipt ALONE: a complete expanded read with an empty ring\n  -- establishes readiness, so the first record to arrive afterwards is news. Ordinary runs only. The probe runs when there is a\n  -- comparable new identity, a standing baseline, or a non-legacy receipt for the current generation, in ONE statement (one snapshot).\n  -- Nothing has been written yet, so deferring here is clean; the tick retries the ZIP. Evaluated by the one writer.\n  create temp table if not exists _dc_recovery (identity_key text primary key, outcome text not null) on commit delete rows;\n  create temp table if not exists _dc_scopecls (identity_key text primary key, cls text not null) on commit delete rows;\n  create temp table if not exists _dc_scopesrc (reg text primary key, scope text, ver text, complete boolean, baseline boolean, continuous boolean) on commit delete rows;\n  truncate _dc_recovery;\n  truncate _dc_scopecls;\n  truncate _dc_scopesrc;\n  if not _baseline then\n    select array_agg(o.identity_key) into _rec_keys\n      from _dc_obs o\n     where o.is_new and o.here_comparable\n       and not exists (select 1 from _dc_conflict k where k.identity_key = o.identity_key);\n    if _rec_keys is not null\n       or exists (select 1 from public.dev_change_scope_ready r where r.zip = p_zip and r.lapsed_at is null)\n       or exists (select 1 from public.dev_refresh_source_receipt rr\n                    join public.development_reports dd on dd.zip = rr.zip and dd.refreshed_at = rr.tick_at\n                   where rr.zip = p_zip and rr.scope in (''expanded'', ''fallback'', ''failed'')) then\n      select * into _rp from public.dev_change_recovery_probe(p_zip, coalesce(_rec_keys, ''{}''::text[]), true);\n      -- A deferral is needed only when an identity must be classified; with nothing new, an unsynchronised ZIP is simply\n      -- observed as before and the readiness upkeep below waits for a synchronised generation.\n      if not _rp.synchronized and _rec_keys is not null then\n        return jsonb_build_object(''status'', ''deferred'', ''reason'', _rp.reason, ''zip'', p_zip);\n      end if;\n      _rec_cache_at := _rp.cache_refreshed_at;\n      if _rp.synchronized and _rp.reason = ''ok'' then\n        insert into _dc_scopesrc (reg, scope, ver, complete, baseline, continuous)\n        select x.reg, x.scope, x.version, x.complete, x.baseline, x.continuous\n          from jsonb_to_recordset(_rp.sources) as x(reg text, scope text, version text, complete boolean, baseline boolean, continuous boolean);\n        insert into _dc_scopecls (identity_key, cls)\n        select o.identity_key,\n               case when s.reg is null or s.scope <> ''expanded'' or not s.complete then ''hold''\n                    when s.continuous then ''genuine''\n                    else ''recover'' end\n          from _dc_obs o left join _dc_scopesrc s on s.reg = coalesce(o.registry_id, '''')\n         where o.identity_key = any(_rp.stamped_keys);\n        insert into _dc_recovery (identity_key, outcome)\n        select c.identity_key, ''coverage_recovered'' from _dc_scopecls c where c.cls = ''recover'';\n        get diagnostics _rec_supp = row_count;\n        delete from _dc_obs o using _dc_scopecls c where c.identity_key = o.identity_key and c.cls = ''hold'';\n        get diagnostics _rec_held = row_count;\n        -- READINESS, per source: a complete expanded read verifies (or, after any break, re-establishes) the baseline at its version\n        insert into public.dev_change_scope_ready as sr\n          (zip, registry_id, scope_version, established_cache_at, established_run_id, verified_cache_at, rule_version)\n        select p_zip, s.reg, s.ver, _rec_cache_at, p_run, _rec_cache_at, public.dev_change_recovery_rule_version()\n          from _dc_scopesrc s where s.scope = ''expanded'' and s.complete\n        on conflict (zip, registry_id) do update\n          set scope_version = excluded.scope_version,\n              verified_cache_at = excluded.verified_cache_at,\n              established_cache_at = case when (select x.continuous from _dc_scopesrc x where x.reg = sr.registry_id) then sr.established_cache_at else excluded.established_cache_at end,\n              established_run_id = case when (select x.continuous from _dc_scopesrc x where x.reg = sr.registry_id) then sr.established_run_id else excluded.established_run_id end,\n              lapsed_at = null,\n              rule_version = excluded.rule_version;\n        get diagnostics _rdy_ok = row_count;\n        -- …and a source that is NOT a complete expanded read this generation (incomplete, fallback, legacy, failed, or missing from a\n        -- ZIP that has receipts) SUSPENDS its own baseline, explicitly and independently of every other source.\n        if exists (select 1 from _dc_scopesrc) then\n          update public.dev_change_scope_ready r set lapsed_at = now()\n           where r.zip = p_zip and r.lapsed_at is null\n             and not exists (select 1 from _dc_scopesrc s where s.reg = r.registry_id and s.scope = ''expanded'' and s.complete);\n          get diagnostics _rdy_lapsed = row_count;\n        end if;\n      end if;\n    end if;\n  end if;\n\n  -- New identities (state first, so events can reference them). One whose copies already contradict is'],
    -- the first_detected insert: not news when classified as recovery
    array[E'  select o.identity_key, ''first_detected'', not _baseline, _baseline, o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o\n   where o.is_new and o.here_comparable\n',
          E'  select o.identity_key, ''first_detected'',\n         not (_baseline or rc.identity_key is not null),\n         (_baseline or rc.identity_key is not null),\n         o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o left join _dc_recovery rc on rc.identity_key = o.identity_key\n   where o.is_new and o.here_comparable\n'],
    -- the audit rows, after the first_detected insert's GET DIAGNOSTICS
    array[E'  get diagnostics _ev = row_count;\n\n  -- A difference between two comparable observations',
          E'  get diagnostics _ev = row_count;\n\n  insert into public.dev_change_recovery\n    (identity_key, zip, run_id, outcome, publisher_event_date, date_kind, date_state, observed_at, cache_refreshed_at, rule_version)\n  select r.identity_key, p_zip, p_run, r.outcome, o.submitted_at, o.date_kind,\n         case when o.submitted_at is null then ''undated'' when o.submitted_at > o.observed_at::date + 1 then ''future'' else ''dated'' end,\n         o.observed_at, _rec_cache_at, public.dev_change_recovery_rule_version()\n    from _dc_recovery r join _dc_obs o on o.identity_key = r.identity_key\n  on conflict (identity_key) do nothing;\n\n  -- A difference between two comparable observations'],
    -- return value
    array[E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf);',
          E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf,\n                            ''coverage_recovered'', _rec_supp,\n                            ''coverage_held'', _rec_held, ''scope_ready_verified'', _rdy_ok, ''scope_ready_suspended'', _rdy_lapsed);']
  ];
  select prosrc into _orig_src from pg_proc where oid = _oid_o;
  _def := pg_get_functiondef(_oid_o);
  _new := _def;
  for i in 1 .. array_length(_pairs_o, 1) loop
    n := (length(_new) - length(replace(_new, _pairs_o[i][1], ''))) / length(_pairs_o[i][1]);
    if n <> 1 then raise exception 'dev_change_recovery: observe_zip anchor % appears % times (need exactly 1)', i, n; end if;
    _new := replace(_new, _pairs_o[i][1], _pairs_o[i][2]);
  end loop;

  -- ---- dev_change_tick (spliced next, executed together so neither can land alone) ----
  select prosrc into _orig_src from pg_proc where oid = _oid_t;
  _pairs_t := array[
    array[E'  _errs       integer := 0;\n', E'  _errs       integer := 0;\n  _deferred   integer := 0;   -- dev_change_recovery: ZIPs not observed because the cache is newer than the materialisation\n'],
    array[E'      if _res->>''status'' = ''busy'' then _reason := ''busy''; exit; end if;\n',
          E'      if _res->>''status'' = ''busy'' then _reason := ''busy''; exit; end if;\n      -- dev_change_recovery: a deferred ZIP wrote nothing and is NOT marked observed; the next tick tries it again.\n      if _res->>''status'' = ''deferred'' then _deferred := _deferred + 1; continue; end if;\n'],
    array[E'    ''zip_errors'', _errs,\n', E'    ''zip_errors'', _errs,\n    ''zips_deferred'', _deferred,\n']
  ];
  declare _defT text := pg_get_functiondef(_oid_t); _newT text := pg_get_functiondef(_oid_t); begin
    for i in 1 .. array_length(_pairs_t, 1) loop
      n := (length(_newT) - length(replace(_newT, _pairs_t[i][1], ''))) / length(_pairs_t[i][1]);
      if n <> 1 then raise exception 'dev_change_recovery: tick anchor % appears % times (need exactly 1)', i, n; end if;
      _newT := replace(_newT, _pairs_t[i][1], _pairs_t[i][2]);
    end loop;
    execute _new;
    execute _newT;
    -- PROOF: excising every inserted fragment (last first) recovers the ORIGINAL prosrc byte for byte.
    select prosrc into _new_src from pg_proc where oid = _oid_o; _back := _new_src;
    for i in reverse array_length(_pairs_o, 1) .. 1 loop _back := replace(_back, _pairs_o[i][2], _pairs_o[i][1]); end loop;
    if md5(_back) <> '042ce94641c713c6c0b6e7d18c4addb6' then raise exception 'dev_change_recovery: observe_zip splice is not a pure insertion (got %)', md5(_back); end if;
    select prosrc into _new_src from pg_proc where oid = _oid_t; _back := _new_src;
    for i in reverse array_length(_pairs_t, 1) .. 1 loop _back := replace(_back, _pairs_t[i][2], _pairs_t[i][1]); end loop;
    if md5(_back) <> '59ce03a97d78ca872735d613d286c991' then raise exception 'dev_change_recovery: tick splice is not a pure insertion (got %)', md5(_back); end if;
  end;
end $splice$;

-- ---- 4. THE READER RULE, WITH ITS DECISION OWNER -------------------------------------------------------------------------
-- Same columns, same order. Excludes events a baseline-class decision wrote (is_baseline) even from an ordinary run.
create or replace view public.dev_change_event_reportable with (security_invoker = true) as
select e.id, e.identity_key, e.event_type, e.material, e.is_baseline, e.observed_at,
       e.prev_facts, e.new_facts, e.prev_fp, e.new_fp, e.changed_fields,
       e.publisher_event_type, e.publisher_event_date, e.source_id,
       e.derivation_version, e.facts_version, e.rights_class, e.run_id, e.created_at
  from public.dev_change_event e
  join public.dev_change_run r on r.id = e.run_id
 where not r.baseline and not e.is_baseline;
revoke all on public.dev_change_event_reportable from public, anon, authenticated, service_role;
grant select on public.dev_change_event_reportable to service_role;

-- ---- 5. LOCK-DOWN of the new functions: system-only ---------------------------------------------------------------------
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('dev_change_recovery_rule_version',
                  'dev_change_recovery_probe','dev_change_materialization_current') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  if has_function_privilege('anon', 'public.dev_change_recovery_probe(text, text[], boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.dev_change_materialization_current(text)', 'execute')
     or has_table_privilege('anon', 'public.dev_change_scope_ready', 'select')
     or has_table_privilege('authenticated', 'public.dev_change_scope_ready', 'update')
     or has_table_privilege('anon', 'public.dev_change_recovery', 'select')
     or has_table_privilege('authenticated', 'public.dev_change_recovery', 'select') then
    raise exception 'dev_change_recovery: a new object is reachable by anon/authenticated';
  end if;
end $lock$;

-- ROLLBACK (restores the exact original bodies by excising the spliced text; run as one transaction):
--   Re-run this file's splice in reverse: for each (anchor, replacement) pair, replace(replacement -> anchor) in
--   pg_get_functiondef(...) and execute; then `create or replace view public.dev_change_event_reportable` WITHOUT
--   `and not e.is_baseline` (docs/dev-change-reportable.sql). Tables/functions:
--   drop function if exists public.dev_change_materialization_current(text), public.dev_change_recovery_probe(text, text[], boolean),
--     public.dev_change_recovery_rule_version();
--   The table dev_change_recovery is audit history; keep it (the ledger never deletes).
