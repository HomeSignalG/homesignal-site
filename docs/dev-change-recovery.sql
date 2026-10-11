-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER — COVERAGE-RECOVERY PROTECTION   (PR B; SQL OF RECORD, NOT APPLIED)   rule_version 2
--
-- THE PROBLEM
--   When the ZIP-mode scope is widened to the polygon (docs/zip-scope-members.sql, sources/scope-members.ts) a ZIP
--   suddenly SEES records that were always there. The ledger cannot tell "HomeSignal started looking here" from "the
--   publisher published something", so the first ordinary run writes `first_detected`, `material = true`, and every
--   reader of public.dev_change_event_reportable (the report, Follow, property watches, buyer alerts) says a new
--   development appeared. A baseline run would suppress it but also hides a genuine filing that arrives in the same
--   window, and it needs a human per ZIP. Neither is acceptable at 12,722.
--
-- WHAT THIS DOES (one rule, evaluated by the ledger's ONE writer, in the transaction that creates the identity)
--   1. PROVENANCE. The connector stamps `scope_origin = 'polygon_member'` on a record kept ONLY because the polygon
--      widening reached it (never on a record the legacy scope already returned). It rides in the cached `sites`.
--   2. CLASSIFICATION, at first sighting. A NEW comparable identity that is stamped is a COVERAGE RECOVERY, not a
--      publisher event: `first_detected` is written non-material / is_baseline (never announced) and an audit row is
--      written to public.dev_change_recovery. THE DECISION USES NO DATE. rule_version 1 compared the publisher date with
--      a 45-day window; that cannot work: filed / issued / scheduled / estimated / decided dates are different facts, a
--      recent date on a long-published record is common (and the reverse), and a window only moves the error. The
--      publisher date, its kind and its plausibility are RECORDED (descriptive) and never decide.
--   3. SYNCHRONISATION (fail closed). The stamps live in the cache and the identities in app_projects; they describe the
--      same records only when app_projects was materialised from the CURRENT cache generation. The check is done ONLY
--      when there is a new comparable identity to classify (so ordinary observation costs nothing extra), in ONE SQL
--      statement (one snapshot): public.dev_change_recovery_probe(zip, keys). It uses the generation evidence the
--      materializer already writes: every app_projects row's provenance.refreshed_at IS the cache's refreshed_at at the
--      time app_refresh_zip built it (and provenance is part of that function's "changed" tuple, so a completed
--      materialisation rewrites EVERY row to the new value). Therefore a synchronised ZIP has all development rows at
--      exactly the cache's clock; ANY other state is not synchronised. Synchronised requires ALL of:
--         the cache clock exists and is valid; every development row has a valid generation; every one equals the cache
--         clock (equality, never >= / max: one current row among stale ones is NOT synchronised); the identities being
--         classified are present at that generation (binds the rows read earlier to the snapshot of the probe); an empty
--         materialisation is accepted only if the cache holds no development content.
--      If not synchronised the observation returns {status:'deferred'} and writes NOTHING; dev_change_tick does not
--      advance the ZIP's cursor, so it is retried. A cache with no row cannot hold stamps and is synchronised.
--   4. THE READER RULE moves with the decision owner: public.dev_change_event_reportable additionally excludes events with
--      is_baseline = true. Today that excludes NOTHING (measured 2026-10-11: 0 of 50,183 ordinary-run events are
--      is_baseline), so existing readers are unchanged.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It never baselines a ZIP. A later genuine change to a recovered identity is an ordinary event: the identity has
--     one observation and its second comparable observation emits status_changed / source_record_updated as always.
--   * It never deletes or rewrites an event, and never touches an identity the ledger already knows (cross-ZIP copies and
--     copy-conflict handling are unchanged). A recovered record that lapses and returns is a known identity: no second
--     announcement.
--   * It does not change first-detection for an UNSTAMPED record (legacy scope), whatever its age: byte for byte as before.
--
-- THE PRODUCT TRADE (stated, not hidden): a genuinely NEW filing whose location is inside the polygon but outside the legacy
--   centroid square is recorded at first sight and NOT announced as "new"; any later change to it is announced. The affected
--   population is exactly the widened-only ring (stamped records), and it is audited. Distinguishing "new to the publisher"
--   from "new to us" for those records needs evidence the cache does not keep today (per-source scope mode per generation);
--   see docs/zip-scope-recovery-review-2026-10-11.md for the one change that would allow it and why it is not made here.
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
     or to_regprocedure('public.app_source_key(jsonb)') is null then
    raise exception 'dev_change_recovery: the ledger, its tick, the reportable view, dev_sites_deduped or app_source_key is missing';
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

-- ---- 2. THE RULE VERSION AND THE PROBE ---------------------------------------------------------------------------------
create or replace function public.dev_change_recovery_rule_version() returns smallint
language sql immutable as $$ select 2::smallint $$;

-- THE PROBE. ONE SQL statement = ONE snapshot, so the generation check, the binding of the identities being classified
-- and the stamp read cannot straddle a concurrent collector write or materialisation. `p_keys` are the new comparable
-- identities the caller is about to classify. Returns exactly one row.
--   synchronized   true only when classification may proceed (reason 'ok' or 'no_cache')
--   reason         ok | no_cache | cache_clock_missing | invalid_row_generation | rows_not_from_current_cache |
--                  requested_key_not_in_current_generation | empty_materialisation_nonempty_cache
--   stamped_keys   the requested keys the CACHE says were reached only by the polygon widening (empty unless synchronized)
-- The stamp filter is the filter of app_refresh_zip's `src` CTE (verified against the live body 2026-10-11), read through
-- the same dev_sites_deduped, so a key here is exactly a key app_projects holds. The cache is read ONLY when the probe is
-- otherwise synchronised and keys were requested.
create or replace function public.dev_change_recovery_probe(p_zip text, p_keys text[] default '{}')
returns table (synchronized boolean, reason text, cache_refreshed_at timestamptz, rows_total integer, rows_stale integer,
               rows_invalid integer, keys_requested integer, keys_unmatched integer, stamped_keys text[])
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
  )
  select v.reason in ('ok', 'no_cache'),
         v.reason,
         (select c.refreshed_at from c),
         (select s.total from s), (select s.stale from s), (select s.invalid from s),
         (select k.requested from k), (select k.unmatched from k),
         case when v.reason = 'ok' and (select k.requested from k) > 0 then
                coalesce((select array_agg(distinct x.sk)
                            from (select public.app_source_key(d.el) as sk
                                    from public.dev_sites_deduped(p_zip) as d
                                   where d.el->>'scope_origin' = 'polygon_member'
                                     and coalesce(d.el->>'relevance','') = 'development'
                                     and coalesce(d.el->>'scope','') = 'point'
                                     and coalesce(d.el->>'record_url', d.el->>'url','') <> ''
                                     and public.app_source_key(d.el) is not null) x
                           where x.sk = any(p_keys)), '{}'::text[])
              else '{}'::text[] end
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
          E'  _newconf integer := 0;  -- new identities recorded non-comparable because their copies already contradict\n  _rec_supp integer := 0;   -- dev_change_recovery: stamped first sightings classified as coverage recovery (not news)\n  _rec_keys text[];         -- dev_change_recovery: the new comparable identities to classify\n  _rp record;               -- dev_change_recovery: the synchronisation probe\n  _rec_cache_at timestamptz; -- dev_change_recovery: the cache generation the probe saw\nbegin'],
    -- classification, before the new identities are written
    array[E'  -- New identities (state first, so events can reference them). One whose copies already contradict is',
          E'  -- dev_change_recovery: CLASSIFY first sightings of identities the polygon widening alone reached. rule_version 2: a\n  -- stamped first sighting is a COVERAGE RECOVERY, never a publisher event; NO DATE DECIDES. Ordinary runs only (a baseline\n  -- run already writes non-reportable first sightings). The synchronisation probe runs ONLY when there is a comparable new\n  -- identity to classify, in ONE statement (one snapshot). Nothing has been written yet, so deferring here is clean; the tick\n  -- retries the ZIP. Evaluated by the one writer, in the transaction that creates the identity, so no ordinary observation\n  -- can precede its classification.\n  create temp table if not exists _dc_recovery (identity_key text primary key, outcome text not null) on commit delete rows;\n  truncate _dc_recovery;\n  if not _baseline then\n    select array_agg(o.identity_key) into _rec_keys\n      from _dc_obs o\n     where o.is_new and o.here_comparable\n       and not exists (select 1 from _dc_conflict k where k.identity_key = o.identity_key);\n    if _rec_keys is not null then\n      select * into _rp from public.dev_change_recovery_probe(p_zip, _rec_keys);\n      if not _rp.synchronized then\n        return jsonb_build_object(''status'', ''deferred'', ''reason'', _rp.reason, ''zip'', p_zip);\n      end if;\n      _rec_cache_at := _rp.cache_refreshed_at;\n      insert into _dc_recovery (identity_key, outcome)\n      select o.identity_key, ''coverage_recovered'' from _dc_obs o where o.identity_key = any(_rp.stamped_keys);\n      get diagnostics _rec_supp = row_count;\n    end if;\n  end if;\n\n  -- New identities (state first, so events can reference them). One whose copies already contradict is'],
    -- the first_detected insert: not news when classified as recovery
    array[E'  select o.identity_key, ''first_detected'', not _baseline, _baseline, o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o\n   where o.is_new and o.here_comparable\n',
          E'  select o.identity_key, ''first_detected'',\n         not (_baseline or rc.identity_key is not null),\n         (_baseline or rc.identity_key is not null),\n         o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o left join _dc_recovery rc on rc.identity_key = o.identity_key\n   where o.is_new and o.here_comparable\n'],
    -- the audit rows, after the first_detected insert's GET DIAGNOSTICS
    array[E'  get diagnostics _ev = row_count;\n\n  -- A difference between two comparable observations',
          E'  get diagnostics _ev = row_count;\n\n  insert into public.dev_change_recovery\n    (identity_key, zip, run_id, outcome, publisher_event_date, date_kind, date_state, observed_at, cache_refreshed_at, rule_version)\n  select r.identity_key, p_zip, p_run, r.outcome, o.submitted_at, o.date_kind,\n         case when o.submitted_at is null then ''undated'' when o.submitted_at > o.observed_at::date + 1 then ''future'' else ''dated'' end,\n         o.observed_at, _rec_cache_at, public.dev_change_recovery_rule_version()\n    from _dc_recovery r join _dc_obs o on o.identity_key = r.identity_key\n  on conflict (identity_key) do nothing;\n\n  -- A difference between two comparable observations'],
    -- return value
    array[E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf);',
          E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf,\n                            ''coverage_recovered'', _rec_supp);']
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
  if has_function_privilege('anon', 'public.dev_change_recovery_probe(text, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.dev_change_materialization_current(text)', 'execute')
     or has_table_privilege('anon', 'public.dev_change_recovery', 'select')
     or has_table_privilege('authenticated', 'public.dev_change_recovery', 'select') then
    raise exception 'dev_change_recovery: a new object is reachable by anon/authenticated';
  end if;
end $lock$;

-- ROLLBACK (restores the exact original bodies by excising the spliced text; run as one transaction):
--   Re-run this file's splice in reverse: for each (anchor, replacement) pair, replace(replacement -> anchor) in
--   pg_get_functiondef(...) and execute; then `create or replace view public.dev_change_event_reportable` WITHOUT
--   `and not e.is_baseline` (docs/dev-change-reportable.sql). Tables/functions:
--   drop function if exists public.dev_change_materialization_current(text), public.dev_change_recovery_probe(text, text[]),
--     public.dev_change_recovery_rule_version();
--   The table dev_change_recovery is audit history; keep it (the ledger never deletes).
